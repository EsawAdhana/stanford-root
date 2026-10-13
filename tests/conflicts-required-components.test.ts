import { describe, expect, it } from 'vitest'
import { filterCourses, type CourseFilterCriteria } from '@/lib/course-filter'
import { getCrossListPrimaryMap } from '@/lib/utils'
import type { Course, Section } from '@/types/course'
import type { CartItem } from '@/lib/cart-store'

/**
 * "Hide conflicting classes" has to clear every component a class requires, not
 * just one section. With CS 210A (Tue/Thu 1:30-2:50 PM) on the schedule, AI 360
 * still showed in Winter 2027: its lecture sits on the same Tue/Thu 1:30, but its
 * discussion sections have no listed time, and "any section fits" counted one of
 * those as a way in. LINGUIST 120A and ENGLISH 160 slipped through the same way.
 */

const TTH_130 = { days: 'Tuesday, Thursday', time: '1:30 PM – 2:50 PM' }
const MW_1030 = { days: 'Monday, Wednesday', time: '10:30 AM – 11:50 AM' }
const F_1030 = { days: 'Friday', time: '10:30 AM – 11:20 AM' }
const TBA = { days: undefined, time: undefined }
const WINTER = 'Winter 2027'

let classId = 1
const sec = (component: string, meeting: { days?: string; time?: string }, term = WINTER) => ({
  term, classId: classId++, sectionNumber: String(classId), component, status: 'Open',
  units: '3', meetings: [{ ...meeting, location: 'TBA' }],
} as unknown as Section)

const course = (id: string, sections: Section[], over: Partial<Course> = {}): Course => ({
  id, subject: id.replace(/[0-9].*$/, ''), code: id.replace(/^[A-Z&]+/, ''), title: id,
  description: '', units: '3', grading: 'Letter', instructors: [], terms: [WINTER],
  sections, ...over,
}) as unknown as Course

const CS210A: CartItem = { ...course('CS210A', [sec('LEC', TTH_130)]), selectedTerm: WINTER }

const CRITERIA: CourseFilterCriteria = {
  excludedWords: [], selectedDepts: [], selectedTerms: [WINTER], selectedFormats: [],
  selectedLevels: [], selectedGers: [], selectedSchools: [], unitMin: 0, unitMax: 30,
  timeMin: 0, timeMax: 1440, hideConflicts: true, hideUnavailable: false,
  hideStudyAbroad: false, newOnly: false,
}

const shown = (catalog: Course[], cart: CartItem[] = [CS210A]) =>
  filterCourses(catalog, CRITERIA, getCrossListPrimaryMap(catalog), cart).map(c => c.id)

describe('hide conflicting classes checks every required component', () => {
  it('hides a class whose only lecture clashes, even with a discussion at no listed time', () => {
    const ai360 = course('AFRICAAM106C', [sec('LEC', TTH_130), sec('DIS', TBA)])
    expect(shown([ai360])).toEqual([])
  })

  it('hides a class whose lecture clashes even when a discussion has a free time', () => {
    const c = course('LINGUIST120A', [sec('LEC', TTH_130), sec('DIS', F_1030)])
    expect(shown([c])).toEqual([])
  })

  it('hides it when every discussion clashes, though the lecture is free', () => {
    const c = course('ECON1', [sec('LEC', MW_1030), sec('DIS', TTH_130), sec('DIS', TTH_130)])
    expect(shown([c])).toEqual([])
  })

  it('keeps a class whose lecture is free and whose discussion has no listed time', () => {
    const c = course('CS161', [sec('LEC', MW_1030), sec('DIS', TBA)])
    expect(shown([c])).toEqual(['CS161'])
  })

  it('keeps a class with a second lecture that fits', () => {
    const c = course('MATH51', [sec('LEC', TTH_130), sec('LEC', MW_1030), sec('DIS', TBA)])
    expect(shown([c])).toEqual(['MATH51'])
  })

  it('keeps a class when one of its discussions fits', () => {
    const c = course('ECON51', [sec('LEC', MW_1030), sec('DIS', TTH_130), sec('DIS', F_1030)])
    expect(shown([c])).toEqual(['ECON51'])
  })

  it('keeps a class with no listed times at all', () => {
    const c = course('CS199', [sec('INS', TBA)])
    expect(shown([c])).toEqual(['CS199'])
  })

  it('ignores a clash in another term', () => {
    const c = course('CS168', [sec('LEC', TTH_130, 'Spring 2027'), sec('LEC', MW_1030)],
      { terms: [WINTER, 'Spring 2027'] })
    expect(shown([c])).toEqual(['CS168'])
  })

  it('keeps everything when nothing is scheduled', () => {
    const ai360 = course('AFRICAAM106C', [sec('LEC', TTH_130), sec('DIS', TBA)])
    expect(shown([ai360], [])).toEqual(['AFRICAAM106C'])
  })

  it('does not count a class as clashing with its own scheduled listing', () => {
    const ai360 = course('AFRICAAM106C', [sec('LEC', TTH_130), sec('DIS', TBA)],
      { title: "AI 360: What's Critical to Know about AI (AMSTUD 106B)" })
    const amstud = course('AMSTUD106B', [sec('LEC', TTH_130)],
      { title: "AI 360: What's Critical to Know about AI (AFRICAAM 106C)" })
    const scheduled: CartItem = { ...amstud, selectedTerm: WINTER }
    expect(shown([ai360, amstud], [scheduled])).toEqual(['AFRICAAM106C'])
  })

  it('hides every listing of a cross-listed class whose lecture clashes', () => {
    const titled = (others: string) => ({ title: `AI 360: What's Critical to Know about AI (${others})` })
    const catalog = [
      course('AFRICAAM106C', [sec('LEC', TTH_130), sec('DIS', TBA)], titled('AMSTUD 106B, ARTHIST 168A')),
      course('AMSTUD106B', [sec('LEC', TTH_130)], titled('AFRICAAM 106C, ARTHIST 168A')),
      course('ARTHIST168A', [sec('LEC', TTH_130), sec('DIS', TBA), sec('DIS', TBA)], titled('AFRICAAM 106C, AMSTUD 106B')),
    ]
    expect(shown(catalog)).toEqual([])
  })
})
