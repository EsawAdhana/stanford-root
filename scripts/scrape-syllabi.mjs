/**
 * Build the syllabus availability index from Stanford's own syllabus service.
 *
 * Usage:
 *   node scripts/scrape-syllabi.mjs --recent 4 --attempts 6   (what CI runs)
 *   node scripts/scrape-syllabi.mjs --years 5                  (full backfill)
 *
 * Past terms never gain syllabi, and the merge below keeps what they already
 * have, so the daily job only re-scrapes the newest few terms. Run the full
 * backfill by hand when the five-year window rolls.
 *
 * Why this exists: the "View Syllabus" button used to link to
 * syllabus.stanford.edu/syllabus/doWebAuth/<id>/<id> for every course, and that
 * URL 302s to WebAuth whether or not a syllabus was ever posted -- so a dead
 * link and a live one are indistinguishable until after you log in. On
 * 2026-09-13 only 378 of Autumn 2026's 3,734 course-sections had a published
 * syllabus, and Winter/Spring/Summer 2027 had none at all, so ~9 in 10 clicks
 * ended at a login wall for nothing.
 *
 * The syllabus SPA is an Angular app backed by three unauthenticated JSON
 * endpoints (no key, no cookie -- see the network tab on the search page):
 *   /syllabus/getAllActiveTerms/            -> [{ term: "F26", title: "Fall 2026" }]
 *   /syllabus/getAllSubjects/               -> [{ id: "CS", title: "Computer Science" }]
 *   /syllabus/searchCourses/{term}/{query}/ -> rows carrying hasSyllabus,
 *                                              published and syllabusVisibility
 * Querying by bare subject code returns every course in that subject for the
 * term, which is how one pass covers the catalog: 335 subjects per term.
 *
 * What counts as linkable is taken from the service's own link builder rather
 * than guessed:
 *
 *   "PUBLIC" == syllabusVisibility
 *     ? (isOnlyOneFile ? <download action, no URL> : `#/viewSyllabus/${courseId}/${origCourseId}`)
 *     : `/syllabus/doWebAuth/${courseId}/${origCourseId}`
 *
 * and the whole block only renders when `hasSyllabus`. Two consequences that
 * cost a round trip to learn: `published` is NOT part of it (it gates a
 * separate "Canvas resources" line, and 239 of Autumn 2026's rows have a real
 * file with published false), and the two path segments are DIFFERENT ids.
 * This scrape therefore records the flags rather than applying a predicate, so
 * src/lib/syllabus.ts can decide without a re-pull.
 *
 * The service is not consistent between requests. The same subject+term query
 * returns rows with their syllabus flags stripped on a minority of attempts
 * (ATTEMPTS below is why: ARTHIST F26 came back with 18 syllabi four times and
 * 0 the fifth), and the stripping is per row, not per response -- two
 * best-of-three runs of Autumn 2026 still disagreed about 99 sections. One
 * degraded 20-term run silently lost 300 courses.
 *
 * So each subject is queried ATTEMPTS times and the rows are unioned: a row
 * counts as having a syllabus if any attempt said so. On top of that the
 * finished index is merged over the previous one, so a bad scrape can never
 * delete a syllabus that was seen before and the committed file converges
 * across daily runs rather than flapping.
 *
 * Cross-listings are why the two ids differ. `origCourseId` is the listing you
 * searched and `courseId` is the listing that owns the file: querying AFRICAAM
 * returns AFRICAAM 10 as `origCourseId: F26-AFRICAAM-10-01` with
 * `courseId: F26-CSRE-10-01`. Passing the listing id twice (which is what the
 * URL shape tempts you into) loads the viewer with no document in it, which is
 * indistinguishable from a gated syllabus. So each entry stores the owner id
 * alongside the section, and entries are filed under the listing.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BASE = 'https://syllabus.stanford.edu/syllabus'
const DEFAULT_OUT = join(__dirname, '..', 'public', 'syllabi', 'index.json')
const CONCURRENCY = 16
const RETRIES = 3
/** Queries per subject, unioned. See the note on inconsistent responses above. */
const ATTEMPTS = 3

function parseArgs() {
  const args = process.argv.slice(2)
  const opts = { years: 5, recent: 0, out: DEFAULT_OUT, terms: null, attempts: ATTEMPTS }
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--years' && args[i + 1]) opts.years = Number(args[++i])
    if (args[i] === '--out' && args[i + 1]) opts.out = args[++i]
    if (args[i] === '--attempts' && args[i + 1]) opts.attempts = Math.max(1, Number(args[++i]))
    if (args[i] === '--recent' && args[i + 1]) opts.recent = Math.max(1, Number(args[++i]))
    if (args[i] === '--terms' && args[i + 1]) opts.terms = args[++i].split(',').map(s => s.trim()).filter(Boolean)
  }
  return opts
}

async function getJson(path) {
  let lastErr
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    try {
      const res = await fetch(`${BASE}${path}`, { headers: { accept: 'application/json' } })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.json()
    } catch (err) {
      lastErr = err
      await new Promise(r => setTimeout(r, 500 * (attempt + 1)))
    }
  }
  throw lastErr
}

/** Run `task` over `items` with a fixed pool, preserving nothing but completion. */
async function pooled(items, task) {
  let cursor = 0
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (cursor < items.length) await task(items[cursor++])
  })
  await Promise.all(workers)
}

/** "F26" -> 2026.3, "W27" -> 2027.0 -- chronological, matching src/lib/terms.ts. */
const SEASON_RANK = { W: 0, Sp: 1, Su: 2, F: 3 }
function termSortKey(code) {
  const m = /^(Sp|Su|W|F)(\d{2})$/.exec(code)
  if (!m) return -1
  return (2000 + Number(m[2])) * 10 + SEASON_RANK[m[1]]
}

/**
 * "F26-CS-106A-01" -> { courseKey: "CS-106A", section: "01" }. Subjects and
 * codes can contain hyphens, so the term prefix and the trailing section are
 * split off by position rather than by counting separators.
 */
function splitId(id, term) {
  if (!id.startsWith(`${term}-`)) return null
  const rest = id.slice(term.length + 1)
  const cut = rest.lastIndexOf('-')
  if (cut <= 0) return null
  const courseKey = rest.slice(0, cut)
  const section = rest.slice(cut + 1)
  if (!courseKey || !section) return null
  return { courseKey, section }
}

async function main() {
  const opts = parseArgs()

  const [allTerms, allSubjects] = await Promise.all([
    getJson('/getAllActiveTerms/'),
    getJson('/getAllSubjects/'),
  ])

  let terms = allTerms
    .map(t => t.term)
    .filter(t => termSortKey(t) > 0)
    .sort((a, b) => termSortKey(a) - termSortKey(b))

  // The window is what the committed index is allowed to contain; `terms` is
  // the subset this run re-scrapes. Keeping them separate is what lets the
  // daily job touch only recent terms without the merge dropping the rest.
  // Older syllabi are real but a 2018 reading list is not what someone
  // planning next quarter wants to see, hence the five-year default.
  const newestYear = Math.floor(termSortKey(terms[terms.length - 1]) / 10)
  const windowTerms =
    Number.isFinite(opts.years) && opts.years > 0
      ? terms.filter(t => Math.floor(termSortKey(t) / 10) > newestYear - opts.years)
      : terms

  if (opts.terms) {
    terms = windowTerms.filter(t => opts.terms.includes(t))
  } else if (opts.recent > 0) {
    terms = windowTerms.slice(-opts.recent)
  } else {
    terms = windowTerms
  }

  const subjects = allSubjects.map(s => s.id).filter(Boolean)
  console.log(`Indexing ${terms.length} terms x ${subjects.length} subjects: ${terms.join(', ')}`)

  /**
   * courseKey ("CS-106A") -> term code -> section -> entry.
   *
   * Every flag the viewer's behaviour turns on is recorded rather than reduced
   * to a boolean here, because working out which combination actually renders
   * took several rounds of logged-in testing and revising it should not need a
   * 17-minute re-pull. Keys are short and defaults are omitted:
   *   s    section number
   *   p    0 when published is false (default true)
   *   v    syllabusVisibility, "P"ublic or "C"ourse (default INSTITUTION)
   *   c    courseVisibility, "P"ublic or "I"nstitution (default COURSE)
   *   o    owning id minus its term prefix, when cross-listed
   *   one  1 when isOnlyOneFile
   */
  const courses = new Map()
  const termTitles = Object.fromEntries(allTerms.map(t => [t.term, t.title]))
  const stats = {}

  for (const term of terms) {
    const started = Date.now()
    let rows = 0
    let withSyllabus = 0
    let partialSubjects = 0
    const failures = []

    await pooled(subjects, async subject => {
      const path = `/searchCourses/${encodeURIComponent(term)}/${encodeURIComponent(subject)}/`
      /** courseId -> the best row seen for it across attempts. */
      const merged = new Map()
      let answered = 0
      let lastErr = null
      let rowCount = 0

      for (let attempt = 0; attempt < opts.attempts; attempt++) {
        let candidate
        try {
          candidate = await getJson(path)
        } catch (err) {
          lastErr = err
          continue
        }
        if (!Array.isArray(candidate)) continue
        answered++
        rowCount = Math.max(rowCount, candidate.length)
        for (const row of candidate) {
          const id = row?.courseId ? `${row.courseId}|${row.origCourseId}` : null
          if (!id) continue
          const seen = merged.get(id)
          // A row claiming a syllabus beats one that does not: the failure
          // mode is flags going missing, never appearing from nowhere.
          if (!seen || (row.hasSyllabus && !seen.hasSyllabus)) merged.set(id, row)
          else if (seen.hasSyllabus && row.hasSyllabus && !seen.published && row.published) {
            merged.set(id, row)
          }
        }
      }

      if (answered === 0) {
        failures.push(`${subject}: ${lastErr ? lastErr.message : 'no usable response'}`)
        return
      }
      if (answered < opts.attempts) partialSubjects++
      const results = [...merged.values()]
      rows += rowCount

      for (const row of results) {
        if (!row?.hasSyllabus) continue
        const visibility = row.syllabusVisibility
        if (!visibility) continue

        // The listing this row is filed under, and the listing that owns the
        // file. They differ for cross-listings, and the viewer needs both.
        const listing = splitId(String(row.origCourseId || row.courseId || ''), term)
        const owner = splitId(String(row.courseId || ''), term)
        if (!listing || !owner) continue

        if (!courses.has(listing.courseKey)) courses.set(listing.courseKey, {})
        const byTerm = courses.get(listing.courseKey)
        if (!byTerm[term]) byTerm[term] = {}
        if (byTerm[term][listing.section]) continue

        const ownerSuffix = `${owner.courseKey}-${owner.section}`
        byTerm[term][listing.section] = {
          s: listing.section,
          ...(row.published === false && { p: 0 }),
          ...(visibility === 'PUBLIC' && { v: 'P' }),
          ...(visibility === 'COURSE' && { v: 'C' }),
          ...(row.courseVisibility === 'PUBLIC' && { c: 'P' }),
          ...(row.courseVisibility === 'INSTITUTION' && { c: 'I' }),
          ...(ownerSuffix !== `${listing.courseKey}-${listing.section}` && { o: ownerSuffix }),
          ...(row.isOnlyOneFile && { one: 1 }),
        }
        withSyllabus++
      }
    })

    stats[term] = { rows, withSyllabus, failedSubjects: failures.length, partialSubjects }
    console.log(
      `  ${term.padEnd(4)} ${String(rows).padStart(5)} rows -> ${String(withSyllabus).padStart(4)} with a syllabus` +
      `  (${((Date.now() - started) / 1000).toFixed(0)}s` +
      `${partialSubjects ? `, ${partialSubjects} subjects answered fewer than ${opts.attempts} times` : ''}` +
      `${failures.length ? `, ${failures.length} subjects failed` : ''})`
    )
    if (failures.length) console.error(`    failures: ${failures.slice(0, 5).join('; ')}`)
  }

  // A subject that never answered is a silent hole in the index: every course
  // in it loses its button. One flaky subject out of 335 is tolerable; a
  // widespread failure should leave the previous index in place instead of
  // committing a thinner one.
  const worstFailureRate = Math.max(...Object.values(stats).map(s => s.failedSubjects / subjects.length))
  if (worstFailureRate > 0.02) {
    throw new Error(
      `Too many subjects failed to fetch (worst term: ${(worstFailureRate * 100).toFixed(1)}%). ` +
      `Refusing to write a partial index.`
    )
  }

  // Sort sections and course keys so the committed file has a stable diff.
  const sortedCourses = {}
  for (const key of [...courses.keys()].sort()) {
    const byTerm = courses.get(key)
    const out = {}
    for (const term of terms) {
      const bySection = byTerm[term]
      if (!bySection) continue
      out[term] = Object.keys(bySection).sort().map(section => bySection[section])
    }
    sortedCourses[key] = out
  }

  // Merge over whatever is already committed. The service drops syllabus flags
  // on a minority of responses, so a term that comes back thinner than last
  // time is far more likely to be a degraded scrape than 300 instructors
  // unpublishing overnight. Fresh data wins per (course, term); anything this
  // run did not see is carried forward.
  let carriedForward = 0
  if (existsSync(opts.out)) {
    try {
      const previous = JSON.parse(readFileSync(opts.out, 'utf8'))
      for (const [key, byTerm] of Object.entries(previous.courses || {})) {
        for (const [term, entries] of Object.entries(byTerm)) {
          if (!windowTerms.includes(term)) continue
          if (!Array.isArray(entries) || entries.length === 0) continue

          // Union at section level, not course level: a degraded run that saw
          // one of a course's two sections must not drop the other.
          const fresh = sortedCourses[key]?.[term]
          if (!fresh) {
            sortedCourses[key] = sortedCourses[key] || {}
            sortedCourses[key][term] = entries
            carriedForward += entries.length
            continue
          }
          const have = new Set(fresh.map(e => e.s))
          for (const entry of entries) {
            if (entry?.s && !have.has(entry.s)) {
              fresh.push(entry)
              carriedForward++
            }
          }
          fresh.sort((a, b) => a.s.localeCompare(b.s))
        }
      }
    } catch (err) {
      console.error(`Could not read the previous index to merge: ${err.message}`)
    }
  }
  if (carriedForward > 0) {
    console.log(`Carried ${carriedForward} entries forward from the previous index.`)
  }

  // Terms the finished file actually covers: what this run scraped plus
  // anything the merge preserved.
  const mergedTerms = windowTerms.filter(
    t => terms.includes(t) || Object.values(sortedCourses).some(byTerm => byTerm[t])
  )

  const payload = {
    generatedAt: new Date().toISOString(),
    // Oldest -> newest, the full five-year window rather than only the terms
    // this run re-scraped: the merge below carries the others forward, and the
    // UI walks this backwards to find the most recent term with a syllabus.
    terms: mergedTerms,
    termTitles: Object.fromEntries(mergedTerms.map(t => [t, termTitles[t] || t])),
    // Course keys stay sorted after the merge so the committed diff is stable.
    courses: Object.fromEntries(Object.keys(sortedCourses).sort().map(k => [k, sortedCourses[k]])),
    stats: { ...stats, carriedForward },
  }

  const outPath = opts.out
  if (!existsSync(dirname(outPath))) mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, JSON.stringify(payload))
  const bytes = JSON.stringify(payload).length
  console.log(
    `Wrote ${outPath}, ${Object.keys(sortedCourses).length} courses, ${(bytes / 1024).toFixed(0)} KB`
  )
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
