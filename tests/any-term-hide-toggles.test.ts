import { it, expect, describe } from 'vitest'
import { filterCourses } from '@/lib/course-filter'
import type { Course } from '@/types/course'
import type { CartItem } from '@/lib/cart-store'

/**
 * The "any term" selection is the sentinel ['any'], not an empty array. The
 * hideConflicts and hideUnavailable checks used to narrow a course's sections
 * to `termsSet.has(s.term)` whenever termsSet was non-empty, so under "any
 * term" they narrowed to zero sections and waved every course through: a class
 * that collides with the cart, or whose only section is closed, reappeared the
 * moment the term chip was removed.
 *
 * Reproduced from the real catalog: searching "cs 448" under Autumn 2026 with a
 * Mon/Wed 10:30 class in the cart showed 0 results, and removing the term chip
 * showed CS 448B again even though the conflict was still there.
 */

const MWF_1030 = { days: 'Monday, Wednesday', time: '10:30 AM – 11:50 AM' }

function course(over: Partial<Course>): Course {
  return {
    id: 'CS1', subject: 'CS', code: '1', title: 'T', description: '',
    units: '3', grading: 'Letter', instructors: [], terms: ['Autumn 2026'],
    sections: [], ...over,
  } as Course
}

const base = {
  excludedWords: [], selectedDepts: [], selectedFormats: [], selectedLevels: [],
  selectedGers: [], selectedSchools: [], unitMin: 1, unitMax: 5,
  timeMin: 420, timeMax: 1320, hideConflicts: false, hideUnavailable: false,
  hideStudyAbroad: true, newOnly: false,
}

const ids = (cs: Course[]) => cs.map(c => c.id)

describe('hide toggles under the "any" term sentinel', () => {
  const conflicting = course({
    id: 'CS448B',
    sections: [{ term: 'Autumn 2026', component: 'LEC', status: 'Open', units: '3-4', meetings: [MWF_1030] } as any],
  })
  const cart: CartItem[] = [{
    ...course({ id: 'CS106B', sections: [{ term: 'Autumn 2026', component: 'LEC', status: 'Open', units: '5', meetings: [MWF_1030] } as any] }),
    selectedTerm: 'Autumn 2026',
  }]

  it('hides a cart conflict under both an explicit term and "any"', () => {
    const crit = { ...base, hideConflicts: true }
    expect(ids(filterCourses([conflicting], { ...crit, selectedTerms: ['Autumn 2026'] }, new Map(), cart))).toEqual([])
    expect(ids(filterCourses([conflicting], { ...crit, selectedTerms: ['any'] }, new Map(), cart))).toEqual([])
    expect(ids(filterCourses([conflicting], { ...crit, selectedTerms: [] }, new Map(), cart))).toEqual([])
  })

  it('keeps the course when nothing in the cart collides', () => {
    const crit = { ...base, hideConflicts: true }
    expect(ids(filterCourses([conflicting], { ...crit, selectedTerms: ['any'] }, new Map(), []))).toEqual(['CS448B'])
  })

  const closed = course({
    id: 'CS999',
    sections: [{ term: 'Autumn 2026', component: 'LEC', status: 'Closed', units: '3', meetings: [MWF_1030] } as any],
  })

  it('hides a closed-only course under both an explicit term and "any"', () => {
    const crit = { ...base, hideUnavailable: true }
    expect(ids(filterCourses([closed], { ...crit, selectedTerms: ['Autumn 2026'] }, new Map(), []))).toEqual([])
    expect(ids(filterCourses([closed], { ...crit, selectedTerms: ['any'] }, new Map(), []))).toEqual([])
  })

  it('a course open in one term stays visible under "any" but not under the closed term', () => {
    const mixed = course({
      id: 'CS777',
      terms: ['Autumn 2026', 'Winter 2027'],
      sections: [
        { term: 'Autumn 2026', component: 'LEC', status: 'Closed', units: '3', meetings: [] } as any,
        { term: 'Winter 2027', component: 'LEC', status: 'Open', units: '3', meetings: [] } as any,
      ],
    })
    const crit = { ...base, hideUnavailable: true }
    expect(ids(filterCourses([mixed], { ...crit, selectedTerms: ['any'] }, new Map(), []))).toEqual(['CS777'])
    expect(ids(filterCourses([mixed], { ...crit, selectedTerms: ['Autumn 2026'] }, new Map(), []))).toEqual([])
    expect(ids(filterCourses([mixed], { ...crit, selectedTerms: ['Winter 2027'] }, new Map(), []))).toEqual(['CS777'])
  })

  it('sectionless courses are never hidden by either toggle', () => {
    const crit = { ...base, hideConflicts: true, hideUnavailable: true }
    const bare = course({ id: 'CS555', sections: [] })
    expect(ids(filterCourses([bare], { ...crit, selectedTerms: ['any'] }, new Map(), cart))).toEqual(['CS555'])
  })
})
