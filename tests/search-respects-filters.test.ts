import { describe, expect, it } from 'vitest'
import { applyQuery } from '@/hooks/use-filtered-courses'
import { filterCourses, needsSections, type CourseFilterCriteria } from '@/lib/course-filter'
import { getCrossListPrimaryMap } from '@/lib/utils'
import type { Course, Section } from '@/types/course'

/**
 * Reproduced in the browser: with Hide closed & waitlisted on, searching
 * "CS 140M" found nothing but searching "EE 186" showed CS 140M, because the
 * search pulled the main listing back from the full catalog when a filter had
 * removed it.
 */
const section = (over: Partial<Section> = {}): Section => ({
    term: 'Autumn 2026', classId: 1, sectionNumber: '1', component: 'LEC', units: 4, grading: 'Letter',
    instructionalMode: '', status: 'Open', enrolled: 0, capacity: 50, waitlist: 0, waitlistMax: 0,
    startDate: '', endDate: '', meetings: [], ...over,
})
const course = (id: string, subject: string, code: string, title: string, sections: Section[]): Course =>
    ({ id, subject, code, title, description: '', grading: 'Letter', units: '4', instructors: [], terms: [...new Set(sections.map(s => s.term))], sections }) as unknown as Course

const room = { enrolled: 50, capacity: 50, waitlist: 24, waitlistMax: 50 }
const catalog = [
    course('CS140M', 'CS', '140M', 'Introduction to Embedded Systems (EE 186)', [section({ classId: 28402, status: 'Closed', enrolled: 11, capacity: 30, combined: room })]),
    course('EE186', 'EE', '186', 'Introduction to Embedded Systems (CS 140M)', [section({ classId: 6325, enrolled: 39, waitlist: 24, combined: room })]),
    course('AA228', 'AA', '228', 'Decision Making under Uncertainty (CS 238)', [section({ classId: 2061 })]),
    course('CS238', 'CS', '238', 'Decision Making under Uncertainty (AA 228)', [section({ classId: 2062, status: 'Closed' })]),
]
const pm = getCrossListPrimaryMap(catalog)
const CRITERIA: CourseFilterCriteria = {
    excludedWords: [], selectedDepts: [], selectedTerms: ['Autumn 2026'], selectedFormats: [],
    selectedLevels: [], selectedGers: [], selectedSchools: [], unitMin: 0, unitMax: 30,
    timeMin: 0, timeMax: 1440, hideConflicts: false, hideUnavailable: false,
    hideStudyAbroad: false, newOnly: false,
}
const search = (query: string, over: Partial<CourseFilterCriteria> = {}) =>
    applyQuery(filterCourses(catalog, { ...CRITERIA, ...over }, pm, []), query, pm).map(c => c.id)

describe('searching a cross-listed code', () => {
    it('finds the class under either code when nothing hides it', () => {
        expect(search('EE 186')).toEqual(['CS140M'])
        expect(search('CS 140M')).toEqual(['CS140M'])
        expect(search('cs 238')).toEqual(['AA228'])
    })

    it('hides it under either code when Hide closed & waitlisted is on', () => {
        expect(search('CS 140M', { hideUnavailable: true })).toEqual([])
        expect(search('EE 186', { hideUnavailable: true })).toEqual([])
        expect(search('ee186', { hideUnavailable: true })).toEqual([])
    })

    it('keeps an open class found by its closed sibling code', () => {
        expect(search('CS 238', { hideUnavailable: true })).toEqual(['AA228'])
    })

    it('does not bring back a class from a term that is not selected', () => {
        expect(search('EE 186', { selectedTerms: ['Winter 2027'] })).toEqual([])
    })
})

describe('holding the list until sections arrive', () => {
    const none = { selectedFormats: [], selectedGers: [], timeMin: 420, timeMax: 1320, hideConflicts: false, hideUnavailable: false }

    it('waits when a filter that reads sections is on', () => {
        expect(needsSections({ ...none, hideUnavailable: true })).toBe(true)
        expect(needsSections({ ...none, hideConflicts: true })).toBe(true)
        expect(needsSections({ ...none, selectedFormats: ['LEC'] })).toBe(true)
        expect(needsSections({ ...none, selectedGers: ['WAY-FR'] })).toBe(true)
        expect(needsSections({ ...none, timeMin: 600 })).toBe(true)
        expect(needsSections({ ...none, timeMax: 1080 })).toBe(true)
    })

    it('does not wait on a fresh load, where every toggle is off', () => {
        expect(needsSections(none)).toBe(false)
    })

    it('shows every course passing "Hide closed" without sections, which is why it has to wait', () => {
        const light = catalog.map(c => ({ ...c, sections: [] }))
        const lightPm = getCrossListPrimaryMap(light)
        expect(filterCourses(light, { ...CRITERIA, hideUnavailable: true }, lightPm, []).map(c => c.id)).toContain('CS140M')
    })
})
