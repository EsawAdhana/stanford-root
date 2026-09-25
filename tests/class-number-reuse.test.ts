import { beforeEach, describe, expect, it } from 'vitest'
import { buildCourses } from '../scripts/navigator-catalog.mjs'
import { useCartStore } from '@/lib/cart-store'
import { useCourseStore } from '@/lib/store'
import { findAffectedSchedule } from '@/lib/unresolved-schedule'
import type { Course, Section } from '@/types/course'

/**
 * Class numbers are per term, and reused inside one course: MATH 53's 9:30
 * Autumn lecture and its 10:30 Spring lecture are both #7154 in 2026-2027.
 * The scraper keyed sections on the number alone and dropped the Spring
 * lecture, along with 3,983 other sections of the year.
 */
const hit = (termOffered: string, strm: string, classNbr: number, startTime: string) => ({
    subject: 'MATH', catalogNbr: '53', courseTitle: 'Differential Equations', crseId: '1',
    termOffered, strm, classNbr, classSection: '01', componentPrimary: 'LEC', components: ['Lecture'],
    units: [5], gradingBasisDescr: 'Letter', enrlCap: 167, enrlTot: 0, waitCap: 0, waitTot: 0,
    enrlStatDescr: 'Open', meetings: [{ daysOfWeekList: ['Monday', 'Wednesday', 'Friday'], startTime, endTime: '11:20 AM' }],
})

describe('the scraper keeps a class number reused in another term', () => {
    it('keeps both MATH 53 lectures numbered 7154', () => {
        const [math53] = buildCourses([
            hit('Autumn 2026', '1272', 7154, '9:30 AM'),
            hit('Spring 2027', '1276', 7033, '9:30 AM'),
            hit('Spring 2027', '1276', 7154, '10:30 AM'),
        ], new Map(), {})
        expect(math53.sections.map((s: Section) => `${s.term} #${s.classId}`)).toEqual([
            'Autumn 2026 #7154', 'Spring 2027 #7033', 'Spring 2027 #7154',
        ])
    })

    it('still drops a class returned twice in the same term', () => {
        const [math53] = buildCourses([hit('Spring 2027', '1276', 7154, '10:30 AM'), hit('Spring 2027', '1276', 7154, '10:30 AM')], new Map(), {})
        expect(math53.sections).toHaveLength(1)
    })
})

const section = (term: string, classId: number, component = 'LEC'): Section =>
    ({ term, classId, sectionNumber: '1', component, status: 'Open', units: 5, meetings: [] }) as unknown as Section
const MATH53 = {
    id: 'MATH53', subject: 'MATH', code: '53', title: 'Differential Equations', units: '5', grading: 'Letter',
    terms: ['Autumn 2026', 'Spring 2027'],
    sections: [section('Autumn 2026', 7154), section('Autumn 2026', 7399), section('Spring 2027', 7033), section('Spring 2027', 7154)],
} as unknown as Course

describe('picking a section when its number exists in another term too', () => {
    beforeEach(() => {
        useCourseStore.setState({ courses: [MATH53] })
        useCartStore.setState({ items: [] })
    })

    it('replaces the Spring lecture pick instead of keeping two lectures', () => {
        useCartStore.getState().addItem(MATH53, 'Spring 2027', 7033)
        useCartStore.getState().addItem(MATH53, 'Spring 2027', 7154)
        expect(useCartStore.getState().items[0].selectedSectionIds).toEqual([7154])
    })

    it('does the same in Autumn', () => {
        useCartStore.getState().addItem(MATH53, 'Autumn 2026', 7399)
        useCartStore.getState().addItem(MATH53, 'Autumn 2026', 7154)
        expect(useCartStore.getState().items[0].selectedSectionIds).toEqual([7154])
    })
})

describe('noticing a saved pick that moved', () => {
    it('flags a Spring pick whose number only exists in Autumn now', () => {
        const withoutSpring7154 = { ...MATH53, sections: MATH53.sections!.filter(s => !(s.term === 'Spring 2027' && s.classId === 7154)) }
        const saved = [{ id: 'MATH53', subject: 'MATH', code: '53', selectedTerm: 'Spring 2027', selectedSectionIds: [7154] }]
        expect(findAffectedSchedule(saved, [withoutSpring7154], []).movedSections).toEqual(['MATH 53'])
    })

    it('does not flag a pick that is still there', () => {
        const saved = [{ id: 'MATH53', subject: 'MATH', code: '53', selectedTerm: 'Spring 2027', selectedSectionIds: [7154] }]
        expect(findAffectedSchedule(saved, [MATH53], []).movedSections).toEqual([])
    })
})
