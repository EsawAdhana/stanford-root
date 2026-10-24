/**
 * Checks a program's requirements against the audit, without a real
 * student: for every subplan and optional section, it builds a record that
 * satisfies each rule as the Bulletin data states it, audits that record,
 * and runs it through the situations a real record goes through (courses in
 * any order, still planned, in progress, one missing, extras, pass/fail
 * grades). Used by tests/requirements-all-programs.test.ts over all 355
 * programs and by scripts/check-requirements.mjs while reviewing one.
 *
 * A failure means one of three things, and the report says which it found:
 * the audit cannot satisfy a rule a student could (an engine bug), a rule
 * cannot be satisfied from what the Bulletin lists (a data problem for an
 * overlay to fix), or the record itself could not be built.
 */
import { runAudit, type AuditResult, type NodeResult, type ProgramResult } from './audit'
import { courseInPool } from './audit'
import type { CourseIndex } from './course-index'
import { EMPTY_OVERRIDES, type AuditOverrides, type Career, type CoursePool, type ProgramChoice, type ProgramData, type RuleNode, type StudentCourse } from './types'

export interface Finding {
  program: string
  variant: string
  scenario: string
  message: string
}

export interface Variant {
  label: string
  choice: ProgramChoice
}

/** One variant per subplan (or one with none), each with and without the optional sections. */
export function programVariants(data: ProgramData): Variant[] {
  const subplans = data.blocks.filter(b => b.kind === 'subplan')
  const optional = data.blocks.filter(b => b.kind === 'optional').map(b => b.id)
  const base: Variant[] = subplans.length
    ? subplans.map(b => ({ label: b.name, choice: { code: data.code, subplan: b.id } }))
    : [{ label: 'program', choice: { code: data.code } }]
  // A subplan the Bulletin does not require: finishing without one is a path too.
  if (subplans.length && data.subplanRequired === false) base.push({ label: 'no subplan', choice: { code: data.code } })
  const out = [...base]
  if (optional.length) for (const v of base) out.push({ label: `${v.label} + optional sections`, choice: { ...v.choice, optional } })
  return out
}

export interface Synthesized {
  courses: StudentCourse[]
  done: string[]
  /** Courses moved into free-text rules, as a student would. */
  pins: AuditOverrides['pins']
  /** Rules the generator could not fill from what they list. */
  short: string[]
}

const PAST_TERMS = ['Autumn 2022', 'Winter 2023', 'Spring 2023', 'Autumn 2023', 'Winter 2024', 'Spring 2024', 'Autumn 2024', 'Winter 2025', 'Spring 2025', 'Autumn 2025']

/**
 * A record that meets every rule of the variant as written: each listed
 * course once, enough units for every floor, free-text rules marked met.
 * It walks the first path of every choice; the audit may pick another.
 */
export function synthesizeStudent(data: ProgramData, choice: ProgramChoice, index: CourseIndex, career: Career, prefix = ''): Synthesized {
  const courses: StudentCourse[] = []
  const done: string[] = []
  const short: string[] = []
  const used = new Set<string>()
  let seq = 0

  const unitsOf = (code: string, min = 0) => {
    const info = index.get(code)
    return Math.max(info?.max || 4, min, 1)
  }
  const take = (code: string, min = 0): StudentCourse => {
    for (const eq of index.equivalents(code)) used.add(eq)
    used.add(code)
    // A course a cap counts ("a maximum of three units of S") is taken at its fewest units, as students do.
    const light = (data.totals ?? []).some(t => t.maxUnits !== undefined && t.minUnits === undefined && t.minCourses === undefined && (t.pool || t.codes?.length || t.grading) && capHits(t, code))
    const c: StudentCourse = {
      id: `${prefix}s${seq}`,
      code,
      term: PAST_TERMS[seq % PAST_TERMS.length],
      units: light ? Math.max(index.get(code)?.min || 1, min, 1) : unitsOf(code, min),
      grade: 'A',
      source: 'manual',
      career,
    }
    seq++
    courses.push(c)
    return c
  }

  // Courses from subjects this program never names, for free-text rules: a
  // student meets "a science elective from the approved list" by moving one
  // of their own courses into it.
  const named = new Set<string>()
  const collect = (n: RuleNode) => {
    for (const item of n.items ?? []) for (const code of item) named.add(code.split(' ')[0])
    for (const s of n.pool?.subjects ?? []) named.add(s)
    n.children?.forEach(collect)
  }
  data.blocks.forEach(b => b.rules.forEach(collect))
  const spare = index.all.filter(c => !named.has(c.code.split(' ')[0]) && c.max >= 3 && !c.tags.includes('REP')).map(c => c.code)
  let spareAt = 0
  const nextSpare = () => {
    while (spareAt < spare.length && used.has(spare[spareAt])) spareAt++
    return spare[spareAt++]
  }
  const pins: AuditOverrides['pins'] = []

  // As the audit matches a cap: through any listing of the course.
  const hits = (l: NonNullable<RuleNode['limits']>[number], code: string) =>
    index.equivalents(code).some(x => l.codes?.includes(x)) || (l.pool && courseInPool(l.pool, index.equivalents(code), index.get(code), code))

  /**
   * Courses a leaf accepts, listed ones first, then its pool (courses no cap
   * applies to before capped ones), never one taken already.
   */
  const candidates = (n: RuleNode): string[] => {
    const out: string[] = []
    const capped: string[] = []
    const seen = new Set<string>()
    const add = (code: string, list = out) => {
      if (seen.has(code) || used.has(code)) return
      seen.add(code)
      const info = index.get(code)
      if (n.minUnitsEach && (info?.max ?? 4) < n.minUnitsEach) return
      list.push(code)
    }
    for (const item of n.items ?? []) for (const code of item) add(code)
    if (n.pool) {
      for (const info of index.all) {
        if (!courseInPool(n.pool, [info.code], info)) continue
        add(info.code, n.limits?.some(l => hits(l, info.code)) || ruleCaps.some(t => capHits(t, info.code)) ? capped : out)
        if (out.length > 200) break
      }
    }
    return [...out, ...capped]
  }

  // The program's caps that bind its rules ("no more than 5 units of directed
  // reading may count toward the major"): a full record stays under them.
  const ruleCaps = (data.totals ?? []).filter(t => (t.inRules || t.grading === 'not-letter') && (t.maxUnits !== undefined || t.maxCourses !== undefined) && t.minUnits === undefined && t.minCourses === undefined)
  const capUsed = new Map<object, number>()
  const capCount = new Map<object, number>()
  // The record is letter graded, except courses offered only S/NC, which a CR/NC cap counts.
  const capHits = (t: NonNullable<ProgramData['totals']>[number], code: string) =>
    (!t.codes || index.equivalents(code).some(x => t.codes!.includes(x))) &&
    (!t.pool || courseInPool(t.pool, index.equivalents(code), index.get(code), code)) &&
    (!t.grading || (t.grading === 'not-letter') === (index.get(code)?.grading === 'S'))
  const underCaps = (code: string, units: number) => ruleCaps.every(t => !capHits(t, code) ||
    ((t.maxUnits === undefined || (capUsed.get(t) ?? 0) + units <= t.maxUnits) && (t.maxCourses === undefined || (capCount.get(t) ?? 0) + 1 <= t.maxCourses)))
  const countCaps = (code: string, units: number) => {
    for (const t of ruleCaps) if (capHits(t, code)) { capUsed.set(t, (capUsed.get(t) ?? 0) + units); capCount.set(t, (capCount.get(t) ?? 0) + 1) }
  }
  const limitCount = new Map<string, number>()
  const limitUnits = new Map<string, number>()
  const underLimit = (n: RuleNode, code: string) => {
    for (const l of n.limits ?? []) {
      if (!hits(l, code)) continue
      const key = `${n.id}|${l.label}`
      if ((limitCount.get(key) ?? 0) >= (l.max ?? Infinity)) return false
      if ((limitUnits.get(key) ?? 0) + unitsOf(code, n.minUnitsEach) > (l.maxUnits ?? Infinity)) return false
    }
    return true
  }
  const countLimit = (n: RuleNode, code: string) => {
    for (const l of n.limits ?? []) {
      if (!hits(l, code)) continue
      const key = `${n.id}|${l.label}`
      limitCount.set(key, (limitCount.get(key) ?? 0) + 1)
      limitUnits.set(key, (limitUnits.get(key) ?? 0) + unitsOf(code, n.minUnitsEach))
    }
  }

  /**
   * A repeatable course on the leaf's list, for unit totals one course cannot
   * reach. A rule asking for units of one course ("12 units in TRAM 299P")
   * says that course repeats, whatever the catalog's flag.
   */
  const repeatable = (n: RuleNode) =>
    (n.items ?? []).flat().find(code => index.get(code)?.tags.includes('REP')) ??
    (n.mode === 'units' && n.items?.length === 1 && !n.pool ? n.items[0][0] : undefined) ??
    // A course listed twice ("ACCT 615 in Year 1 and Year 2") is taken twice.
    (n.items ?? []).map(item => item[0]).find((code, i, all) => all.indexOf(code) !== i) ??
    // "OB 678 every quarter": more courses asked for than the one listed.
    (n.mode === 'atLeast' && n.items?.length === 1 && (n.n ?? 1) > 1 && !n.pool ? n.items[0][0] : undefined)

  /** Fill a leaf; returns the units it added. */
  const fillLeaf = (n: RuleNode): number => {
    if (n.t === 'text') {
      if (n.info) return 0
      // An exam, a thesis, an approval with no course count: nothing to move,
      // the student marks it met. One that counts courses or units takes moves.
      if (n.manual && !n.n && !n.units) { done.push(`${data.code}:${n.id}`); return 0 }
      let units = 0
      let count = 0
      while (count < (n.n ?? 1) || units < (n.units ?? 0)) {
        const code = nextSpare()
        if (!code) break
        const c = take(code)
        c.units = 5
        pins.push({ course: c.id, program: data.code, node: n.id })
        units += 5
        count++
      }
      return units
    }
    if (n.optional) return 0
    let units = 0
    if (n.mode === 'all') {
      units = prefilled.get(n.id) ?? 0
      if (n.units) units += topUp(n, n.units - units)
      return units
    }
    const needCourses = n.mode === 'atLeast' ? n.n ?? 1 : n.mode === 'units' ? 0 : n.n ?? (n.units ? 0 : 1)
    const needUnits = n.units ?? 0
    let count = 0
    if (n.shares || blockShares) {
      // Count what is already taken and on the list before taking more.
      const taken = (n.items ?? []).flat().filter(code => used.has(code))
      const inPool = n.pool ? courses.filter(c => courseInPool(n.pool!, index.equivalents(c.code), index.get(c.code), c.code)).map(c => c.code) : []
      for (const code of new Set([...taken, ...inPool])) {
        if (count >= needCourses && units >= needUnits) break
        count++
        units += unitsOf(code)
      }
    }
    for (const code of candidates(n)) {
      if (count >= needCourses && units >= needUnits) break
      if (!underLimit(n, code) || !underCaps(code, unitsOf(code, n.minUnitsEach))) continue
      countLimit(n, code)
      countCaps(code, unitsOf(code, n.minUnitsEach))
      units += take(code, n.minUnitsEach).units
      count++
    }
    const again = repeatable(n)
    while (again && (count < needCourses || units < needUnits)) {
      units += take(again, n.minUnitsEach).units
      count++
    }
    if (count < needCourses || units < needUnits) short.push(`${n.name ?? n.id}: listed courses run out (${count}/${needCourses} courses, ${units}/${needUnits} units)`)
    return units
  }

  /** Add courses from a leaf's own list until `missing` more units are in. */
  const topUp = (n: RuleNode, missing: number): number => {
    let added = 0
    if (n.t === 'text') {
      if (n.info || (n.manual && !n.n && !n.units)) return 0
      while (added < missing) {
        const code = nextSpare()
        if (!code) break
        const c = take(code)
        c.units = 5
        pins.push({ course: c.id, program: data.code, node: n.id })
        added += 5
      }
      return added
    }
    // An optional pool ("additional courses to reach 45 units") is where a floor's extra units go.
    if (n.optional && !n.pool) return 0
    for (const code of candidates(n)) {
      if (added >= missing) break
      if (!underLimit(n, code) || !underCaps(code, unitsOf(code, n.minUnitsEach))) continue
      countLimit(n, code)
      countCaps(code, unitsOf(code, n.minUnitsEach))
      added += take(code, n.minUnitsEach).units
    }
    const again = repeatable(n)
    while (again && added < missing) added += take(again, n.minUnitsEach).units
    return added
  }

  // Course lists first, free-text rules last: a floor is topped up from what
  // the Bulletin lists before a placeholder is moved in.
  const leavesUnder = (n: RuleNode, active: (x: RuleNode) => RuleNode[]): RuleNode[] => {
    const all: RuleNode[] = []
    const walk = (x: RuleNode) => (x.t === 'courses' || x.t === 'text' ? all.push(x) : active(x).forEach(walk))
    walk(n)
    // A "complete all of" list takes exactly its items; extras count nowhere.
    return [...all.filter(x => x.t === 'courses' && x.mode !== 'all'), ...all.filter(x => x.t === 'text')]
  }

  const activeKids = (n: RuleNode): RuleNode[] => {
    const kids = n.children ?? []
    if (n.t === 'any') return kids.slice(0, 1)
    if (n.t === 'some') return kids.slice(0, n.n ?? 1)
    return kids
  }

  const fill = (n: RuleNode): number => {
    if (n.t === 'courses' || n.t === 'text') return fillLeaf(n)
    let units = 0
    for (const c of activeKids(n)) units += fill(c)
    if (n.units && units < n.units) {
      // A floor over several rules: more courses from any of them.
      for (const leaf of leavesUnder(n, activeKids)) {
        if (units >= n.units) break
        units += topUp(leaf, n.units - units)
      }
      if (units < n.units) short.push(`${n.name ?? n.id}: ${units}/${n.units} units from its listed courses`)
    }
    return units
  }

  const included = data.blocks.filter(block =>
    block.kind !== 'info' &&
    !(block.kind === 'subplan' && block.id !== choice.subplan) &&
    !(block.unlessSubplan && data.blocks.some(b => b.kind === 'subplan' && b.id === choice.subplan)) &&
    !(block.kind === 'optional' && !choice.optional?.includes(block.id)))

  // Courses named outright first, across the whole program, so a pool
  // earlier on the page cannot spend a course a later rule requires by name.
  const prefilled = new Map<string, number>()
  let blockShares = false
  const prefill = (n: RuleNode) => {
    if (n.t === 'courses' && n.mode === 'all' && !n.optional) {
      let units = 0
      const nth = new Map<string, number>()
      const enrolled = (code: string) => courses.filter(c => c.code === code || index.equivalents(code).includes(c.code)).length
      for (const item of n.items ?? []) {
        // An item listed again ("PSYCH 196, three times") is another enrollment.
        const key = item.join('|')
        nth.set(key, (nth.get(key) ?? 0) + 1)
        const repeats = (n.items ?? []).filter(i => i.join('|') === key).length > 1
        // A designation (WIM, capstone) is met by a course already taken for another rule.
        if ((n.shares || blockShares) && item.some(code => enrolled(code) >= nth.get(key)!)) continue
        const fresh = item.find(code => !used.has(code))
        const again = item.find(code => index.get(code)?.tags.includes('REP')) ?? (repeats ? item[0] : undefined)
        // Every listing already taken for another rule: a repeatable course
        // is taken again; otherwise the audit has to count it twice here,
        // which is the case this exercises.
        const code = fresh ?? again
        if (code) units += take(code, n.minUnitsEach).units
      }
      prefilled.set(n.id, units)
      return
    }
    if (n.t !== 'courses' && n.t !== 'text') activeKids(n).forEach(prefill)
  }
  // Designations go last, so they can reuse what the rest of the program took.
  for (const b of [...included.filter(b => !b.wim), ...included.filter(b => b.wim)]) {
    blockShares = Boolean(b.wim)
    b.rules.forEach(prefill)
  }

  for (const block of [...included.filter(b => !b.wim), ...included.filter(b => b.wim)]) {
    blockShares = Boolean(block.wim)
    let units = 0
    for (const r of block.rules) units += fill(r)
    if (block.units && units < block.units) {
      const pseudo: RuleNode = { id: block.id, t: 'all', children: block.rules }
      for (const leaf of leavesUnder(pseudo, activeKids)) {
        if (units >= block.units) break
        units += topUp(leaf, block.units - units)
      }
      if (units < block.units) short.push(`${block.name}: ${units}/${block.units} units from its listed courses`)
    }
  }

  // The program's own counts ("60 units in the program", "23 units at the
  // 200 level"): the courses a student with a full record has besides the
  // ones each rule names. A graduate degree counts every graduate-career
  // course, so those are simply added; otherwise they go where the program's
  // rules take extras (a pool, or a free-text rule they are moved into).
  const graduateCareer = data.kind === 'grad'
  const absorbers: RuleNode[] = []
  const collectAbsorbers = (n: RuleNode) => {
    if (n.t === 'courses') { if (n.pool && n.mode !== 'all') absorbers.push(n); return }
    // A free-text rule takes what the student moves into it, past its own count too.
    if (n.t === 'text') { if (!n.info && !n.optional && (n.n || n.units || n.manual)) absorbers.push(n); return }
    activeKids(n).forEach(collectAbsorbers)
  }
  for (const b of included) if (!b.wim) b.rules.forEach(collectAbsorbers)
  // A graduate student's extra units are graduate courses.
  // Courses past a cap ("at most 15 units outside the department") would not count, so a full record has others.
  const caps = (data.totals ?? []).filter(t => t.maxUnits !== undefined && t.minUnits === undefined && t.minCourses === undefined && (!t.when || included.some(b => b.id === t.when)))
  const capped = (code: string) => caps.some(t => (t.pool || t.codes?.length || t.grading) && capHits(t, code))
  const fresh = (pool?: CoursePool) => index.all.find(c =>
    !used.has(c.code) && c.max >= 3 && !c.tags.includes('REP') &&
    (!graduateCareer || c.tags.includes('GR')) && !capped(c.code) &&
    (!pool || courseInPool(pool, index.equivalents(c.code), c, c.code)))?.code
  for (let round = 0; round < 8; round++) {
    const r = runAudit({ programs: [{ data, choice }], courses, index, overrides: { ...EMPTY_OVERRIDES, done, pins }, generalEducation: false, now: NOW }).programs[0]
    const failing = r.checks.filter(c => c.status === 'incomplete' && c.need !== undefined && (c.key === 'units' || c.key.startsWith('total:')))
    if (!failing.length) break
    let added = 0
    for (const check of failing) {
      const total = check.key === 'units' ? undefined : data.totals?.[Number(check.key.slice('total:'.length))]
      const byCourses = total?.minUnits === undefined && total?.minCourses !== undefined
      let gap = check.need! - check.have!
      while (gap > 0) {
        let c: StudentCourse | undefined
        if (graduateCareer) {
          const code = fresh(total?.pool)
          if (code) c = take(code)
        } else {
          for (const leaf of absorbers) {
            if (leaf.t === 'courses') {
              const code = candidates(leaf).find(x => !capped(x) && (!total?.pool || courseInPool(total.pool, index.equivalents(x), index.get(x), x)))
              if (code && underLimit(leaf, code)) { countLimit(leaf, code); c = take(code, leaf.minUnitsEach); break }
            } else {
              const code = total?.pool ? fresh(total.pool) : nextSpare()
              if (code) { c = take(code); pins.push({ course: c.id, program: data.code, node: leaf.id }); break }
            }
          }
        }
        if (!c) break
        gap -= byCourses ? 1 : c.units
        added++
      }
    }
    if (!added) {
      for (const check of failing) short.push(`${check.label}: ${check.detail}, and no rule takes more courses`)
      break
    }
  }
  return { courses, done, pins, short }
}

function careerFor(data: ProgramData): Career {
  return data.kind === 'grad' || data.kind === 'phd-minor' ? 'GR' : 'UG'
}

function audit(data: ProgramData[], choices: ProgramChoice[], courses: StudentCourse[], index: CourseIndex, overrides: Partial<AuditOverrides> = {}, now = NOW): AuditResult {
  return runAudit({
    programs: data.map((d, i) => ({ data: d, choice: choices[i] })),
    courses,
    index,
    overrides: { ...EMPTY_OVERRIDES, ...overrides },
    generalEducation: false,
    now,
  })
}

// Autumn 2026 is in session; every synthesized term is before it.
const NOW = new Date(2026, 9, 23)

/** What is not met, rule by rule, for a failure message. */
export function unmet(r: ProgramResult): string[] {
  const out: string[] = []
  const walk = (n: NodeResult, path: string) => {
    if (n.status === 'inactive') return
    const name = n.node.name ?? n.node.id
    if (n.children?.length) {
      if (n.floor && n.floor.have < n.floor.need) out.push(`${path}${name}: ${n.floor.have}/${n.floor.need} units`)
      n.children.forEach(c => walk(c, `${path}${name} > `))
      return
    }
    if (n.status === 'incomplete' || n.status === 'manual') {
      const need = n.need ? `${n.need.courses ? `${n.have.courses}/${n.need.courses} courses` : ''}${n.need.units ? ` ${n.have.units}/${n.need.units} units` : ''}` : n.status
      out.push(`${path}${name}: ${need.trim()}`)
    }
  }
  for (const b of r.blocks) {
    if (!b.included) continue
    if (b.floor && b.floor.have < b.floor.need) out.push(`${b.block.name}: ${b.floor.have}/${b.floor.need} units`)
    b.rules.forEach(n => walk(n, `${b.block.name} > `))
  }
  if (r.needsSubplan) out.push('needs a subplan')
  return out
}

/**
 * Every scenario for one program. Returns findings; an empty list is a pass.
 */
export function verifyProgram(data: ProgramData, index: CourseIndex): Finding[] {
  const findings: Finding[] = []
  const career = careerFor(data)
  for (const v of programVariants(data)) {
    const f = (scenario: string, message: string) => findings.push({ program: data.code, variant: v.label, scenario, message })
    try {
      // Nothing taken: no crash, nothing met.
      const empty = audit([data], [v.choice], [], index).programs[0]
      if (empty.met > 0) f('empty record', `${empty.met} requirements met with no courses`)

      const s = synthesizeStudent(data, v.choice, index, career)
      for (const msg of s.short) f('building a complete record', msg)
      const done = { done: s.done, pins: s.pins }
      const full = audit([data], [v.choice], s.courses, index, done)
      const p = full.programs[0]
      if (p.total === 0) {
        f('nothing to audit', 'every rule is information or free text the Bulletin data does not encode')
        continue
      }
      if (s.short.length === 0 && (p.status !== 'complete' || p.met !== p.total)) {
        f('complete record', `audit says ${p.status}, ${p.met}/${p.total}: ${unmet(p).slice(0, 6).join('; ')}`)
        continue
      }
      if (p.status !== 'complete') continue

      // Same courses, reverse order: the same answer.
      const reversed = audit([data], [v.choice], [...s.courses].reverse(), index, done).programs[0]
      if (reversed.status !== p.status || reversed.met !== p.met) f('reversed order', `${reversed.status} ${reversed.met}/${reversed.total} vs ${p.status} ${p.met}/${p.total}`)

      // Not taken yet: met by the plan, not met now.
      const planned = s.courses.map(c => ({ ...c, term: 'Spring 2027', grade: undefined }))
      const pr = audit([data], [v.choice], planned, index, done).programs[0]
      if (pr.metWithPlan !== pr.total) f('all planned', `${pr.metWithPlan}/${pr.total} met with the plan`)
      if (s.courses.length && pr.status === 'complete') f('all planned', 'complete before any course is taken')

      // Current quarter: met if they pass.
      const current = s.courses.map(c => ({ ...c, term: 'Autumn 2026', grade: undefined }))
      const cr = audit([data], [v.choice], current, index, done).programs[0]
      if (s.courses.length && cr.status !== 'in-progress') f('all in progress', `status ${cr.status}`)

      // Unrelated extra courses never take anything away.
      const extras: StudentCourse[] = ['ATHLETIC 10', 'DANCE 46', 'ME 1', 'LAW 7001', 'MED 299', 'OSPOXFRD 199'].filter(c => index.get(c)).map((code, i) => ({
        id: `x${i}`, code, term: 'Autumn 2024', units: 1, grade: 'S', source: 'manual', career,
      }))
      const noisy = audit([data], [v.choice], [...extras, ...s.courses], index, done).programs[0]
      if (noisy.status !== 'complete' || noisy.met !== p.met) f('extra unrelated courses', `${noisy.status} ${noisy.met}/${noisy.total}`)

      // One course missing: never more met than before.
      for (const drop of s.courses.slice(0, 8)) {
        const fewer = audit([data], [v.choice], s.courses.filter(c => c !== drop), index, done).programs[0]
        if (fewer.met > p.met) f('one course missing', `dropping ${drop.code} raised met to ${fewer.met}`)
      }

      // Pass/fail where letter grades are required.
      if (data.letterGrade && s.courses.length) {
        const cr = s.courses.map(c => ({ ...c, grade: 'CR', term: 'Autumn 2024' }))
        const crr = audit([data], [v.choice], cr, index, done).programs[0]
        const sOnly = s.courses.every(c => index.get(c.code)?.grading === 'S')
        if (!sOnly && crr.status === 'complete') f('pass/fail grades', 'complete with CR grades in a letter-grade program')
      }
    } catch (err) {
      f('crash', err instanceof Error ? `${err.message}\n${err.stack?.split('\n').slice(1, 4).join('\n')}` : String(err))
    }
  }
  return findings
}

/**
 * Two programs together, each with a record that completes it alone. When
 * the two records share no course, both must still be complete; when they
 * do share, Stanford's double-counting rule decides, and nothing may crash.
 * A secondary major or a what-if shares freely, so both stay complete.
 */
export function verifyPair(a: ProgramData, b: ProgramData, index: CourseIndex): Finding[] {
  const findings: Finding[] = []
  const label = `${a.code} + ${b.code}`
  const f = (scenario: string, message: string) => findings.push({ program: label, variant: 'first variants', scenario, message })
  const va = programVariants(a)[0]
  const vb = programVariants(b)[0]
  const sa = synthesizeStudent(a, va.choice, index, careerFor(a), 'a')
  const sb = synthesizeStudent(b, vb.choice, index, careerFor(b), 'b')
  if (sa.short.length || sb.short.length) return findings
  const alone = (d: ProgramData, v: Variant, s: Synthesized) => audit([d], [v.choice], s.courses, index, { done: s.done, pins: s.pins }).programs[0]
  if (alone(a, va, sa).status !== 'complete' || alone(b, vb, sb).status !== 'complete') return findings
  const codesA = new Set(sa.courses.flatMap(c => index.equivalents(c.code)))
  const shared = sb.courses.filter(c => index.equivalents(c.code).some(x => codesA.has(x)))
  const together = [...sa.courses, ...sb.courses]
  const done = { done: [...sa.done, ...sb.done], pins: [...sa.pins, ...sb.pins] }
  try {
    const r = audit([a, b], [va.choice, vb.choice], together, index, done)
    if (shared.length === 0 && r.programs.some(p => p.status !== 'complete')) {
      f('both complete', r.programs.map(p => `${p.code} ${p.status} ${p.met}/${p.total}: ${unmet(p).slice(0, 3).join('; ')}`).join(' | '))
    }
    if (r.doubleCounted.length) f('double counting', `${r.doubleCounted.length} courses counted twice without a move`)
    const whatIf = audit([a, b], [va.choice, { ...vb.choice, exploring: true }], together, index, done)
    if (whatIf.programs.some(p => p.status !== 'complete')) f('what-if', whatIf.programs.map(p => `${p.code} ${p.status}`).join(', '))
  } catch (err) {
    f('crash', err instanceof Error ? err.message : String(err))
  }
  return findings
}
