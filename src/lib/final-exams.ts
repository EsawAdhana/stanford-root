import type { Course } from '@/types/course'
import { componentRank, getParsedSectionMeetings, pickSectionsForTerm, primarySection } from '@/lib/schedule-utils'

/**
 * Final exam slots from Stanford's published 2026-27 Final Exam Schedule
 * (https://studentservices.stanford.edu/my-academics/evaluations-exams-grades/final-exam-schedule,
 * read 2026-11-07). The Registrar sets a class's exam by the days and start
 * time of its meetings, plus a short list of group exams for large intro
 * courses. Nothing in the catalog carries exam times, so this table is the only
 * source. Add the next academic year's table when Student Services posts it.
 *
 * Classes that end in a project still hold the slot, which is why the UI says
 * "exam slot" rather than promising an exam.
 */

type DayFamily = 'MWF' | 'TTh'

type Rule = {
  day: number
  slot: number
  /** 'any' ignores the meeting days: "Classes starting at 4:30 any day". */
  family: DayFamily | 'any'
  starts?: number[]
  /** "Classes starting at 5:30 or later any day". */
  startsFrom?: number
}

type GroupExam = { day: number; slot: number; subject: string; codes: string[] }

type TermExams = {
  /** ISO dates of the exam days, in order. Spring has a Saturday. */
  days: string[]
  rules: Rule[]
  groups: GroupExam[]
}

const at = (h: number, m = 0) => h * 60 + m

/** The four daily blocks: 8:30-11:30 AM, 12:15-3:15 PM, 3:30-6:30 PM, 7-10 PM. */
export const EXAM_SLOTS = [
  { start: at(8, 30), end: at(11, 30) },
  { start: at(12, 15), end: at(15, 15) },
  { start: at(15, 30), end: at(18, 30) },
  { start: at(19), end: at(22) },
] as const

// Autumn, Winter and Spring share one grid by position; only the dates and the
// group exam lists change. "On M, W, and/or F; and MTWTh(F)" is the MWF family.
const QUARTER_RULES: Rule[] = [
  { day: 0, slot: 0, family: 'MWF', starts: [at(8, 30), at(9)] },
  { day: 0, slot: 2, family: 'MWF', starts: [at(10, 30)] },
  { day: 0, slot: 3, family: 'any', starts: [at(16, 30)] },
  { day: 1, slot: 0, family: 'MWF', starts: [at(14, 30), at(15)] },
  { day: 1, slot: 2, family: 'TTh', starts: [at(13, 30)] },
  { day: 2, slot: 0, family: 'TTh', starts: [at(8, 30), at(9), at(9, 30)] },
  { day: 2, slot: 2, family: 'MWF', starts: [at(13, 30)] },
  { day: 2, slot: 3, family: 'MWF', starts: [at(15, 30)] },
  { day: 3, slot: 0, family: 'MWF', starts: [at(9, 30)] },
  { day: 3, slot: 1, family: 'TTh', starts: [at(15)] },
  { day: 3, slot: 2, family: 'TTh', starts: [at(10, 30)] },
  { day: 3, slot: 3, family: 'any', startsFrom: at(17, 30) },
  { day: 4, slot: 0, family: 'MWF', starts: [at(11, 30)] },
  { day: 4, slot: 1, family: 'TTh', starts: [at(11, 30), at(12)] },
  { day: 4, slot: 2, family: 'MWF', starts: [at(12, 30)] },
]

// Summer goes by start time alone, over two days.
const SUMMER_RULES: Rule[] = [
  { day: 0, slot: 0, family: 'any', starts: [at(8, 30), at(9), at(9, 30)] },
  { day: 0, slot: 1, family: 'any', starts: [at(11, 30), at(12)] },
  { day: 0, slot: 2, family: 'any', starts: [at(13, 30)] },
  { day: 0, slot: 3, family: 'any', starts: [at(15, 30)] },
  { day: 1, slot: 0, family: 'any', starts: [at(10, 30)] },
  { day: 1, slot: 1, family: 'any', starts: [at(12, 30)] },
  { day: 1, slot: 2, family: 'any', starts: [at(14, 30), at(15)] },
  { day: 1, slot: 3, family: 'any', startsFrom: at(16, 30) },
]

export const FINAL_EXAMS: Record<string, TermExams> = {
  'Autumn 2026': {
    days: ['2026-12-07', '2026-12-08', '2026-12-09', '2026-12-10', '2026-12-11'],
    rules: QUARTER_RULES,
    groups: [
      { day: 0, slot: 0, subject: 'CS', codes: ['105', '106A', '106AX', '106B', '106E', '106EA'] },
      { day: 0, slot: 1, subject: 'PHYSICS', codes: ['21', '41', '41E', '45', '61'] },
      { day: 1, slot: 1, subject: 'MATH', codes: ['19', '20', '21', '51', '53'] },
      { day: 2, slot: 1, subject: 'CHEM', codes: ['31A', '31E', '121'] },
    ],
  },
  'Winter 2027': {
    days: ['2027-03-15', '2027-03-16', '2027-03-17', '2027-03-18', '2027-03-19'],
    rules: QUARTER_RULES,
    groups: [
      { day: 0, slot: 0, subject: 'CS', codes: ['105', '106A', '106B', '106E', '106EA'] },
      { day: 0, slot: 1, subject: 'PHYSICS', codes: ['23', '41', '41E', '43'] },
      { day: 1, slot: 1, subject: 'MATH', codes: ['19', '20', '21', '51', '52', '53'] },
      { day: 2, slot: 1, subject: 'CHEM', codes: ['31B', '33', '141'] },
    ],
  },
  'Spring 2027': {
    days: ['2027-06-04', '2027-06-05', '2027-06-07', '2027-06-08', '2027-06-09'],
    rules: QUARTER_RULES,
    groups: [
      { day: 0, slot: 0, subject: 'CS', codes: ['105', '106A', '106B', '106E', '106EA'] },
      { day: 0, slot: 1, subject: 'PHYSICS', codes: ['25', '43'] },
      { day: 1, slot: 1, subject: 'MATH', codes: ['20', '21', '51', '52', '53'] },
      { day: 2, slot: 1, subject: 'CHEM', codes: ['33', '143'] },
    ],
  },
  'Summer 2027': {
    days: ['2027-08-13', '2027-08-14'],
    rules: SUMMER_RULES,
    groups: [],
  },
}

/** Product call (2026-11-07): three or more exam slots in one day gets a warning. */
export const HEAVY_DAY_EXAMS = 3

export type ScheduledExam = {
  kind: 'slot'
  day: number
  date: string
  start: number
  end: number
  /** A group exam from the Registrar's list rather than the meeting-time grid. */
  group: boolean
}

export type ExamSlot =
  | ScheduledExam
  /** Meets at a start time or day pattern the Registrar's grid does not list. */
  | { kind: 'off-grid'; days: string[]; start: number }
  /** No meeting time to look an exam up by. */
  | { kind: 'no-time' }

export function hasFinalExamSchedule(term: string): boolean {
  return term in FINAL_EXAMS
}

/** The exam days of a term, or [] when its schedule is not published here. */
export function examDays(term: string): string[] {
  return FINAL_EXAMS[term]?.days ?? []
}

const MWF = new Set(['Mon', 'Wed', 'Fri'])
const TTH = new Set(['Tue', 'Thu'])

function dayFamily(days: string[]): DayFamily | null {
  if (days.length === 0) return null
  if (days.every(d => MWF.has(d))) return 'MWF'
  if (days.every(d => TTH.has(d))) return 'TTh'
  // "MTWTh(F)": Monday through Thursday, with or without Friday.
  const set = new Set(days)
  const weekdaysOnly = days.every(d => MWF.has(d) || TTH.has(d))
  if (weekdaysOnly && ['Mon', 'Tue', 'Wed', 'Thu'].every(d => set.has(d))) return 'MWF'
  return null
}

function ruleMatches(rule: Rule, family: DayFamily | null, start: number): boolean {
  if (rule.family !== 'any' && rule.family !== family) return false
  if (rule.starts) return rule.starts.includes(start)
  return rule.startsFrom !== undefined && start >= rule.startsFrom
}

/**
 * Where a scheduled course's final lands, read off the section the student
 * attends (its lecture, not a discussion). Null when the term has no published
 * schedule here.
 */
export function examSlotFor(course: Course, term: string): ExamSlot | null {
  const schedule = FINAL_EXAMS[term]
  if (!schedule) return null

  const toSlot = (day: number, slot: number, group: boolean): ScheduledExam => ({
    kind: 'slot',
    day,
    date: schedule.days[day],
    start: EXAM_SLOTS[slot].start,
    end: EXAM_SLOTS[slot].end,
    group,
  })

  const group = schedule.groups.find(g => g.subject === course.subject && g.codes.includes(course.code))
  if (group) return toSlot(group.day, group.slot, true)

  let section = primarySection(pickSectionsForTerm(course, term))
  // A pick of only a discussion still takes its exam from the lecture. When the
  // term has exactly one lecture, that lecture is the student's.
  const termSections = (course.sections ?? []).filter(s => s.term === term)
  const best = primarySection(termSections)
  if (section && best && componentRank(best) < componentRank(section)) {
    const lectures = termSections.filter(s => componentRank(s) === componentRank(best))
    if (lectures.length === 1) section = lectures[0]
  }
  const meeting = section
    ? getParsedSectionMeetings(section).find(m => m.days.length > 0 && m.startMinutes > 0)
    : undefined
  if (!meeting) return { kind: 'no-time' }

  const family = dayFamily(meeting.days)
  const rule = schedule.rules.find(r => ruleMatches(r, family, meeting.startMinutes))
  if (!rule) return { kind: 'off-grid', days: meeting.days, start: meeting.startMinutes }
  return toSlot(rule.day, rule.slot, false)
}

export type ExamEntry = { courseId: string; label: string; exam: ScheduledExam }

export type ExamClash = { date: string; start: number; end: number; entries: ExamEntry[] }

export type ExamLoad = {
  /** Two or more exams in the same slot. */
  clashes: ExamClash[]
  /** Days with HEAVY_DAY_EXAMS or more exams. */
  heavyDays: { date: string; entries: ExamEntry[] }[]
}

export function examLoad(entries: ExamEntry[]): ExamLoad {
  const bySlot = new Map<string, ExamEntry[]>()
  const byDay = new Map<string, ExamEntry[]>()
  for (const entry of entries) {
    const slotKey = `${entry.exam.date}|${entry.exam.start}`
    bySlot.set(slotKey, [...(bySlot.get(slotKey) ?? []), entry])
    byDay.set(entry.exam.date, [...(byDay.get(entry.exam.date) ?? []), entry])
  }

  const byTime = (a: ExamEntry, b: ExamEntry) => a.exam.start - b.exam.start || a.label.localeCompare(b.label)
  const clashes = [...bySlot.values()]
    .filter(group => group.length >= 2)
    .map(group => ({ date: group[0].exam.date, start: group[0].exam.start, end: group[0].exam.end, entries: [...group].sort(byTime) }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start)
  const heavyDays = [...byDay.entries()]
    .filter(([, group]) => group.length >= HEAVY_DAY_EXAMS)
    .map(([date, group]) => ({ date, entries: [...group].sort(byTime) }))
    .sort((a, b) => a.date.localeCompare(b.date))
  return { clashes, heavyDays }
}

/** Stable key for a set of clashes, so a dismissed warning returns when the clashes change. */
export function clashSignature(clashes: ExamClash[]): string {
  return clashes
    .map(c => `${c.date}@${c.start}:${c.entries.map(e => e.courseId).sort().join('+')}`)
    .join(';')
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function parseIsoDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  // UTC so the weekday never shifts with the viewer's timezone.
  const date = new Date(Date.UTC(y, m - 1, d))
  return { weekday: WEEKDAYS[date.getUTCDay()], month: m, monthName: MONTHS[m - 1], day: d }
}

/** "Tue, Mar 16" */
export function formatExamDate(iso: string): string {
  const { weekday, monthName, day } = parseIsoDate(iso)
  return `${weekday}, ${monthName} ${day}`
}

/** "Tue 3/16", for a narrow column header. */
export function formatExamColumn(iso: string): string {
  const { weekday, month, day } = parseIsoDate(iso)
  return `${weekday} ${month}/${day}`
}

function clock(minutes: number): string {
  const h24 = Math.floor(minutes / 60)
  const m = minutes % 60
  const h12 = ((h24 + 11) % 12) + 1
  return m ? `${h12}:${String(m).padStart(2, '0')}` : `${h12}`
}

const meridiem = (minutes: number) => (minutes >= 12 * 60 ? 'PM' : 'AM')

/** "12:15-3:15 PM", "7-10 PM" */
export function formatExamTime(start: number, end: number): string {
  return meridiem(start) === meridiem(end)
    ? `${clock(start)}-${clock(end)} ${meridiem(end)}`
    : `${clock(start)} ${meridiem(start)}-${clock(end)} ${meridiem(end)}`
}

/** "12:15 PM" */
export function formatExamStart(start: number): string {
  return `${clock(start)} ${meridiem(start)}`
}
