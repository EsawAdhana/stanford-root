import type { Course } from '@/types/course'
import type { CartItem } from '@/lib/cart-store'
import { filterCourses, type CourseFilterCriteria } from '@/lib/course-filter'
import { compareTerms, getCurrentTerm } from '@/lib/terms'
import { normalizeCourseId, resolveToCanonicalPrimary } from '@/lib/utils'

/**
 * What an empty search would find if the quarter filter were off.
 *
 * A fresh visit is scoped to the calendar quarter, so "cs229" in Autumn showed
 * "No courses match your search" although CS 229 runs in Winter and Spring.
 * Everything except the term filter stays as the student set it, and the count
 * comes from the same pipeline the list uses, so "Show all quarters" shows
 * exactly the number promised.
 */
export type OtherTermsMatch =
  | {
      kind: 'one'
      course: Course
      /** The list's own label for the class, e.g. "CS 229". */
      label: string
      /** Quarters any listing of the class is offered in, outside the selected ones, oldest first. */
      offeredTerms: string[]
      /**
       * Where "Show <class>" goes: the soonest upcoming quarter in which the class
       * actually shows with every other filter as set. ['any'] when no single
       * quarter does (see below).
       */
      target: string[]
    }
  | { kind: 'many'; count: number }

/** The selection the term filter treats as "no term filter". */
export const ANY_TERM = 'any'

export type ApplyQuery = (courses: Course[], query: string, primaryMap: Map<string, string>) => Course[]

export function findInOtherTerms(
  courses: Course[],
  criteria: CourseFilterCriteria,
  primaryMap: Map<string, string>,
  cartItems: CartItem[],
  query: string,
  applyQuery: ApplyQuery,
  now: Date = new Date(),
): OtherTermsMatch | null {
  const selected = criteria.selectedTerms.filter(t => t && t !== ANY_TERM)
  // Already every quarter: there is nowhere else to look.
  if (selected.length === 0 || criteria.selectedTerms.includes(ANY_TERM)) return null

  const run = (terms: string[]) =>
    applyQuery(filterCourses(courses, { ...criteria, selectedTerms: terms }, primaryMap, cartItems), query, primaryMap)

  // With the term filter off, Hide conflicting and Hide closed & waitlisted ask
  // "does it fit (or have a seat) in SOME quarter", not in one particular quarter.
  // That is the right count for "Show all quarters", which turns the filter off.
  // It is not enough for picking a single quarter, so that is checked per quarter.
  const anywhere = run([ANY_TERM])
  if (anywhere.length === 0) return null
  if (anywhere.length > 1) return { kind: 'many', count: anywhere.length }

  const course = anywhere[0]
  const groupTerms = offeredTermsOfGroup(courses, course, primaryMap)
  const selectedSet = new Set(selected)
  const offeredTerms = groupTerms.filter(t => !selectedSet.has(t))

  const shownIn = offeredTerms.filter(t => {
    const id = normalizeCourseId(course.id)
    return run([t]).some(c => normalizeCourseId(c.id) === id)
  })
  const current = getCurrentTerm(now)
  const upcoming = shownIn.filter(t => compareTerms(t, current) >= 0)
  // Soonest upcoming quarter; only past quarters left means the latest of them.
  // A class can pass "some quarter" for each filter in a different quarter (open
  // in Spring, fitting the schedule only in Winter) and so show in no single
  // one: then the button turns the term filter off, which does show it.
  const pick = upcoming[0] ?? shownIn[shownIn.length - 1]
  return {
    kind: 'one',
    course,
    label: `${course.subject} ${course.code}`,
    offeredTerms,
    target: pick ? [pick] : [ANY_TERM],
  }
}

/** Every quarter any listing of the class is offered in, oldest first. */
function offeredTermsOfGroup(courses: Course[], course: Course, primaryMap: Map<string, string>): string[] {
  const canonical = resolveToCanonicalPrimary(normalizeCourseId(course.id), primaryMap)
  const terms = new Set<string>()
  for (const c of courses) {
    if (resolveToCanonicalPrimary(normalizeCourseId(c.id), primaryMap) !== canonical) continue
    for (const t of c.terms ?? []) if (t) terms.add(t)
  }
  return [...terms].sort(compareTerms)
}

/** "Autumn 2026", "Autumn 2026 or Winter 2027", "A, B or C": each quarter as its chip names it. */
export function joinTerms(terms: string[], conjunction: 'or' | 'and'): string {
  if (terms.length <= 1) return terms[0] ?? ''
  return `${terms.slice(0, -1).join(', ')} ${conjunction} ${terms[terms.length - 1]}`
}
