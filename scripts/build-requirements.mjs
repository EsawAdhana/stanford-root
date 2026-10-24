/**
 * Build the degree-requirement data the /requirements audit reads, from the
 * Stanford Bulletin itself.
 *
 * Usage:
 *   node scripts/build-requirements.mjs
 *   node scripts/build-requirements.mjs --offline      # reuse .cache/requirements
 *   node scripts/build-requirements.mjs --catalog <coursedogCatalogId> --year 2027-28 --effective 2027-08-01
 *
 * Writes public/requirements/index.json, public/requirements/courses.json and
 * one public/requirements/programs/<CODE>.json per program.
 *
 * bulletin.stanford.edu runs on Coursedog, and the requirement trees it renders
 * on every program page are structured data, not prose: "complete all of",
 * "at least 2 of", "minimum 15 units from", with course ids. Three requests
 * read all of it, with the same headers the Bulletin's own pages send (the API
 * answers "Unauthenticated" without the Origin header):
 *   - programs/search: every program shown in the catalog (355 for 2026-27),
 *     with its `requisites.requisitesSimple` tree
 *   - courses/search: every course in the catalog year (~27.8k), which maps the
 *     tree's course ids (courseGroupId) to codes, and carries each listing's
 *     Ways, WR1/WR2/COLLEGE/Language attributes, units and grading basis
 *   - courseSets: the named lists ("PHIL 1-399 Courses") a rule can point at
 * The raw responses are cached in .cache/requirements for --offline runs and
 * for scripts/check-requirements.mjs.
 *
 * About a third of the Bulletin's rules are free text ("35 units of approved
 * courses chosen from those offered by the Department of English"), and some
 * structured ones are wrong (two concentrations a student picks between,
 * entered as both required). Reviewed corrections live in
 * data/requirements/overlays/<CODE>.json, one file per program, and are applied
 * here; an overlay that names a rule that no longer exists fails the build.
 *
 * The data is public Bulletin content, so it is served straight from public/.
 * The catalog id changes every academic year; the 2026-27 one is read from the
 * Bulletin's own course search request.
 */

import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { createHash } from 'crypto'
import { buildCourseTable, convertProgram } from './requirements/convert.mjs'
import { cacheDir, readCache, readOverlays, setsByGroupOf } from './requirements/io.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const OUT_DIR = join(ROOT, 'public', 'requirements')
const CACHE_DIR = cacheDir(ROOT)

const API = 'https://app.coursedog.com/api/v1/cm/stanford'
const HEADERS = {
  'x-requested-with': 'catalog',
  'content-type': 'application/json',
  accept: 'application/json',
  origin: 'https://bulletin.stanford.edu',
  referer: 'https://bulletin.stanford.edu/',
}

function parseArgs() {
  const args = process.argv.slice(2)
  const opts = { catalog: 's1KuGHRiFO9tNyicMDbi', year: '2026-27', effective: '2026-08-01', offline: false }
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--catalog' && args[i + 1]) opts.catalog = args[++i]
    else if (args[i] === '--year' && args[i + 1]) opts.year = args[++i]
    else if (args[i] === '--effective' && args[i + 1]) opts.effective = args[++i]
    else if (args[i] === '--offline') opts.offline = true
  }
  return opts
}

async function request(path, body) {
  const res = await fetch(`${API}/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: HEADERS,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`${path.split('?')[0]}: HTTP ${res.status}`)
  const json = await res.json()
  if (json && json.error) throw new Error(`${path.split('?')[0]}: ${json.error}`)
  return json
}

// The Bulletin's own program index sends this filter: w4XG5 is the
// "show in catalog" custom field.
const SHOWN_PROGRAMS_FILTER = {
  condition: 'AND',
  filters: [{
    id: 'vQsytaoW',
    condition: 'or',
    filters: [{ id: 'w4XG5-program', condition: 'field', name: 'w4XG5', inputType: 'boolean', group: 'program', type: 'is', value: true, customField: true }],
  }],
}

const PROGRAM_COLUMNS = [
  'name', 'type', 'degreeDesignation', 'longName', 'code', 'level', 'departments', 'status', 'id',
  'requisites', 'specializations', 'unitsProgramMin', 'programGPARequirement', 'programGradingPolicies',
  'programAdditionalPolicies', 'subplanRequired', 'career',
  // The fields above that are Coursedog custom fields (unitsProgramMin,
  // subplanRequired, the policies) only come back inside customFields.
  'customFields',
]

const COURSE_COLUMNS = [
  'customFields.rawCourseId', 'customFields.WAYS', 'customFields.catalogAttributes', 'code', 'subjectCode',
  'courseNumber', 'longName', 'courseGroupId', 'career', 'credits', 'gradeMode',
]

async function fetchCoursedog({ catalog, effective }) {
  const range = `${effective}%2C${effective}`
  const [programRes, courseRes, courseSets] = await Promise.all([
    request(`programs/search/%24filters?catalogId=${catalog}&skip=0&limit=5000&sortBy=longName&effectiveDatesRange=${range}&columns=${PROGRAM_COLUMNS.join('%2C')}`, SHOWN_PROGRAMS_FILTER),
    request(`courses/search/%24filters?catalogId=${catalog}&skip=0&limit=60000&orderBy=&formatDependents=false&effectiveDatesRange=${range}&ignoreEffectiveDating=false&ignoreTotalCount=false&columns=${COURSE_COLUMNS.join('%2C')}`, { condition: 'AND', filters: [] }),
    request(`courseSets?catalogId=${catalog}`),
  ])
  const programs = programRes.data
  const courses = courseRes.data
  if (!Array.isArray(programs) || programs.length < 100) throw new Error(`only ${programs?.length} programs came back`)
  if (!Array.isArray(courses) || courses.length < 10000) throw new Error(`only ${courses?.length} courses came back`)
  return { programs, courses, courseSets }
}

async function run(opts) {
  console.log(`Coursedog catalog ${opts.catalog} (${opts.year})${opts.offline ? ', offline' : ''}`)
  let raw
  if (opts.offline) {
    raw = readCache(ROOT)
  } else {
    raw = await fetchCoursedog(opts)
    mkdirSync(CACHE_DIR, { recursive: true })
    writeFileSync(join(CACHE_DIR, 'programs.json'), JSON.stringify(raw.programs))
    writeFileSync(join(CACHE_DIR, 'courses.json'), JSON.stringify(raw.courses))
    writeFileSync(join(CACHE_DIR, 'coursesets.json'), JSON.stringify(raw.courseSets))
  }
  console.log(`${raw.programs.length} programs, ${raw.courses.length} courses, ${Object.keys(raw.courseSets).length} course sets`)

  const table = buildCourseTable(raw.courses)
  const setsByGroup = setsByGroupOf(raw.courseSets)
  const overlays = readOverlays(ROOT)

  const files = []
  const errors = []
  let warnings = 0
  for (const p of [...raw.programs].sort((a, b) => a.longName.localeCompare(b.longName))) {
    if (p.status && p.status !== 'Active') continue
    const overlay = overlays.get(p.code)
    overlays.delete(p.code)
    const result = convertProgram(p, table, setsByGroup, opts.year, overlay)
    errors.push(...result.errors)
    warnings += result.warnings.length
    files.push(result.file)
  }
  for (const code of overlays.keys()) errors.push(`${code}: overlay for a program that is not in the ${opts.year} Bulletin`)
  if (errors.length) {
    console.error(errors.join('\n'))
    throw new Error(`${errors.length} overlay errors; nothing was written`)
  }

  rmSync(join(OUT_DIR, 'programs'), { recursive: true, force: true })
  mkdirSync(join(OUT_DIR, 'programs'), { recursive: true })
  const index = []
  for (const file of files) {
    writeFileSync(join(OUT_DIR, 'programs', `${file.code}.json`), JSON.stringify(file))
    index.push({
      code: file.code,
      name: file.name,
      kind: file.kind,
      degree: file.degree,
      subplans: file.blocks.filter(b => b.kind === 'subplan').map(b => ({ id: b.id, name: b.name })),
      ...(file.reviewed ? { reviewed: file.reviewed } : {}),
    })
  }

  const coursesJson = JSON.stringify({ year: opts.year, cols: ['code', 'title', 'min', 'max', 'ways', 'tags', 'grading', 'group'], rows: table.rows })
  writeFileSync(join(OUT_DIR, 'courses.json'), coursesJson)

  // The browser caches these files; the version in the index is what the page
  // appends to every other request, so a rebuild reaches returning visitors.
  const hash = createHash('sha1').update(coursesJson)
  for (const file of files) hash.update(JSON.stringify(file))
  const version = hash.digest('hex').slice(0, 10)
  writeFileSync(join(OUT_DIR, 'index.json'), JSON.stringify({ year: opts.year, version, builtAt: new Date().toISOString().slice(0, 10), programs: index }))

  const reviewed = files.filter(f => f.reviewed).length
  console.log(`Wrote ${files.length} programs (${reviewed} reviewed), ${table.rows.length} courses; ${warnings} warnings`)
}

run(parseArgs()).catch(err => {
  console.error(err)
  process.exit(1)
})
