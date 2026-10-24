/**
 * The degree audit: which of a student's courses fill which requirement, and
 * where each requirement stands.
 *
 * Statuses follow My Academic Path's legend: complete (a check, final grades
 * in), in progress (MAP's diamond: satisfied if the current courses pass),
 * planned (satisfied only by courses not taken yet), incomplete (MAP's red
 * exclamation). Free-text rules the Bulletin states only in words are
 * `manual` until the student assigns courses to them or marks them done.
 *
 * Double counting follows the Bulletin:
 *   - a course counts once inside a program, except toward Writing in the
 *     Major, which designates a course that is also part of the major
 *   - two majors, or a major and a minor, may share only the foundational
 *     courses (FOUNDATIONAL_COURSES); a secondary major may share anything
 *   - general education shares with everything, but a course fills one Way
 *   - a coterm master's program may use undergraduate courses toward its
 *     requirements at 0 units ("do not enter units for Stanford courses
 *     counted toward your BS", CS MS); only graduate-career units count
 *     toward its unit totals
 *
 * Within each group of programs that compete for courses, assignment is a
 * min-cost flow (see flow.ts), so a course goes where it does the most good.
 * Rules with alternatives ("any of these paths", "3 of these 4 areas") are
 * searched: each choice is tried and the best total kept.
 */
import { MinCostFlow } from './flow'
import type { CourseIndex } from './course-index'
import { normalizeCode } from './course-index'
import { FOUNDATIONAL_COURSES, GE_PROGRAMS, MASTERS_UNITS, UNDERGRAD_UNITS } from './general-education'
import { countsTowardDegree, courseStatus, isCreditTerm, isLetterGrade, isPassNoLetter, normalizeGrade, TEST_CREDIT } from './student-courses'
import type {
  AuditOverrides,
  Career,
  CourseInfo,
  CoursePool,
  CourseStatus,
  ProgramBlock,
  ProgramChoice,
  ProgramData,
  ProgramTotal,
  RuleLimit,
  RuleNode,
  StudentCourse,
} from './types'

export type NodeStatus = 'complete' | 'in-progress' | 'planned' | 'incomplete' | 'manual' | 'optional' | 'info' | 'inactive'

const RANK: Record<string, number> = { incomplete: 0, manual: 1, planned: 2, 'in-progress': 3, complete: 4 }
const NEUTRAL = new Set<NodeStatus>(['optional', 'info', 'inactive'])

export interface AppliedCourse {
  courseId: string
  /** Units this course counts for here (0 for an undergraduate course in a master's program). */
  units: number
  pinned?: boolean
  /** Pinned somewhere it is not on the Bulletin's list: needs an approved exception. */
  exception?: boolean
  /** Counted here and elsewhere in the same program (Writing in the Major). */
  shared?: boolean
}

export interface Amount {
  courses?: number
  units?: number
}

export interface NodeResult {
  node: RuleNode
  status: NodeStatus
  /** What the rule asks for, when it is a number. */
  need?: Amount
  /** What is applied, counting planned courses. */
  have: { courses: number; units: number }
  applied: AppliedCourse[]
  children?: NodeResult[]
  /** For `any` and `some`: the children in use. */
  chosen?: string[]
  /** The choice was the solver's, not the student's. */
  auto?: boolean
  floor?: { need: number; have: number }
  doneByStudent?: boolean
  /** Courses the student moved here that the grading or unit rules keep out ("letter grade, C or better", "at least 3 units"). */
  belowGrade?: string[]
}

export interface BlockResult {
  block: ProgramBlock
  included: boolean
  status: NodeStatus
  rules: NodeResult[]
  floor?: { need: number; have: number }
}

export interface ProgramResult {
  code: string
  data: ProgramData
  choice: ProgramChoice
  blocks: BlockResult[]
  status: NodeStatus
  /** Requirements counted for the progress bar, and how many are met. */
  total: number
  met: number
  metWithPlan: number
  units: number
  needsSubplan: boolean
  isGeneralEducation: boolean
  /** Rules over the whole program: letter-graded units, the graduate-level share. */
  checks: ProgramCheck[]
}

export interface ProgramCheck {
  /** 'units' (the program's minimum), 'total:<i>' (data.totals[i]), 'letter', 'graduate'. */
  key: string
  label: string
  status: NodeStatus
  detail: string
  /** For a minimum: how far along it is, in units (or courses, for a course count). */
  have?: number
  need?: number
  /** Only a cap ("at most 10 units CR/NC"): it counts toward the program's total only once it is broken. */
  cap?: boolean
}

export interface UnitSummary {
  need: number
  completed: number
  inProgress: number
  planned: number
  /** Pass/fail units beyond the 36-unit cap, which do not count. */
  overCap: number
  /** Test and transfer units beyond the 45-unit cap on outside credit, which do not count. */
  externalOverCap: number
}

export interface AuditResult {
  programs: ProgramResult[]
  generalEducation: ProgramResult[]
  undergradUnits?: UnitSummary
  gradUnits?: UnitSummary
  /** Courses that count toward a degree but fill nothing: MAP's "Classes Not Applied Toward Degree". */
  notApplied: string[]
  /** Failed, withdrawn and repeated attempts. */
  notCounted: string[]
  /** A course used by two programs that may not share it. */
  doubleCounted: { courseId: string; programs: string[] }[]
  courses: Map<string, AuditCourse>
}

export interface AuditCourse {
  course: StudentCourse
  status: CourseStatus
  info?: CourseInfo
  codes: Set<string>
  career: Career
  units: number
}

export interface AuditInput {
  programs: { data: ProgramData; choice: ProgramChoice }[]
  courses: StudentCourse[]
  index: CourseIndex
  overrides: AuditOverrides
  /** Audit the undergraduate general education requirements. */
  generalEducation: boolean
  now?: Date
}

/** "CS-BS:r12", the key overrides use. */
export function nodeKey(program: string, node: string): string {
  return `${program}:${node}`
}

// ── Rewards (negative costs) ──
const REWARD_REQUIRED = 1000
const REWARD_UNITS_MORE = 300
const REWARD_SURPLUS_FLOOR = 2
const REWARD_SURPLUS = 1
const REWARD_PIN = 100_000
const BONUS_STATUS: Record<string, number> = { completed: 3, 'in-progress': 2, planned: 1 }
const BONUS_CAREER = 4

interface Slot {
  key: string
  program: string
  prog: ProgramData
  node: RuleNode
  /** Index into node.items for "complete all of" rules, one slot per item. */
  item?: number
  wim: boolean
  /** Free-text rule: only courses the student moves here. */
  pinOnly: boolean
  tiers: { cap: number; reward: number }[]
  /** A unit target, whose tiers are sized once the eligible courses are known. */
  unitNeed?: { units: number; reward: number; surplus: { cap: number; reward: number } }
}

interface AuditProgram {
  data: ProgramData
  choice: ProgramChoice
  group: string
  isGE: boolean
  isGrad: boolean
}

type Choices = Map<string, string[]>

export function runAudit(input: AuditInput): AuditResult {
  const now = input.now ?? new Date()
  const { index, overrides } = input

  const hasUndergradProgram = input.programs.some(p => isUndergradKind(p.data))
  const defaultCareer: Career = !hasUndergradProgram && input.programs.some(p => !isUndergradKind(p.data)) ? 'GR' : 'UG'

  // ── Courses ──
  const courses = new Map<string, AuditCourse>()
  for (const course of input.courses) {
    const code = normalizeCode(course.code)
    const info = index.get(code)
    const codes = new Set(index.equivalents(code))
    codes.add(code)
    const status = courseStatus(course, now)
    const career: Career = isCreditTerm(course.term) ? 'UG' : course.career ?? defaultCareer
    courses.set(course.id, { course: { ...course, code }, status, info, codes, career, units: Number(course.units) || 0 })
  }
  const counting = [...courses.values()].filter(c => countsTowardDegree(c.status))

  // ── Programs and groups ──
  const programs: AuditProgram[] = input.programs.map(({ data, choice }) => {
    const ug = isUndergradKind(data)
    let group = `p:${data.code}`
    if (ug && !choice.secondary && !choice.exploring) group = 'ug'
    return { data, choice, group, isGE: false, isGrad: !ug }
  })
  const ge: AuditProgram[] = input.generalEducation
    ? GE_PROGRAMS.map(data => ({ data, choice: { code: data.code }, group: `ge:${data.code}`, isGE: true, isGrad: false }))
    : []
  const all = [...programs, ...ge]

  const pinsBy = new Map<string, Set<string>>() // course|program -> node ids
  for (const pin of overrides.pins) {
    const k = `${pin.course}|${pin.program}`
    if (!pinsBy.has(k)) pinsBy.set(k, new Set())
    pinsBy.get(k)!.add(pin.node)
  }
  const excluded = new Set(overrides.exclusions.map(e => `${e.course}|${e.program}`))
  const done = new Set(overrides.done)

  const ctx: Ctx = { courses, counting, pinsBy, excluded, done, overrides }

  const results = new Map<string, ProgramResult>()
  const groups = new Map<string, AuditProgram[]>()
  for (const p of all) {
    if (!groups.has(p.group)) groups.set(p.group, [])
    groups.get(p.group)!.push(p)
  }
  for (const members of groups.values()) {
    for (const r of solveGroup(members, ctx)) results.set(r.code, r)
  }

  const programResults = programs.map(p => results.get(p.data.code)!)
  const geResults = ge.map(p => results.get(p.data.code)!)

  // ── Applied / not applied / double counted ──
  const usage = new Map<string, string[]>()
  for (const r of [...programResults, ...geResults]) {
    if (r.choice.exploring) continue
    const seen = new Set<string>()
    forEachApplied(r, a => {
      if (seen.has(a.courseId)) return
      seen.add(a.courseId)
      if (!usage.has(a.courseId)) usage.set(a.courseId, [])
      usage.get(a.courseId)!.push(r.code)
    })
  }
  const notApplied = counting.filter(c => !usage.has(c.course.id)).map(c => c.course.id)
  const notCounted = [...courses.values()].filter(c => !countsTowardDegree(c.status)).map(c => c.course.id)
  const ugGroupCodes = new Set(programs.filter(p => p.group === 'ug').map(p => p.data.code))
  const doubleCounted: AuditResult['doubleCounted'] = []
  for (const [courseId, codes] of usage) {
    const shared = codes.filter(c => ugGroupCodes.has(c))
    const course = courses.get(courseId)
    if (shared.length > 1 && course && !isFoundational(course)) doubleCounted.push({ courseId, programs: shared })
  }

  // ── Units ──
  let undergradUnits: UnitSummary | undefined
  let gradUnits: UnitSummary | undefined
  if (input.generalEducation || hasUndergradProgram) {
    const ugMajors = programs.filter(p => p.data.kind === 'major' && !p.choice.exploring && !p.choice.secondary)
    const degrees = new Set(ugMajors.map(p => p.data.degree))
    const need = degrees.has('BA') && degrees.has('BS') ? UNDERGRAD_UNITS.dual : UNDERGRAD_UNITS.bachelor
    undergradUnits = sumUnits(counting.filter(c => c.career === 'UG'), need, UNDERGRAD_UNITS.passFailCap, UNDERGRAD_UNITS.externalCap)
  }
  if (programs.some(p => p.isGrad && !p.choice.exploring && /^M/.test(p.data.degree))) {
    gradUnits = sumUnits(counting.filter(c => c.career === 'GR'), MASTERS_UNITS)
  }

  return {
    programs: programResults,
    generalEducation: geResults,
    undergradUnits,
    gradUnits,
    notApplied,
    notCounted,
    doubleCounted,
    courses,
  }
}

function isUndergradKind(data: ProgramData): boolean {
  return data.kind === 'major' || data.kind === 'minor' || data.kind === 'honors'
}

function isFoundational(c: AuditCourse): boolean {
  for (const code of c.codes) if (FOUNDATIONAL_COURSES.has(code)) return true
  return false
}

function sumUnits(list: AuditCourse[], need: number, passFailCap?: number, externalCap?: number): UnitSummary {
  const summary: UnitSummary = { need, completed: 0, inProgress: 0, planned: 0, overCap: 0, externalOverCap: 0 }
  let passFail = 0
  let external = 0
  for (const c of list) {
    let units = c.units
    if (externalCap !== undefined && isCreditTerm(c.course.term)) {
      const counted = Math.min(Math.max(0, externalCap - external), units)
      external += units
      summary.externalOverCap += units - counted
      units = counted
    }
    if (passFailCap !== undefined && c.status === 'completed' && isPassNoLetter(c.course.grade) && !isCreditTerm(c.course.term)) {
      const room = Math.max(0, passFailCap - passFail)
      const counted = Math.min(room, units)
      passFail += units
      summary.overCap += units - counted
      units = counted
    }
    if (c.status === 'completed') summary.completed += units
    else if (c.status === 'in-progress') summary.inProgress += units
    else summary.planned += units
  }
  return summary
}

export function forEachApplied(r: ProgramResult, fn: (a: AppliedCourse, node: NodeResult) => void) {
  const walk = (n: NodeResult) => {
    for (const a of n.applied) fn(a, n)
    n.children?.forEach(walk)
  }
  for (const b of r.blocks) if (b.included) b.rules.forEach(walk)
}

interface Ctx {
  courses: Map<string, AuditCourse>
  counting: AuditCourse[]
  pinsBy: Map<string, Set<string>>
  excluded: Set<string>
  done: Set<string>
  overrides: AuditOverrides
}

// ── Group solve with the alternate-path search ──

function solveGroup(members: AuditProgram[], ctx: Ctx): ProgramResult[] {
  const fixed: Choices = new Map()
  const choiceNodes: { program: AuditProgram; node: RuleNode }[] = []
  for (const p of members) {
    for (const block of includedBlocks(p)) {
      walkRules(block.rules, node => {
        if ((node.t === 'any' || node.t === 'some') && node.children && node.children.length > 1) {
          const key = nodeKey(p.data.code, node.id)
          const picked = ctx.overrides.paths[key]
          if (node.t === 'any' && picked && node.children.some(c => c.id === picked)) fixed.set(key, [picked])
          else choiceNodes.push({ program: p, node })
        }
      })
    }
  }

  // 1. Everything active, to see which alternatives the courses lean toward.
  let choices: Choices = new Map(fixed)
  let results = solveOnce(members, ctx, choices)

  // 2. Pick, per choice node, the children with the least left to take, outermost first.
  // How close each child came is also the order step 3 tries them in.
  const promise = new Map<string, Map<string, number>>()
  if (choiceNodes.length) {
    choices = new Map(fixed)
    for (const { program, node } of choiceNodes) {
      const key = nodeKey(program.data.code, node.id)
      const r = findNode(results, program.data.code, node.id)
      const kids = node.children!
      const want = node.t === 'any' ? 1 : Math.min(node.n ?? 1, kids.length)
      const scored = kids.map((k, i) => ({ id: k.id, i, score: r?.children?.[i] ? -remaining(r.children[i]) : -Infinity }))
      promise.set(key, new Map(scored.map(s => [s.id, s.score])))
      scored.sort((a, b) => b.score - a.score || a.i - b.i)
      choices.set(key, scored.slice(0, want).map(s => s.id).sort((a, b) => kids.findIndex(k => k.id === a) - kids.findIndex(k => k.id === b)))
    }
    results = solveOnce(members, ctx, choices)
    let best = groupScore(results)

    // 3. Try each other alternative, one choice at a time; keep what helps.
    // Enough tries to visit every alternative once (Political Science pairs
    // five tracks into twenty primary and secondary combinations), within a cap.
    const total = choiceNodes.reduce((n, { node }) => n + (node.children?.length ?? 0), 0)
    let budget = Math.min(200, Math.max(48, total * 2))
    for (let pass = 0; pass < 2 && budget > 0; pass++) {
      let improved = false
      for (const { program, node } of choiceNodes) {
        const key = nodeKey(program.data.code, node.id)
        const current = choices.get(key)
        if (!current || !isActive(results, program.data.code, node.id)) continue
        const score = promise.get(key)
        const value = (ids: string[]) => ids.reduce((n, id) => n + (score?.get(id) ?? -Infinity), 0)
        const ordered = alternatives(node, current).sort((a, b) => value(b) - value(a))
        for (const candidate of ordered) {
          if (budget-- <= 0) break
          let trial = new Map(choices)
          trial.set(key, candidate)
          let r = solveOnce(members, ctx, trial)
          let score = groupScore(r)
          if (score <= best + 1e-9) {
            // The new path's own choices still carry picks made while it was
            // not in use (LING-PHD's Group I or Group II sets): try those along
            // with it, which one change at a time never reaches.
            const picked = node.children!.filter(c => candidate.includes(c.id))
            const nested = choiceNodes.filter(x => x.program === program && x.node !== node && picked.some(k => contains(k, x.node)))
            outer: for (const inner of nested) {
              const ik = nodeKey(inner.program.data.code, inner.node.id)
              const cur = trial.get(ik)
              if (!cur) continue
              for (const alt of alternatives(inner.node, cur)) {
                if (budget-- <= 0) break outer
                const t2 = new Map(trial)
                t2.set(ik, alt)
                const r2 = solveOnce(members, ctx, t2)
                const s2 = groupScore(r2)
                if (s2 > score + 1e-9) {
                  score = s2
                  r = r2
                  trial = t2
                }
              }
            }
          }
          if (score > best + 1e-9) {
            best = score
            results = r
            choices = trial
            improved = true
            break
          }
        }
      }
      if (!improved) {
        // Two choices that pick from the same options (a primary and a
        // secondary pathway): trade their picks, which one change at a time
        // never reaches.
        const name = (node: RuleNode, id: string) => node.children?.find(c => c.id === id)?.name
        for (let i = 0; i < choiceNodes.length && !improved && budget > 0; i++) {
          for (let j = i + 1; j < choiceNodes.length && !improved && budget > 0; j++) {
            const [a, b] = [choiceNodes[i], choiceNodes[j]]
            if (a.program !== b.program || a.node.t !== 'any' || b.node.t !== 'any') continue
            const [ka, kb] = [nodeKey(a.program.data.code, a.node.id), nodeKey(b.program.data.code, b.node.id)]
            const [ca, cb] = [choices.get(ka)?.[0], choices.get(kb)?.[0]]
            if (!ca || !cb) continue
            const toA = a.node.children?.find(c => c.name && c.name === name(b.node, cb))
            const toB = b.node.children?.find(c => c.name && c.name === name(a.node, ca))
            if (!toA || !toB || toA.id === ca) continue
            budget--
            const trial = new Map(choices)
            trial.set(ka, [toA.id])
            trial.set(kb, [toB.id])
            const r = solveOnce(members, ctx, trial)
            const score = groupScore(r)
            if (score > best + 1e-9) {
              best = score
              results = r
              choices = trial
              improved = true
            }
          }
        }
        if (!improved) break
      }
    }
  }

  // Mark solver-made choices so the UI can say "picked for you".
  for (const r of results) {
    walkResults(r, n => {
      if (n.chosen && !fixed.has(nodeKey(r.code, n.node.id))) n.auto = true
    })
  }
  return results
}

function contains(root: RuleNode, target: RuleNode): boolean {
  return root === target || (root.children ?? []).some(c => contains(c, target))
}

function alternatives(node: RuleNode, current: string[]): string[][] {
  const ids = node.children!.map(c => c.id)
  if (node.t === 'any') return ids.filter(id => id !== current[0]).map(id => [id])
  // `some`: swap one chosen child for one unchosen child.
  const out: string[][] = []
  for (const drop of current) {
    for (const add of ids) {
      if (current.includes(add)) continue
      const next = current.filter(id => id !== drop).concat(add)
      out.push(ids.filter(id => next.includes(id)))
    }
  }
  return out
}

function walkRules(rules: RuleNode[], fn: (node: RuleNode) => void) {
  const walk = (n: RuleNode) => {
    fn(n)
    n.children?.forEach(walk)
  }
  rules.forEach(walk)
}

function walkResults(r: ProgramResult, fn: (n: NodeResult) => void) {
  const walk = (n: NodeResult) => {
    fn(n)
    n.children?.forEach(walk)
  }
  r.blocks.forEach(b => b.rules.forEach(walk))
}

function findNode(results: ProgramResult[], code: string, id: string): NodeResult | undefined {
  const r = results.find(x => x.code === code)
  let found: NodeResult | undefined
  if (r) walkResults(r, n => { if (n.node.id === id) found = n })
  return found
}

function isActive(results: ProgramResult[], code: string, id: string): boolean {
  const n = findNode(results, code, id)
  return Boolean(n && n.status !== 'inactive')
}

/**
 * Coursework still missing under a rule, in courses (units count at 4 to a
 * course). The search minimizes this, the work left to graduate, rather
 * than the share of rules done: moving one course from a track area into
 * general electives finishes a rule but leaves the same amount to take, and
 * it should not win. Ties keep the flow's own placement.
 */
function remaining(n: NodeResult): number {
  if (n.status === 'inactive' || NEUTRAL.has(n.status) || n.doneByStudent) return 0
  let left = 0
  if (n.children && n.children.length) {
    for (const c of n.children) left += remaining(c)
  } else if (n.status === 'incomplete' || n.status === 'manual') {
    // A hand check weighs more than several courses to take: between a path
    // the audit can check and one only a person can ("current PhD students:
    // the committee approves"), the audit shows the checkable one and its
    // gaps, and the student can pick the other.
    if (!n.need) left = 1
    else {
      if (n.need.courses) left = Math.max(left, n.need.courses - n.have.courses)
      if (n.need.units) left = Math.max(left, (n.need.units - n.have.units) / UNITS_PER_COURSE)
    }
    if (n.status === 'manual') left += 9
  }
  if (n.floor) left = Math.max(left, (n.floor.need - n.floor.have) / UNITS_PER_COURSE)
  return Math.max(0, left)
}

const UNITS_PER_COURSE = 4

/** Higher is better: less work left, then fewer requirements that rest on courses not yet taken. */
function groupScore(results: ProgramResult[]): number {
  let left = 0
  let planned = 0
  for (const r of results) {
    for (const b of r.blocks) {
      if (!b.included) continue
      let blockLeft = 0
      for (const n of b.rules) blockLeft += remaining(n)
      if (b.floor) blockLeft = Math.max(blockLeft, (b.floor.need - b.floor.have) / UNITS_PER_COURSE)
      left += blockLeft
    }
    // The program's own counts too ("60 units in the program"): a path that
    // leaves the student short of them is worse than one that does not.
    for (const c of r.checks) {
      if (c.status !== 'incomplete' || c.cap) continue
      left += c.need !== undefined && c.have !== undefined
        ? Math.max(0, c.need - c.have) / (c.key.startsWith('total:') && r.data.totals?.[Number(c.key.slice(6))]?.minUnits === undefined ? 1 : UNITS_PER_COURSE)
        : 1
    }
    planned += r.metWithPlan - r.met
  }
  return -left - planned / 1000
}

function includedBlocks(p: AuditProgram): ProgramBlock[] {
  return p.data.blocks.filter(b => blockIncluded(p, b))
}

function blockIncluded(p: AuditProgram, b: ProgramBlock): boolean {
  if (b.kind === 'info') return false
  if (b.kind === 'subplan') return p.choice.subplan === b.id
  if (b.kind === 'optional') return Boolean(p.choice.optional?.includes(b.id))
  if (b.unlessSubplan) return !p.data.blocks.some(x => x.kind === 'subplan' && x.id === p.choice.subplan)
  return true
}

// ── One assignment for fixed choices ──

function solveOnce(members: AuditProgram[], ctx: Ctx, choices: Choices): ProgramResult[] {
  // Slots for every active leaf.
  const slotsBy = new Map<string, Slot[]>()
  const nodeSlots = new Map<string, Slot[]>()
  for (const p of members) {
    const slots: Slot[] = []
    for (const block of includedBlocks(p)) {
      const floorAbove = Boolean(block.units)
      const walk = (n: RuleNode, floor: boolean) => {
        const f = floor || Boolean(n.units && n.t !== 'courses')
        if (n.t === 'courses' || n.t === 'text') {
          const made = makeSlots(p, n, block.wim === true, f)
          nodeSlots.set(nodeKey(p.data.code, n.id), made)
          slots.push(...made)
          return
        }
        const active = activeChildren(p, n, choices)
        for (const c of n.children ?? []) if (active.has(c.id)) walk(c, f)
      }
      block.rules.forEach(r => walk(r, floorAbove))
    }
    slotsBy.set(p.data.code, slots)
  }

  // Flow network.
  const flow = new MinCostFlow()
  const source = flow.addNode()
  const sink = flow.addNode()
  const slotNode = new Map<Slot, number>()
  const limitNodes = new Map<Slot, { limit: RuleLimit; node: number }[]>()
  for (const slots of slotsBy.values()) {
    for (const s of slots) {
      if (s.wim) continue
      if (s.unitNeed) {
        const p = members.find(m => m.data.code === s.program)!
        const eligible = ctx.counting.filter(c => unitsFor(c, p) > 0 && accepts(s, c)).map(c => unitsFor(c, p))
        const { units, reward, surplus } = s.unitNeed
        s.tiers = eligible.length ? unitTiers(units, reward, surplus, Math.min(...eligible), Math.max(...eligible)) : unitTiers(units, reward, surplus)
      }
      const node = flow.addNode()
      slotNode.set(s, node)
      for (const tier of s.tiers) flow.addEdge(node, sink, tier.cap, -tier.reward)
      // "Only one creative writing course": the capped courses pass through
      // one node whose capacity is the cap.
      if (s.node.limits?.length) {
        limitNodes.set(s, s.node.limits.map(limit => {
          const via = flow.addNode()
          flow.addEdge(via, node, limit.max ?? 99, 0)
          return { limit, node: via }
        }))
      }
    }
  }
  const entryFor = (s: Slot, c: AuditCourse) => limitNodes.get(s)?.find(l => limitMatches(l.limit, c))?.node ?? slotNode.get(s)!

  const assignEdges: { edge: number; course: AuditCourse; slot: Slot; pinned: boolean; exception: boolean }[] = []
  for (const c of ctx.counting) {
    const progEdges: { p: AuditProgram; edges: { slot: Slot; cost: number; pinned: boolean; exception: boolean }[] }[] = []
    for (const p of members) {
      if (ctx.excluded.has(`${c.course.id}|${p.data.code}`)) continue
      if (!careerFits(c, p)) continue
      // A course moved into a designation (WIM, capstone) still fills the
      // rest of the program; only moves into other rules steer the flow.
      const designations = new Set((slotsBy.get(p.data.code) ?? []).filter(s => s.wim).map(s => s.node.id))
      const pinnedAll = ctx.pinsBy.get(`${c.course.id}|${p.data.code}`)
      const pinned = pinnedAll && new Set([...pinnedAll].filter(id => !designations.has(id)))
      const edges: { slot: Slot; cost: number; pinned: boolean; exception: boolean }[] = []
      for (const s of slotsBy.get(p.data.code) ?? []) {
        if (s.wim) continue
        const bonus = (BONUS_STATUS[c.status] ?? 0) + (p.isGrad === (c.career === 'GR') ? BONUS_CAREER : 0)
        if (pinned && pinned.size) {
          if (!pinned.has(s.node.id)) continue
          // A move never gets past a grading rule or a per-course unit minimum;
          // "Mark as met" is the student's override.
          if (!gradeFits(s, c) || !unitsFit(s, c)) continue
          const eligible = !s.pinOnly && accepts(s, c)
          // An item slot the course is not on is only a fallback for the pin.
          const isItemMismatch = s.item !== undefined && !eligible && nodeHasEligibleItem(nodeSlotsFor(p, s.node, slotsBy), c)
          if (isItemMismatch) continue
          edges.push({ slot: s, cost: -(REWARD_PIN + bonus), pinned: true, exception: !eligible && !s.pinOnly })
        } else if (!s.pinOnly && accepts(s, c)) {
          // A course worth 0 units here (undergraduate, in a master's) cannot
          // help a unit target, only a course count.
          if (s.unitNeed && unitsFor(c, p) === 0) continue
          edges.push({ slot: s, cost: -bonus, pinned: false, exception: false })
        }
      }
      if (edges.length) progEdges.push({ p, edges })
    }
    if (!progEdges.length) continue
    const courseNode = flow.addNode()
    // Inside the undergraduate group only foundational courses may serve more than one program.
    const shares = members[0].group === 'ug' && isFoundational(c) ? progEdges.length : 1
    flow.addEdge(source, courseNode, shares, 0)
    for (const { edges } of progEdges) {
      const pc = flow.addNode()
      flow.addEdge(courseNode, pc, 1, 0)
      for (const e of edges) {
        const edge = flow.addEdge(pc, entryFor(e.slot, c), 1, e.cost)
        assignEdges.push({ edge, course: c, slot: e.slot, pinned: e.pinned, exception: e.exception })
      }
    }
  }
  flow.run(source, sink)

  const applied = new Map<Slot, AppliedCourse[]>()
  for (const a of assignEdges) {
    if (flow.flowOn(a.edge) <= 0) continue
    const p = members.find(m => m.data.code === a.slot.program)!
    const list = applied.get(a.slot) ?? []
    list.push({ courseId: a.course.course.id, units: unitsFor(a.course, p), pinned: a.pinned || undefined, exception: a.exception || undefined })
    applied.set(a.slot, list)
  }

  repairUnits(slotsBy, applied, ctx, members)
  repairFloors(members, choices, nodeSlots, slotsBy, applied, ctx)
  repairChains(members, choices, nodeSlots, slotsBy, applied, ctx)

  // Caps, then the repairs again (a cap can leave a rule short that an unused
  // course fills), then the caps again for whatever the repairs moved in.
  applyCaps(members, applied, ctx)
  repairUnits(slotsBy, applied, ctx, members)
  repairFloors(members, choices, nodeSlots, slotsBy, applied, ctx)
  repairChains(members, choices, nodeSlots, slotsBy, applied, ctx)
  applyCaps(members, applied, ctx)

  // After the repairs, which may move a course from one program to another.
  const usedIn = new Map<string, Set<string>>() // program -> course ids
  for (const [slot, list] of applied) {
    if (!usedIn.has(slot.program)) usedIn.set(slot.program, new Set())
    for (const a of list) usedIn.get(slot.program)!.add(a.courseId)
  }

  // Writing in the Major: a course already in the major, or any that is on the
  // list and not counted toward the student's other major or minor (a
  // designation shares inside its program, not across programs).
  const usedElsewhere = (courseId: string, code: string) =>
    members[0].group === 'ug' &&
    [...usedIn].some(([program, ids]) => program !== code && ids.has(courseId)) &&
    !isFoundational(ctx.courses.get(courseId)!)
  const trimmed = (c: AuditCourse, p: AuditProgram) => {
    const held = [...applied].filter(([s]) => s.program === p.data.code).flatMap(([, list]) => list).filter(a => a.courseId === c.course.id)
    return held.length > 0 && Math.max(...held.map(a => a.units)) < unitsFor(c, p)
  }
  // One enrollment fills one item: "PSYCH 196, three times" takes three.
  const pickedFor = new Map<string, Set<string>>()
  for (const [code, slots] of slotsBy) {
    const p = members.find(m => m.data.code === code)!
    for (const s of slots) {
      // The extra attempts under a floor are not part of a designation.
      if (!s.wim || s.key.endsWith('#extra')) continue
      const ruleKey = `${code}|${s.node.id}`
      if (!pickedFor.has(ruleKey)) pickedFor.set(ruleKey, new Set())
      const takenHere = pickedFor.get(ruleKey)!
      // A unit target ("one 5-unit WIM course, or 5 units of designated courses") takes courses until it is met.
      const want = s.unitNeed ? 0 : s.tiers[0]?.cap ?? 1
      const wantUnits = s.unitNeed?.units ?? s.node.units ?? 0
      const candidates = ctx.counting
        .filter(c => !ctx.excluded.has(`${c.course.id}|${code}`) && careerFits(c, p) && !usedElsewhere(c.course.id, code) && !takenHere.has(c.course.id))
        .map(c => {
          const pinned = ctx.pinsBy.get(`${c.course.id}|${code}`)?.has(s.node.id) ?? false
          return { c, pinned, ok: (pinned && gradeFits(s, c) && unitsFit(s, c)) || (!s.pinOnly && accepts(s, c)) }
        })
        .filter(x => x.ok)
        .sort((x, y) =>
          Number(y.pinned) - Number(x.pinned) ||
          Number(usedIn.get(code)?.has(y.c.course.id) ?? false) - Number(usedIn.get(code)?.has(x.c.course.id) ?? false) ||
          (BONUS_STATUS[y.c.status] ?? 0) - (BONUS_STATUS[x.c.status] ?? 0) ||
          // A course a cap trimmed elsewhere keeps its units here; then a fixed order.
          Number(trimmed(y.c, p)) - Number(trimmed(x.c, p)) ||
          x.c.course.code.localeCompare(y.c.course.code) || x.c.course.id.localeCompare(y.c.course.id))
      let picked: typeof candidates = []
      let pickedUnits = 0
      for (const x of candidates) {
        if (picked.length >= Math.max(1, want) && pickedUnits >= wantUnits) break
        // The rule's caps hold here too ("at most two courses below 100").
        if (s.node.limits?.some(l => l.max !== undefined && limitMatches(l, x.c) && picked.filter(y => limitMatches(l, y.c)).length >= l.max)) continue
        picked.push(x)
        pickedUnits += unitsFor(x.c, p)
      }
      // Short because the rest of the list counts toward the student's other
      // major or minor: take courses back while that program can refill its
      // rules with courses nobody uses.
      while (members[0].group === 'ug' && (picked.length < Math.max(1, want) || pickedUnits < wantUnits)) {
        const skip = new Set([...picked.map(x => x.c.course.id), ...takenHere])
        const freed = freeForDesignation(s, p, slotsBy, applied, usedIn, ctx, members, skip)
        if (!freed) break
        picked.push({ c: freed, pinned: false, ok: true })
        pickedUnits += unitsFor(freed, p)
      }
      applied.set(s, picked.map(x => ({
        courseId: x.c.course.id,
        units: unitsFor(x.c, p),
        pinned: x.pinned || undefined,
        exception: (x.pinned && !s.pinOnly && !accepts(s, x.c)) || undefined,
        shared: true,
      })))
      // A designation's course is this program's now: the next program's
      // designation cannot take it too.
      if (!usedIn.has(code)) usedIn.set(code, new Set())
      for (const x of picked) {
        usedIn.get(code)!.add(x.c.course.id)
        takenHere.add(x.c.course.id)
      }
    }
  }

  // The floors once more, now that designations hold their courses: a WIM or
  // capstone course counts toward the program's units, so a program that
  // looked short before may spare a cross-listed course another program needs.
  repairFloors(members, choices, nodeSlots, slotsBy, applied, ctx)
  repairChains(members, choices, nodeSlots, slotsBy, applied, ctx)
  applyCaps(members, applied, ctx)

  return members.map(p => evaluateProgram(p, ctx, choices, nodeSlots, applied))

  function nodeSlotsFor(p: AuditProgram, node: RuleNode, all: Map<string, Slot[]>): Slot[] {
    return (all.get(p.data.code) ?? []).filter(s => s.node === node)
  }
}

/**
 * The flow counts courses, not units, so two unit targets drawing on the same
 * courses ("35 units of English" and "25 units of English electives") can end
 * with one short while the other has units to spare. Move courses from a
 * target that stays met without them to one that is short, until nothing
 * moves. Moves never break a rule that was met, and pinned courses stay put.
 */
/**
 * Unit floors over several rules ("34 units at the 200 level", "a total of
 * 21 units from categories A, B and C", a block's 45 units) are invisible to
 * the flow, which can park a course that would count under the floor in a
 * rule outside it. For each floor that is short, move in courses from rules
 * outside it that stay met without them, then any eligible course the
 * program has not used, until it is met or nothing moves.
 */
interface Floor {
  need: number
  slots: Slot[]
  // The program's own minimum counts units after the program's caps, as its
  // check does: the Portuguese minor's 23 units take 12 of 14 language units.
  caps?: { program: AuditProgram; totals: { t: ProgramTotal; i: number }[] }
}

/**
 * Every unit floor over more than one course, per program: a group's or a
 * counted rule's `units`, a block's, and the program's own minimum (except a
 * graduate degree's, which counts every graduate course whether a rule holds
 * it or not). Innermost first: a block's total is easier once its parts are met.
 */
function programFloors(members: AuditProgram[], choices: Choices, nodeSlots: Map<string, Slot[]>): Map<string, Floor[]> {
  const floorsBy = new Map<string, Floor[]>()
  for (const p of members) {
    const code = p.data.code
    const floors: Floor[] = []
    const leafSlots = (n: RuleNode): Slot[] => {
      if (n.t === 'courses' || n.t === 'text') return nodeSlots.get(nodeKey(code, n.id)) ?? []
      const active = activeChildren(p, n, choices)
      return (n.children ?? []).filter(c => active.has(c.id)).flatMap(leafSlots)
    }
    const walk = (n: RuleNode) => {
      if (n.units && n.t !== 'courses' && n.t !== 'text') floors.push({ need: n.units, slots: leafSlots(n) })
      if (n.t === 'courses' && n.units && n.mode !== 'units' && !(n.mode === 'any' && !n.n)) floors.push({ need: n.units, slots: leafSlots(n) })
      const active = activeChildren(p, n, choices)
      for (const c of n.children ?? []) if (active.has(c.id)) walk(c)
    }
    for (const block of includedBlocks(p)) {
      block.rules.forEach(walk)
      if (block.units) floors.push({ need: block.units, slots: block.rules.flatMap(leafSlots) })
    }
    if (p.data.unitsMin && p.data.kind !== 'grad') {
      const included = new Set(includedBlocks(p).map(b => b.id))
      const totals = activeTotals(p.data, included).filter(({ t }) => isCap(t))
      floors.push({ need: p.data.unitsMin, slots: includedBlocks(p).flatMap(b => b.rules.flatMap(leafSlots)), caps: totals.length ? { program: p, totals } : undefined })
    }
    floors.sort((a, b) => a.slots.length - b.slots.length)
    floorsBy.set(code, floors)
  }
  return floorsBy
}

function floorUnits(floor: Floor, applied: Map<Slot, AppliedCourse[]>, ctx: Ctx): number {
  // A course in two rules under the floor counts once, with its most units.
  const best = new Map<string, number>()
  for (const s of floor.slots) for (const a of applied.get(s) ?? []) best.set(a.courseId, Math.max(best.get(a.courseId) ?? 0, a.units))
  if (floor.caps) {
    const { program, totals } = floor.caps
    const counted = [...best].flatMap(([id, units]) => {
      const c = ctx.courses.get(id)
      return c ? [{ c, units, full: unitsFor(c, program) }] : []
    })
    capCounted(totals, counted)
    return counted.reduce((sum, x) => sum + x.units, 0)
  }
  let sum = 0
  for (const units of best.values()) sum += units
  return sum
}

function repairFloors(
  members: AuditProgram[],
  choices: Choices,
  nodeSlots: Map<string, Slot[]>,
  slotsBy: Map<string, Slot[]>,
  applied: Map<Slot, AppliedCourse[]>,
  ctx: Ctx,
) {
  const floorsBy = programFloors(members, choices, nodeSlots)
  const unitsInside = (floor: Floor) => floorUnits(floor, applied, ctx)
  // Sets `changes` for the length of `check`, then puts the rules back.
  const trying = <T,>(changes: [Slot, AppliedCourse[]][], check: () => T): T => {
    const old = changes.map(([s]) => [s, applied.get(s)] as const)
    for (const [s, list] of changes) applied.set(s, list)
    try {
      return check()
    } finally {
      for (const [s, list] of old) list ? applied.set(s, list) : applied.delete(s)
    }
  }
  // A course leaves a rule only if every unit floor around that rule still
  // holds without it, or loses nothing: a floor around both rules keeps the
  // course either way, and a course past the program's cap counted for
  // nothing (CSRE's 28 units of ethnic studies courses count as 15).
  const keepsFloors = (giver: Slot, changes: [Slot, AppliedCourse[]][]) => {
    const floors = (floorsBy.get(giver.program) ?? []).filter(f => f.slots.includes(giver))
    const before = floors.map(unitsInside)
    return trying(changes, () => floors.every((f, i) => {
      const units = unitsInside(f)
      return units >= f.need || units >= before[i]
    }))
  }
  const free = (s: Slot) => !s.wim && !s.pinOnly

  for (const p of members) {
    const code = p.data.code
    const floors = floorsBy.get(code)!
    if (!floors.length) continue
    const programSlots = (slotsBy.get(code) ?? []).filter(free)
    // Inside the undergraduate group a course one program holds beyond what it
    // needs can move to another: the English major's extra CHILATST 12D fills
    // the Chicana/o-Latina/o Studies minor's 30 units.
    const otherSlots = members[0].group === 'ug' ? [...slotsBy].filter(([c]) => c !== code).flatMap(([, list]) => list.filter(free)) : []
    for (const floor of floors) {
      if (unitsInside(floor) >= floor.need) continue
      const inside = new Set(floor.slots)
      const takers = floor.slots.filter(free)
      const usedHere = () => new Set([...applied].filter(([s]) => s.program === code).flatMap(([, list]) => list.map(a => a.courseId)))
      const place = (c: AuditCourse) => takers.find(t => accepts(t, c) && fitsLimits(t, c, unitsFor(c, p), applied, ctx))
      // A move that adds nothing under the floor (a course past one of the
      // program's caps) is undone, so no rule gives up a course for nothing.
      const tryMove = (changes: [Slot, AppliedCourse[]][]) => {
        const before = unitsInside(floor)
        if (!trying(changes, () => unitsInside(floor) > before)) return false
        for (const [s, list] of changes) applied.set(s, list)
        return true
      }
      const moveFrom = (givers: Slot[], across: boolean) => {
        for (const giver of givers) {
          if (unitsInside(floor) >= floor.need) return
          if (inside.has(giver)) continue
          for (const a of [...(applied.get(giver) ?? [])]) {
            if (unitsInside(floor) >= floor.need) return
            const c = ctx.courses.get(a.courseId)
            if (!c || a.units <= 0 || !canGive(giver, a, applied)) continue
            if (across && (usedHere().has(c.course.id) || ctx.excluded.has(`${c.course.id}|${code}`) || !careerFits(c, p) || unitsFor(c, p) <= 0)) continue
            // A course the other program's WIM or capstone holds stays that program's.
            if (across && [...applied].some(([s, list]) => s.wim && s.program === giver.program && list.some(x => x.courseId === a.courseId))) continue
            const target = place(c)
            if (!target) continue
            const changes: [Slot, AppliedCourse[]][] = [
              [giver, (applied.get(giver) ?? []).filter(x => x !== a)],
              [target, [...(applied.get(target) ?? []), across ? { courseId: a.courseId, units: unitsFor(c, p) } : { ...a }]],
            ]
            if (keepsFloors(giver, changes)) tryMove(changes)
          }
        }
      }
      moveFrom(programSlots, false)
      if (unitsInside(floor) >= floor.need) continue
      // Trade a smaller course inside for a bigger one outside, when each
      // rule takes the other's course and both stay met: AFRICAAM 214 (5
      // units) into Americas-focused, AFRICAAM 212 (4) into Community Engaged
      // Learning, and Breadth reaches its 15.
      const unitsIn = (s: Slot) => (applied.get(s) ?? []).reduce((sum, a) => sum + a.units, 0)
      const swapped = (outside: Slot, b: AppliedCourse, t: Slot, a: AppliedCourse): [Slot, AppliedCourse[]][] => [
        [outside, [...(applied.get(outside) ?? []).filter(x => x !== b), { ...a }]],
        [t, [...(applied.get(t) ?? []).filter(x => x !== a), { ...b }]],
      ]
      // Across programs too: SOC 11SC back to Sociology, AFRICAAM 212 to Native American Studies.
      const heldBy = (program: string, id: string) => [...applied].some(([s, list]) => s.program === program && list.some(x => x.courseId === id))
      for (const outside of [...programSlots, ...otherSlots]) {
        if (unitsInside(floor) >= floor.need) break
        if (inside.has(outside)) continue
        const across = outside.program !== code
        for (const b of [...(applied.get(outside) ?? [])]) {
          if (unitsInside(floor) >= floor.need) break
          const big = ctx.courses.get(b.courseId)
          if (!big || b.pinned || floor.slots.some(s => (applied.get(s) ?? []).some(x => x.courseId === b.courseId))) continue
          if (across && (heldBy(code, b.courseId) || ctx.excluded.has(`${b.courseId}|${code}`) || !careerFits(big, p) ||
            [...applied].some(([s, list]) => s.wim && s.program === outside.program && list.some(x => x.courseId === b.courseId)))) continue
          const swap = takers.flatMap(t => (applied.get(t) ?? []).map(a => ({ t, a }))).find(({ t, a }) => {
            const small = ctx.courses.get(a.courseId)
            if (!small || a.pinned || a.units >= b.units) return false
            if (across) {
              const other = members.find(m => m.data.code === outside.program)!
              if (heldBy(outside.program, a.courseId) || ctx.excluded.has(`${a.courseId}|${outside.program}`) || !careerFits(small, other)) return false
              if ([...applied].some(([s, list]) => s.wim && s.program === code && list.some(x => x.courseId === a.courseId))) return false
            }
            if (!accepts(t, big) || !accepts(outside, small)) return false
            if (outside.unitNeed && unitsIn(outside) - b.units + a.units < outside.unitNeed.units) return false
            return keepsFloors(outside, swapped(outside, b, t, a))
          })
          if (!swap) continue
          tryMove(swapped(outside, b, swap.t, swap.a))
        }
      }
      if (unitsInside(floor) >= floor.need) continue
      // Courses the program has not used at all, and no other program holds.
      const used = usedHere()
      const heldElsewhere = new Set(members[0].group === 'ug'
        ? [...applied].filter(([s]) => s.program !== code).flatMap(([, list]) => list.map(a => a.courseId))
        : [])
      for (const c of ctx.counting) {
        if (unitsInside(floor) >= floor.need) break
        if (used.has(c.course.id) || ctx.excluded.has(`${c.course.id}|${code}`) || !careerFits(c, p)) continue
        if (heldElsewhere.has(c.course.id) && !isFoundational(c)) continue
        if (unitsFor(c, p) <= 0) continue
        const target = place(c)
        if (!target) continue
        if (tryMove([[target, [...(applied.get(target) ?? []), { courseId: c.course.id, units: unitsFor(c, p) }]]])) used.add(c.course.id)
      }
      if (unitsInside(floor) >= floor.need) continue
      moveFrom(otherSlots, true)
    }
  }
}

/**
 * A rule still short after the other repairs, which a chain of moves fixes:
 * the course it needs sits in a rule that can let it go only by taking a
 * replacement from a third, and so on (Political Science with a Communication
 * minor: COMM 135W back to the minor's Area I, so Justice and Law takes
 * POLISCI 114D from International Relations, which takes POLISCI 110C from
 * Additional Coursework). Searches a few moves deep inside one group, and keeps
 * a chain only if it leaves less unmet across the group, unit floors included.
 */
function repairChains(
  members: AuditProgram[],
  choices: Choices,
  nodeSlots: Map<string, Slot[]>,
  slotsBy: Map<string, Slot[]>,
  applied: Map<Slot, AppliedCourse[]>,
  ctx: Ctx,
) {
  const all = [...slotsBy.values()].flat().filter(s => !s.wim && !s.pinOnly)
  const program = (s: Slot) => members.find(m => m.data.code === s.program)!
  const floorsBy = programFloors(members, choices, nodeSlots)
  const unitsIn = (s: Slot) => (applied.get(s) ?? []).reduce((sum, a) => sum + a.units, 0)
  const countNeed = (s: Slot) => s.tiers.filter(t => t.reward >= REWARD_REQUIRED).reduce((sum, t) => sum + t.cap, 0)
  const shortBy = (s: Slot) => s.unitNeed
    ? Math.max(0, s.unitNeed.units - unitsIn(s))
    : Math.max(0, countNeed(s) - (applied.get(s)?.length ?? 0)) * 5
  // How much is unmet across the group: rules short of their count or units, and floors short of theirs.
  const deficit = () =>
    all.reduce((sum, s) => sum + shortBy(s), 0) +
    [...floorsBy.values()].flat().reduce((sum, f) => sum + Math.max(0, f.need - floorUnits(f, applied, ctx)), 0)
  const holders = (courseId: string) => all.filter(s => (applied.get(s) ?? []).some(a => a.courseId === courseId))
  const heldByMove = (courseId: string) => [...applied].some(([s, list]) => s.pinOnly && list.some(a => a.courseId === courseId))
  const heldByDesignation = (program: string, courseId: string) => [...applied].some(([s, list]) => s.wim && s.program === program && list.some(a => a.courseId === courseId))
  // Another program's WIM or capstone holds it: not free, unless it is foundational and may serve both.
  const heldByOtherDesignation = (program: string, c: AuditCourse) =>
    members[0].group === 'ug' && !isFoundational(c) &&
    [...applied].some(([s, list]) => s.wim && s.program !== program && list.some(a => a.courseId === c.course.id))
  // A list item holds one course; a count or unit rule takes extras when a floor sits above it.
  const hasRoom = (s: Slot, pending?: Map<Slot, { units: number; count: number }>) =>
    Boolean(s.unitNeed) || (applied.get(s)?.length ?? 0) + (pending?.get(s)?.count ?? 0) < s.tiers.reduce((sum, t) => sum + t.cap, 0)

  type Move = { courseId: string; from?: Slot; to: Slot }
  // What the moves already planned along a chain do to each rule, in units and
  // courses, so a rule a course is about to arrive in can give one away.
  type Pending = Map<Slot, { units: number; count: number }>
  const after = (pending: Pending, s: Slot) => pending.get(s) ?? { units: 0, count: 0 }
  const canGiveLater = (from: Slot, a: AppliedCourse, pending: Pending) => {
    if (a.pinned) return false
    const d = after(pending, from)
    if (from.unitNeed) return unitsIn(from) + d.units - a.units >= from.unitNeed.units
    const required = from.tiers.filter(t => t.reward >= REWARD_REQUIRED).reduce((sum, t) => sum + t.cap, 0)
    return (applied.get(from)?.length ?? 0) + d.count - 1 >= required
  }
  /**
   * Moves that put one more course into `target` while every rule they take
   * from stays met: a rule that cannot spare its course takes a replacement
   * the same way, up to `depth` rules along (POLISCI 31 to Additional
   * Coursework, 110D to International Relations, 114D to Justice and Law).
   */
  const search = (target: Slot, minUnits: number, banned: Set<string>, depth: number, pending: Pending): Move[] | null => {
    const p = program(target)
    const heldHere = new Set([...applied].filter(([s]) => s.program === target.program).flatMap(([, list]) => list.map(a => a.courseId)))
    // Room counts the course this rule is about to give up along the chain.
    if (!hasRoom(target, pending)) return null
    const options = ctx.counting.filter(c =>
      !banned.has(c.course.id) && !ctx.excluded.has(`${c.course.id}|${target.program}`) && careerFits(c, p) &&
      accepts(target, c) && unitsFor(c, p) >= minUnits && (!target.unitNeed || unitsFor(c, p) > 0) &&
      fitsLimits(target, c, unitsFor(c, p), applied, ctx))
    // A course nobody uses is the easy fix. One a student moved into a
    // free-text rule is held there, though no repair can see it move.
    for (const c of options) {
      if (holders(c.course.id).length === 0 && !heldByMove(c.course.id) && !heldByOtherDesignation(target.program, c)) return [{ courseId: c.course.id, to: target }]
    }
    for (const c of options) {
      for (const from of holders(c.course.id)) {
        if (from === target) continue
        // One program never counts a course twice; another program's course may move over.
        if (from.program !== target.program && heldHere.has(c.course.id)) continue
        if (from.program !== target.program && members[0].group !== 'ug') continue
        // A course the other program's WIM or capstone holds stays that program's.
        if (from.program !== target.program && heldByDesignation(from.program, c.course.id)) continue
        const a = (applied.get(from) ?? []).find(x => x.courseId === c.course.id)!
        if (a.pinned) continue
        if (canGiveLater(from, a, pending)) return [{ courseId: c.course.id, from, to: target }]
        if (depth <= 0) continue
        const next: Pending = new Map(pending)
        const units = unitsFor(c, program(target))
        next.set(from, { units: after(pending, from).units - a.units, count: after(pending, from).count - 1 })
        next.set(target, { units: after(pending, target).units + units, count: after(pending, target).count + 1 })
        const need = from.unitNeed ? from.unitNeed.units - (unitsIn(from) + after(next, from).units) : 0
        const rest = search(from, Math.max(0, need), new Set([...banned, c.course.id]), depth - 1, next)
        if (rest) return [...rest, { courseId: c.course.id, from, to: target }]
      }
    }
    return null
  }

  const apply = (moves: Move[]) => {
    for (const m of moves) {
      const c = ctx.courses.get(m.courseId)!
      const units = unitsFor(c, program(m.to))
      if (m.from) applied.set(m.from, (applied.get(m.from) ?? []).filter(x => x.courseId !== m.courseId))
      applied.set(m.to, [...(applied.get(m.to) ?? []), { courseId: m.courseId, units }])
    }
  }

  /** Try a chain into `target`; keep it only if less is unmet afterwards. */
  const attempt = (target: Slot, banned: Set<string>): boolean => {
    const before = deficit()
    const snapshot = new Map([...applied].map(([s, list]) => [s, [...list]]))
    const moves = search(target, 0, banned, 3, new Map())
    if (!moves) return false
    apply(moves)
    if (deficit() < before) return true
    applied.clear()
    for (const [s, list] of snapshot) applied.set(s, list)
    return false
  }

  for (let round = 0; round < 20; round++) {
    let improved = false
    for (const target of all) {
      if (shortBy(target) > 0 && attempt(target, new Set())) improved = true
    }
    // A floor short of its units takes a course from outside it into a rule beneath it.
    for (const floor of [...floorsBy.values()].flat()) {
      for (const taker of floor.slots.filter(s => !s.wim && !s.pinOnly)) {
        if (floorUnits(floor, applied, ctx) >= floor.need) break
        const inside = new Set(floor.slots.flatMap(s => (applied.get(s) ?? []).map(a => a.courseId)))
        if (attempt(taker, inside)) improved = true
      }
    }
    if (!improved) break
  }
}

/**
 * Unit caps, in a fixed order so the same record gives the same answer
 * whatever order it comes in (completed courses first, then the bigger ones,
 * then by code):
 * - a rule's own ("no more than 10 units of research"): past it, a course's
 *   units stop counting in that rule, across all of its slots;
 * - the program's, marked `inRules` ("no more than 5 units of directed
 *   reading may count toward the major"): past it, a course's units stop
 *   counting anywhere in the program. Other program caps only limit totals.
 */
function applyCaps(members: AuditProgram[], applied: Map<Slot, AppliedCourse[]>, ctx: Ctx) {
  const order: CourseStatus[] = ['completed', 'in-progress', 'planned']
  const rank = (id: string, units: number) => {
    const c = ctx.courses.get(id)
    return [c ? order.indexOf(c.status) : 9, -units, c?.course.code ?? '', id] as const
  }
  const compare = (x: readonly [number, number, string, string], y: readonly [number, number, string, string]) =>
    x[0] - y[0] || x[1] - y[1] || x[2].localeCompare(y[2]) || x[3].localeCompare(y[3])

  const byRule = new Map<string, { node: RuleNode; list: AppliedCourse[] }>()
  for (const [slot, list] of applied) {
    if (!slot.node.limits?.length) continue
    const key = `${slot.program}|${slot.node.id}`
    const entry = byRule.get(key) ?? { node: slot.node, list: [] }
    entry.list.push(...list)
    byRule.set(key, entry)
  }
  for (const { node, list } of byRule.values()) {
    list.sort((x, y) => compare(rank(x.courseId, x.units), rank(y.courseId, y.units)))
    // A course past a count cap ("only one creative writing workshop") leaves
    // the rule. The flow routes a course through one cap only, so one that
    // matches two can slip past the second.
    for (const limit of node.limits ?? []) {
      if (limit.max === undefined) continue
      const over = list.filter(a => { const c = ctx.courses.get(a.courseId); return c && limitMatches(limit, c) }).slice(limit.max)
      if (!over.length) continue
      for (const [slot, held] of applied) {
        if (slot.node === node) applied.set(slot, held.filter(a => !over.includes(a)))
      }
    }
    for (const limit of node.limits ?? []) {
      if (limit.maxUnits === undefined) continue
      let used = 0
      for (const a of list) {
        const c = ctx.courses.get(a.courseId)
        if (!c || !limitMatches(limit, c)) continue
        const counted = Math.min(a.units, Math.max(0, limit.maxUnits - used))
        used += a.units
        a.units = counted
      }
    }
  }

  const zeroed = new Set<AppliedCourse>()
  for (const p of members) {
    const included = new Set(includedBlocks(p).map(b => b.id))
    // A cap on CR/NC units binds the rules too: past it, the rest "must be taken for a letter grade".
    const caps = (p.data.totals ?? []).filter(t => isCap(t) && (t.inRules || t.grading === 'not-letter') && (!t.when || included.has(t.when)) && (!t.unless || !included.has(t.unless)))
    if (!caps.length) continue
    const entries = [...applied].filter(([s]) => s.program === p.data.code).flatMap(([, list]) => list)
    const full = new Map<string, number>()
    for (const a of entries) full.set(a.courseId, Math.max(full.get(a.courseId) ?? 0, a.units))
    // A course a rule needs keeps its units before one a rule only holds as
    // an extra (an optional pool, or past what the rule asks for): ANTHRO
    // 310G, required and offered only S/NC, over an elective taken S; a
    // Political Science methods course over the fifth extra ECON course.
    const required = new Set([...applied]
      .filter(([s]) => s.program === p.data.code && !s.node.optional)
      .flatMap(([s, list]) => list.filter(a => !canGive(s, a, applied)).map(a => a.courseId)))
    const ids = [...full.keys()].sort((x, y) => Number(required.has(y)) - Number(required.has(x)) || compare(rank(x, full.get(x)!), rank(y, full.get(y)!)))
    for (const t of caps) {
      let used = 0
      let count = 0
      // Under a CR/NC cap, a course offered only S/NC was no choice of the
      // student's: it keeps its units before one they elected to take S/NC.
      const order = t.grading === 'not-letter'
        ? [...ids].sort((x, y) => Number(ctx.courses.get(y)?.info?.grading === 'S') - Number(ctx.courses.get(x)?.info?.grading === 'S'))
        : ids
      for (const id of order) {
        const c = ctx.courses.get(id)
        if (!c || !inProgramTotal(t, c)) continue
        const units = full.get(id)!
        let counted = t.maxUnits !== undefined ? Math.min(units, Math.max(0, t.maxUnits - used)) : units
        // "Count 2 classes S/NC": past the count, a course counts for nothing.
        if (t.maxCourses !== undefined && count >= t.maxCourses) counted = 0
        used += units
        if (counted > 0) count++
        if (counted < units) for (const a of entries) if (a.courseId === id) {
          a.units = Math.min(a.units, counted)
          if (a.units === 0) zeroed.add(a)
        }
      }
    }
  }
  // A course a program cap that binds the rules cut to 0 units fills
  // nothing: not a unit total, and not a course count either (MUSIC 72A past
  // the cap is no non-Western course). A rule's own unit cap only limits that
  // rule's units ("one unit per workshop quarter"), so its courses stay.
  if (zeroed.size) for (const [slot, list] of applied) {
    const kept = list.filter(a => !zeroed.has(a))
    if (kept.length !== list.length) applied.set(slot, kept)
  }
}

/** A total that only caps ("at most 10 units CR/NC"), as opposed to a minimum or a range. */
function isCap(t: ProgramTotal): boolean {
  return (t.maxUnits !== undefined || t.maxCourses !== undefined) && t.minUnits === undefined && t.minCourses === undefined
}

/** Not graded yet counts as letter graded unless the course offers no letter option. */
function letterGraded(c: AuditCourse): boolean {
  return c.course.grade ? isLetterGrade(c.course.grade) : c.info?.grading !== 'S'
}

function inProgramTotal(t: ProgramTotal, c: AuditCourse): boolean {
  // A cap weighs the listing taken, as rule caps do; a minimum takes any listing.
  const codes = isCap(t) && t.pool ? capCodes(t.pool, c) : c.codes
  // A cap's named courses match the listing taken too: BMDS 217 is not CS 275 for "CS units pass/fail".
  const named = isCap(t) && c.info && c.codes.has(c.course.code) ? new Set([c.course.code]) : c.codes
  return (!t.pool || courseInPool(t.pool, codes, c.info, c.course.code)) &&
    (!t.codes || t.codes.some(x => named.has(x))) &&
    (!t.grading || (t.grading === 'letter') === letterGraded(c))
}

/** Whether a course can join a slot without going past one of the slot's caps. */
function fitsLimits(s: Slot, c: AuditCourse, units: number, applied: Map<Slot, AppliedCourse[]>, ctx: Ctx): boolean {
  for (const limit of s.node.limits ?? []) {
    if (!limitMatches(limit, c)) continue
    // A cap covers the whole rule, every listed item's slot.
    const held = [...applied].filter(([x]) => x.node === s.node && x.program === s.program).flatMap(([, list]) => list).filter(a => {
      const x = ctx.courses.get(a.courseId)
      return x && limitMatches(limit, x)
    })
    if (limit.max !== undefined && held.length + 1 > limit.max) return false
    if (limit.maxUnits !== undefined && held.reduce((sum, a) => sum + a.units, 0) + units > limit.maxUnits) return false
  }
  return true
}

/** Whether a slot stays met without one of its courses (it holds more than it needs). */
function canGive(s: Slot, a: AppliedCourse, applied: Map<Slot, AppliedCourse[]>): boolean {
  if (a.pinned) return false
  const list = applied.get(s) ?? []
  if (s.unitNeed) return list.reduce((sum, x) => sum + x.units, 0) - a.units >= s.unitNeed.units
  const required = s.tiers.filter(t => t.reward >= REWARD_REQUIRED).reduce((sum, t) => sum + t.cap, 0)
  return list.length - 1 >= required
}

function repairUnits(slotsBy: Map<string, Slot[]>, applied: Map<Slot, AppliedCourse[]>, ctx: Ctx, members: AuditProgram[]) {
  const all = [...slotsBy.values()].flat().filter(s => !s.wim && !s.pinOnly)
  const unitsIn = (s: Slot) => (applied.get(s) ?? []).reduce((sum, a) => sum + a.units, 0)
  const program = (s: Slot) => members.find(m => m.data.code === s.program)!
  for (let round = 0; round < 50; round++) {
    let moved = false
    for (const short of all) {
      if (!short.unitNeed || unitsIn(short) >= short.unitNeed.units) continue
      const p = program(short)
      for (const giver of all) {
        if (giver === short || unitsIn(short) >= short.unitNeed.units) continue
        // Only between rules of one program or of programs that already share
        // a course this way; a course never jumps into another program here.
        if (giver.program !== short.program) continue
        for (const a of [...(applied.get(giver) ?? [])]) {
          const c = ctx.courses.get(a.courseId)
          if (!c || !canGive(giver, a, applied) || !careerFits(c, p) || !accepts(short, c)) continue
          if (!fitsLimits(short, c, a.units, applied, ctx)) continue
          applied.set(giver, (applied.get(giver) ?? []).filter(x => x !== a))
          applied.set(short, [...(applied.get(short) ?? []), { ...a }])
          moved = true
          if (unitsIn(short) >= short.unitNeed.units) break
        }
      }
      if (unitsIn(short) >= short.unitNeed.units) continue
      // Two steps: the course the short rule needs is one its holder cannot
      // spare, but the holder can take a replacement from a third rule that
      // can (POLISCI 110C into International Relations, so POLISCI 114D is free
      // for Justice and Law).
      for (const giver of all) {
        if (giver === short || giver.program !== short.program || unitsIn(short) >= short.unitNeed.units) continue
        const need = giver.unitNeed?.units
        for (const a of [...(applied.get(giver) ?? [])]) {
          const c = ctx.courses.get(a.courseId)
          if (!c || a.pinned || canGive(giver, a, applied) || !careerFits(c, p) || !accepts(short, c)) continue
          if (!fitsLimits(short, c, a.units, applied, ctx)) continue
          const swap = all.flatMap(third => (third === giver || third === short || third.program !== short.program ? [] : (applied.get(third) ?? []).map(b => ({ third, b }))))
            .find(({ third, b }) => {
              const r = ctx.courses.get(b.courseId)
              if (!r || !canGive(third, b, applied) || !accepts(giver, r) || !fitsLimits(giver, r, b.units, applied, ctx)) return false
              // The holder stays met with the replacement in place of the course it gives.
              return need === undefined ? true : unitsIn(giver) - a.units + b.units >= need
            })
          if (!swap) continue
          applied.set(swap.third, (applied.get(swap.third) ?? []).filter(x => x !== swap.b))
          applied.set(giver, [...(applied.get(giver) ?? []).filter(x => x !== a), { ...swap.b }])
          applied.set(short, [...(applied.get(short) ?? []), { ...a }])
          moved = true
          if (unitsIn(short) >= short.unitNeed.units) break
        }
      }
    }
    if (!moved) break
  }
}

/**
 * For an empty designation (WIM, capstone) in a program whose eligible
 * courses all count toward another program: find a course the other program
 * can give up, because a course no program uses fills its rule instead, and
 * move it. Returns the freed course, or null.
 */
function freeForDesignation(
  wim: Slot,
  p: AuditProgram,
  slotsBy: Map<string, Slot[]>,
  applied: Map<Slot, AppliedCourse[]>,
  usedIn: Map<string, Set<string>>,
  ctx: Ctx,
  members: AuditProgram[],
  skip: Set<string> = new Set(),
): AuditCourse | null {
  const usedAnywhere = new Set([...usedIn.values()].flatMap(ids => [...ids]))
  for (const [otherCode, slots] of slotsBy) {
    if (otherCode === p.data.code) continue
    const other = members.find(m => m.data.code === otherCode)!
    for (const slot of slots) {
      if (slot.wim || slot.pinOnly) continue
      for (const a of applied.get(slot) ?? []) {
        if (a.pinned) continue
        const c = ctx.courses.get(a.courseId)
        if (!c || skip.has(c.course.id) || ctx.excluded.has(`${c.course.id}|${p.data.code}`) || !careerFits(c, p) || !accepts(wim, c)) continue
        // Only a course the other program holds in this one rule: one it also
        // counts for its own WIM or capstone stays with it.
        const alsoUsed = [...applied].some(([other, list]) => other !== slot && other.program === otherCode && list.some(x => x.courseId === c.course.id))
        if (alsoUsed) continue
        if (canGive(slot, a, applied)) {
          // The other program holds it as an extra: it simply lets go.
          applied.set(slot, (applied.get(slot) ?? []).filter(x => x !== a))
          usedIn.get(otherCode)?.delete(c.course.id)
          return c
        }
        // The replacement must not be a course this designation has just taken.
        // Nor one another of this program's designations holds (unless
        // foundational, which both programs may share).
        const fits = (d: AuditCourse) => d !== c && !skip.has(d.course.id) &&
          !(!isFoundational(d) && [...applied].some(([x, list]) => x.wim && x.program === p.data.code && list.some(y => y.courseId === d.course.id))) &&
          !ctx.excluded.has(`${d.course.id}|${otherCode}`) && careerFits(d, other) && accepts(slot, d)
        let replacement = ctx.counting.find(d => fits(d) && !usedAnywhere.has(d.course.id))
        if (!replacement) {
          // A course some rule holds as an extra, in either program: it moves
          // to the other program's rule, which frees this one.
          for (const holder of [...slotsBy.values()].flat()) {
            if (holder.wim || holder.pinOnly || holder === slot) continue
            const spare = (applied.get(holder) ?? []).find(x => {
              const d = ctx.courses.get(x.courseId)
              return d && fits(d) && canGive(holder, x, applied)
            })
            if (!spare) continue
            applied.set(holder, (applied.get(holder) ?? []).filter(x => x !== spare))
            usedIn.get(holder.program)?.delete(spare.courseId)
            replacement = ctx.courses.get(spare.courseId)
            break
          }
        }
        if (!replacement) continue
        const d = replacement
        applied.set(slot, (applied.get(slot) ?? []).map(x => (x === a ? { courseId: d.course.id, units: unitsFor(d, other) } : x)))
        usedIn.get(otherCode)?.delete(c.course.id)
        if (!usedIn.has(otherCode)) usedIn.set(otherCode, new Set())
        usedIn.get(otherCode)!.add(d.course.id)
        return c
      }
    }
  }
  return null
}

function nodeHasEligibleItem(slots: Slot[], c: AuditCourse): boolean {
  return slots.some(s => accepts(s, c))
}

function careerFits(c: AuditCourse, p: AuditProgram): boolean {
  // Graduate-career courses count toward the master's, not the bachelor's;
  // undergraduate courses may still satisfy master's requirements (at 0 units).
  if (p.isGrad) return true
  return c.career === 'UG'
}

function unitsFor(c: AuditCourse, p: AuditProgram): number {
  if (p.isGrad && c.career !== 'GR') return 0
  return c.units
}

function activeChildren(p: AuditProgram, n: RuleNode, choices: Choices): Set<string> {
  const ids = (n.children ?? []).map(c => c.id)
  if ((n.t === 'any' || n.t === 'some') && ids.length > 1) {
    const chosen = choices.get(nodeKey(p.data.code, n.id))
    if (chosen) return new Set(chosen)
  }
  return new Set(ids)
}

function makeSlots(p: AuditProgram, n: RuleNode, blockWim: boolean, floorAbove: boolean): Slot[] {
  const base = { program: p.data.code, prog: p.data, node: n, wim: blockWim || Boolean(n.shares) }
  const key = (suffix: string) => `${p.data.code}|${n.id}${suffix}`
  if (n.t === 'text') {
    if (n.info) return []
    return [{ ...base, key: key(''), pinOnly: true, tiers: [{ cap: n.n ?? (n.units ? 99 : 1), reward: REWARD_REQUIRED }, { cap: 99, reward: REWARD_SURPLUS }] }]
  }
  // General education takes what it asks for and no more: a third creative
  // writing workshop is not "more CE", and it stays free for other rules.
  const surplus = n.match ? { cap: 0, reward: 0 } : { cap: 99, reward: floorAbove || n.units ? REWARD_SURPLUS_FLOOR : REWARD_SURPLUS }
  if (n.optional) return [{ ...base, key: key(''), pinOnly: false, tiers: [{ cap: 99, reward: REWARD_SURPLUS }] }]
  const required = REWARD_REQUIRED + (n.pool ? 0 : specificity(n.items?.flat().length ?? 0))
  switch (n.mode) {
    case 'all': {
      const slots: Slot[] = (n.items ?? []).map((item, i) => ({
        ...base, key: key(`#${i}`), item: i, pinOnly: false,
        tiers: [{ cap: 1, reward: REWARD_REQUIRED + specificity(item.length) }],
      }))
      // Under a unit floor, more attempts at the listed courses count toward
      // it: a repeatable thesis course taken three quarters running.
      if (n.units || floorAbove) slots.push({ ...base, key: key('#extra'), pinOnly: false, tiers: [surplus] })
      return slots
    }
    case 'atLeast':
      return [{ ...base, key: key(''), pinOnly: false, tiers: [{ cap: n.n ?? 1, reward: required }, ...(floorAbove || n.units ? [surplus] : [])] }]
    case 'units':
      return [{ ...base, key: key(''), pinOnly: false, tiers: [], unitNeed: { units: n.units ?? 1, reward: required, surplus } }]
    case 'any':
    default: {
      if (n.n) return [{ ...base, key: key(''), pinOnly: false, tiers: [{ cap: n.n, reward: required }, surplus] }]
      if (n.units) return [{ ...base, key: key(''), pinOnly: false, tiers: [], unitNeed: { units: n.units, reward: required, surplus } }]
      return [{ ...base, key: key(''), pinOnly: false, tiers: [{ cap: 1, reward: required }, surplus] }]
    }
  }
}

/**
 * Tie-break between two requirements a course fills equally well: the one
 * with the shorter list wins, since fewer other courses could fill it. CS 221
 * goes to "Probability" (6 options) before "Breadth Area B" (52). Small next
 * to REWARD_REQUIRED, so it never trades a requirement for a preference.
 */
function specificity(listSize: number): number {
  if (listSize <= 0) return 0
  return Math.round(20 / (1 + Math.log2(1 + listSize)))
}

/**
 * A unit target: the fewest of the eligible courses that could reach it (the
 * largest first) at full reward, enough of the smallest to reach it at a
 * lower one, then surplus. Sized from the courses the student actually has,
 * so six units of 1-unit ensembles get six slots, not two.
 */
function unitTiers(units: number, reward: number, surplus: { cap: number; reward: number }, smallest = 3, largest = 5) {
  const fewest = Math.max(1, Math.ceil(units / Math.max(1, largest)))
  const most = Math.max(fewest, Math.ceil(units / Math.max(1, smallest)))
  const tiers = [{ cap: fewest, reward }]
  if (most > fewest) tiers.push({ cap: most - fewest, reward: REWARD_UNITS_MORE })
  tiers.push(surplus)
  return tiers
}

function accepts(s: Slot, c: AuditCourse): boolean {
  const n = s.node
  if (n.match) return matches(n.match, c)
  if (!listed(n, s.item, c)) return false
  if (n.minUnitsEach && c.units < n.minUnitsEach && !isCreditTerm(c.course.term)) return false
  return gradeOk(c, Boolean(n.letter || s.prog.letterGrade), higherGrade(n.minGrade, s.prog.minGrade))
}

/** "Courses must be taken for at least three units." */
function unitsFit(s: Slot, c: AuditCourse): boolean {
  return !s.node.minUnitsEach || c.units >= s.node.minUnitsEach || isCreditTerm(c.course.term)
}

/** The rule's and the program's grading: letter grade, grade floor. */
function gradeFits(s: Slot, c: AuditCourse): boolean {
  return gradeOk(c, Boolean(s.node.letter || s.prog.letterGrade), higherGrade(s.node.minGrade, s.prog.minGrade))
}

function higherGrade(a?: string, b?: string): string | undefined {
  if (!a) return b
  if (!b) return a
  return GRADE_RANK.indexOf(a) >= GRADE_RANK.indexOf(b) ? a : b
}

function listed(n: RuleNode, item: number | undefined, c: AuditCourse): boolean {
  const items = n.items ?? []
  const list = item !== undefined ? [items[item] ?? []] : items
  for (const it of list) for (const code of it) if (isListing(code, c)) return true
  return item === undefined && Boolean(n.pool) && courseInPool(n.pool!, c.codes, c.info, c.course.code)
}

/**
 * Whether a course is the one a code names: that listing, or a cross-listing
 * in another subject (STATS 229 for CS 229). In the student's own subject the
 * number decides: COMM 106 is not COMM 206, though Coursedog groups the
 * undergraduate and graduate versions as one course.
 */
function isListing(code: string, c: AuditCourse): boolean {
  if (!c.codes.has(code)) return false
  if (code === c.course.code || !c.codes.has(c.course.code)) return true
  return code.split(' ')[0] !== c.course.code.split(' ')[0]
}

/**
 * Whether a course is in a pool: one of its listings is in a pool subject,
 * within the number range. A cross-listing counts, the way it does for a
 * listed course.
 */
export function courseInPool(pool: CoursePool, codes: Iterable<string>, info?: CourseInfo, own?: string): boolean {
  if (pool.excludeGraduate && info?.tags.includes('GR')) return false
  if (pool.onlyGraduate && !info?.tags.includes('GR')) return false
  for (const code of codes) {
    if (pool.exclude?.includes(code)) return false
    // "Outside the department": a course cross-listed in the department is the department's.
    if (pool.anySubject && pool.excludeSubjects?.includes(code.split(' ')[0])) return false
  }
  // The listing the student took decides the number: FRENCH 121 is not "140
  // or higher" because its graduate twin is FRENCH 221A, and EDUC 147 is not
  // "below 100" because it is also listed as PSYCH 47. Another listing can
  // still bring the course into the pool's subject.
  // "Must have the HISTORY subject code": only the listing taken counts.
  const all = pool.takenListing && own && [...codes].includes(own) ? [own] : [...codes]
  const ownNumber = own && all.includes(own) ? own.split(' ')[1] ?? '' : undefined
  for (const code of all) {
    const [subject, listed = ''] = code.split(' ')
    if (pool.anySubject ? pool.excludeSubjects?.includes(subject) : !pool.subjects.includes(subject)) continue
    const number = ownNumber ?? listed
    const n = parseInt(number, 10)
    if (pool.minNumber !== undefined && !(n >= pool.minNumber)) continue
    if (pool.maxNumber !== undefined && !(n <= pool.maxNumber)) continue
    return true
  }
  return false
}

function limitMatches(limit: RuleLimit, c: AuditCourse): boolean {
  if (limit.codes?.some(code => isListing(code, c))) return true
  return Boolean(limit.pool && courseInPool(limit.pool, capCodes(limit.pool, c), c.info, c.course.code))
}

/**
 * The listings a cap's pool weighs: the one the student took, when it is in
 * the catalog. CSRE 145 is a CSRE course for "up to 15 units of DAAAS
 * courses", though it is also AFRICAAM 145. "Outside the department" still
 * sees every listing, so a cross-listed department course is never outside.
 */
function capCodes(pool: CoursePool, c: AuditCourse): Iterable<string> {
  if (pool.anySubject || !c.info || !c.codes.has(c.course.code)) return c.codes
  return [c.course.code]
}

const GRADE_RANK = ['D-', 'D', 'D+', 'C-', 'C', 'C+', 'B-', 'B', 'B+', 'A-', 'A', 'A+']

/**
 * Stanford let CR and S count as letter grades for courses taken from Spring
 * 2020 through Summer 2021; departments' rules say so ("courses taken for a
 * CR or S grade from spring 2019-20 through summer 2020-21 satisfy ... as if
 * taken for a letter grade").
 */
function covidTerm(term: string): boolean {
  const m = /^(Winter|Spring|Summer|Autumn) (\d{4})$/.exec(term)
  if (!m) return false
  const key = Number(m[2]) * 10 + ['Winter', 'Spring', 'Summer', 'Autumn'].indexOf(m[1])
  return key >= 2020 * 10 + 1 && key <= 2021 * 10 + 2
}

/** A recorded grade meets a letter-grade rule and a grade floor. No grade yet is taken on trust. */
function gradeOk(c: AuditCourse, letter: boolean, minGrade?: string): boolean {
  const grade = normalizeGrade(c.course.grade)
  if (!grade || isCreditTerm(c.course.term)) return true
  if (letter && !isLetterGrade(grade)) {
    const allowed = isPassNoLetter(grade) && (c.info?.grading === 'S' || covidTerm(c.course.term))
    if (!allowed) return false
  }
  if (minGrade && isLetterGrade(grade) && GRADE_RANK.indexOf(grade) < GRADE_RANK.indexOf(minGrade)) return false
  return true
}

function matches(m: NonNullable<RuleNode['match']>, c: AuditCourse): boolean {
  const info = c.info
  if (!info) return false
  if (m.way && !info.ways.includes(m.way)) return false
  if (m.tag && !info.tags.includes(m.tag)) return false
  if (m.undergradOnly && info.tags.includes('GR')) return false
  if (m.noTestCredit && c.course.term === TEST_CREDIT) return false
  if (m.minUnits && c.units < m.minUnits) return false
  if (m.letter) {
    const grade = normalizeGrade(c.course.grade)
    // Not graded yet: assume the letter option the requirement asks for,
    // unless the course offers none.
    if (!grade) return info.grading !== 'S' || m.way !== undefined
    if (!isLetterGrade(grade) && !(isPassNoLetter(grade) && info.grading === 'S')) return false
  }
  return true
}

// ── Statuses ──

function evaluateProgram(
  p: AuditProgram,
  ctx: Ctx,
  choices: Choices,
  nodeSlots: Map<string, Slot[]>,
  applied: Map<Slot, AppliedCourse[]>,
): ProgramResult {
  const code = p.data.code
  const statusOf = (id: string) => ctx.courses.get(id)?.status

  const evalNode = (n: RuleNode, active: boolean): NodeResult => {
    if (!active) {
      return { node: n, status: 'inactive', have: { courses: 0, units: 0 }, applied: [], children: n.children?.map(c => evalNode(c, false)) }
    }
    const studentDone = ctx.done.has(nodeKey(code, n.id))
    if (n.t === 'courses' || n.t === 'text') {
      const slots = nodeSlots.get(nodeKey(code, n.id)) ?? []
      const list = slots.flatMap(s => applied.get(s) ?? [])
      const need = needOf(n)
      const result: NodeResult = { node: n, status: 'incomplete', need, have: tally(list, () => true, ctx), applied: list }
      const kept = [...ctx.pinsBy].filter(([key, nodes]) => key.endsWith(`|${code}`) && nodes.has(n.id)).map(([key]) => key.slice(0, -code.length - 1))
        .filter(id => !list.some(a => a.courseId === id) && slots[0] && ctx.courses.get(id) && (!gradeFits(slots[0], ctx.courses.get(id)!) || !unitsFit(slots[0], ctx.courses.get(id)!)))
      if (kept.length) result.belowGrade = kept
      if (n.t === 'text' && n.info) result.status = 'info'
      else if (n.optional) result.status = 'optional'
      else if (studentDone) { result.status = 'complete'; result.doneByStudent = true }
      else if (n.t === 'text' && list.length === 0) result.status = 'manual'
      else if (n.t === 'courses' && n.mode === 'all') {
        // Each item on its own: the worst item decides.
        let worst = 4
        // The extra slot (more attempts under a unit floor) is not an item.
        for (const s of slots) if (s.item !== undefined) worst = Math.min(worst, statusRank(applied.get(s) ?? [], { courses: 1 }, statusOf))
        result.status = rankStatus(worst)
        // Progress counts the items filled, not every attempt: a third EPI
        // 246 is no EPI 236.
        result.have = { ...result.have, courses: slots.filter(s => s.item !== undefined && (applied.get(s)?.length ?? 0) > 0).length }
        if (n.units) result.status = withFloor(result, n.units, list, ctx)
      } else {
        result.status = rankStatus(statusRank(list, need ?? { courses: 1 }, statusOf))
        if (n.units && n.mode !== 'units' && !(n.mode === 'any' && !n.n)) result.status = withFloor(result, n.units, list, ctx)
      }
      return result
    }

    const activeKids = activeChildren(p, n, choices)
    const children = (n.children ?? []).map(c => evalNode(c, activeKids.has(c.id)))
    const used = children.filter(c => c.status !== 'inactive')
    const appliedBelow = collectApplied(used)
    const result: NodeResult = {
      node: n,
      status: 'complete',
      have: tally(appliedBelow, () => true, ctx),
      applied: [],
      children,
    }
    if ((n.t === 'any' || n.t === 'some') && (n.children?.length ?? 0) > 1) result.chosen = [...activeKids]
    const ranks = used.filter(c => !NEUTRAL.has(c.status)).map(c => RANK[c.status])
    if (studentDone) {
      result.status = 'complete'
      result.doneByStudent = true
    } else if (n.info) {
      result.status = 'info'
    } else if (n.optional) {
      // An optional group ("pre-approved non-law courses") asks nothing of a student who skips it.
      result.status = 'optional'
    } else if (n.t === 'some') {
      const want = Math.min(n.n ?? 1, ranks.length)
      const sorted = [...ranks].sort((a, b) => b - a)
      result.status = sorted.length ? rankStatus(sorted[want - 1] ?? 0) : 'info'
    } else {
      result.status = ranks.length ? rankStatus(Math.min(...ranks)) : used.some(c => c.status === 'optional') ? 'optional' : 'info'
    }
    if (n.units && !studentDone && !n.optional && !n.info) result.status = withFloor(result, n.units, appliedBelow, ctx)
    return result
  }

  const blocks: BlockResult[] = p.data.blocks.map(block => {
    const included = blockIncluded(p, block)
    const rules = block.rules.map(r => evalNode(r, included))
    const ranks = rules.filter(r => !NEUTRAL.has(r.status)).map(r => RANK[r.status])
    let status: NodeStatus = !included ? 'inactive' : ranks.length ? rankStatus(Math.min(...ranks)) : 'info'
    let floor: BlockResult['floor']
    if (included && block.units) {
      const list = collectApplied(rules)
      floor = { need: block.units, have: tally(list, () => true, ctx).units }
      const probe: NodeResult = { node: { id: block.id, t: 'all' }, status, have: { courses: 0, units: 0 }, applied: [] }
      status = withFloor(probe, block.units, list, ctx)
    }
    return { block, included, status, rules, floor }
  })

  // Requirements for the progress bar: every active leaf that asks for something.
  let total = 0
  let met = 0
  let metWithPlan = 0
  const countLeaves = (n: NodeResult) => {
    if (n.status === 'inactive') return
    if (n.doneByStudent && n.children) { total++; met++; metWithPlan++; return }
    // A floor over optional pools is one requirement of its own.
    if (n.children && n.floor && !NEUTRAL.has(n.status) && n.children.every(c => NEUTRAL.has(c.status))) {
      total++
      if (n.status === 'complete' || n.status === 'in-progress') met++
      if (n.status !== 'incomplete' && n.status !== 'manual') metWithPlan++
      return
    }
    if (n.children && n.children.length) {
      if (n.node.optional || n.node.info) return
      n.children.forEach(countLeaves)
      return
    }
    if (NEUTRAL.has(n.status)) return
    total++
    if (n.status === 'complete' || n.status === 'in-progress') met++
    if (n.status !== 'incomplete' && n.status !== 'manual') metWithPlan++
  }
  for (const b of blocks) if (b.included) b.rules.forEach(countLeaves)

  const subplans = p.data.blocks.filter(b => b.kind === 'subplan')
  // The Bulletin says whether a subplan is required; unset reads as required.
  const needsSubplan = subplans.length > 0 && p.data.subplanRequired !== false && !subplans.some(b => b.id === p.choice.subplan)
  const blockRanks = blocks.filter(b => b.included && !NEUTRAL.has(b.status)).map(b => RANK[b.status])
  let status: NodeStatus = blockRanks.length ? rankStatus(Math.min(...blockRanks)) : 'info'
  if (needsSubplan) status = 'incomplete'

  const best = new Map<string, number>()
  for (const b of blocks) {
    if (!b.included) continue
    for (const a of collectApplied(b.rules)) best.set(a.courseId, Math.max(best.get(a.courseId) ?? 0, a.units))
  }
  let units = 0
  for (const u of best.values()) units += u

  const checks = programChecks(p, blocks, ctx)
  for (const c of checks) {
    if (c.cap && c.status !== 'incomplete') continue
    total++
    if (c.status === 'complete' || c.status === 'in-progress') met++
    if (c.status !== 'incomplete') metWithPlan++
    status = rankStatus(Math.min(RANK[status] ?? 4, RANK[c.status]))
  }

  return { code, data: p.data, choice: p.choice, blocks, status, total, met, metWithPlan, units, needsSubplan, isGeneralEducation: p.isGE, checks }
}

/** The program's totals that apply with these blocks: "when" one is included, "unless" one is. */
function activeTotals(data: ProgramData, included: Set<string>): { t: ProgramTotal; i: number }[] {
  return (data.totals ?? []).map((t, i) => ({ t, i })).filter(({ t }) => (!t.when || included.has(t.when)) && (!t.unless || !included.has(t.unless)))
}

/** A course counted toward the program: `units` is what counts after the caps, `full` what it carries. */
interface Counted { c: AuditCourse; units: number; full: number }

/**
 * A cap ("no more than 30 units of language courses may be counted toward
 * the major") stops units from counting past it; taking more is no failure.
 * The same fixed order as applyCaps, which already trimmed the courses rules
 * hold; this trims the rest. Returns what each cap saw, by the total's index.
 */
function capCounted(totals: { t: ProgramTotal; i: number }[], counted: Counted[]) {
  const order: CourseStatus[] = ['completed', 'in-progress', 'planned']
  counted.sort((a, b) => order.indexOf(a.c.status) - order.indexOf(b.c.status) || b.full - a.full || a.c.course.code.localeCompare(b.c.course.code) || a.c.course.id.localeCompare(b.c.course.id))
  const capped = new Map<number, { units: number; dropped: number; courses: number; overCourses: boolean }>()
  for (const { t, i } of totals) {
    if (!isCap(t)) continue
    let used = 0
    let count = 0
    let courses = 0
    const inOrder = t.grading === 'not-letter' ? [...counted].sort((a, b) => Number(b.c.info?.grading === 'S') - Number(a.c.info?.grading === 'S')) : counted
    for (const x of inOrder) {
      if (!inProgramTotal(t, x.c)) continue
      let counts = t.maxUnits !== undefined ? Math.min(x.full, Math.max(0, t.maxUnits - used)) : x.full
      if (t.maxCourses !== undefined && count >= t.maxCourses) counts = 0
      used += x.full
      courses++
      if (counts > 0) count++
      x.units = Math.min(x.units, counts)
    }
    const dropped = t.maxUnits !== undefined ? Math.max(0, used - t.maxUnits) : 0
    capped.set(i, { units: used, dropped, courses, overCourses: t.maxCourses !== undefined && courses > t.maxCourses })
  }
  return capped
}

/**
 * Master's programs' rules over all their units: "at least 36 units ... for
 * a letter grade", "50% of units in courses designated for graduate
 * students". Counted over the courses applied to the program, by status.
 */
function programChecks(p: AuditProgram, blocks: BlockResult[], ctx: Ctx): ProgramCheck[] {
  const data = p.data
  const included = new Set(blocks.filter(b => b.included).map(b => b.block.id))
  const totals = activeTotals(data, included)
  if (!data.unitsMin && !data.unitsUniversityMin && !data.letterUnitsMin && !data.gradUnitsShare && !totals.length) return []
  // A graduate degree counts every course in the graduate career (research
  // units no rule lists among them); anything else counts what its rules hold.
  const graduateCareer = data.kind === 'grad'
  // `units` is what counts after the caps; `full` is what the course carries.
  const counted: Counted[] = []
  if (graduateCareer) {
    for (const c of ctx.counting) {
      if (c.career !== 'GR' || ctx.excluded.has(`${c.course.id}|${data.code}`)) continue
      // "All courses must be taken for a letter grade": a CR course is not one of the degree's units.
      if (!gradeOk(c, Boolean(data.letterGrade), data.minGrade)) continue
      counted.push({ c, units: c.units, full: c.units })
    }
  } else {
    // A course in two rules (a designation, or a cap that trims it in one)
    // counts once, with the most units any rule gives it. The program's caps
    // have trimmed these already (applyCaps).
    for (const a of collectApplied(blocks.filter(b => b.included).flatMap(b => b.rules))) {
      const c = ctx.courses.get(a.courseId)
      if (c) counted.push({ c, units: a.units, full: unitsFor(c, p) })
    }
  }
  const capped = capCounted(totals, counted)
  const letter = letterGraded
  const inTotal = (t: ProgramTotal) => (c: AuditCourse) => inProgramTotal(t, c)
  const sum = (keep: (c: AuditCourse) => boolean, allowed: Set<CourseStatus>, count = false) =>
    counted.reduce((n, x) => (allowed.has(x.c.status) && keep(x.c) && (!count || x.units > 0) ? n + (count ? 1 : x.units) : n), 0)
  const done = new Set<CourseStatus>(['completed'])
  const now = new Set<CourseStatus>(['completed', 'in-progress'])
  const all = new Set<CourseStatus>(['completed', 'in-progress', 'planned'])
  const statusFor = (met: (s: Set<CourseStatus>) => boolean): NodeStatus =>
    met(done) ? 'complete' : met(now) ? 'in-progress' : met(all) ? 'planned' : 'incomplete'
  const checks: ProgramCheck[] = []
  // A graduate degree needs the larger of the program's and the university's units (135 for a PhD).
  const unitsNeed = graduateCareer ? Math.max(data.unitsMin ?? 0, data.unitsUniversityMin ?? 0) : data.unitsMin ?? 0
  if (unitsNeed) {
    const need = unitsNeed
    checks.push({
      key: 'units',
      label: graduateCareer ? `${need} graduate units` : `${need} units in the program`,
      status: statusFor(s => sum(() => true, s) >= need),
      detail: `${sum(() => true, all)} of ${need} units${graduateCareer ? ' in the graduate career' : ''}`,
      have: sum(() => true, all),
      need,
    })
  }
  for (const { t, i } of totals) {
    const cap = capped.get(i)
    if (cap) {
      const over = cap.dropped > 0 || cap.overCourses
      const detail = t.maxCourses !== undefined
        ? cap.overCourses ? `${cap.courses} courses; ${t.maxCourses} count toward the program` : `${cap.courses} of at most ${t.maxCourses} courses`
        : cap.dropped ? `${cap.units} units; ${t.maxUnits} count toward the program` : `${cap.units} of at most ${t.maxUnits} units`
      checks.push({ key: `total:${i}`, label: t.label, cap: true, status: over ? 'info' : 'complete', detail })
      continue
    }
    const keep = inTotal(t)
    const parts: string[] = []
    const met = (s: Set<CourseStatus>) =>
      (t.minUnits === undefined || sum(keep, s) >= t.minUnits) &&
      (t.minCourses === undefined || sum(keep, s, true) >= t.minCourses)
    if (t.minUnits !== undefined || t.maxUnits !== undefined) parts.push(`${sum(keep, all)} units${t.minUnits !== undefined ? ` of ${t.minUnits}` : ''}${t.maxUnits !== undefined ? `, at most ${t.maxUnits}` : ''}`)
    if (t.minCourses !== undefined) parts.push(`${sum(keep, all, true)} of ${t.minCourses} courses`)
    // A range ("21-35 units") is broken by what is on the record, planned courses included.
    const over = t.maxUnits !== undefined && sum(keep, all) > t.maxUnits
    const progress = t.minUnits !== undefined
      ? { have: sum(keep, all), need: t.minUnits }
      : { have: sum(keep, all, true), need: t.minCourses }
    checks.push({ key: `total:${i}`, label: t.label, status: over ? 'incomplete' : statusFor(met), detail: parts.join(', '), ...progress })
  }
  if (data.letterUnitsMin) {
    const need = data.letterUnitsMin
    checks.push({
      key: 'letter',
      label: `${need} letter-graded units`,
      status: statusFor(s => sum(letter, s) >= need),
      detail: `${sum(letter, all)} of ${need} units letter graded`,
    })
  }
  if (data.gradUnitsShare) {
    const graduate = (c: AuditCourse) => c.info?.tags.includes('GR') || parseInt(c.course.code.split(' ')[1] ?? '', 10) >= 200
    const share = data.gradUnitsShare
    checks.push({
      key: 'graduate',
      label: `${Math.round(share * 100)}% of units at the graduate level`,
      status: statusFor(s => sum(() => true, s) > 0 && sum(graduate, s) >= share * sum(() => true, s)),
      detail: `${sum(graduate, all)} of ${sum(() => true, all)} units in courses numbered 200 and up`,
    })
  }
  return checks
}

function needOf(n: RuleNode): Amount | undefined {
  if (n.t === 'text') {
    if (n.n) return { courses: n.n }
    if (n.units) return { units: n.units }
    return undefined
  }
  switch (n.mode) {
    case 'all': return { courses: n.items?.length ?? 0, ...(n.units ? { units: n.units } : {}) }
    case 'atLeast': return { courses: n.n ?? 1, ...(n.units ? { units: n.units } : {}) }
    case 'units': return { units: n.units ?? 1 }
    default:
      if (n.optional) return undefined
      if (n.n) return { courses: n.n }
      if (n.units) return { units: n.units }
      return { courses: 1 }
  }
}

/** Each course once, as the rule that counts the most of its units has it (a cap may trim it to 0 in another). */
function collectApplied(nodes: NodeResult[]): AppliedCourse[] {
  const best = new Map<string, AppliedCourse>()
  const walk = (n: NodeResult) => {
    if (n.status === 'inactive') return
    for (const a of n.applied) {
      const had = best.get(a.courseId)
      if (!had || a.units > had.units) best.set(a.courseId, a)
    }
    n.children?.forEach(walk)
  }
  nodes.forEach(walk)
  return [...best.values()]
}

function tally(list: AppliedCourse[], keep: (s: CourseStatus | undefined) => boolean, ctx: Ctx) {
  let courses = 0
  let units = 0
  for (const a of list) {
    const s = ctx.courses.get(a.courseId)?.status
    if (!keep(s)) continue
    courses++
    units += a.units
  }
  return { courses, units }
}

/** Highest status the applied courses reach for a need: 4 complete ... 0 incomplete. */
function statusRank(list: AppliedCourse[], need: Amount, statusOf: (id: string) => CourseStatus | undefined): number {
  const reaches = (allowed: Set<CourseStatus>) => {
    let courses = 0
    let units = 0
    for (const a of list) {
      const s = statusOf(a.courseId)
      if (!s || !allowed.has(s)) continue
      courses++
      units += a.units
    }
    return (!need.courses || courses >= need.courses) && (!need.units || units >= need.units)
  }
  if (reaches(new Set(['completed']))) return 4
  if (reaches(new Set(['completed', 'in-progress']))) return 3
  if (reaches(new Set(['completed', 'in-progress', 'planned']))) return 2
  return 0
}

function rankStatus(rank: number): NodeStatus {
  return (['incomplete', 'manual', 'planned', 'in-progress', 'complete'] as NodeStatus[])[rank] ?? 'incomplete'
}

/** Lower a status to what a unit floor over the applied courses allows. */
function withFloor(result: NodeResult, floor: number, list: AppliedCourse[], ctx: Ctx): NodeStatus {
  const statusOf = (id: string) => ctx.courses.get(id)?.status
  result.floor = { need: floor, have: tally(list, () => true, ctx).units }
  const floorRank = statusRank(list, { units: floor }, statusOf)
  // A group of optional pools ("remaining units, from any of these") is the
  // floor itself; only an optional group is left to the student.
  if (NEUTRAL.has(result.status)) return result.node.optional || result.status === 'inactive' ? result.status : rankStatus(floorRank)
  return rankStatus(Math.min(RANK[result.status], floorRank))
}
