/**
 * Shapes of the degree-requirement data written by scripts/build-requirements.mjs
 * (public/requirements/*) and of a student's own record.
 */

export type ProgramKind = 'major' | 'minor' | 'grad' | 'phd-minor' | 'honors'

export type Way = 'AII' | 'AQR' | 'CE' | 'EDP' | 'ER' | 'FR' | 'SI' | 'SMA'

/**
 * One rule from the Bulletin.
 *
 * - `all`: every child, `any`: one child (an "alternate path"), `some`: `n` of the children
 * - `courses`: a list of courses. `mode` says how much of it:
 *   `all` each item, `atLeast` `n` items, `units` `units` units, `any` a pool
 *   (one course unless `n` or `units` says more)
 * - `text`: a rule the Bulletin only states in words. `info` marks one that is
 *   not a requirement at all ("Subplan Overview").
 *
 * `units` on any node is a unit floor over everything applied beneath it.
 */
export interface RuleNode {
  id: string
  t: 'all' | 'any' | 'some' | 'courses' | 'text'
  name?: string
  desc?: string
  notes?: string
  n?: number
  units?: number
  mode?: 'all' | 'atLeast' | 'any' | 'units'
  /** Each item is a list of alternative listings ("CS 107" or "CS 107E"). */
  items?: string[][]
  /** Names of the Bulletin course sets the items came from. */
  sets?: string[]
  optional?: boolean
  info?: boolean
  /**
   * A designation rather than separate coursework (Writing in the Major,
   * "significant software implementation"): its course still counts toward
   * the program's other requirements.
   */
  shares?: boolean
  children?: RuleNode[]
  /**
   * General education leaves match on course attributes instead of a list.
   * Never written by the build script; see general-education.ts.
   */
  match?: CourseMatch
}

export interface CourseMatch {
  way?: Way
  tag?: 'WR1' | 'WR2' | 'COL' | 'LANG'
  /** Minimum units the attempt must carry (Ways: 3, except CE). */
  minUnits?: number
  /** Letter grade required unless the course is only offered S/NC. */
  letter?: boolean
  /** Courses numbered for graduate students are excluded (Ways). */
  undergradOnly?: boolean
  /** Test credit is excluded (Ways: "taken prior to matriculation"). */
  noTestCredit?: boolean
}

export interface ProgramBlock {
  id: string
  name: string
  /** subplan: one of several, the student picks. optional: honors and the like, opt in. */
  kind?: 'subplan' | 'optional' | 'info'
  /** Writing in the Major: its course also counts toward the rest of the program. */
  wim?: boolean
  /** Unit floor over the whole block ("a total of at least 21 units from A, B and C"). */
  units?: number
  notes?: string
  rules: RuleNode[]
}

export interface ProgramData {
  code: string
  name: string
  kind: ProgramKind
  degree: string
  year: string
  url: string
  departments: string[]
  unitsMin?: number
  gpa?: string
  grading?: string
  policies?: string
  blocks: ProgramBlock[]
}

export interface ProgramIndexEntry {
  code: string
  name: string
  kind: ProgramKind
  degree: string
  subplans: { id: string; name: string }[]
}

export interface ProgramIndex {
  year: string
  version: string
  builtAt: string
  programs: ProgramIndexEntry[]
}

export interface CourseInfo {
  code: string
  title: string
  min: number
  max: number
  ways: Way[]
  /** WR1, WR2, COL, LANG, GR (a graduate-career listing). */
  tags: string[]
  /** L: letter only, S: S/NC only, O: letter or CR/NC. */
  grading: '' | 'L' | 'S' | 'O'
  /** Stanford's course id when the course is cross-listed; listings sharing it are one course. */
  group: string
}

export type Career = 'UG' | 'GR'

/** One attempt at a course on the student's record or plan. */
export interface StudentCourse {
  /** Unique per attempt. */
  id: string
  code: string
  /** "Autumn 2024", or "Test credit" / "Transfer credit". */
  term: string
  units: number
  grade?: string
  title?: string
  source: 'transcript' | 'manual' | 'schedule'
  career?: Career
}

export type CourseStatus = 'completed' | 'in-progress' | 'planned' | 'failed' | 'withdrawn'

/** A program the student has added, and their choices for it. */
export interface ProgramChoice {
  code: string
  /** Block id of the chosen subplan. */
  subplan?: string
  /** Optional blocks (honors, distinction) the student opted into. */
  optional?: string[]
  /** A secondary major may double-count with the other programs. */
  secondary?: boolean
  /** What-if: audited on its own, without taking courses from the declared programs. */
  exploring?: boolean
}

/** A student's manual adjustments, the counterpart of MAP's moves and path picks. */
export interface AuditOverrides {
  /** Course attempt pinned to a requirement: MAP's class move / bucket move. */
  pins: { course: string; program: string; node: string }[]
  /** Course attempt that must not count toward a program. */
  exclusions: { course: string; program: string }[]
  /** Requirements the student marked satisfied (an approved petition, test credit, a free-text rule). */
  done: string[]
  /** Chosen child of an "any" rule, keyed program:node. */
  paths: Record<string, string>
}

export const EMPTY_OVERRIDES: AuditOverrides = { pins: [], exclusions: [], done: [], paths: {} }
