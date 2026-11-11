import { describe, expect, it, vi } from 'vitest'
import type { Course, Section } from '@/types/course'

// The real aggregateMetrics lives in a component module that loads the
// Supabase client; these tests only need its hours, passed straight through.
vi.mock('@/components/course-evaluations', () => ({
  aggregateMetrics: (evals: { hours?: number }[]) => ({ hours: evals[0]?.hours }),
}))

const { expectedWeeklyHours, formatUnitRange, formatWeeklyHours, termUnitRange } = await import('@/lib/schedule-totals')

const W = 'Winter 2027'

const section = (classId: number, units: string, term = W) =>
  ({ classId, term, units, component: 'LEC', meetings: [] }) as unknown as Section

const course = (id: string, units: string, over: Partial<Course> = {}): Course =>
  ({ id, subject: 'CS', code: id, title: id, units, terms: [W], sections: [], ...over }) as unknown as Course

describe('termUnitRange', () => {
  it('adds a fixed-unit class to both ends and a variable one across its range', () => {
    expect(termUnitRange([course('A', '4'), course('B', '3-5')], W)).toEqual({ min: 7, max: 9 })
  })

  it('counts a unit pick as itself', () => {
    expect(termUnitRange([course('B', '3-5', { selectedUnits: 4 })], W)).toEqual({ min: 4, max: 4 })
  })

  it('reads units off the picked section, in its own term only', () => {
    const c = course('C', '1-5', {
      selectedSectionIds: [7],
      sections: [section(7, '2', 'Autumn 2026'), section(7, '3', W)],
    } as Partial<Course>)
    expect(termUnitRange([c], W)).toEqual({ min: 3, max: 3 })
  })

  it('falls back to the course units when the picked section has none', () => {
    const c = course('D', '2-3', { selectedSectionIds: [9], sections: [section(9, '')] } as Partial<Course>)
    expect(termUnitRange([c], W)).toEqual({ min: 2, max: 3 })
  })
})

describe('formatUnitRange', () => {
  it('prints a range, a single number, or zero', () => {
    expect(formatUnitRange({ min: 9, max: 13 })).toBe('9-13')
    expect(formatUnitRange({ min: 12, max: 12 })).toBe('12')
    expect(formatUnitRange({ min: 0, max: 0 })).toBe('0')
  })
})

describe('expectedWeeklyHours', () => {
  const noEvals = () => []

  it('estimates three hours a unit without evaluations, using the middle unit option', () => {
    expect(expectedWeeklyHours([course('A', '3-5')], noEvals, {})).toEqual({ total: 12, loading: false })
    expect(expectedWeeklyHours([course('A', '3-5', { selectedUnits: 3 })], noEvals, {})).toEqual({ total: 9, loading: false })
  })

  it('leaves out a course whose evaluations are still loading, and says so', () => {
    expect(expectedWeeklyHours([course('A', '4'), course('B', '4')], noEvals, { B: true })).toEqual({ total: 12, loading: true })
    expect(expectedWeeklyHours([course('B', '4')], noEvals, { B: true })).toEqual({ total: null, loading: true })
  })

  it('uses evaluation hours where a course has them', () => {
    const evals = (id: string) => (id === 'A' ? [{ hours: 11.5 }] : [])
    expect(expectedWeeklyHours([course('A', '4'), course('B', '4')], evals as never, {})).toEqual({ total: 23.5, loading: false })
  })

  it('is null for an empty term rather than zero hours', () => {
    expect(expectedWeeklyHours([], noEvals, {})).toEqual({ total: null, loading: false })
  })
})

describe('formatWeeklyHours', () => {
  it('rounds to a whole number of hours', () => {
    expect(formatWeeklyHours({ total: 47.6, loading: false })).toBe('~48')
  })

  it('shows a pending mark, not zero, while the only figure is still loading', () => {
    expect(formatWeeklyHours({ total: null, loading: true })).toBe('…')
  })

  it('keeps showing a total it has while more evaluations load', () => {
    expect(formatWeeklyHours({ total: 12, loading: true })).toBe('~12')
  })

  it('says zero for an empty term', () => {
    expect(formatWeeklyHours({ total: null, loading: false })).toBe('0')
  })
})
