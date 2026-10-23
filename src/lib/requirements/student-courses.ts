import { compareTerms, getCurrentTerm, parseTerm } from '@/lib/terms'
import type { CourseStatus, StudentCourse } from './types'

export const TEST_CREDIT = 'Test credit'
export const TRANSFER_CREDIT = 'Transfer credit'

const LETTER = new Set(['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-'])
/** Passed without a letter: credit, satisfactory, and the professional schools' pass marks. */
const PASS_NO_LETTER = new Set(['CR', 'S', 'P', 'H', 'HP', 'MP', '+'])
const FAILED = new Set(['NP', 'NC', 'F', 'U', '-', 'R'])
/** Off the record for degree purposes: withdrawn, and the first attempt of a repeated course (RP). */
const WITHDRAWN = new Set(['W', 'WP', 'WF', 'RP', 'AU', 'NS'])
/** Incomplete, continuing, pending, grade not reported: still in progress. */
const PENDING = new Set(['I', 'N', 'N-', 'L', 'GNR', 'IP'])

export function normalizeGrade(grade: string | undefined): string {
  return (grade || '').trim().toUpperCase()
}

export function isLetterGrade(grade: string | undefined): boolean {
  return LETTER.has(normalizeGrade(grade))
}

export function isPassNoLetter(grade: string | undefined): boolean {
  return PASS_NO_LETTER.has(normalizeGrade(grade))
}

export function isCreditTerm(term: string): boolean {
  return term === TEST_CREDIT || term === TRANSFER_CREDIT
}

/**
 * Where an attempt stands. A recorded grade decides it; without one the term
 * does: past terms count as done (a course added by hand), the current term
 * is in progress, and later terms are the plan.
 */
export function courseStatus(course: StudentCourse, now: Date = new Date()): CourseStatus {
  const grade = normalizeGrade(course.grade)
  if (LETTER.has(grade) || PASS_NO_LETTER.has(grade)) return 'completed'
  if (FAILED.has(grade)) return 'failed'
  if (WITHDRAWN.has(grade)) return 'withdrawn'
  if (isCreditTerm(course.term)) return 'completed'
  if (PENDING.has(grade)) return 'in-progress'
  const current = getCurrentTerm(now)
  const cmp = compareTerms(course.term, current)
  if (cmp < 0) return 'completed'
  if (cmp === 0) return 'in-progress'
  return 'planned'
}

/** Counts toward requirements at all (passed, in progress, or planned). */
export function countsTowardDegree(status: CourseStatus): boolean {
  return status === 'completed' || status === 'in-progress' || status === 'planned'
}

/** Test and transfer credit first, then terms in order. */
export function compareCourseTerms(a: string, b: string): number {
  const rank = (t: string) => (t === TEST_CREDIT ? 0 : t === TRANSFER_CREDIT ? 1 : 2)
  if (rank(a) !== rank(b) || rank(a) < 2) return rank(a) - rank(b)
  return compareTerms(a, b)
}

/** "Autumn 2024" -> "2024-25", the academic year a term belongs to. */
export function academicYear(term: string): string {
  const { season, year } = parseTerm(term)
  if (!year) return ''
  const start = season === 'Autumn' || season === 'Fall' ? year : year - 1
  return `${start}-${String(start + 1).slice(-2)}`
}

/**
 * Terms a student can pick when adding a course: six years back through four
 * ahead of the current term, newest last, summers included.
 */
export function selectableTerms(now: Date = new Date()): string[] {
  const { year } = parseTerm(getCurrentTerm(now))
  const terms: string[] = []
  for (let y = year - 6; y <= year + 4; y++) {
    for (const season of ['Winter', 'Spring', 'Summer', 'Autumn']) terms.push(`${season} ${y}`)
  }
  return terms
}
