/**
 * Build the degree-requirement data the /requirements audit reads, from the
 * Stanford Bulletin itself.
 *
 * Usage:
 *   node scripts/build-requirements.mjs
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
 *   - courseSets: the 45 named lists ("PHIL 1-399 Courses") a rule can point at
 *
 * About a third of the Bulletin's rules are free text ("see Note 6"). Those are
 * kept as text with their own wording, and the audit lets a student assign
 * courses to them by hand, the way My Academic Path's bucket moves work.
 *
 * The data is public Bulletin content, so it is served straight from public/.
 * The catalog id changes every academic year; the 2026-27 one is read from the
 * Bulletin's own course search request.
 */

import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { createHash } from 'crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(__dirname, '..', 'public', 'requirements')

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
  const opts = { catalog: 's1KuGHRiFO9tNyicMDbi', year: '2026-27', effective: '2026-08-01' }
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--catalog' && args[i + 1]) opts.catalog = args[++i]
    else if (args[i] === '--year' && args[i + 1]) opts.year = args[++i]
    else if (args[i] === '--effective' && args[i + 1]) opts.effective = args[++i]
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
]

const COURSE_COLUMNS = [
  'customFields.rawCourseId', 'customFields.WAYS', 'customFields.catalogAttributes', 'code', 'subjectCode',
  'courseNumber', 'longName', 'courseGroupId', 'career', 'credits', 'gradeMode',
]

const WAYS = {
  'Aesthetic and Interpretive Inquiry (AII)': 'AII',
  'Applied Quantitative Reasoning (AQR)': 'AQR',
  'Creative Expression (CE)': 'CE',
  'Exploring Difference and Power (EDP)': 'EDP',
  'Ethical Reasoning (ER)': 'ER',
  'Formal Reasoning (FR)': 'FR',
  'Social Inquiry (SI)': 'SI',
  'Scientific Method and Analysis (SMA)': 'SMA',
}

// catalogAttributes "UGRQ - ..." entries name the general education
// requirement a listing satisfies outside Ways.
const UGRQ = { 'UGRQ - WR1 (Writing 1)': 'WR1', 'UGRQ - WR2 (Writing 2)': 'WR2', 'UGRQ - COL (COLLEGE)': 'COL', 'UGRQ - LANGUAGE (Language)': 'LANG' }

/** "RLT - Letter (ABCD/NP)" -> L (letter only), RSN -> S (S/NC only), ROP -> O (either). */
function gradingCode(gradeMode) {
  const m = /^([A-Z0-9]+) -/.exec(gradeMode || '')
  if (!m) return ''
  if (m[1] === 'RLT' || m[1] === 'GLT') return 'L'
  if (m[1] === 'RSN' || m[1] === 'MSN') return 'S'
  if (m[1] === 'ROP' || m[1] === 'GOP') return 'O'
  return ''
}

/** "MS&E" + "211" -> "MS&E 211", the form students and the transcript use. */
function displayCode(course) {
  return `${course.subjectCode} ${course.courseNumber}`.trim()
}

function htmlToText(html) {
  if (!html || typeof html !== 'string') return ''
  return html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h\d|tr)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&ndash;|&mdash;/g, '-')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/﻿/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function cleanName(name) {
  return (name || '').replace(/\s+/g, ' ').trim()
}

/** "Mathematics (26 units minimum)" -> 26. Unit floors often live only in the name. */
function unitsFromName(name) {
  const m = /\(?\s*(\d+)\s*units?\s*(?:minimum|min\.?)\b/i.exec(name || '') || /minimum of (\d+) units/i.exec(name || '')
  return m ? Number(m[1]) : undefined
}

/** "A total of at least 21 units from categories A, B, and the following" -> 21, summed over the block. */
function blockUnitsFromText(text) {
  const m = /total of (?:at least )?(\d+) units\b/i.exec(text || '')
  return m ? Number(m[1]) : undefined
}

const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 }

/**
 * How much of a "complete any of" pool the department asks for, when its text
 * says ("Earn at least 9 credits from the courses listed below"). Coursedog's
 * own meaning for such a pool is one course; 656 of the 803 pools in 2026-27
 * say nothing more, and only a minimum counts here ("no more than 10 units"
 * is a cap, not a requirement).
 */
function poolAmountFromText(text) {
  const units = /\b(?:at least|minimum of|a total of|earn|complete|take)\s+(\d+)\s+(?:additional\s+)?(?:units?|credits?)\b/i.exec(text || '')
  if (units) return { units: Number(units[1]) }
  const courses = /\b(?:at least|minimum of|a total of|complete|take|choose|select)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:additional\s+)?(?:courses?|classes)\b/i.exec(text || '')
  if (courses) return { n: NUMBER_WORDS[courses[1].toLowerCase()] ?? Number(courses[1]) }
  return {}
}

// Designations, not separate coursework: the course also counts toward the
// rest of the program ("at least one course designated as having a
// significant software implementation component", CS MS).
const SHARED = /writing in (the )?major|\bWIM\b|significant (software )?implementation/i

const INFO_TEXT = /overview|overivew|details|information|application|polic(y|ies)|\bnotes?\b|assistantship|^joint |narrative|admission|advising|declar|recommended|not required/i

function main() {
  return run(parseArgs())
}

async function run({ catalog, year, effective }) {
  const range = `${effective}%2C${effective}`
  console.log(`Coursedog catalog ${catalog} (${year})`)

  const [programRes, courseRes, courseSets] = await Promise.all([
    request(`programs/search/%24filters?catalogId=${catalog}&skip=0&limit=5000&sortBy=longName&effectiveDatesRange=${range}&columns=${PROGRAM_COLUMNS.join('%2C')}`, SHOWN_PROGRAMS_FILTER),
    request(`courses/search/%24filters?catalogId=${catalog}&skip=0&limit=60000&orderBy=&formatDependents=false&effectiveDatesRange=${range}&ignoreEffectiveDating=false&ignoreTotalCount=false&columns=${COURSE_COLUMNS.join('%2C')}`, { condition: 'AND', filters: [] }),
    request(`courseSets?catalogId=${catalog}`),
  ])
  const programs = programRes.data
  const rawCourses = courseRes.data
  if (!Array.isArray(programs) || programs.length < 100) throw new Error(`only ${programs?.length} programs came back`)
  if (!Array.isArray(rawCourses) || rawCourses.length < 10000) throw new Error(`only ${rawCourses?.length} courses came back`)
  console.log(`${programs.length} programs, ${rawCourses.length} courses, ${Object.keys(courseSets).length} course sets`)

  // ── Courses ──
  const byGroupId = new Map()
  const listingsPerRawId = new Map()
  for (const c of rawCourses) {
    byGroupId.set(String(c.courseGroupId), c)
    const raw = c.customFields?.rawCourseId
    if (raw) listingsPerRawId.set(raw, (listingsPerRawId.get(raw) ?? 0) + 1)
  }

  const courseRows = []
  const seenCodes = new Set()
  for (const c of [...rawCourses].sort((a, b) => (a.orderByKeyForCode || a.code).localeCompare(b.orderByKeyForCode || b.code))) {
    if (c.career !== 'Undergraduate' && c.career !== 'Graduate') continue
    const code = displayCode(c)
    if (seenCodes.has(code)) continue
    seenCodes.add(code)
    const hours = c.credits?.creditHours ?? {}
    const min = Number.isFinite(Number(hours.min)) ? Number(hours.min) : 0
    const max = Number.isFinite(Number(hours.max)) ? Number(hours.max) : min
    const ways = (c.customFields?.WAYS ?? []).map(w => WAYS[w]).filter(Boolean)
    const tags = (c.customFields?.catalogAttributes ?? []).map(a => UGRQ[a]).filter(Boolean)
    if (c.career === 'Graduate') tags.push('GR')
    const raw = c.customFields?.rawCourseId
    // Cross-listings share Stanford's course id; only listings that have a
    // sibling need it, which keeps the file small.
    const group = raw && (listingsPerRawId.get(raw) ?? 0) > 1 ? raw : ''
    courseRows.push([code, (c.longName || c.name || '').trim(), min, max, ways.join(' '), tags.join(' '), gradingCode(c.gradeMode), group])
  }

  // ── Course sets ──
  const setsByGroup = new Map()
  for (const s of Object.values(courseSets)) {
    setsByGroup.set(s.courseSetGroupId, { name: cleanName(s.name || s.description), ids: s.dynamicCourseList ?? [] })
  }

  const unresolved = new Set()
  const codeFor = (id) => {
    const c = byGroupId.get(String(id))
    if (!c) { unresolved.add(String(id)); return null }
    return displayCode(c)
  }

  /** Coursedog course values -> list of items, each item a list of alternative codes. */
  function itemsFromValue(value) {
    if (!value) return { items: [], sets: [] }
    if (value.condition === 'courses') {
      const items = []
      for (const group of value.values ?? []) {
        const codes = (group.value ?? []).map(codeFor).filter(Boolean)
        if (codes.length === 0) continue
        // An "or" group is one slot any of its listings fills. An "and" group
        // with several ids names each of them.
        if (group.logic === 'or') items.push([...new Set(codes)])
        else for (const code of codes) items.push([code])
      }
      return { items, sets: [] }
    }
    if (value.condition === 'courseSets') {
      const items = []
      const sets = []
      for (const group of value.values ?? []) {
        for (const setId of group.value ?? []) {
          const set = setsByGroup.get(setId)
          if (!set) { unresolved.add(`set:${setId}`); continue }
          sets.push(set.name)
          for (const id of set.ids) {
            const code = codeFor(id)
            if (code) items.push([code])
          }
        }
      }
      return { items, sets }
    }
    return { items: [], sets: [] }
  }

  let nextId = 0
  function convertRule(rule, ctx) {
    const id = `r${nextId++}`
    const name = cleanName(rule.name)
    const desc = htmlToText(rule.description)
    const notes = htmlToText(rule.notes)
    const node = { id }
    if (name) node.name = name
    if (desc) node.desc = desc
    if (notes) node.notes = notes

    const restriction = Number(rule.restriction)
    const credits = Number(rule.credits)
    const nameUnits = unitsFromName(name)
    const textUnits = blockUnitsFromText(desc)
    if (textUnits && ctx) ctx.blockUnits = Math.max(ctx.blockUnits ?? 0, textUnits)

    switch (rule.condition) {
      case 'allOf':
      case 'anyOf':
      case 'numberOf': {
        node.t = rule.condition === 'allOf' ? 'all' : rule.condition === 'anyOf' ? 'any' : 'some'
        if (node.t === 'some') node.n = Number(rule.number) || 1
        const units = Number.isFinite(credits) && credits > 0 ? credits : nameUnits
        if (units) node.units = units
        node.children = (rule.subRules ?? []).map(r => convertRule(r, ctx)).filter(Boolean)
        if (node.children.length === 0) {
          node.t = 'text'
          delete node.children
        }
        return node
      }
      case 'completedAllOf':
      case 'completedAnyOf':
      case 'completedAtLeastXOf':
      case 'minimumCredits':
      case 'completeVariableCoursesAndVariableCredits':
      case 'enrolledIn': {
        const { items, sets } = itemsFromValue(rule.value)
        if (items.length === 0) {
          node.t = 'text'
          if (Number.isFinite(restriction) && restriction > 0) node.n = restriction
          if (Number.isFinite(credits) && credits > 0) node.units = credits
          return node
        }
        node.t = 'courses'
        node.items = items
        if (sets.length) node.sets = sets
        if (/\boptional\b/i.test(name)) node.optional = true
        if (SHARED.test(name) || /\bdesignated as having\b/i.test(`${notes} ${desc}`)) node.shares = true
        const units = Number.isFinite(credits) && credits > 0 ? credits : nameUnits
        if (rule.condition === 'completedAllOf' || rule.condition === 'enrolledIn') {
          node.mode = 'all'
          if (units) node.units = units
        } else if (rule.condition === 'minimumCredits') {
          node.mode = 'units'
          node.units = units || 1
        } else if (rule.condition === 'completedAtLeastXOf') {
          node.mode = 'atLeast'
          node.n = Number.isFinite(restriction) && restriction > 0 ? restriction : 1
          if (units) node.units = units
        } else {
          // "Complete any of": a pool. A restriction or unit figure says how much
          // of it; otherwise it is one course, or whatever the block's unit
          // total asks for.
          node.mode = 'any'
          if (Number.isFinite(restriction) && restriction > 0) node.n = restriction
          if (units) node.units = units
          // "A total of at least 21 units from categories A, B, and the
          // following" is the block's floor (blockUnitsFromText), not this pool's.
          if (!node.n && !node.units && !textUnits) Object.assign(node, poolAmountFromText(`${name}. ${desc}`))
        }
        if (node.mode === 'all' && Number.isFinite(restriction) && restriction > 0 && restriction < items.length) {
          // A handful of "complete all of" rules carry a smaller restriction,
          // e.g. CS-BS Comp Bio "Mathematics restriction=3" over 5 courses.
          // The restriction is what the department wrote; it wins.
          node.mode = 'atLeast'
          node.n = restriction
        }
        return node
      }
      case 'freeformText':
      case 'minimumResidencyCredits':
      case 'minimumGrade':
      case 'programs':
      case 'none':
      default: {
        node.t = 'text'
        if (Number.isFinite(restriction) && restriction > 0) node.n = restriction
        const units = Number.isFinite(credits) && credits > 0 ? credits : nameUnits
        if (units) node.units = units
        if (typeof rule.value === 'string' && !desc) node.desc = htmlToText(rule.value)
        if (rule.condition === 'freeformText' && !node.n && !node.units && (INFO_TEXT.test(name) || /assistantships? (are|is) available/i.test(desc))) node.info = true
        return node
      }
    }
  }

  const SUBPLAN = /subplan|\btrack\b|concentration|specialization|self-designed path/i
  const OPTIONAL = /honors|distinction|\(optional\)|optional\)|^joint /i
  const WIM = /writing in (the )?major|\bWIM\b/i

  function kindOf(p) {
    const type = p.type || ''
    if (type.startsWith('(MIN)')) return 'minor'
    if (type.startsWith('(PMN)')) return 'phd-minor'
    if (type.startsWith('(IHN)')) return 'honors'
    if (p.level === 'Undergraduate Matriculated') return 'major'
    return 'grad'
  }

  rmSync(join(OUT_DIR, 'programs'), { recursive: true, force: true })
  mkdirSync(join(OUT_DIR, 'programs'), { recursive: true })

  const index = []
  const stats = { blocks: 0, nodes: 0, text: 0 }
  for (const p of programs.sort((a, b) => a.longName.localeCompare(b.longName))) {
    if (p.status && p.status !== 'Active') continue
    nextId = 0
    const kind = kindOf(p)
    const blocks = []
    let subplanCount = 0
    for (const [i, b] of (p.requisites?.requisitesSimple ?? []).entries()) {
      if (b.showInCatalog === false) continue
      const name = cleanName(b.name)
      const ctx = {}
      const rules = (b.rules ?? []).map(r => convertRule(r, ctx)).filter(Boolean)
      if (rules.length === 0) continue
      const block = { id: `b${i}`, name, rules }
      const notes = htmlToText(b.notes)
      if (notes) block.notes = notes
      if (ctx.blockUnits) block.units = ctx.blockUnits
      const required = rules.filter(r => !(r.t === 'text' && r.info))
      if (SUBPLAN.test(name) && kind !== 'honors') { block.kind = 'subplan'; subplanCount++ }
      else if (kind !== 'honors' && (OPTIONAL.test(name) || (required.length > 0 && required.every(r => OPTIONAL.test(r.name ?? ''))))) block.kind = 'optional'
      else if (rules.every(r => r.t === 'text' && r.info)) block.kind = 'info'
      if (WIM.test(name)) block.wim = true
      blocks.push(block)
    }
    // A lone "subplan" block is not a choice, it is the program.
    if (subplanCount === 1) for (const b of blocks) if (b.kind === 'subplan') delete b.kind

    const walk = (n) => { stats.nodes++; if (n.t === 'text') stats.text++; (n.children ?? []).forEach(walk) }
    blocks.forEach(b => { stats.blocks++; b.rules.forEach(walk) })

    const degree = (p.degreeDesignation || '').split(' - ')[0] || ''
    const file = {
      code: p.code,
      name: cleanName(p.longName),
      kind,
      degree,
      year,
      url: `https://bulletin.stanford.edu/programs/${encodeURIComponent(p.code)}`,
      departments: p.departments ?? [],
      blocks,
    }
    const unitsMin = Number(p.unitsProgramMin)
    if (Number.isFinite(unitsMin) && unitsMin > 0) file.unitsMin = unitsMin
    const gpa = htmlToText(p.programGPARequirement)
    if (gpa) file.gpa = gpa
    const grading = htmlToText(p.programGradingPolicies)
    if (grading) file.grading = grading
    const policies = htmlToText(p.programAdditionalPolicies)
    if (policies) file.policies = policies

    writeFileSync(join(OUT_DIR, 'programs', `${p.code}.json`), JSON.stringify(file))
    index.push({
      code: p.code,
      name: file.name,
      kind,
      degree,
      subplans: blocks.filter(b => b.kind === 'subplan').map(b => ({ id: b.id, name: b.name })),
    })
  }

  const coursesJson = JSON.stringify({ year, cols: ['code', 'title', 'min', 'max', 'ways', 'tags', 'grading', 'group'], rows: courseRows })
  writeFileSync(join(OUT_DIR, 'courses.json'), coursesJson)

  // The browser caches these files; the version in the index is what the page
  // appends to every other request, so a rebuild reaches returning visitors.
  const version = createHash('sha1')
    .update(coursesJson)
    .update(JSON.stringify(index))
    .digest('hex')
    .slice(0, 10)
  writeFileSync(join(OUT_DIR, 'index.json'), JSON.stringify({ year, version, builtAt: new Date().toISOString().slice(0, 10), programs: index }))

  console.log(`Wrote ${index.length} programs (${stats.blocks} sections, ${stats.nodes} rules, ${stats.text} free-text), ${courseRows.length} courses`)
  if (unresolved.size) console.warn(`${unresolved.size} course ids did not resolve: ${[...unresolved].slice(0, 10).join(', ')}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
