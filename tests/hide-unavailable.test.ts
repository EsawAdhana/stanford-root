import { describe, expect, it } from 'vitest'
import { filterCourses, type CourseFilterCriteria } from '@/lib/course-filter'
import { getCrossListPrimaryMap } from '@/lib/utils'
import type { Course, Section } from '@/types/course'

/**
 * "Hide closed & waitlisted" used to keep a class if ANY of its sections read
 * "Open". Reproduced from the real Autumn 2026 dump: CS 140M's lecture is Closed,
 * and its cross-listing EE 186 has a lecture Navigator flags "Open" with 17
 * waitlisted (the combined section is 50/50) plus a 999-seat lab that is always
 * "Open". The lab alone kept the class in the list.
 */
const section = (over: Partial<Section> = {}): Section => ({
    term: 'Autumn 2026',
    classId: 1,
    sectionNumber: '01',
    component: 'LEC',
    status: 'Open',
    enrolled: 0,
    capacity: 50,
    waitlist: 0,
    waitlistMax: 0,
    meetings: [],
    ...over,
} as Section)

const course = (id: string, subject: string, code: string, title: string, sections: Section[]): Course =>
    ({
        id, subject, code, title,
        grading: 'Letter (ABCD/NP)',
        units: '4',
        terms: [...new Set(sections.map(s => s.term))],
        sections,
    }) as unknown as Course

const CRITERIA: CourseFilterCriteria = {
    excludedWords: [], selectedDepts: [], selectedTerms: [], selectedFormats: [],
    selectedLevels: [], selectedGers: [], selectedSchools: [], unitMin: 0, unitMax: 30,
    timeMin: 0, timeMax: 1440, hideConflicts: false, hideUnavailable: true,
    hideStudyAbroad: false, newOnly: false,
}

const run = (catalog: Course[], over: Partial<CourseFilterCriteria> = {}) =>
    filterCourses(catalog, { ...CRITERIA, ...over }, getCrossListPrimaryMap(catalog), []).map(c => c.id)

const one = (sections: Section[]) => [course('CS999', 'CS', '999', 'Test Class', sections)]

describe('hide closed & waitlisted', () => {
    it('hides CS 140M / EE 186 as they sit in the real dump', () => {
        const cs = course('CS140M', 'CS', '140M', 'Introduction to Embedded Systems (EE 186)', [
            section({ classId: 28402, status: 'Closed', enrolled: 10, capacity: 30 }),
        ])
        const ee = course('EE186', 'EE', '186', 'Introduction to Embedded Systems (CS 140M)', [
            section({ classId: 6325, status: 'Open', enrolled: 40, capacity: 50, waitlist: 17, waitlistMax: 50 }),
            section({ classId: 6324, component: 'LBS', status: 'Open', enrolled: 35, capacity: 999 }),
        ])
        expect(run([cs, ee], { selectedTerms: ['Autumn 2026'] })).toEqual([])
        expect(run([cs, ee])).toEqual([])
    })

    it('hides a class whose lecture is closed even though its lab is open', () => {
        expect(run(one([section({ status: 'Closed' }), section({ component: 'LBS' })]))).toEqual([])
    })

    it('hides a section flagged Open whose waitlist is at least the seats left: CS 312 at 96/99 with 85 waiting', () => {
        expect(run(one([section({ enrolled: 96, capacity: 99, waitlist: 85, waitlistMax: 100 })]))).toEqual([])
        expect(run(one([section({ enrolled: 47, capacity: 50, waitlist: 3, waitlistMax: 20 })]))).toEqual([])
    })

    it('keeps a class with seats and a short line: EARTHSYS 10 at 163/300 with one waiting', () => {
        expect(run(one([section({ enrolled: 163, capacity: 300, waitlist: 1, waitlistMax: 50 })]))).toEqual(['CS999'])
        expect(run(one([section({ enrolled: 47, capacity: 50, waitlist: 2, waitlistMax: 20 })]))).toEqual(['CS999'])
    })

    it('hides a section flagged Open that is already full or over', () => {
        expect(run(one([section({ enrolled: 50, capacity: 50 })]))).toEqual([])
        expect(run(one([section({ enrolled: 52, capacity: 50 })]))).toEqual([])
    })

    it('lets the status decide when the cap is missing', () => {
        expect(run(one([section({ enrolled: 4, capacity: 0, waitlist: 2 })]))).toEqual(['CS999'])
        expect(run(one([section({ enrolled: 4, capacity: 0, status: 'Closed' })]))).toEqual([])
    })

    it('keeps a class whose lecture and lab are both open', () => {
        expect(run(one([section(), section({ component: 'LBS' })]))).toEqual(['CS999'])
    })

    it('keeps a class with one closed and one open lecture section', () => {
        expect(run(one([section({ status: 'Closed' }), section({ sectionNumber: '02' })]))).toEqual(['CS999'])
    })

    it('keeps a class with an open lecture and one open discussion out of several', () => {
        expect(run(one([
            section(),
            section({ component: 'DIS', status: 'Closed' }),
            section({ component: 'DIS', sectionNumber: '02' }),
        ]))).toEqual(['CS999'])
    })

    it('hides a class whose only discussion sections are all full', () => {
        expect(run(one([section(), section({ component: 'DIS', status: 'Closed' })]))).toEqual([])
    })

    it('does not pair an open lab in one term with an open lecture in another', () => {
        const sections = [
            section({ term: 'Autumn 2026' }),
            section({ term: 'Autumn 2026', component: 'LBS', status: 'Closed' }),
            section({ term: 'Winter 2027', status: 'Closed' }),
            section({ term: 'Winter 2027', component: 'LBS' }),
        ]
        expect(run(one(sections))).toEqual([])
    })

    it('keeps a class fully open in one term under "any" but not under the closed term', () => {
        const sections = [
            section({ term: 'Autumn 2026', status: 'Closed' }),
            section({ term: 'Autumn 2026', component: 'LBS' }),
            section({ term: 'Winter 2027' }),
            section({ term: 'Winter 2027', component: 'LBS' }),
        ]
        expect(run(one(sections))).toEqual(['CS999'])
        expect(run(one(sections), { selectedTerms: ['any'] })).toEqual(['CS999'])
        expect(run(one(sections), { selectedTerms: ['Autumn 2026'] })).toEqual([])
        expect(run(one(sections), { selectedTerms: ['Winter 2027'] })).toEqual(['CS999'])
    })

    it('treats a missing waitlist count as no waitlist', () => {
        expect(run(one([section({ waitlist: undefined as unknown as number })]))).toEqual(['CS999'])
    })

    it('still matches status case-insensitively', () => {
        expect(run(one([section({ status: 'OPEN' })]))).toEqual(['CS999'])
    })

    it('keeps a class with no sections, as before', () => {
        expect(run(one([]))).toEqual(['CS999'])
    })
})
