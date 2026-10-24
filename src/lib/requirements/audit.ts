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
  CourseStatus,
  ProgramBlock,
  ProgramChoice,
  ProgramData,
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
}

export interface UnitSummary {
  need: number
  completed: number
  inProgress: number
  planned: number
  /** Pass/fail units beyond the 36-unit cap, which do not count. */
  overCap: number
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
  node: RuleNode
  /** Index into node.items for "complete all of" rules, one slot per item. */
  item?: number
  wim: boolean
  /** Free-text rule: only courses the student moves here. */
  pinOnly: boolean
  tiers: { cap: number; reward: number }[]
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
    undergradUnits = sumUnits(counting.filter(c => c.career === 'UG'), need, UNDERGRAD_UNITS.passFailCap)
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

function sumUnits(list: AuditCourse[], need: number, passFailCap?: number): UnitSummary {
  const summary: UnitSummary = { need, completed: 0, inProgress: 0, planned: 0, overCap: 0 }
  let passFail = 0
  for (const c of list) {
    let units = c.units
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
  if (choiceNodes.length) {
    choices = new Map(fixed)
    for (const { program, node } of choiceNodes) {
      const key = nodeKey(program.data.code, node.id)
      const r = findNode(results, program.data.code, node.id)
      const kids = node.children!
      const want = node.t === 'any' ? 1 : Math.min(node.n ?? 1, kids.length)
      const scored = kids.map((k, i) => ({ id: k.id, i, score: r?.children?.[i] ? -remaining(r.children[i]) : -Infinity }))
      scored.sort((a, b) => b.score - a.score || a.i - b.i)
      choices.set(key, scored.slice(0, want).map(s => s.id).sort((a, b) => kids.findIndex(k => k.id === a) - kids.findIndex(k => k.id === b)))
    }
    results = solveOnce(members, ctx, choices)
    let best = groupScore(results)

    // 3. Try each other alternative, one choice at a time; keep what helps.
    let budget = 48
    for (let pass = 0; pass < 2 && budget > 0; pass++) {
      let improved = false
      for (const { program, node } of choiceNodes) {
        const key = nodeKey(program.data.code, node.id)
        const current = choices.get(key)
        if (!current || !isActive(results, program.data.code, node.id)) continue
        for (const candidate of alternatives(node, current)) {
          if (budget-- <= 0) break
          const trial = new Map(choices)
          trial.set(key, candidate)
          const r = solveOnce(members, ctx, trial)
          const score = groupScore(r)
          if (score > best + 1e-9) {
            best = score
            results = r
            choices = trial
            improved = true
            break
          }
        }
      }
      if (!improved) break
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
    if (!n.need) left = 1
    else {
      if (n.need.courses) left = Math.max(left, n.need.courses - n.have.courses)
      if (n.need.units) left = Math.max(left, (n.need.units - n.have.units) / UNITS_PER_COURSE)
    }
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
  for (const slots of slotsBy.values()) {
    for (const s of slots) {
      if (s.wim) continue
      const node = flow.addNode()
      slotNode.set(s, node)
      for (const tier of s.tiers) flow.addEdge(node, sink, tier.cap, -tier.reward)
    }
  }

  const assignEdges: { edge: number; course: AuditCourse; slot: Slot; pinned: boolean; exception: boolean }[] = []
  for (const c of ctx.counting) {
    const progEdges: { p: AuditProgram; edges: { slot: Slot; cost: number; pinned: boolean; exception: boolean }[] }[] = []
    for (const p of members) {
      if (ctx.excluded.has(`${c.course.id}|${p.data.code}`)) continue
      if (!careerFits(c, p)) continue
      const pinned = ctx.pinsBy.get(`${c.course.id}|${p.data.code}`)
      const edges: { slot: Slot; cost: number; pinned: boolean; exception: boolean }[] = []
      for (const s of slotsBy.get(p.data.code) ?? []) {
        if (s.wim) continue
        const bonus = (BONUS_STATUS[c.status] ?? 0) + (p.isGrad === (c.career === 'GR') ? BONUS_CAREER : 0)
        if (pinned && pinned.size) {
          if (!pinned.has(s.node.id)) continue
          const eligible = !s.pinOnly && accepts(s, c)
          // An item slot the course is not on is only a fallback for the pin.
          const isItemMismatch = s.item !== undefined && !eligible && nodeHasEligibleItem(nodeSlotsFor(p, s.node, slotsBy), c)
          if (isItemMismatch) continue
          edges.push({ slot: s, cost: -(REWARD_PIN + bonus), pinned: true, exception: !eligible && !s.pinOnly })
        } else if (!s.pinOnly && accepts(s, c)) {
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
        const edge = flow.addEdge(pc, slotNode.get(e.slot)!, 1, e.cost)
        assignEdges.push({ edge, course: c, slot: e.slot, pinned: e.pinned, exception: e.exception })
      }
    }
  }
  flow.run(source, sink)

  const applied = new Map<Slot, AppliedCourse[]>()
  const usedIn = new Map<string, Set<string>>() // program -> course ids
  for (const a of assignEdges) {
    if (flow.flowOn(a.edge) <= 0) continue
    const p = members.find(m => m.data.code === a.slot.program)!
    const list = applied.get(a.slot) ?? []
    list.push({ courseId: a.course.course.id, units: unitsFor(a.course, p), pinned: a.pinned || undefined, exception: a.exception || undefined })
    applied.set(a.slot, list)
    if (!usedIn.has(a.slot.program)) usedIn.set(a.slot.program, new Set())
    usedIn.get(a.slot.program)!.add(a.course.course.id)
  }

  // Writing in the Major: a course already in the major, or any that is on the list.
  for (const [code, slots] of slotsBy) {
    const p = members.find(m => m.data.code === code)!
    for (const s of slots) {
      if (!s.wim) continue
      const want = s.tiers[0]?.cap ?? 1
      const candidates = ctx.counting
        .filter(c => !ctx.excluded.has(`${c.course.id}|${code}`) && careerFits(c, p))
        .map(c => {
          const pinned = ctx.pinsBy.get(`${c.course.id}|${code}`)?.has(s.node.id) ?? false
          return { c, pinned, ok: pinned || (!s.pinOnly && accepts(s, c)) }
        })
        .filter(x => x.ok)
        .sort((x, y) =>
          Number(y.pinned) - Number(x.pinned) ||
          Number(usedIn.get(code)?.has(y.c.course.id) ?? false) - Number(usedIn.get(code)?.has(x.c.course.id) ?? false) ||
          (BONUS_STATUS[y.c.status] ?? 0) - (BONUS_STATUS[x.c.status] ?? 0))
      applied.set(s, candidates.slice(0, Math.max(1, want)).map(x => ({
        courseId: x.c.course.id,
        units: unitsFor(x.c, p),
        pinned: x.pinned || undefined,
        exception: (x.pinned && !s.pinOnly && !accepts(s, x.c)) || undefined,
        shared: true,
      })))
    }
  }

  return members.map(p => evaluateProgram(p, ctx, choices, nodeSlots, applied))

  function nodeSlotsFor(p: AuditProgram, node: RuleNode, all: Map<string, Slot[]>): Slot[] {
    return (all.get(p.data.code) ?? []).filter(s => s.node === node)
  }
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
  const base = { program: p.data.code, node: n, wim: blockWim || Boolean(n.shares) }
  const key = (suffix: string) => `${p.data.code}|${n.id}${suffix}`
  if (n.t === 'text') {
    if (n.info) return []
    return [{ ...base, key: key(''), pinOnly: true, tiers: [{ cap: n.n ?? (n.units ? 99 : 1), reward: REWARD_REQUIRED }, { cap: 99, reward: REWARD_SURPLUS }] }]
  }
  const surplus = { cap: 99, reward: floorAbove || n.units ? REWARD_SURPLUS_FLOOR : REWARD_SURPLUS }
  if (n.optional) return [{ ...base, key: key(''), pinOnly: false, tiers: [{ cap: 99, reward: REWARD_SURPLUS }] }]
  const required = REWARD_REQUIRED + specificity(n.items?.flat().length ?? 0)
  switch (n.mode) {
    case 'all':
      return (n.items ?? []).map((item, i) => ({
        ...base, key: key(`#${i}`), item: i, pinOnly: false,
        tiers: [{ cap: 1, reward: REWARD_REQUIRED + specificity(item.length) }],
      }))
    case 'atLeast':
      return [{ ...base, key: key(''), pinOnly: false, tiers: [{ cap: n.n ?? 1, reward: required }, ...(floorAbove || n.units ? [surplus] : [])] }]
    case 'units':
      return [{ ...base, key: key(''), pinOnly: false, tiers: unitTiers(n.units ?? 1, required, surplus) }]
    case 'any':
    default: {
      if (n.n) return [{ ...base, key: key(''), pinOnly: false, tiers: [{ cap: n.n, reward: required }, surplus] }]
      if (n.units) return [{ ...base, key: key(''), pinOnly: false, tiers: unitTiers(n.units, required, surplus) }]
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
 * A unit target: the fewest courses that could reach it (5-unit courses) at
 * full reward, enough 3-unit courses to reach it at a lower one, then surplus.
 */
function unitTiers(units: number, reward: number, surplus: { cap: number; reward: number }) {
  const fewest = Math.max(1, Math.ceil(units / 5))
  const most = Math.max(fewest, Math.ceil(units / 3))
  const tiers = [{ cap: fewest, reward }]
  if (most > fewest) tiers.push({ cap: most - fewest, reward: REWARD_UNITS_MORE })
  tiers.push(surplus)
  return tiers
}

function accepts(s: Slot, c: AuditCourse): boolean {
  const n = s.node
  if (n.match) return matches(n.match, c)
  const items = n.items ?? []
  const list = s.item !== undefined ? [items[s.item] ?? []] : items
  for (const item of list) for (const code of item) if (c.codes.has(code)) return true
  return false
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
      if (n.t === 'text' && n.info) result.status = 'info'
      else if (n.optional) result.status = 'optional'
      else if (studentDone) { result.status = 'complete'; result.doneByStudent = true }
      else if (n.t === 'text' && list.length === 0) result.status = 'manual'
      else if (n.t === 'courses' && n.mode === 'all') {
        // Each item on its own: the worst item decides.
        let worst = 4
        for (const s of slots) worst = Math.min(worst, statusRank(applied.get(s) ?? [], { courses: 1 }, statusOf))
        result.status = rankStatus(worst)
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
    } else if (n.t === 'some') {
      const want = Math.min(n.n ?? 1, ranks.length)
      const sorted = [...ranks].sort((a, b) => b - a)
      result.status = sorted.length ? rankStatus(sorted[want - 1] ?? 0) : 'info'
    } else {
      result.status = ranks.length ? rankStatus(Math.min(...ranks)) : used.some(c => c.status === 'optional') ? 'optional' : 'info'
    }
    if (n.units && !studentDone) result.status = withFloor(result, n.units, appliedBelow, ctx)
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
    if (n.children && n.children.length) { n.children.forEach(countLeaves); return }
    if (NEUTRAL.has(n.status)) return
    total++
    if (n.status === 'complete' || n.status === 'in-progress') met++
    if (n.status !== 'incomplete' && n.status !== 'manual') metWithPlan++
  }
  for (const b of blocks) if (b.included) b.rules.forEach(countLeaves)

  const subplans = p.data.blocks.filter(b => b.kind === 'subplan')
  const needsSubplan = subplans.length > 0 && !subplans.some(b => b.id === p.choice.subplan)
  const blockRanks = blocks.filter(b => b.included && !NEUTRAL.has(b.status)).map(b => RANK[b.status])
  let status: NodeStatus = blockRanks.length ? rankStatus(Math.min(...blockRanks)) : 'info'
  if (needsSubplan) status = 'incomplete'

  const seen = new Set<string>()
  let units = 0
  for (const b of blocks) {
    if (!b.included) continue
    for (const a of collectApplied(b.rules)) {
      if (seen.has(a.courseId)) continue
      seen.add(a.courseId)
      units += a.units
    }
  }

  return { code, data: p.data, choice: p.choice, blocks, status, total, met, metWithPlan, units, needsSubplan, isGeneralEducation: p.isGE }
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

function collectApplied(nodes: NodeResult[]): AppliedCourse[] {
  const out: AppliedCourse[] = []
  const seen = new Set<string>()
  const walk = (n: NodeResult) => {
    if (n.status === 'inactive') return
    for (const a of n.applied) {
      if (seen.has(a.courseId)) continue
      seen.add(a.courseId)
      out.push(a)
    }
    n.children?.forEach(walk)
  }
  nodes.forEach(walk)
  return out
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
  if (NEUTRAL.has(result.status)) return result.status
  const floorRank = statusRank(list, { units: floor }, statusOf)
  return rankStatus(Math.min(RANK[result.status], floorRank))
}
