/**
 * Converts the Bulletin's Coursedog program records into the rule trees the
 * audit reads (src/lib/requirements/types.ts), and applies the reviewed
 * corrections in data/requirements/overlays.
 *
 * Pure: no network, no files. scripts/build-requirements.mjs writes the
 * result; scripts/check-requirements.ts converts and audits in memory.
 *
 * Node and block ids are Coursedog's own rule ids, which do not change when
 * a department edits a rule's wording, so overlays, a student's moves and
 * their chosen paths survive a rebuild.
 */

export const WAYS = {
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
export const UGRQ = { 'UGRQ - WR1 (Writing 1)': 'WR1', 'UGRQ - WR2 (Writing 2)': 'WR2', 'UGRQ - COL (COLLEGE)': 'COL', 'UGRQ - LANGUAGE (Language)': 'LANG' }

/** "RLT - Letter (ABCD/NP)" -> L (letter only), RSN -> S (S/NC only), ROP -> O (either). */
export function gradingCode(gradeMode) {
  const m = /^([A-Z0-9]+) -/.exec(gradeMode || '')
  if (!m) return ''
  if (['RLT', 'GLT', 'MLT'].includes(m[1])) return 'L'
  // No ABCD letter on offer: S/NC, TGR, GSB pass/fail, Law's H/P/R/F
  // scales, Medicine's +/-. A letter-grade rule takes a pass in these.
  if (['RSN', 'MSN', 'RTG', 'GPF', 'MED', 'L01', 'L02', 'L03', 'L04'].includes(m[1])) return 'S'
  if (['ROP', 'GOP', 'MOP'].includes(m[1])) return 'O'
  return ''
}

/** "MS&E" + "211" -> "MS&E 211", the form students and the transcript use. */
export function displayCode(course) {
  return `${course.subjectCode} ${course.courseNumber}`.trim()
}

/**
 * Bulletin HTML to plain text. Course links in the text read "course" on
 * the page source (<a data-course-id="1107111">course</a>); `courseCode`
 * turns the id back into the code the page shows.
 */
export function htmlToText(html, courseCode) {
  if (!html || typeof html !== 'string') return ''
  return html
    .replace(/<a\b[^>]*data-course-id="(\d+)"[^>]*>[\s\S]*?<\/a>/gi, (link, id) => (courseCode && courseCode(id)) || link)
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
  const m = /\(?\s*(\d+)\s*units?\s*(?:minimum|mimimum|min\.?)\b/i.exec(name || '') || /minimum (?:of )?(\d+) units/i.exec(name || '')
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
 * own meaning for such a pool is one course; most pools say nothing more, and
 * only a minimum counts here ("no more than 10 units" is a cap, not a
 * requirement).
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

const SUBPLAN = /subplan|\btrack\b|concentration|specialization|self-designed path/i
const OPTIONAL = /honors|distinction|\(optional\)|optional\)|^joint /i
// Writing in the Major and the capstone are designations on courses inside
// the major, not separate coursework: "all majors require completion of a
// capstone" alongside WIM (Bulletin, Undergraduate Majors), and departments
// list as the capstone a course that is also one of their required or
// advanced courses (CHEM 185). Their courses count toward the rest of the
// program too. An overlay turns this off for a program that says otherwise.
const DESIGNATION = /writing in (the )?major|\bWIM\b|capstone/i

export function kindOf(p) {
  const type = p.type || ''
  if (type.startsWith('(MIN)')) return 'minor'
  if (type.startsWith('(PMN)')) return 'phd-minor'
  if (type.startsWith('(IHN)')) return 'honors'
  if (p.level === 'Undergraduate Matriculated') return 'major'
  return 'grad'
}

/**
 * The course table the audit's index is built from, and the lookup the
 * converter resolves Coursedog course ids with.
 */
export function buildCourseTable(rawCourses) {
  const byGroupId = new Map()
  for (const c of rawCourses) byGroupId.set(String(c.courseGroupId), c)
  // Law, Medicine and GSB courses are graduate courses too (LAW-JD, MED-MD,
  // joint degrees); the few listings marked UG or GR are the same careers.
  const careerOf = (c) => (['Graduate', 'GR', 'Law', 'Medicine', 'Graduate School of Business'].includes(c.career) ? 'GR'
    : c.career === 'Undergraduate' || c.career === 'UG' ? 'UG' : '')
  // A code can have several versions (EDUC 314 from 2019 and from 2026):
  // the newest describes the course, and its cross-listings are the current ones.
  const current = new Map()
  for (const c of rawCourses) {
    if (!careerOf(c)) continue
    const code = displayCode(c)
    const had = current.get(code)
    if (!had || String(c.effectiveStartDate || '') > String(had.effectiveStartDate || '')) current.set(code, c)
  }
  const listingsPerRawId = new Map()
  for (const c of current.values()) {
    const raw = c.customFields?.rawCourseId
    if (raw) listingsPerRawId.set(raw, (listingsPerRawId.get(raw) ?? 0) + 1)
  }
  const rows = []
  for (const c of [...current.values()].sort((a, b) => (a.orderByKeyForCode || a.code).localeCompare(b.orderByKeyForCode || b.code))) {
    const graduate = careerOf(c) === 'GR'
    const code = displayCode(c)
    const hours = c.credits?.creditHours ?? {}
    const min = Number.isFinite(Number(hours.min)) ? Number(hours.min) : 0
    const max = Number.isFinite(Number(hours.max)) ? Number(hours.max) : min
    const ways = (c.customFields?.WAYS ?? []).map(w => WAYS[w]).filter(Boolean)
    const tags = (c.customFields?.catalogAttributes ?? []).map(a => UGRQ[a]).filter(Boolean)
    if (graduate) tags.push('GR')
    // Repeatable for credit (CS 191, ATHLETIC 10): several attempts can count.
    if (c.credits?.repeatable) tags.push('REP')
    const raw = c.customFields?.rawCourseId
    // Cross-listings share Stanford's course id; only listings that have a
    // sibling need it, which keeps the file small.
    const group = raw && (listingsPerRawId.get(raw) ?? 0) > 1 ? raw : ''
    rows.push([code, (c.longName || c.name || '').trim(), min, max, ways.join(' '), tags.join(' '), gradingCode(c.gradeMode), group])
  }
  const codes = new Set(rows.map(r => r[0]))
  const subjects = new Set(rows.map(r => r[0].split(' ')[0]))
  return { rows, byGroupId, codes, subjects }
}

/**
 * Convert one program. Returns the program file and the problems found,
 * overlay mistakes included; the build fails on any `errors`.
 */
export function convertProgram(p, { byGroupId, codes, subjects }, setsByGroup, year, overlay) {
  const errors = []
  const warnings = []
  const unresolved = new Set()
  const codeFor = (id) => {
    const c = byGroupId.get(String(id))
    if (!c) { unresolved.add(String(id)); return null }
    return displayCode(c)
  }
  const text = (html) => htmlToText(html, (id) => (byGroupId.has(String(id)) ? displayCode(byGroupId.get(String(id))) : null))

  /** Coursedog course values -> list of items, each item a list of alternative codes. */
  function itemsFromValue(value) {
    if (!value) return { items: [], sets: [] }
    if (value.condition === 'courses') {
      const items = []
      const groups = []
      for (const group of value.values ?? []) {
        const resolved = (group.value ?? []).map(codeFor).filter(Boolean)
        if (resolved.length === 0) continue
        // An "or" group is one slot any of its listings fills. An "and" group
        // with several ids names each of them; in a choice it is a bundle the
        // page shows as one option ("CHEM 31A AND CHEM 31B").
        if (group.logic === 'or') items.push([...new Set(resolved)])
        else for (const code of resolved) items.push([code])
        groups.push({ codes: [...new Set(resolved)], bundle: group.logic !== 'or' && new Set(resolved).size > 1 })
      }
      return { items, sets: [], groups }
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

  function convertRule(rule, ctx) {
    const id = String(rule.id)
    const name = cleanName(rule.name)
    const desc = text(rule.description)
    const notes = text(rule.notes)
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
      case 'minimumResidencyCredits':
      case 'completeVariableCoursesAndVariableCredits':
      case 'enrolledIn': {
        const { items, sets, groups = [] } = itemsFromValue(rule.value)
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
        // The page shows a course rule's units only in its name ("(minimum 4
        // units)") or as "earn N units"; the data's `credits` on any other
        // course rule is hidden, and a hidden floor is no requirement.
        const units = (rule.condition === 'minimumCredits' || rule.condition === 'minimumResidencyCredits') && Number.isFinite(credits) && credits > 0 ? credits : nameUnits
        if (rule.condition === 'completedAllOf' || rule.condition === 'enrolledIn') {
          node.mode = 'all'
          if (units) node.units = units
        } else if (rule.condition === 'minimumCredits' || rule.condition === 'minimumResidencyCredits') {
          // "Earn at least 3 credits (in residence) from the following."
          node.mode = 'units'
          node.units = units || 1
        } else if (rule.condition === 'completedAtLeastXOf') {
          node.mode = 'atLeast'
          node.n = Number.isFinite(restriction) && restriction > 0 ? restriction : 1
          if (units) node.units = units
        } else if (rule.condition === 'completeVariableCoursesAndVariableCredits' && (Number(rule.minCourses) > 0 || Number(rule.minCredits) > 0)) {
          // The Bulletin shows "Complete 1 or more course(s) and earn 5 or
          // more credit(s) from the following".
          node.mode = Number(rule.minCourses) > 0 ? 'atLeast' : 'units'
          if (Number(rule.minCourses) > 0) node.n = Number(rule.minCourses)
          if (Number(rule.minCredits) > 0) node.units = Number(rule.minCredits)
          else if (units) node.units = units
          // "Complete 1 to 2 courses": past the maximum, courses count elsewhere.
          const maxCourses = Number(rule.maxCourses)
          const maxCredits = Number(rule.maxCredits)
          const limits = []
          if (maxCourses > 0 && maxCourses > (node.n ?? 0)) limits.push({ label: `at most ${maxCourses} courses`, max: maxCourses, codes: items.flat() })
          if (maxCredits > 0 && maxCredits > (node.units ?? 0)) limits.push({ label: `at most ${maxCredits} units`, maxUnits: maxCredits, codes: items.flat() })
          if (limits.length) node.limits = limits
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
        // A "complete all of" rule's restriction is hidden: the page says
        // "Complete ALL of the following Courses", and so does the audit.
        if (node.mode !== 'all' && node.mode !== 'units' && groups.some(g => g.bundle)) {
          // "Complete ANY of: CHEM 31A AND CHEM 31B, or CHEM 31E": each
          // option is a child, a bundle needing all of its courses.
          const need = node.n ?? 1
          const children = groups.map((g, i) => (g.bundle
            ? { id: `${id}-${i + 1}`, t: 'courses', mode: 'all', name: g.codes.join(' and '), items: g.codes.map(c => [c]) }
            : { id: `${id}-${i + 1}`, t: 'courses', mode: 'all', items: [g.codes] }))
          const choice = { id, t: need > 1 ? 'some' : 'any', children }
          if (need > 1) choice.n = need
          for (const key of ['name', 'desc', 'notes', 'units', 'shares', 'optional', 'sets']) if (node[key] !== undefined) choice[key] = node[key]
          return choice
        }
        return node
      }
      case 'freeformText':
      case 'minimumGrade':
      case 'programs':
      case 'none':
      default: {
        node.t = 'text'
        if (Number.isFinite(restriction) && restriction > 0) node.n = restriction
        const units = Number.isFinite(credits) && credits > 0 ? credits : nameUnits
        if (units) node.units = units
        if (typeof rule.value === 'string' && !desc) node.desc = text(rule.value)
        if (rule.condition === 'freeformText' && !node.n && !node.units && (INFO_TEXT.test(name) || /assistantships? (are|is) available/i.test(desc))) node.info = true
        return node
      }
    }
  }

  const kind = kindOf(p)
  const blocks = []
  let subplanCount = 0
  for (const b of p.requisites?.requisitesSimple ?? []) {
    if (b.showInCatalog === false) continue
    const name = cleanName(b.name)
    const ctx = {}
    const rules = (b.rules ?? []).map(r => convertRule(r, ctx)).filter(Boolean)
    // A section whose requirement is only its text ("must complete a minimum
    // of 20 units of graduate courses in the Department of Communication")
    // becomes one free-text rule, so a review reads it like any other.
    const blockText = text(b.notes || b.description)
    const fromText = rules.length === 0 && Boolean(blockText)
    if (fromText) rules.push({ id: `${b.id}-text`, t: 'text', name, desc: blockText })
    // An empty subplan is still one a student can declare; an overlay may give it rules.
    if (rules.length === 0 && !SUBPLAN.test(name)) continue
    const block = { id: String(b.id), name, rules }
    const notes = text(b.notes)
    if (notes && !fromText) block.notes = notes
    if (ctx.blockUnits) block.units = ctx.blockUnits
    const required = rules.filter(r => !(r.t === 'text' && r.info))
    if (SUBPLAN.test(name) && kind !== 'honors') { block.kind = 'subplan'; subplanCount++ }
    else if (kind !== 'honors' && (OPTIONAL.test(name) || (required.length > 0 && required.every(r => OPTIONAL.test(r.name ?? ''))))) block.kind = 'optional'
    else if (rules.every(r => r.t === 'text' && r.info)) block.kind = 'info'
    if (DESIGNATION.test(name)) block.wim = true
    blocks.push(block)
  }
  // The program's own free-form requirements section, when the page shows one
  // ("In the first two years, complete the PhD core course sequence"), is a
  // free-text rule like any other.
  const freeform = p.requisites?.requisitesFreeform
  const freeText = freeform && freeform.showInCatalog !== false ? text(freeform.value) : ''
  if (freeText) blocks.push({ id: 'freeform', name: 'Program Requirements', rules: [{ id: 'freeform-text', t: 'text', name: 'Program requirements in the Bulletin text', desc: freeText }] })

  // A lone "subplan" block is not a choice, it is the program, unless the
  // Bulletin says the subplan is optional: then the student takes it or not.
  const subplanRequired = (p.customFields ?? {}).subplanRequired ?? p.subplanRequired
  if (subplanCount === 1 && subplanRequired !== false) for (const b of blocks) if (b.kind === 'subplan') delete b.kind

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
  // Coursedog keeps these in customFields, some under their names and some
  // under ids: WOZxr is the transfer and AP credit policy, AZvZN the
  // requirements outside the course rules ("submit a senior survey").
  const cf = p.customFields ?? {}
  const field = (name) => cf[name] ?? p[name]
  const unitsMin = Number(field('unitsProgramMin'))
  if (Number.isFinite(unitsMin) && unitsMin > 0) file.unitsMin = unitsMin
  // A graduate degree also needs the university's units (135 for a PhD); an
  // undergraduate's 180 is checked with general education.
  const universityMin = Number(field('unitsUniversityMin'))
  if (kind === 'grad' && Number.isFinite(universityMin) && universityMin > (file.unitsMin ?? 0)) file.unitsUniversityMin = universityMin
  if (typeof field('subplanRequired') === 'boolean' && blocks.some(b => b.kind === 'subplan')) file.subplanRequired = field('subplanRequired')
  const gpa = text(field('programGPARequirement'))
  if (gpa) file.gpa = gpa
  const grading = text(field('programGradingPolicies'))
  if (grading) file.grading = grading
  const policies = text(field('programAdditionalPolicies'))
  if (policies) file.policies = policies
  const transfer = text(cf.WOZxr)
  if (transfer) file.transferPolicy = transfer
  const other = text(cf.AZvZN)
  if (other) file.otherRequirements = other

  if (overlay) applyOverlay(file, overlay, { codes, subjects, errors, warnings })
  if (unresolved.size) warnings.push(`${unresolved.size} course ids did not resolve: ${[...unresolved].slice(0, 5).join(', ')}`)
  return { file, errors, warnings }
}

// ── Overlays ──

const NODE_TYPES = new Set(['all', 'any', 'some', 'courses', 'text'])
const MODES = new Set(['all', 'atLeast', 'any', 'units'])
const MANUAL = new Set(['approval', 'milestone', 'exam', 'thesis', 'gpa', 'residency', 'other'])
const GRADES = ['D-', 'D', 'D+', 'C-', 'C', 'C+', 'B-', 'B', 'B+', 'A-', 'A', 'A+']
const PATCHABLE = new Set(['name', 'n', 'units', 'mode', 'items', 'addItems', 'removeItems', 'pool', 'minUnitsEach', 'letter', 'minGrade', 'limits', 'shares', 'optional', 'info', 'manual', 'desc'])

/**
 * Apply a reviewed correction file (data/requirements/overlays/<CODE>.json).
 * The format is documented in data/requirements/overlays/README.md.
 */
export function applyOverlay(file, overlay, ctx) {
  const { errors } = ctx
  const where = (s) => `${file.code}: ${s}`
  if (overlay.parseError) { errors.push(where(`overlay is not valid JSON: ${overlay.parseError}`)); return }
  for (const key of Object.keys(overlay)) {
    if (!['code', 'reviewed', 'summary', 'program', 'blocks', 'nodes', 'alternatives', 'add'].includes(key)) errors.push(where(`${key} is not a known overlay field`))
  }
  if (overlay.code && overlay.code !== file.code) errors.push(where(`overlay is for ${overlay.code}`))

  if (overlay.reviewed) file.reviewed = String(overlay.reviewed)
  if (overlay.summary) file.reviewNotes = String(overlay.summary)

  const prog = overlay.program ?? {}
  for (const key of Object.keys(prog)) {
    if (!['letterGrade', 'minGrade', 'unitsMin', 'subplanRequired', 'letterUnitsMin', 'gradUnitsShare', 'totals', 'notes', 'why'].includes(key)) errors.push(where(`program.${key} is not a known field`))
  }
  if (prog.letterGrade !== undefined) file.letterGrade = Boolean(prog.letterGrade)
  if (prog.minGrade !== undefined) {
    if (!GRADES.includes(prog.minGrade)) errors.push(where(`program.minGrade ${prog.minGrade} is not a letter grade`))
    else file.minGrade = prog.minGrade
  }
  if (prog.unitsMin !== undefined) {
    if (prog.unitsMin === null) delete file.unitsMin
    else file.unitsMin = Number(prog.unitsMin)
  }
  if (prog.subplanRequired !== undefined) file.subplanRequired = Boolean(prog.subplanRequired)
  if (prog.letterUnitsMin !== undefined) file.letterUnitsMin = Number(prog.letterUnitsMin)
  if (prog.gradUnitsShare !== undefined) {
    const share = Number(prog.gradUnitsShare)
    if (!(share > 0 && share <= 1)) errors.push(where('program.gradUnitsShare is a fraction, like 0.5'))
    else file.gradUnitsShare = share
  }
  if (prog.notes) file.reviewNotes = [file.reviewNotes, String(prog.notes)].filter(Boolean).join('\n')
  if (prog.totals !== undefined) {
    if (!Array.isArray(prog.totals)) errors.push(where('program.totals must be a list'))
    else {
      file.totals = prog.totals.map((t, i) => {
        const id = `program.totals[${i}]`
        for (const key of Object.keys(t)) {
          if (!['label', 'minUnits', 'maxUnits', 'minCourses', 'maxCourses', 'pool', 'codes', 'grading', 'when', 'unless', 'inRules', 'why'].includes(key)) errors.push(where(`${id}.${key} is not a known field`))
        }
        if (!t.label) errors.push(where(`${id} needs a label`))
        if (!t.why) ctx.warnings.push(where(`${id}: no "why"`))
        if (t.minUnits === undefined && t.maxUnits === undefined && t.minCourses === undefined && t.maxCourses === undefined) errors.push(where(`${id} needs minUnits, maxUnits, minCourses or maxCourses`))
        if (t.grading !== undefined && !['letter', 'not-letter'].includes(t.grading)) errors.push(where(`${id}.grading is letter or not-letter`))
        if (t.when !== undefined && !file.blocks.some(b => b.id === t.when)) errors.push(where(`${id}.when: block ${t.when} does not exist`))
        const out = { label: String(t.label ?? '') }
        for (const key of ['minUnits', 'maxUnits', 'minCourses', 'maxCourses']) if (t[key] !== undefined) out[key] = Number(t[key])
        if (t.pool) out.pool = checkPool(t.pool, id, ctx, where)
        if (t.codes) out.codes = checkItems(t.codes.map(c => [c]), id, ctx, where).map(item => item[0])
        if (t.grading) out.grading = t.grading
        if (t.when) out.when = t.when
        if (t.unless !== undefined && !file.blocks.some(b => b.id === t.unless)) errors.push(where(`${id}.unless: block ${t.unless} does not exist`))
        if (t.unless) out.unless = t.unless
        if (t.inRules) {
          if (t.minUnits !== undefined || t.minCourses !== undefined || (t.maxUnits === undefined && t.maxCourses === undefined)) errors.push(where(`${id}.inRules is only for a cap (maxUnits or maxCourses alone)`))
          else out.inRules = true
        }
        return out
      })
    }
  }

  const blockById = new Map(file.blocks.map(b => [b.id, b]))
  const index = new Map() // node id -> { node, siblings, block }
  const reindex = () => {
    index.clear()
    const walk = (list, block) => {
      for (const n of list) {
        if (index.has(n.id)) errors.push(where(`node id ${n.id} appears twice`))
        index.set(n.id, { node: n, siblings: list, block })
        if (n.children) walk(n.children, block)
      }
    }
    for (const b of file.blocks) walk(b.rules, b)
  }
  reindex()

  for (const [blockId, patch] of Object.entries(overlay.blocks ?? {})) {
    const b = blockById.get(blockId)
    if (!b) { errors.push(where(`block ${blockId} does not exist`)); continue }
    if (patch.kind !== undefined) {
      if (patch.kind === 'required') delete b.kind
      else if (['subplan', 'optional', 'info'].includes(patch.kind)) b.kind = patch.kind
      else errors.push(where(`block ${blockId}: kind ${patch.kind}`))
    }
    if (patch.units !== undefined) {
      if (patch.units === null) delete b.units
      else b.units = Number(patch.units)
    }
    if (patch.name) b.name = String(patch.name)
    // unlessSubplan: the block applies only to a student with no subplan.
    if (patch.unlessSubplan !== undefined) {
      if (patch.unlessSubplan) b.unlessSubplan = true
      else delete b.unlessSubplan
    }
    // shares: the block is a designation (WIM, capstone) whose courses also count elsewhere.
    if (patch.shares !== undefined) {
      if (patch.shares) b.wim = true
      else delete b.wim
    }
    for (const key of Object.keys(patch)) {
      if (!['kind', 'units', 'name', 'shares', 'unlessSubplan', 'why'].includes(key)) errors.push(where(`block ${blockId}: ${key} is not a known field`))
    }
  }

  for (const [nodeId, change] of Object.entries(overlay.nodes ?? {})) {
    const hit = index.get(nodeId)
    if (!hit) { errors.push(where(`node ${nodeId} does not exist`)); continue }
    if (!change.why) ctx.warnings.push(where(`node ${nodeId}: no "why"`))
    if (change.remove) {
      hit.siblings.splice(hit.siblings.indexOf(hit.node), 1)
    } else if (change.replace) {
      const replaced = specToNode(change.replace, nodeId, ctx, where)
      if (replaced) {
        if (!replaced.desc && hit.node.desc) replaced.desc = hit.node.desc
        if (!replaced.notes && hit.node.notes) replaced.notes = hit.node.notes
        if (!replaced.name && hit.node.name) replaced.name = hit.node.name
        replaced.reviewed = true
        hit.siblings[hit.siblings.indexOf(hit.node)] = replaced
      }
    } else if (change.patch) {
      patchNode(hit.node, change.patch, ctx, where)
    } else {
      errors.push(where(`node ${nodeId}: needs replace, patch or remove`))
    }
    reindex()
  }

  for (const alt of overlay.alternatives ?? []) {
    const ids = alt.of ?? []
    const hits = ids.map(id => index.get(id))
    if (hits.some(h => !h) || ids.length < 2) { errors.push(where(`alternatives ${alt.id}: needs two or more existing nodes`)); continue }
    const siblings = hits[0].siblings
    if (hits.some(h => h.siblings !== siblings)) { errors.push(where(`alternatives ${alt.id}: nodes must share a parent`)); continue }
    if (!alt.id || index.has(alt.id)) { errors.push(where(`alternatives: id ${alt.id} missing or taken`)); continue }
    const at = Math.min(...hits.map(h => siblings.indexOf(h.node)))
    const children = hits.map(h => h.node)
    for (const c of children) siblings.splice(siblings.indexOf(c), 1)
    const node = { id: alt.id, t: alt.n && alt.n > 1 ? 'some' : 'any', name: alt.name, children, reviewed: true }
    if (alt.n && alt.n > 1) node.n = alt.n
    siblings.splice(at, 0, node)
    reindex()
  }

  for (const add of overlay.add ?? []) {
    let list
    if (add.parent) {
      const hit = index.get(add.parent)
      if (!hit || !hit.node.children) { errors.push(where(`add: parent ${add.parent} is not a group rule`)); continue }
      list = hit.node.children
    } else {
      const b = blockById.get(add.block)
      if (!b) { errors.push(where(`add: block ${add.block} does not exist`)); continue }
      list = b.rules
    }
    const node = specToNode(add.node, add.node?.id, ctx, where)
    if (!node) continue
    if (index.has(node.id)) { errors.push(where(`add: id ${node.id} is taken`)); continue }
    node.reviewed = true
    list.push(node)
    reindex()
  }

  // Blocks emptied by removals go; a block with no rules has nothing to show.
  file.blocks = file.blocks.filter(b => b.rules.length > 0)
  const subplans = file.blocks.filter(b => b.kind === 'subplan')
  if (subplans.length === 1 && file.subplanRequired !== false) ctx.warnings.push(where(`one subplan block left (${subplans[0].name}); it will read as a choice of one`))
}

function patchNode(node, patch, ctx, where) {
  for (const key of Object.keys(patch)) {
    if (!PATCHABLE.has(key)) ctx.errors.push(where(`node ${node.id}: cannot patch ${key}`))
  }
  if (patch.addItems) {
    node.items = [...(node.items ?? []), ...checkItems(patch.addItems, node.id, ctx, where)]
  }
  if (patch.removeItems) {
    const drop = new Set(patch.removeItems)
    node.items = (node.items ?? []).map(item => item.filter(c => !drop.has(c))).filter(item => item.length)
  }
  // Grading on a choice (a rule the Bulletin writes as bundles of courses)
  // belongs to the courses under it.
  if (node.children && !node.items) {
    for (const key of ['letter', 'minGrade', 'minUnitsEach']) {
      if (patch[key] === undefined) continue
      const down = (n) => (n.t === 'courses' ? (patch[key] === null ? delete n[key] : (n[key] = patch[key])) : n.children?.forEach(down))
      node.children.forEach(down)
    }
  }
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'addItems' || key === 'removeItems' || !PATCHABLE.has(key)) continue
    if (node.children && !node.items && ['letter', 'minGrade', 'minUnitsEach'].includes(key)) continue
    if (value === null) { delete node[key]; continue }
    if (key === 'items') node.items = checkItems(value, node.id, ctx, where)
    else if (key === 'pool') node.pool = checkPool(value, node.id, ctx, where)
    else if (key === 'limits') node.limits = checkLimits(value, node.id, ctx, where)
    else node[key] = value
  }
  node.reviewed = true
  checkNode(node, ctx, where)
}

/** An overlay's rule spec -> a rule node, validated. */
function specToNode(spec, fallbackId, ctx, where) {
  if (!spec || typeof spec !== 'object') { ctx.errors.push(where(`rule spec missing for ${fallbackId}`)); return null }
  const id = String(spec.id ?? fallbackId ?? '')
  if (!id) { ctx.errors.push(where('a new rule needs an id')); return null }
  const node = { id, t: spec.t }
  for (const key of ['name', 'n', 'units', 'mode', 'minUnitsEach', 'letter', 'minGrade', 'shares', 'optional', 'info', 'manual', 'desc', 'notes']) {
    if (spec[key] !== undefined) node[key] = spec[key]
  }
  if (spec.items) node.items = checkItems(spec.items, id, ctx, where)
  if (spec.pool) node.pool = checkPool(spec.pool, id, ctx, where)
  if (spec.limits) node.limits = checkLimits(spec.limits, id, ctx, where)
  if (spec.children) {
    node.children = spec.children.map((c, i) => specToNode(c, c.id ?? `${id}-${i + 1}`, ctx, where)).filter(Boolean)
  }
  checkNode(node, ctx, where)
  return node
}

function checkNode(node, ctx, where) {
  const e = (s) => ctx.errors.push(where(`node ${node.id}: ${s}`))
  if (!NODE_TYPES.has(node.t)) return e(`t "${node.t}" is not one of ${[...NODE_TYPES].join(', ')}`)
  if (node.manual !== undefined && !MANUAL.has(node.manual)) e(`manual "${node.manual}" is not one of ${[...MANUAL].join(', ')}`)
  if (node.t === 'courses') {
    if (!MODES.has(node.mode)) e(`mode "${node.mode}"`)
    if (!(node.items?.length) && !node.pool) e('a courses rule needs items or a pool')
    if (node.mode === 'atLeast' && !(node.n > 0)) e('atLeast needs n')
    if (node.mode === 'units' && !(node.units > 0)) e('units mode needs units')
    // "OB 678 every quarter" (n of one listed course) repeats it; more than one listed and still too few is a mistake.
    if (node.mode === 'atLeast' && !node.pool && (node.items?.length ?? 0) > 1 && node.n > node.items.length) e(`n ${node.n} is more than the ${node.items?.length ?? 0} listed courses`)
    if (node.children) e('a courses rule has no children')
  } else if (node.t === 'text') {
    if (node.children || node.items || node.pool) e('a text rule has no courses or children')
  } else {
    if (!(node.children?.length)) e(`${node.t} needs children`)
    if (node.t === 'some' && !(node.n >= 1 && node.n <= (node.children?.length ?? 0))) e(`some needs 1 <= n <= ${node.children?.length ?? 0}`)
    if (node.items || node.pool) e(`${node.t} takes children, not courses`)
  }
  if (node.minUnitsEach !== undefined && !(node.minUnitsEach > 0)) e('minUnitsEach must be positive')
  if (node.minGrade !== undefined && !GRADES.includes(node.minGrade)) e(`minGrade ${node.minGrade} is not a letter grade`)
  for (const key of ['n', 'units', 'minUnitsEach']) if (node[key] !== undefined && typeof node[key] !== 'number') e(`${key} must be a number`)
}

function checkItems(items, id, ctx, where) {
  if (!Array.isArray(items)) { ctx.errors.push(where(`node ${id}: items must be a list`)); return [] }
  return items.map(item => (Array.isArray(item) ? item : [item])).map(item => {
    for (const code of item) {
      if (typeof code !== 'string' || !/^[A-Z&]+ \d/.test(code)) ctx.errors.push(where(`node ${id}: "${code}" is not a course code like "ENGLISH 160"`))
      else if (!ctx.codes.has(code)) ctx.warnings.push(where(`node ${id}: ${code} is not in the ${'catalog'} (kept; a student may have taken it)`))
    }
    return item
  })
}

function checkPool(pool, id, ctx, where) {
  if (!pool || (!pool.anySubject && (!Array.isArray(pool.subjects) || pool.subjects.length === 0))) {
    ctx.errors.push(where(`node ${id}: pool needs subjects, or anySubject`))
    return pool
  }
  if (!pool.subjects) pool.subjects = []
  for (const s of [...pool.subjects, ...(pool.excludeSubjects ?? [])]) if (!ctx.subjects.has(s)) ctx.errors.push(where(`node ${id}: subject ${s} does not exist`))
  for (const key of Object.keys(pool)) {
    if (!['subjects', 'anySubject', 'excludeSubjects', 'minNumber', 'maxNumber', 'exclude', 'excludeGraduate', 'onlyGraduate', 'takenListing'].includes(key)) ctx.errors.push(where(`node ${id}: pool.${key} is not a known field`))
  }
  if (pool.exclude) checkItems(pool.exclude.map(c => [c]), id, ctx, where)
  return pool
}

function checkLimits(limits, id, ctx, where) {
  if (!Array.isArray(limits)) { ctx.errors.push(where(`node ${id}: limits must be a list`)); return [] }
  for (const l of limits) {
    if (!l.label) ctx.errors.push(where(`node ${id}: each limit needs a label`))
    if (l.max === undefined && l.maxUnits === undefined) ctx.errors.push(where(`node ${id}: limit "${l.label}" needs max or maxUnits`))
    if (!l.codes && !l.pool) ctx.errors.push(where(`node ${id}: limit "${l.label}" needs codes or a pool`))
    if (l.codes) checkItems(l.codes.map(c => [c]), id, ctx, where)
    if (l.pool) checkPool(l.pool, id, ctx, where)
  }
  return limits
}
