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
  /** Courses that count besides `items`: "any ENGLISH course numbered 100 or above". */
  pool?: CoursePool
  /** Each course must carry at least this many units ("courses must be taken for at least three units"). */
  minUnitsEach?: number
  /** Each course must be letter graded. */
  letter?: boolean
  /** Lowest grade a course may carry and still count here ("C-"). */
  minGrade?: string
  /** Caps inside the rule: "only one of which may be a creative writing course". */
  limits?: RuleLimit[]
  /** Why a text rule needs a person: an approval, an exam, a thesis. */
  manual?: 'approval' | 'milestone' | 'exam' | 'thesis' | 'gpa' | 'residency' | 'other'
  /** Rewritten by a reviewed overlay (data/requirements/overlays). */
  reviewed?: boolean
}

export interface CoursePool {
  /** Subject codes ("ENGLISH"). A cross-listing in another subject counts too. */
  subjects: string[]
  /** Any subject ("15 units outside the department"); `excludeSubjects` narrows it. */
  anySubject?: boolean
  excludeSubjects?: string[]
  /** Range on the course number's digits: ENGLISH 160A is 160. */
  minNumber?: number
  maxNumber?: number
  exclude?: string[]
  /** Leave out graduate-career listings. */
  excludeGraduate?: boolean
  /** Only graduate-career listings ("graduate-level courses"). */
  onlyGraduate?: boolean
  /** Only the listing the student took, not a cross-listing ("must have the HISTORY subject code"). */
  takenListing?: boolean
}

export interface RuleLimit {
  label: string
  /** At most this many courses matching `codes` or `pool` count here. */
  max?: number
  /** At most this many of their units count here. */
  maxUnits?: number
  codes?: string[]
  pool?: CoursePool
}

/**
 * A count over every course the program counts, across its rules: "at least
 * 23 units must be at or above the 200 level", "a minimum of 13 courses",
 * "up to 10 units may be taken CR/NC". For a graduate program that is every
 * graduate-career course; otherwise the courses applied to the program.
 */
export interface ProgramTotal {
  label: string
  minUnits?: number
  maxUnits?: number
  minCourses?: number
  /** A cap on the number of courses ("count 2 classes S/NC"): past it, a course counts for nothing. */
  maxCourses?: number
  /** Only courses in this pool, or with one of these listings, count toward the total. */
  pool?: CoursePool
  codes?: string[]
  /** Only letter-graded courses, or only the others (CR, S). */
  grading?: 'letter' | 'not-letter'
  /** Only when this subplan or optional section is in the plan ("the French and Philosophy subplan requires 66 units"). */
  when?: string
  /** Not when this subplan or optional section is in the plan ("except for honors students"). */
  unless?: string
  /**
   * A cap that binds the rules too: past it, the courses count toward no
   * requirement ("no more than 5 units of directed reading may count toward
   * the major"). Without it a cap only limits the program's totals.
   */
  inRules?: boolean
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
  /** Writing in the Major or the capstone: its course also counts toward the rest of the program. */
  wim?: boolean
  /** Unit floor over the whole block ("a total of at least 21 units from A, B and C"). */
  units?: number
  /** Only for a student with no subplan ("complete the Literature depth, or one subplan"). */
  unlessSubplan?: boolean
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
  /** "Minimum University Units", for a graduate degree when it is more than the program's (135 for a PhD). */
  unitsUniversityMin?: number
  /** The Bulletin's own flag: false means a student may finish without a subplan. Unset reads as required. */
  subplanRequired?: boolean
  gpa?: string
  grading?: string
  policies?: string
  /** Transfer, AP and outside credit. */
  transferPolicy?: string
  /** Requirements the Bulletin lists outside the course rules ("submit a senior survey"). */
  otherRequirements?: string
  /** Every course in the program must be letter graded. */
  letterGrade?: boolean
  /** Lowest grade a course may carry and still count ("C-"). */
  minGrade?: string
  /** Units of the program's courses that must be letter graded ("at least 36 units ... letter grade"). */
  letterUnitsMin?: number
  /** Share of the program's units in courses for graduate students, numbered 200 and up ("50% of units"). */
  gradUnitsShare?: number
  /** Counts over the program's courses as a whole; see ProgramTotal. */
  totals?: ProgramTotal[]
  /** Date the program was reviewed against the Bulletin text, and what changed. */
  reviewed?: string
  reviewNotes?: string
  blocks: ProgramBlock[]
}

export interface ProgramIndexEntry {
  code: string
  name: string
  kind: ProgramKind
  degree: string
  subplans: { id: string; name: string }[]
  reviewed?: string
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
  /** WR1, WR2, COL, LANG, GR (a graduate-career listing), REP (repeatable for credit). */
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
