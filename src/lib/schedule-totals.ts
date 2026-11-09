import type { Course } from '@/types/course'
import { parseUnitsOptions } from '@/lib/utils'
import { aggregateMetrics } from '@/components/course-evaluations'

type Evaluations = Parameters<typeof aggregateMetrics>[0]

/**
 * A term's unit range, as the schedule page shows it: a unit pick counts as
 * itself, otherwise a variable-unit class adds its low end to the minimum and
 * its high end to the maximum.
 */
export function termUnitRange(courses: Course[], term: string): { min: number; max: number } {
  let min = 0
  let max = 0

  courses.forEach(c => {
    if (c.selectedUnits !== undefined && !isNaN(c.selectedUnits)) {
      min += c.selectedUnits
      max += c.selectedUnits
      return
    }

    // Units belong to the course, not to each picked section: ExploreCourses
    // leaves DIS rows blank, so read them off the first picked section that
    // has them rather than summing across LEC + DIS.
    if (c.selectedSectionIds?.length && c.sections) {
      // Only the entry's own term: class numbers are reused across terms.
      const entryTerm = c.selectedTerm ?? term
      const picked = c.sections.filter(s => s.term === entryTerm && c.selectedSectionIds!.includes(s.classId))
      const withUnits = picked
        .map(s => parseUnitsOptions(s.units))
        .find(opts => opts.length > 0 && Math.max(0, ...opts) > 0)
      if (withUnits) {
        min += withUnits[0]
        max += withUnits[withUnits.length - 1]
        return
      }
    }

    if (c.units) {
      const opts = parseUnitsOptions(c.units)
      if (opts.length > 0) {
        min += opts[0]
        max += opts[opts.length - 1]
      }
    }
  })

  return { min, max }
}

/** "9-13", "12", "0" */
export function formatUnitRange({ min, max }: { min: number; max: number }): string {
  if (min === 0 && max === 0) return '0'
  return min === max ? String(min) : `${min}-${max}`
}

/**
 * Expected hours a week: evaluation hours where a course has them, otherwise
 * three hours per unit. A course whose evaluations are still loading counts
 * toward neither, and `loading` says so, so the caller can avoid printing a
 * total that is about to jump.
 */
export function expectedWeeklyHours(
  courses: Course[],
  getEvaluations: (courseId: string) => Evaluations,
  loadingCourses: Record<string, boolean>,
): { total: number | null; loading: boolean } {
  let total = 0
  let withData = 0
  let loading = false
  for (const c of courses) {
    if (loadingCourses[c.id]) loading = true
    const metrics = aggregateMetrics(getEvaluations(c.id))
    if (metrics.hours !== undefined && !Number.isNaN(metrics.hours)) {
      total += metrics.hours
      withData++
    } else if (!loadingCourses[c.id]) {
      // Fallback: estimate hours as units * 3 when no eval data
      const effectiveUnits = c.selectedUnits
        ?? (() => {
          const opts = parseUnitsOptions(c.units ?? '')
          return opts.length > 0 ? opts[Math.floor(opts.length / 2)] : 0
        })()
      total += effectiveUnits * 3
      withData++
    }
  }
  return { total: withData > 0 ? total : null, loading }
}
