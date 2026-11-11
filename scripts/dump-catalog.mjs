/**
 * Dump light + full course catalogs for near-instant API serving.
 *
 * Usage:
 *   node --env-file=.env.local scripts/dump-catalog.mjs
 *   node --env-file=.env.local scripts/dump-catalog.mjs --scraped rows.json    # what the nightly job runs
 *   node --env-file=.env.local scripts/dump-catalog.mjs --courses rows.json --out-dir ./local-catalog
 *
 * Writes data/catalog/{light,full}.json and public/catalog/instructors.json,
 * which the SSR course/department/instructor pages read instead of scanning the
 * DB. full.json and light.json are deliberately NOT under public/: anything
 * there is served as a static asset, which published the whole catalog at
 * /catalog/full.json. instructors.json stays public because the browser fetches
 * it directly. See src/lib/catalog-paths.ts.
 * The files are committed, so refresh-courses.yml re-runs this and commits the
 * result.
 *
 * One sequential keyset pass fetches every row with sections (~22s for the
 * whole catalog) and light rows are derived from it. Concurrency is
 * deliberately absent: parallel section reads exhausted the free-tier
 * instance's memory on 2026-08-10 and took the data API down with it.
 *
 * --scraped takes the columns scrape-sections.mjs writes from the rows that
 * run just wrote (its --save-rows file) and reads only the rest (ratings, title,
 * cross-listings) from the table. Re-reading every row's sections, about 40 MB
 * of jsonb, right after writing them was the bulk of the nightly read, and the
 * dump comes out byte for byte the same (tests/dump-catalog-scraped.test.ts).
 */

import { createClient } from '@supabase/supabase-js'
import { existsSync, mkdirSync, writeFileSync, readFileSync, realpathSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { buildCrossListGroups, normalizeCourseId } from '../src/lib/cross-list.mjs'
import { SCRAPED_FIELDS } from './catalog-rows.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
// full.json / light.json are server-only; instructors.json is browser-fetched.
const DEFAULT_SERVER_OUT_DIR = join(__dirname, '..', 'data', 'catalog')
const DEFAULT_PUBLIC_OUT_DIR = join(__dirname, '..', 'public', 'catalog')

/**
 * --courses reads catalog rows from a file (scrape-sections.mjs --out) instead
 * of Supabase, and --out-dir writes all three dumps into one directory instead
 * of the split defaults. Together they build a full local catalog without touching the
 * shared database or the committed dumps. Evaluations are still read from
 * Supabase, read-only, because isNew needs the teaching history.
 */
function parseArgs() {
  const args = process.argv.slice(2)
  const opts = { courses: null, scraped: null, outDir: null }
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--courses' && args[i + 1]) opts.courses = args[i + 1]
    if (args[i] === '--scraped' && args[i + 1]) opts.scraped = args[i + 1]
    if (args[i] === '--out-dir' && args[i + 1]) opts.outDir = args[i + 1]
  }
  return opts
}

/** SUNet → full name; also used to expand leftover "Last, F." rows already in the DB. */
const INSTRUCTOR_OVERRIDES = JSON.parse(
  readFileSync(join(__dirname, 'instructor-name-overrides.json'), 'utf8')
)

const FULL_COLUMNS =
  'course_id, subject, code, title, description, units, grading, instructors, terms, sections, hours, quality, quality_pct, quality_n, rank_scope, rating_breakdown, cross_list_with, difficulty'
// What --scraped still reads from the table: every column the scrape does not
// write, plus title for rows the scrape no longer returns (cross-list grouping
// in markNewCourses reads every row's title).
const SCRAPED_MODE_COLUMNS =
  'course_id, title, hours, quality, quality_pct, quality_n, rank_scope, rating_breakdown, cross_list_with, difficulty'
const LIGHT_KEYS = [
  'course_id', 'subject', 'code', 'title', 'units',
  'instructors', 'terms', 'grading', 'hours', 'quality', 'quality_pct', 'quality_n',
  'rank_scope', 'rating_breakdown', 'cross_list_with', 'difficulty', 'isNew',
]

const PRIOR_OFFERINGS_PATH = join(__dirname, 'prior-offerings.json')
const MIN_PRIOR_YEARS = 3

const PAGE = 250
const MAX_ATTEMPTS = 5

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function isRetryable(err) {
  const msg = err?.message || ''
  return (
    err?.code === '57014' ||
    /statement timeout|upstream request timeout|fetch failed|ECONNRESET|schema cache/i.test(msg)
  )
}

/**
 * A quality of 0 is not a rating — the scale is 1-5, so 0 means "we computed
 * nothing", and rendering it puts the worst possible score on a course nobody
 * rated badly. scrape-evaluations.mjs stopped emitting these (it filters
 * `median > 0`), but rows written by earlier versions are still in the table:
 * CEE126Z and CEE177Q as of 2026-08-25. Same argument for hours and the
 * hours/unit ratio derived from it.
 */
function dropNonPositiveMetrics(rows) {
  let cleared = 0
  for (const row of rows) {
    for (const key of ['quality', 'hours', 'difficulty']) {
      if (row[key] != null && !(row[key] > 0)) {
        row[key] = null
        cleared++
      }
    }
  }
  if (cleared) console.log(`  cleared ${cleared} non-positive eval metric(s)`)
}

/** Catalog stubs (no sections / TBD-only) stay out of the dump. */
function isGradeable(row) {
  if ((row.sections || []).length > 0) return true
  const g = String(row.grading || '').trim()
  return Boolean(g) && g !== 'TBD'
}

async function fetchAll(supabase, columns = FULL_COLUMNS) {
  const rows = []
  let cursor = null
  let page = 0

  while (true) {
    page++
    let result = null
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      let q = supabase
        .from('courses')
        .select(columns)
        .order('course_id', { ascending: true })
        .limit(PAGE)
      if (cursor) q = q.gt('course_id', cursor)

      result = await q
      if (!result.error) break
      if (!isRetryable(result.error) || attempt === MAX_ATTEMPTS) {
        throw new Error(`page ${page} failed: ${result.error.message || result.error.code}`)
      }
      const wait = 1000 * attempt
      console.warn(`  page ${page} retry ${attempt}/${MAX_ATTEMPTS} in ${wait}ms (${result.error.message})`)
      await sleep(wait)
    }

    const data = result.data || []
    if (!data.length) break
    rows.push(...data)
    cursor = data[data.length - 1].course_id
    if (page % 10 === 0) console.log(`  ${rows.length} rows (page ${page})`)
    if (data.length < PAGE) break
    await sleep(50)
  }

  return rows
}

/** Keep dump slugs in lockstep with src/lib/instructors.ts. */
function fold(text) {
  return String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}
function slugPart(text) {
  return fold(text).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}
function parseInstructorName(raw) {
  const name = String(raw || '').replace(/\s+/g, ' ').trim()
  if (name.includes(',')) {
    const [last, ...rest] = name.split(',')
    return { last: last.trim(), first: rest.join(',').trim() }
  }
  const tokens = name.split(' ')
  if (tokens.length > 1) return { last: tokens.slice(1).join(' '), first: tokens[0] }
  return { last: name, first: '' }
}
function hasFullFirstName(first) {
  return fold(first).replace(/[^a-z0-9]/g, '').length > 1
}
function instructorSlug(raw) {
  const { last, first } = parseInstructorName(raw)
  const lastSlug = slugPart(last)
  if (!first) return lastSlug
  return `${lastSlug}-${hasFullFirstName(first) ? slugPart(first) : fold(first)[0]}`
}
function instructorInitialSlug(raw) {
  const { last, first } = parseInstructorName(raw)
  const lastSlug = slugPart(last)
  const initial = fold(first).replace(/[^a-z0-9]/g, '')[0]
  return initial ? `${lastSlug}-${initial}` : lastSlug
}

/** "heller, h" → "Heller, H. Craig" for rows scraped before SUNet overrides. */
const ABBR_TO_FULL = new Map()
for (const full of Object.values(INSTRUCTOR_OVERRIDES)) {
  const { last, first } = parseInstructorName(full)
  const initial = fold(first).replace(/[^a-z]/g, '')[0]
  if (!last || !initial) continue
  ABBR_TO_FULL.set(`${fold(last)}, ${initial}`, full)
}
// ExploreCourses stores Ann Miura-Ko's firstName as "R." under sunet amiura.
ABBR_TO_FULL.set('miura-ko, r', INSTRUCTOR_OVERRIDES.amiura)

function expandInstructorName(raw) {
  const name = String(raw || '').replace(/\s+/g, ' ').trim()
  if (!name) return name
  const { last, first } = parseInstructorName(name)
  if (hasFullFirstName(first)) return name
  const initial = fold(first).replace(/[^a-z]/g, '')[0]
  if (!initial) return name
  return ABBR_TO_FULL.get(`${fold(last)}, ${initial}`) || name
}

function expandCourseInstructors(row) {
  const instructors = Array.from(
    new Set((row.instructors || []).map(expandInstructorName).filter(Boolean))
  )
  const sections = (row.sections || []).map((section) => ({
    ...section,
    meetings: (section.meetings || []).map((meeting) => ({
      ...meeting,
      instructors: Array.from(
        new Set((meeting.instructors || []).map(expandInstructorName).filter(Boolean))
      ),
    })),
  }))
  return { ...row, instructors, sections }
}

/**
 * The three evaluation columns the dump uses, for every report, in one pass.
 * Keyset pages on the primary key: the two passes this replaced each paged by
 * OFFSET over course_id, so every page re-walked all the rows before it, and
 * the table was read twice. Comments and questions are never selected.
 */
export async function fetchEvaluationIndex(supabase) {
  const rows = []
  let cursor = null
  while (true) {
    let q = supabase
      .from('evaluations')
      .select('id, course_id, instructor, term')
      .order('id', { ascending: true })
      .limit(1000)
    if (cursor != null) q = q.gt('id', cursor)
    const { data, error } = await q
    if (error) throw new Error(`evaluations page after id ${cursor} failed: ${error.message}`)
    if (!data?.length) break
    rows.push(...data)
    cursor = data[data.length - 1].id
    if (data.length < 1000) break
  }
  return rows
}

const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

/**
 * Every raw instructor spelling we know of, plus a course-scoped map that
 * turns catalog initials into a full-name slug when evaluation history for
 * that course_id points at exactly one person ("Clark, S." on CS 229 →
 * clark-susan). Catalog rows only cover upcoming terms and abbreviate first
 * names; evaluations supply both the history and the full names.
 */
export function buildInstructorDump(evaluations, courseRows) {
  const names = new Set()
  for (const row of courseRows) {
    for (const name of row.instructors || []) if (name) names.add(name)
  }

  // courseId → initialSlug → Set of named slugs seen in evaluations
  const byCourse = new Map()

  for (const row of evaluations) {
    if (!row.instructor) continue
    names.add(row.instructor)
    if (!row.course_id || !hasFullFirstName(parseInstructorName(row.instructor).first)) continue
    const initial = instructorInitialSlug(row.instructor)
    const slug = instructorSlug(row.instructor)
    if (!initial || !slug) continue
    let byInitial = byCourse.get(row.course_id)
    if (!byInitial) {
      byInitial = new Map()
      byCourse.set(row.course_id, byInitial)
    }
    let set = byInitial.get(initial)
    if (!set) {
      set = new Set()
      byInitial.set(initial, set)
    }
    set.add(slug)
  }

  // Course ids in code-unit order, the order the old course_id-ordered read
  // produced them in (every id in the 2026-11-10 instructors.json is in it).
  const courseLinks = {}
  for (const courseId of [...byCourse.keys()].sort(byCodeUnit)) {
    const byInitial = byCourse.get(courseId)
    const links = {}
    for (const [initial, slugs] of byInitial) {
      if (slugs.size === 1) links[initial] = [...slugs][0]
    }
    if (Object.keys(links).length > 0) courseLinks[courseId] = links
  }

  return { names: Array.from(names).sort(), courseLinks }
}

/**
 * Course IDs the previous catalogs scheduled, written by
 * `scrape-sections.mjs --prior-years`. Returns null when the file is missing or
 * covers fewer than MIN_PRIOR_YEARS years, so a bad backfill leaves isNew unset
 * instead of marking the whole catalog new.
 */
function readPriorOfferings() {
  if (!existsSync(PRIOR_OFFERINGS_PATH)) return null
  const byYear = JSON.parse(readFileSync(PRIOR_OFFERINGS_PATH, 'utf8'))
  const years = Object.keys(byYear).sort()
  if (years.length < MIN_PRIOR_YEARS) return null
  const ids = new Set()
  for (const year of years) for (const id of byYear[year] || []) ids.add(id)
  return { ids, years, earliestYearStart: parseInt(years[0].slice(0, 4), 10) }
}

// Autumn belongs to the academic year it starts; Winter/Spring/Summer to the one before.
const SEASON_YEAR_OFFSET = { Autumn: 0, Fall: 0, Winter: -1, Spring: -1, Summer: -1 }

/** course_ids with an evaluation from academic year `minYearStart` or later. */
function recentlyTaught(evaluations, minYearStart) {
  const taught = new Set()
  for (const row of evaluations) {
    if (!row.course_id) continue
    const match = /^(Autumn|Fall|Winter|Spring|Summer)\s+(\d{4})/.exec(row.term || '')
    if (!match) continue
    if (parseInt(match[2], 10) + SEASON_YEAR_OFFSET[match[1]] >= minYearStart) taught.add(row.course_id)
  }
  return taught
}


/**
 * Course codes a title names, whether or not they are still in the catalog.
 *
 * Distinct from buildCrossListGroups, which unions only codes that exist today because a
 * missing code cannot be a navigation target. Here the codes are looked up in teaching
 * HISTORY, so a sibling Stanford has since retired is exactly the evidence that matters:
 * ENGLISH 168B names ENGLISH 268A, which no longer ships but was taught, and dropping it
 * flagged a long-running course as new.
 */
function extractCrossListedIds(title) {
  const ids = []
  for (const match of String(title || '').matchAll(/\(([^)]+)\)/g)) {
    const inner = match[1]
    if (!/[A-Z]{2,}(?:&[A-Z]+)?\s+\d/i.test(inner)) continue
    for (const code of inner.matchAll(/([A-Z]{2,}(?:&[A-Z]+)?)\s+(\d+[A-Z]*)/gi)) {
      ids.push(`${code[1]}${code[2]}`.toUpperCase().replace(/\s+/g, ''))
    }
  }
  return ids
}

/**
 * Flag courses the last three catalogs never scheduled. Evaluation history is a
 * second opinion: plenty of long-standing courses (independent study, seminars,
 * low-enrollment sections) never collect evaluations, but anything that DID
 * collect one in the window was clearly taught and is not new.
 */
function markNewCourses(evaluations, rows, catalog) {
  const prior = readPriorOfferings()
  if (!prior) {
    console.warn(`  ⚠ ${PRIOR_OFFERINGS_PATH} missing or short of ${MIN_PRIOR_YEARS} years — no isNew flags. Run: scrape-sections.mjs --prior-years`)
    return
  }
  const taught = recentlyTaught(evaluations, prior.earliestYearStart)

  // Titles declare siblings pairwise and inconsistently, so reading only this row's
  // title misses a class whose OTHER codes name it: MATSCI 402A's own title says nothing
  // while EE 402A, EASTASN 402A and EALC 402A all list it, and it was flagged a brand-new
  // course despite the class having run since 2023 -- next to a rating inherited from its
  // siblings. Group by connected component over the whole catalog, the same grouping
  // refreshMetrics and the course page use, so "new" and the rating cannot disagree.
  const groups = buildCrossListGroups(
    (catalog || rows).map(course => ({
      id: course.course_id,
      title: course.title || '',
      crossListWith: course.cross_list_with || [],
    })),
  )
  const groupOf = new Map()
  for (const members of groups.values()) {
    const ids = members.map(normalizeCourseId)
    for (const member of members) groupOf.set(normalizeCourseId(member), ids)
  }

  let isNew = 0
  let existing = 0
  for (const row of rows) {
    // A course with no sections is a dormant listing, not an offering: leave
    // isNew unset rather than answering. The filter needs that third state —
    // false means "we checked, it ran before" and blocks its whole cross-list
    // group; undefined must not, or a section-less sibling would hide a
    // genuinely new course.
    if (!(row.sections || []).length) continue
    // Judge the whole cross-list group, not just this row's code: a course keeps
    // running while gaining a new code (CS 140M on the long-running EE 186), and
    // which sibling carries the sections moves between years.
    // Two sources, because they answer different questions. The group covers siblings
    // whose titles name this row but not the reverse; the raw title codes cover siblings
    // that have left the catalog and so are absent from the group.
    const self = normalizeCourseId(row.course_id)
    const codes = new Set([self, ...(groupOf.get(self) || []), ...extractCrossListedIds(row.title)])
    if ([...codes].some((id) => prior.ids.has(id) || taught.has(id))) {
      row.isNew = false
      existing++
      continue
    }
    row.isNew = true
    isNew++
  }
  console.log(`  ${isNew} new courses, ${existing} known-existing (unscheduled in ${prior.years.join(', ')} and no evaluations since ${prior.earliestYearStart})`)
}

/**
 * Postgres returns a jsonb object's keys shortest first, then bytewise, not in
 * the order they were written. The dump has always been read back from jsonb,
 * so rows taken from the scrape's own file are put in that order to come out
 * byte for byte the same.
 */
export function jsonbKeyOrder(value) {
  if (Array.isArray(value)) return value.map(jsonbKeyOrder)
  if (value && typeof value === 'object') {
    const keys = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort((a, b) => Buffer.byteLength(a) - Buffer.byteLength(b) || Buffer.compare(Buffer.from(a), Buffer.from(b)))
    return Object.fromEntries(keys.map((key) => [key, jsonbKeyOrder(value[key])]))
  }
  return value
}

const JSONB_COLUMNS = new Set(['sections'])

/**
 * The table's rows, rebuilt from the rows the scrape just wrote plus the
 * columns only the table has. Every row the scrape returned is in the table
 * (it upserts them or finds them unchanged); a row it did not return has had
 * its schedule cleared, so it carries no sections, and is kept only for its
 * title and cross-listings.
 */
export function rowsFromScrape(scraped, tableRows) {
  const scrapedById = new Map(scraped.map((row) => [row.course_id, row]))
  const columns = FULL_COLUMNS.split(',').map((column) => column.trim())
  const seen = new Set()
  const rows = tableRows.map((tableRow) => {
    const fresh = scrapedById.get(tableRow.course_id)
    if (!fresh) return { ...tableRow, sections: [], terms: [] }
    seen.add(tableRow.course_id)
    return Object.fromEntries(columns.map((column) => {
      if (!SCRAPED_FIELDS.includes(column)) return [column, tableRow[column] ?? null]
      const value = fresh[column] ?? null
      return [column, JSONB_COLUMNS.has(column) ? jsonbKeyOrder(value) : value]
    }))
  })
  const missing = scraped.filter((row) => !seen.has(row.course_id)).map((row) => row.course_id)
  if (missing.length) {
    throw new Error(`${missing.length} scraped rows are not in the courses table (${missing.slice(0, 5).join(', ')}); run without --scraped`)
  }
  return rows
}

/**
 * The three dumps as strings, from the table or from a scrape's rows plus the table.
 * @param {{ from: (table: string) => any }} supabase
 * @param {{ courses?: object[] | null, scraped?: object[] | null }} [opts]
 */
export async function buildCatalogDump(supabase, { courses = null, scraped = null } = {}) {
  const source = courses
    ? courses
    : scraped
      ? rowsFromScrape(scraped, await fetchAll(supabase, SCRAPED_MODE_COLUMNS))
      : await fetchAll(supabase)
  const allRaw = source.filter(isGradeable).map(expandCourseInstructors)
  // Browse/API dump is offerings only — zero-section shells stay in Supabase for
  // eval history joins but should not ship in the static catalog.
  const dropped = allRaw.filter((c) => !(c.sections || []).length).length
  const all = allRaw.filter((c) => (c.sections || []).length > 0)
  if (dropped) console.log(`  dropped ${dropped} zero-section rows from dump`)

  const evaluations = await fetchEvaluationIndex(supabase)
  markNewCourses(evaluations, all, source)
  dropNonPositiveMetrics(all)

  const light = all.map((row) => Object.fromEntries(LIGHT_KEYS.map((k) => [k, row[k]])))
  const instructors = buildInstructorDump(evaluations, all)
  return {
    all,
    instructors,
    fullJson: JSON.stringify(all),
    lightJson: JSON.stringify(light),
    instructorsJson: JSON.stringify(instructors),
  }
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    process.exit(1)
  }

  const opts = parseArgs()
  const supabase = createClient(url, key, { auth: { persistSession: false } })
  const serverOutDir = opts.outDir ?? DEFAULT_SERVER_OUT_DIR
  const publicOutDir = opts.outDir ?? DEFAULT_PUBLIC_OUT_DIR
  mkdirSync(serverOutDir, { recursive: true })
  mkdirSync(publicOutDir, { recursive: true })

  const from = opts.courses ?? opts.scraped
  console.log(from ? `Dumping catalog from ${from}…` : 'Dumping catalog…')
  const t0 = Date.now()
  const { all, instructors, fullJson, lightJson, instructorsJson } = await buildCatalogDump(supabase, {
    courses: opts.courses ? JSON.parse(readFileSync(opts.courses, 'utf8')) : null,
    scraped: opts.scraped ? JSON.parse(readFileSync(opts.scraped, 'utf8')) : null,
  })

  if (!all.length) {
    console.error('Refusing to keep an empty dump - aborting so a bad run cannot ship.')
    process.exit(1)
  }

  writeFileSync(join(serverOutDir, 'full.json'), fullJson)
  writeFileSync(join(serverOutDir, 'light.json'), lightJson)
  writeFileSync(join(publicOutDir, 'instructors.json'), instructorsJson)
  const linkCount = Object.values(instructors.courseLinks).reduce((n, m) => n + Object.keys(m).length, 0)
  console.log(`  ${instructors.names.length} instructor names, ${linkCount} course-scoped links`)

  const scheduled = all.filter((c) => (c.terms || []).length > 0)
  console.log(
    `${all.length} courses in ${((Date.now() - t0) / 1000).toFixed(1)}s — ` +
    `full ${(Buffer.byteLength(fullJson) / 1e6).toFixed(1)} MB, ` +
    `light ${(Buffer.byteLength(lightJson) / 1e6).toFixed(1)} MB`,
  )
  console.log(`  scheduled ${scheduled.length} (all dumped rows have sections)`)
}

// Only when run, so tests can import the helpers without starting a dump.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
