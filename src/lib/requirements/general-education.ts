import type { ProgramData, RuleNode, Way } from './types'

/**
 * Undergraduate General Education Requirements, written out from the
 * 2026-27 Bulletin page (bulletin.stanford.edu/academic-polices/degree-requirements/general-education).
 * Coursedog has no program for them, so they are encoded here, but in the
 * same rule shape as a major so one engine audits both.
 *
 * Each requirement is its own program on purpose: the Bulletin lets a COLLEGE
 * course also fill a Way, and Ways courses also count for the major, but a
 * course counts toward only one Way. Separate programs share courses with
 * each other; inside one program a course is used once.
 */

const GE_URL = 'https://bulletin.stanford.edu/academic-polices/degree-requirements/general-education'
const YEAR = '2026-27'

export const WAY_NAMES: Record<Way, string> = {
  AII: 'Aesthetic and Interpretive Inquiry',
  AQR: 'Applied Quantitative Reasoning',
  CE: 'Creative Expression',
  EDP: 'Exploring Difference and Power',
  ER: 'Ethical Reasoning',
  FR: 'Formal Reasoning',
  SI: 'Social Inquiry',
  SMA: 'Scientific Method and Analysis',
}

const WAYS_RULE =
  'Courses must be at least 3 units and taken for a letter grade, unless the course is only offered S/NC. ' +
  'Graduate courses, independent study, test credit and courses taken before matriculation are not eligible. ' +
  'A course certified for two Ways counts toward only one.'

function way(way: Way, n: number): RuleNode {
  return {
    id: `ways-${way}`,
    t: 'courses',
    name: `Way-${way}: ${WAY_NAMES[way]}`,
    mode: 'atLeast',
    n,
    items: [],
    match: { way, minUnits: 3, letter: true, undergradOnly: true, noTestCredit: true },
  }
}

function geProgram(code: string, name: string, rules: RuleNode[]): ProgramData {
  return { code, name, kind: 'major', degree: '', year: YEAR, url: GE_URL, departments: [], blocks: [{ id: 'b0', name, rules }] }
}

export const GE_PROGRAMS: ProgramData[] = [
  geProgram('GE-COLLEGE', 'COLLEGE', [{
    id: 'college',
    t: 'courses',
    name: 'Civic, Liberal, and Global Education',
    desc:
      'Two COLLEGE courses in the first year, one in each of two quarters. SLE and ITALIC also satisfy it, ' +
      'and ESF satisfies one quarter. COLLEGE becomes a three-quarter requirement for first-years starting in 2027-28.',
    mode: 'atLeast',
    n: 2,
    items: [],
    match: { tag: 'COL', letter: true, noTestCredit: true },
  }]),
  geProgram('GE-WAYS', 'Ways of Thinking, Ways of Doing', [{
    id: 'ways',
    t: 'all',
    name: 'Eleven certified Ways courses',
    desc: WAYS_RULE,
    children: [
      way('AII', 2),
      way('AQR', 1),
      {
        id: 'ways-CE',
        t: 'courses',
        name: `Way-CE: ${WAY_NAMES.CE}`,
        desc: 'Two units: one 2-unit course, or 1-unit courses in Dance, Music or TAPS.',
        mode: 'units',
        units: 2,
        items: [],
        match: { way: 'CE', letter: true, undergradOnly: true, noTestCredit: true },
      },
      way('EDP', 1),
      way('ER', 1),
      way('FR', 1),
      way('SI', 2),
      way('SMA', 2),
    ],
  }]),
  geProgram('GE-WRITING', 'Writing and Rhetoric', [{
    id: 'writing',
    t: 'all',
    name: 'Writing and Rhetoric',
    desc: 'Writing in the Major (WIM), the third level, is part of each major and is audited there.',
    children: [
      {
        id: 'wr1',
        t: 'courses',
        name: 'First level (WR 1): PWR 1, SLE, ESF or ITALIC',
        mode: 'atLeast',
        n: 1,
        items: [],
        match: { tag: 'WR1', letter: true },
      },
      {
        id: 'wr2',
        t: 'courses',
        name: 'Second level (WR 2): PWR 2, SLE or a WRITE 2 course',
        mode: 'atLeast',
        n: 1,
        items: [],
        match: { tag: 'WR2', letter: true },
      },
    ],
  }]),
  geProgram('GE-LANGUAGE', 'Language', [{
    id: 'language',
    t: 'any',
    name: 'One year of a foreign language',
    desc: 'Language courses may be taken CR/NC.',
    children: [
      {
        // The registrar tags only the course that finishes the year
        // (SPANLANG 3 carries "UGRQ - LANGUAGE"; SPANLANG 1 and 2 do not).
        id: 'language-courses',
        t: 'courses',
        name: 'Third quarter of a first-year language sequence',
        desc: 'Three quarters of a first-year, 4-5 unit language course. The third quarter is the one that completes it.',
        mode: 'atLeast',
        n: 1,
        items: [],
        match: { tag: 'LANG' },
      },
      {
        id: 'language-placement',
        t: 'text',
        name: 'Placed out',
        desc:
          'A 4 or 5 on the AP exam in Chinese, French, German, Japanese, Latin or Spanish, a qualifying SAT II ' +
          'score, or a placement test. Mark it done once it is on your record.',
      },
    ],
  }]),
]

/** Units a bachelor's degree needs, and the Bulletin's caps on what counts toward them. */
export const UNDERGRAD_UNITS = {
  bachelor: 180,
  /** A dual B.A. and B.S. */
  dual: 225,
  /** Pass/fail grading (CR/NC, S/NC), activity courses included. */
  passFailCap: 36,
} as const

/** University minimum for a master's degree at Stanford. */
export const MASTERS_UNITS = 45

/**
 * The Bulletin's foundational courses, the only ones that may double-count
 * between two majors or a major and a minor
 * (bulletin.stanford.edu/academic-polices/degree-requirements/ug-double-counting).
 */
export const FOUNDATIONAL_COURSES = new Set([
  'BIO 81', 'BIO 82', 'BIO 83', 'BIO 84', 'BIO 85', 'BIO 86',
  'CHEM 31A', 'CHEM 31B', 'CHEM 31E', 'CHEM 31M', 'CHEM 33',
  'CME 100', 'CME 102',
  'CS 106A', 'CS 106B',
  'ECON 1',
  'ENGR 14', 'ENGR 40M',
  'MATH 19', 'MATH 20', 'MATH 21', 'MATH 51', 'MATH 52', 'MATH 53',
  'MATH 61CM', 'MATH 62CM', 'MATH 63CM', 'MATH 61DM', 'MATH 62DM', 'MATH 63DM',
  'PHYSICS 21', 'PHYSICS 23', 'PHYSICS 41', 'PHYSICS 43', 'PHYSICS 45',
  'STATS 110', 'STATS 60',
])
