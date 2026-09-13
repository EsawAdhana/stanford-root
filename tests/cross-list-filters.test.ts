import { describe, expect, it } from 'vitest'
import { filterCourses, filterCoursesForFacets, type CourseFilterCriteria } from '@/lib/course-filter'
import { getCrossListPrimaryMap } from '@/lib/utils'
import type { Course, Section } from '@/types/course'

/**
 * One class, two listings: AA 228 (canonical, Autumn) and CS 238. Filters must match
 * the class if any of its listings matches, and the row rendered stays the canonical.
 */
const section = (over: Partial<{ term: string; status: string; component: string; time: string; days: string }> = {}) => ({
    term: over.term ?? 'Autumn 2026',
    classId: 1,
    sectionNumber: '1',
    component: over.component ?? 'LEC',
    status: over.status ?? 'Open',
    meetings: [{ days: over.days ?? 'Monday', time: over.time ?? '10:00 AM – 11:00 AM', location: 'TBA' }],
} as unknown as Section)

const course = (id: string, subject: string, code: string, title: string, over: Partial<Course> = {}): Course =>
    ({
        id, subject, code, title,
        grading: 'Letter (ABCD/NP)',
        units: '3',
        terms: ['Autumn 2026'],
        sections: [section()],
        ...over,
    }) as unknown as Course

const CRITERIA: CourseFilterCriteria = {
    excludedWords: [], selectedDepts: [], selectedTerms: [], selectedFormats: [],
    selectedLevels: [], selectedGers: [], selectedSchools: [], unitMin: 0, unitMax: 30,
    timeMin: 0, timeMax: 1440, hideConflicts: false, hideUnavailable: false,
    hideStudyAbroad: false, newOnly: false,
}

const run = (catalog: Course[], over: Partial<CourseFilterCriteria>) =>
    filterCourses(catalog, { ...CRITERIA, ...over }, getCrossListPrimaryMap(catalog), []).map(c => c.id)

describe('browse filters match on any listing of a cross-listed class', () => {
    const AA228 = course('AA228', 'AA', '228', 'Decision Making under Uncertainty (CS 238)')
    const CS238 = course('CS238', 'CS', '238', 'Decision Making under Uncertainty (AA 228)')
    const CS106A = course('CS106A', 'CS', '106A', 'Programming Methodology')
    const catalog = [AA228, CS238, CS106A]

    it('finds the class under a subject only its sibling is listed under', () => {
        expect(run(catalog, { selectedDepts: ['CS'] })).toEqual(['AA228', 'CS106A'])
    })

    it('still renders the canonical row, not the matching listing', () => {
        expect(run(catalog, { selectedDepts: ['CS'] })).not.toContain('CS238')
    })

    it('leaves an unrelated subject out', () => {
        expect(run(catalog, { selectedDepts: ['ME'] })).toEqual([])
    })

    it('matches a quarter only the sibling is offered in', () => {
        const winterSibling = course('ME350', 'ME', '350', 'Plasma Seminar (AA 296)', {
            terms: ['Autumn 2026', 'Winter 2027'],
            sections: [section(), section({ term: 'Winter 2027' })],
        })
        const canonical = course('AA296', 'AA', '296', 'Plasma Seminar (ME 350)')
        const cat = [canonical, winterSibling]
        expect(run(cat, { selectedTerms: ['Winter 2027'] })).toEqual(['AA296'])
    })

    it('matches a grad-only listing under a graduate class-level filter', () => {
        expect(run(catalog, { selectedLevels: ['Graduate'] })).toContain('AA228')
    })

    it('keeps a class whose sibling still has an open section', () => {
        const closedCanonical = course('CS227A', 'CS', '227A', 'Music (EE 227)', { sections: [section({ status: 'Closed' })] })
        const openSibling = course('EE227', 'EE', '227', 'Music (CS 227A)')
        expect(run([closedCanonical, openSibling], { hideUnavailable: true })).toEqual(['CS227A'])
    })

    it('hides a class whose every listing is closed', () => {
        const a = course('CS227A', 'CS', '227A', 'Music (EE 227)', { sections: [section({ status: 'Closed' })] })
        const b = course('EE227', 'EE', '227', 'Music (CS 227A)', { sections: [section({ status: 'Closed' })] })
        expect(run([a, b], { hideUnavailable: true })).toEqual([])
    })

    it('keeps hide rules as hide rules: an excluded keyword on any listing still hides it', () => {
        expect(run(catalog, { excludedWords: ['uncertainty'] })).toEqual(['CS106A'])
    })

    it('counts the class once per facet, under the sibling subject too', () => {
        const counts = filterCoursesForFacets(catalog, { ...CRITERIA, selectedDepts: ['CS'] }, getCrossListPrimaryMap(catalog), [])
        expect(counts.depts.map(c => c.id).sort()).toEqual(['AA228', 'CS106A'])
    })
})
