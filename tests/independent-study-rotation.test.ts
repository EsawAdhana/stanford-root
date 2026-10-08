import { describe, expect, it } from 'vitest'
import { restingIndependentStudy, rotationToday, withRestingSections } from '../scripts/navigator-catalog.mjs'

/**
 * Independent-study listings are read one day in seven and carried from the
 * last dump on the others. These are the ways that could quietly lose a
 * listing, resurrect a cancelled class, or write the dump's extra fields back.
 */
const YEAR = ['Autumn 2026', 'Winter 2027', 'Spring 2027', 'Summer 2027']
const meeting = (who: string) => ({ instructors: [who] })
const ins = (term: string, classId: number, who: string, units = '1-5') =>
    ({ term, classId, component: 'INS', units, status: 'Open', enrolled: 0, capacity: 5, waitlist: 0, waitlistMax: 0, meetings: [meeting(who)] })
const lecture = (term: string, classId: number, who: string) =>
    ({ term, classId, component: 'LEC', units: '3', status: 'Open', enrolled: 10, capacity: 40, waitlist: 0, waitlistMax: 0, meetings: [meeting(who)] })

const previous = [
    {
        course_id: 'SYMSYS190', subject: 'SYMSYS', code: '190', title: 'Senior Honors Tutorial', description: 'd', units: '1-5', grading: 'Letter',
        instructors: ['Duncan, Laramie', 'Old, Lecturer'], terms: ['Autumn 2026', 'Winter 2027'],
        sections: [ins('Autumn 2026', 11327, 'Duncan, Laramie'), lecture('Winter 2027', 4000, 'Old, Lecturer'), ins('Autumn 2025', 9, 'Gone, Long')],
        // Fields dump-catalog adds, which a carried row must not write back.
        quality: 4.2, hours: 6, isNew: false,
    },
    {
        course_id: 'CS106A', subject: 'CS', code: '106A', title: 'Programming Methodology', description: 'd', units: '3-5', grading: 'Letter',
        instructors: ['Parlante, Nick', 'Lee, Ada'], terms: ['Autumn 2026'],
        sections: [lecture('Autumn 2026', 1801, 'Parlante, Nick'), ins('Autumn 2026', 29000, 'Lee, Ada', '1-2'), { ...ins('Autumn 2026', 1834, 'TA, Some'), units: '' }],
    },
]

const restDays = (courseId: string) =>
    Array.from({ length: 7 }, (_, day) => restingIndependentStudy(previous.filter(c => c.course_id === courseId), YEAR, day).size > 0)

describe('which independent-study sections rest today', () => {
    it('rests a course six days in seven, and reads it on the seventh', () => {
        for (const id of ['SYMSYS190', 'CS106A']) expect(restDays(id).filter(Boolean)).toHaveLength(6)
    })

    it('rests only this year\'s primary INS sections, keyed like the record reads', () => {
        const day = restDays('SYMSYS190').indexOf(true)
        const resting = restingIndependentStudy(previous, YEAR, day)
        expect([...resting.keys()].filter(k => resting.get(k)!.course.course_id === 'SYMSYS190')).toEqual(['1272|11327'])
        // CS 106A's discussion has no units: it is a related section, never read on its own.
        expect([...resting.keys()]).not.toContain('1272|1834')
        expect([...resting.keys()]).not.toContain('1272|1801')
    })

    it('moves with the date', () => {
        expect(rotationToday(new Date('2026-10-08T14:00:00Z'))).not.toBe(rotationToday(new Date('2026-10-09T14:00:00Z')))
        expect(rotationToday(new Date('2026-10-08T00:00:01Z'))).toBe(rotationToday(new Date('2026-10-08T23:59:59Z')))
    })
})

describe('putting resting sections back', () => {
    const everyDayRests = () => {
        const all = new Map()
        for (let day = 0; day < 7; day++) for (const [k, v] of restingIndependentStudy(previous, YEAR, day)) all.set(k, v)
        return all
    }

    it('appends them to a course read today, widening its units, instructors and terms', () => {
        const built = [{ course_id: 'CS106A', subject: 'CS', code: '106A', title: 'Programming Methodology', description: 'd', units: '3', grading: 'Letter',
            instructors: ['Parlante, Nick'], terms: ['Autumn 2026'], sections: [lecture('Autumn 2026', 1801, 'Parlante, Nick')] }]
        const { carriedSections, carriedCourses } = withRestingSections(built, everyDayRests())
        const cs = built.find(c => c.course_id === 'CS106A')!
        expect(cs.sections.map(s => s.classId)).toEqual([1801, 29000])
        expect(cs.units).toBe('1-3')
        expect(cs.instructors).toEqual(['Parlante, Nick', 'Lee, Ada'])
        expect(carriedSections).toBe(2)
        expect(carriedCourses).toBe(1)
    })

    it('brings back a course with nothing read today as only its resting sections and the fields the scrape writes', () => {
        const built: Record<string, unknown>[] = []
        withRestingSections(built, everyDayRests())
        const symsys = built.find(c => c.course_id === 'SYMSYS190')!
        expect(Object.keys(symsys).sort()).toEqual(['code', 'course_id', 'description', 'grading', 'instructors', 'sections', 'subject', 'terms', 'title', 'units'])
        // The Winter lecture was not read today, so it was cancelled; it does not come back.
        expect((symsys.sections as { classId: number }[]).map(s => s.classId)).toEqual([11327])
        expect(symsys.terms).toEqual(['Autumn 2026'])
        expect(symsys.instructors).toEqual(['Duncan, Laramie'])
    })

    it('does not add a section twice when it was read today anyway', () => {
        const built = [{ course_id: 'SYMSYS190', subject: 'SYMSYS', code: '190', title: 't', description: 'd', units: '1-5', grading: 'Letter',
            instructors: ['de Lecea, Luis'], terms: ['Autumn 2026'], sections: [ins('Autumn 2026', 11327, 'de Lecea, Luis')] }]
        const { carriedSections } = withRestingSections(built, everyDayRests())
        expect(built[0].sections).toHaveLength(1)
        expect(built[0].instructors).toEqual(['de Lecea, Luis'])
        expect(carriedSections).toBe(1)
    })
})
