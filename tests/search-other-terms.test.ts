import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { applyQuery } from '@/hooks/use-filtered-courses'
import { filterCourses, type CourseFilterCriteria } from '@/lib/course-filter'
import { rowToCourse } from '@/lib/course-mapper'
import { findInOtherTerms, joinTerms, type OtherTermsMatch } from '@/lib/other-terms'
import { getCrossListPrimaryMap } from '@/lib/utils'
import type { Course, Section } from '@/types/course'

/**
 * Searching "cs229" on a fresh Autumn visit said "No courses match your search"
 * although CS 229 runs in Winter and Spring. These run the committed light
 * catalog, which is what the list renders first.
 */
const rows = JSON.parse(fs.readFileSync('data/catalog/light.json', 'utf8'))
const catalog: Course[] = rows.map(rowToCourse)
const pm = getCrossListPrimaryMap(catalog)
const AUTUMN = 'Autumn 2026'
// Mid-November 2026: Autumn is the calendar quarter.
const NOW = new Date(2026, 10, 11)

const CRITERIA: CourseFilterCriteria = {
    excludedWords: [], selectedDepts: [], selectedTerms: [AUTUMN], selectedFormats: [],
    selectedLevels: [], selectedGers: [], selectedSchools: [], unitMin: 1, unitMax: 5,
    timeMin: 420, timeMax: 1320, hideConflicts: false, hideUnavailable: false,
    hideStudyAbroad: false, newOnly: false,
}
const pmOf = (list: Course[]) => (list === catalog ? pm : getCrossListPrimaryMap(list))
const inView = (query: string, over: Partial<CourseFilterCriteria> = {}, list = catalog) =>
    applyQuery(filterCourses(list, { ...CRITERIA, ...over }, pmOf(list), []), query, pmOf(list))
const other = (query: string, over: Partial<CourseFilterCriteria> = {}, list = catalog, now = NOW): OtherTermsMatch | null =>
    findInOtherTerms(list, { ...CRITERIA, ...over }, pmOf(list), [], query, applyQuery, now)
const termsOf = (id: string) => catalog.find(c => c.id === id)!.terms!

describe('a single class offered only in other quarters', () => {
    it('cs229 names CS 229 and goes to its soonest quarter', () => {
        expect(inView('cs229')).toHaveLength(0)
        const m = other('cs229')
        expect(m?.kind).toBe('one')
        if (m?.kind !== 'one') return
        expect(m.label).toBe('CS 229')
        expect(m.offeredTerms).toEqual(termsOf('CS229'))
        expect(m.offeredTerms).toEqual(['Winter 2027', 'Spring 2027'])
        expect(m.target).toEqual(['Winter 2027'])
        // The button's promise: the class is in the list it lands on.
        expect(inView('cs229', { selectedTerms: m.target }).map(c => c.id)).toEqual(['CS229'])
    })

    it('"cs 224n" finds the cross-listed class under the code the list shows', () => {
        expect(inView('cs 224n')).toHaveLength(0)
        const m = other('cs 224n')
        expect(m?.kind).toBe('one')
        if (m?.kind !== 'one') return
        expect(m.label).toBe('CS 224N')
        expect(m.target).toEqual(['Winter 2027'])
        expect(inView('cs 224n', { selectedTerms: m.target }).map(c => c.id)).toEqual(['CS224N'])
    })
})

describe('several classes in other quarters', () => {
    it('cs161 counts CS 161 and CS 161ACE, exactly what Show all quarters shows', () => {
        expect(inView('cs161')).toHaveLength(0)
        const anyTerm = inView('cs161', { selectedTerms: ['any'] })
        expect(anyTerm.map(c => c.id).sort()).toEqual(['CS161', 'CS161ACE'])
        expect(other('cs161')).toEqual({ kind: 'many', count: 2 })
    })

    it('counts with the other filters still applied', () => {
        // CS 161ACE is 1 unit, so a 3+ unit range leaves CS 161 alone: the single-class case.
        expect(inView('cs161', { unitMin: 3, selectedTerms: ['any'] }).map(c => c.id)).toEqual(['CS161'])
        const m = other('cs161', { unitMin: 3 })
        expect(m?.kind === 'one' && [m.label, m.target]).toEqual(['CS 161', ['Winter 2027']])
    })
})

describe('when there is nothing to offer', () => {
    it('a nonsense query matches nowhere', () => {
        expect(inView('zzqxv nonsense 9999')).toHaveLength(0)
        expect(other('zzqxv nonsense 9999')).toBeNull()
    })

    it('a query that matches in the selected quarter is never empty, so the hook never asks', () => {
        expect(inView('cs106a').length).toBeGreaterThan(0)
    })

    it('does nothing when the term filter is already off', () => {
        expect(other('cs229', { selectedTerms: ['any'] })).toBeNull()
    })

    it('keeps every other filter: a department that excludes the class finds nothing', () => {
        expect(other('cs229', { selectedDepts: ['MATH'] })).toBeNull()
    })
})

describe('several selected quarters', () => {
    it('lists only quarters outside the selection', () => {
        const m = other('cs229', { selectedTerms: [AUTUMN, 'Summer 2027'] })
        expect(m?.kind).toBe('one')
        if (m?.kind !== 'one') return
        expect(m.offeredTerms).toEqual(['Winter 2027', 'Spring 2027'])
    })

    it('joins quarter names the way a sentence reads', () => {
        expect(joinTerms(['Autumn 2026'], 'or')).toBe('Autumn 2026')
        expect(joinTerms(['Autumn 2026', 'Summer 2027'], 'or')).toBe('Autumn 2026 or Summer 2027')
        expect(joinTerms(['Winter 2027', 'Spring 2027', 'Summer 2027'], 'and')).toBe('Winter 2027, Spring 2027 and Summer 2027')
    })
})

/**
 * Hide closed & waitlisted with the term filter off asks "open in SOME quarter".
 * A class full in Winter and open in Spring passes that, so the button must
 * skip Winter, where it would land on an empty list again.
 */
const section = (over: Partial<Section> = {}): Section => ({
    term: 'Winter 2027', classId: 1, sectionNumber: '1', component: 'LEC', units: 4, grading: 'Letter',
    instructionalMode: '', status: 'Open', enrolled: 0, capacity: 50, waitlist: 0, waitlistMax: 0,
    startDate: '', endDate: '', meetings: [], ...over,
})
const course = (id: string, subject: string, code: string, sections: Section[]): Course =>
    ({ id, subject, code, title: 'Test class', description: '', grading: 'Letter', units: '4', instructors: [], terms: [...new Set(sections.map(s => s.term))], sections }) as unknown as Course

describe('per-quarter meaning of the hide toggles', () => {
    const tiny = [
        course('TEST101', 'TEST', '101', [
            section({ term: 'Winter 2027', classId: 1, status: 'Closed', enrolled: 50 }),
            section({ term: 'Spring 2027', classId: 2 }),
        ]),
        course('OTHER1', 'OTHER', '1', [section({ term: AUTUMN, classId: 3 })]),
    ]

    it('picks the soonest quarter the class actually shows in', () => {
        const m = other('test101', { hideUnavailable: true }, tiny)
        expect(m?.kind).toBe('one')
        if (m?.kind !== 'one') return
        expect(m.offeredTerms).toEqual(['Winter 2027', 'Spring 2027'])
        expect(m.target).toEqual(['Spring 2027'])
        expect(inView('test101', { hideUnavailable: true, selectedTerms: m.target }, tiny)).toHaveLength(1)
    })

    it('goes to the soonest quarter when nothing hides it', () => {
        const m = other('test101', {}, tiny)
        expect(m?.kind === 'one' && m.target).toEqual(['Winter 2027'])
    })

    it('skips a past quarter for the soonest upcoming one', () => {
        const past = [course('OLD1', 'OLD', '1', [
            section({ term: 'Spring 2026', classId: 4 }),
            section({ term: 'Spring 2027', classId: 5 }),
        ]), ...tiny]
        const m = other('old1', {}, past)
        expect(m?.kind === 'one' && m.target).toEqual(['Spring 2027'])
    })

    it('turns the term filter off when no single quarter shows the class', () => {
        // Open only in Winter, starts inside the time window only in Spring.
        const split = [course('SPLIT1', 'SPLIT', '1', [
            section({ term: 'Winter 2027', classId: 6, meetings: [{ days: 'Mon', time: '7:00 AM - 8:00 AM' }] as never }),
            section({ term: 'Spring 2027', classId: 7, status: 'Closed', meetings: [{ days: 'Mon', time: '3:00 PM - 4:00 PM' }] as never }),
        ]), ...tiny]
        const over = { hideUnavailable: true, timeMin: 600 }
        expect(inView('split1', { ...over, selectedTerms: ['Winter 2027'] }, split)).toHaveLength(0)
        expect(inView('split1', { ...over, selectedTerms: ['Spring 2027'] }, split)).toHaveLength(0)
        const m = other('split1', over, split)
        expect(m?.kind).toBe('one')
        if (m?.kind !== 'one') return
        expect(m.target).toEqual(['any'])
        expect(inView('split1', { ...over, selectedTerms: ['any'] }, split)).toHaveLength(1)
    })
})
