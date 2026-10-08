import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildCourses, fetchClassDetail, fetchClassesFromRecords, hitFromDetail, strmForTerm } from '../scripts/navigator-catalog.mjs'
import { strmForTerm as appStrmForTerm } from '../src/lib/seats'

/**
 * Since 2026-10-03 the search index refuses anything but Navigator's own pages,
 * so the year is read from each class's record instead. These pin the record to
 * the catalog row the index used to produce, using CS 106A's real Autumn 2026
 * record (trimmed) and the row the 2026-10-02 dump had for it.
 */
const instructor = (last: string, first: string, role: string, seq: number, print = 'Y', sunet = '') => ({
    sectionInstructorLastName: last, sectionInstructorFirstName: first, sectionInstructorRole: role,
    sectionInstructorSeq: seq, sectionInstructorPrint: print, sectionInstructorSunet: sunet,
})
const meeting = (over: Record<string, unknown> = {}) => ({
    sectionMeetingSeq: 1, sectionMeetingMon: 'N', sectionMeetingTues: 'N', sectionMeetingWed: 'N', sectionMeetingThur: 'N',
    sectionMeetingFri: 'N', sectionMeetingSat: 'N', sectionMeetingSun: 'N', sectionMeetingStartTime: '', sectionMeetingEndTime: '',
    sectionMeetingRoom: '', sectionMeetingRoomDescr: '', sectionInstructors: [], ...over,
})
const CS106A = (over: Record<string, unknown> = {}) => ({
    classNbr: 1801, strm: '1272', strmQuarter: 'Autumn', strmCalendarYear: 2026, strmDescr: '2026-2027 Autumn',
    isPrimaryComponent: 'TRUE', courseId: '105644', courseTitle: 'Programming Methodology', courseDescr: 'Introduction to the engineering of computer applications.',
    section: '01', sectionSubject: 'CS', sectionCatalogNbr: '106A', sectionComponent: 'LEC',
    sectionUnitsMin: 3, sectionUnitsMax: 5, sectionGradingBasisDescr: 'Letter or Credit/No Credit', sectionInstructionModeDescr: 'In Person',
    sectionCapacityEnrollment: 999, sectionTotalEnrollment: 440, sectionCapacityWaitlist: 0, sectionTotalWaitlist: 0,
    sectionEnrollmentStatusDescr: 'Open', sectionClassStatusDescr: 'Active', sectionStartDate: '2026-09-22', sectionEndDate: '2026-12-04',
    courseComponents: [{ courseComponentDescr: 'Lecture' }, { courseComponentDescr: 'Discussion' }],
    courseAttributes: [
        { courseAttribute: 'NQTR', courseAttributeValue: 'AUT', courseAttributeValueDescr: 'Autumn' },
        { courseAttribute: 'WAYS', courseAttributeValue: 'FR', courseAttributeValueDescr: 'Formal Reasoning (FR)' },
        { courseAttribute: 'CUCO', courseAttributeValue: 'FRSHFRIEND', courseAttributeValueDescr: 'Frosh Friendly' },
    ],
    sectionMeetings: [meeting({
        sectionMeetingMon: 'Y', sectionMeetingWed: 'Y', sectionMeetingFri: 'Y',
        sectionMeetingStartTime: '11:30 AM', sectionMeetingEndTime: '12:20 PM',
        sectionMeetingRoom: 'HEWLETT200', sectionMeetingRoomDescr: 'Hewlett Teaching Center 200',
        sectionInstructors: [instructor('Mlauzi', 'Iddah', 'TA', 2, 'N'), instructor('Parlante', 'Nick', 'PI', 1, 'Y', 'nick')],
    })],
    relatedClasses: [{
        relatedClassNbr: 1834, relatedClassSection: '30', relatedClassComponent: 'DIS', relatedClassCapacityEnrollment: 15,
        relatedClassTotalEnrollment: 0, relatedClassCapacityWaitlist: 0, relatedClassTotalWaitlist: 0,
        relatedClassEnrollmentStatusDescr: 'Open', relatedClassMeetings: [],
    }],
    ...over,
})

const build = (detail: Record<string, unknown>) => {
    const hit = hitFromDetail(detail)!
    return buildCourses([hit], new Map([[`${hit.strm}|${hit.classNbr}`, detail.relatedClasses ?? []]]))
}

describe('a class record as a catalog row', () => {
    it('gives CS 106A the lecture row the 2026-10-02 dump had', () => {
        const [course] = build(CS106A())
        expect(course).toMatchObject({ course_id: 'CS106A', subject: 'CS', code: '106A', title: 'Programming Methodology', units: '3-5', grading: 'Letter or Credit/No Credit' })
        const lecture = course.sections.find((s: { classId: number }) => s.classId === 1801)
        expect(lecture).toMatchObject({
            term: 'Autumn 2026', sectionNumber: '1', component: 'LEC', units: '3-5', instructionalMode: 'In Person',
            status: 'Open', enrolled: 440, capacity: 999, startDate: '2026-09-22', endDate: '2026-12-04', gers: ['WAY-FR'],
            meetings: [{ days: 'Monday, Wednesday, Friday', time: '11:30 AM – 12:20 PM', location: 'Hewlett Teaching Center 200', instructors: ['Parlante, Nick'] }],
        })
        expect(course.sections.find((s: { classId: number }) => s.classId === 1834)).toMatchObject({ component: 'DIS', units: '' })
    })

    it('names a Winter class by the calendar year the quarter falls in', () => {
        expect(hitFromDetail(CS106A({ strm: '1274', strmQuarter: 'Winter', strmCalendarYear: 2027 }))!.termOffered).toBe('Winter 2027')
    })

    it('keeps WAYS and UGRQ as requirements, in the codes the site filters on', () => {
        const hit = hitFromDetail(CS106A({
            courseAttributes: [
                { courseAttribute: 'UGRQ', courseAttributeValue: 'WR1', courseAttributeValueDescr: 'Writing 1' },
                { courseAttribute: 'WAYS', courseAttributeValue: 'AII', courseAttributeValueDescr: 'Aesthetic and Interpretive Inquiry (AII)' },
                { courseAttribute: 'UGRQ', courseAttributeValue: 'COL', courseAttributeValueDescr: 'COLLEGE' },
                { courseAttribute: 'NQTR', courseAttributeValue: 'WIN', courseAttributeValueDescr: 'Winter' },
            ],
        }))
        const [course] = buildCourses([hit])
        expect(course.sections[0].gers).toEqual(['Writing 1', 'WAY-A-II', 'College'])
    })

    it('leaves out unprinted instructors and the grading proxy, and orders the rest by sequence', () => {
        const hit = hitFromDetail(CS106A({
            sectionMeetings: [meeting({
                sectionMeetingTues: 'Y', sectionMeetingStartTime: '09:30 AM', sectionMeetingEndTime: '10:20 AM',
                sectionInstructors: [
                    instructor('Taylor', 'Christine', 'GP', 2),
                    instructor('Hammond', 'Caleb', 'TA', 4),
                    instructor('Wieczorek', 'Wojciech', 'PI', 1),
                    instructor('Goldberg', 'Ariella', 'TA', 3),
                    instructor('Mlauzi', 'Iddah', 'TA', 5, 'N'),
                ],
            })],
        }))
        const [course] = buildCourses([hit])
        expect(course.sections[0].meetings[0]).toEqual({
            days: 'Tuesday', time: '9:30 AM – 10:20 AM', instructors: ['Wieczorek, Wojciech', 'Goldberg, Ariella', 'Hammond, Caleb'],
        })
    })

    it('orders meetings by sequence, drops an unassigned room, and drops a meeting with nothing in it', () => {
        const hit = hitFromDetail(CS106A({
            sectionMeetings: [
                meeting({ sectionMeetingSeq: 3, sectionMeetingWed: 'Y', sectionMeetingStartTime: '01:30 PM', sectionMeetingEndTime: '02:50 PM', sectionMeetingRoom: ' ', sectionMeetingRoomDescr: ' ' }),
                meeting({ sectionMeetingSeq: 4 }),
                meeting({ sectionMeetingSeq: 2, sectionMeetingFri: 'Y', sectionMeetingStartTime: '12:30 PM', sectionMeetingEndTime: '01:20 PM', sectionMeetingRoomDescr: '200-219' }),
            ],
        }))
        const [course] = buildCourses([hit])
        expect(course.sections[0].meetings).toEqual([
            { days: 'Friday', time: '12:30 PM – 1:20 PM', location: '200-219' },
            { days: 'Wednesday', time: '1:30 PM – 2:50 PM' },
        ])
    })

    it('is nothing for what is not a primary class record', () => {
        expect(hitFromDetail(null)).toBeNull()
        expect(hitFromDetail('Class not found')).toBeNull()
        expect(hitFromDetail({ classNbr: 1801 })).toBeNull()
        expect(hitFromDetail(CS106A({ isPrimaryComponent: 'FALSE' }))).toBeNull()
    })
})

describe('reading the year one record at a time', () => {
    const records: Record<string, unknown> = {
        '1272|1801': CS106A(),
        '1272|6325': {
            ...CS106A({ classNbr: 6325, sectionSubject: 'EE', sectionCatalogNbr: '186', courseId: '9', relatedClasses: [] }),
            combinedSections: [{
                combinedEnrlCap: 50, combinedEnrlTot: 50, combinedWaitCap: 50, combinedWaitTot: 24,
                sections: [
                    { cmbndclassClassNbr: 6325, cmbndclassEnrlCap: 50, cmbndclassEnrlTot: 39 },
                    { cmbndclassClassNbr: 28402, cmbndclassEnrlCap: 30, cmbndclassEnrlTot: 11 },
                ],
            }],
        },
    }
    // 5555 always fails; 6325 fails once, as a burst of errors partway through a run would.
    const fake = () => {
        const reads: string[] = []
        const fetchDetail = async (strm: string, classNbr: number) => {
            const key = `${strm}|${classNbr}`
            reads.push(key)
            if (classNbr === 5555) throw new Error('HTTP 500')
            if (classNbr === 6325 && reads.filter(r => r === key).length === 1) throw new Error('HTTP 503')
            return records[key] ?? null
        }
        return { reads, fetchDetail }
    }
    const opts = (fetchDetail: (strm: string, classNbr: number) => Promise<unknown>) => ({ concurrency: 1, fetchDetail, retryPauseMs: 0 })

    it('reads a primary once, skips the discussion it names, and keeps a read that keeps failing', async () => {
        const { reads, fetchDetail } = fake()
        const result = await fetchClassesFromRecords([
            { strm: '1272', classNbr: 1834, primary: false },
            { strm: '1272', classNbr: 1801, primary: true },
            { strm: '1272', classNbr: 1801, primary: false },
            { strm: '1272', classNbr: 9999, primary: false },
            { strm: '1272', classNbr: 5555, primary: true },
        ], opts(fetchDetail))
        expect(reads).toEqual(['1272|1801', '1272|5555', '1272|9999', '1272|5555'])
        expect(result.classes.map((h: { classNbr: number }) => h.classNbr)).toEqual([1801])
        expect(result.relatedByClass.get('1272|1801')).toHaveLength(1)
        expect(result.notFound).toBe(1)
        expect(result.failed).toEqual(['1272|5555'])
    })

    it('gets a class back that failed once', async () => {
        const { reads, fetchDetail } = fake()
        const result = await fetchClassesFromRecords([{ strm: '1272', classNbr: 6325, primary: true }], opts(fetchDetail))
        expect(reads).toEqual(['1272|6325', '1272|6325'])
        expect(result.failed).toEqual([])
        expect(result.classes.map((h: { classNbr: number }) => h.classNbr)).toEqual([6325])
    })

    it('takes seats and the shared room from the same read', async () => {
        const { fetchDetail } = fake()
        const result = await fetchClassesFromRecords([{ strm: '1272', classNbr: 6325, primary: true }], opts(fetchDetail))
        expect(result.seatsByClass.get('1272|6325')).toMatchObject({ enrolled: 440, capacity: 999, status: 'Open' })
        expect(result.combinedByClass.get('1272|28402')).toEqual({ enrolled: 50, capacity: 50, waitlist: 24, waitlistMax: 50 })
    })
})

describe('when Navigator pushes back', () => {
    afterEach(() => { vi.unstubAllGlobals() })

    it('waits out a 429 for as long as it is told, then reads the record', async () => {
        const answers = [
            new Response('', { status: 429, headers: { 'retry-after': '1' } }),
            new Response(JSON.stringify({ classNbr: 1801 }), { status: 200 }),
        ]
        const fetch = vi.fn(async () => answers.shift()!)
        vi.stubGlobal('fetch', fetch)
        const started = Date.now()
        expect(await fetchClassDetail('1272', 1801)).toEqual({ classNbr: 1801 })
        expect(fetch).toHaveBeenCalledTimes(2)
        expect(Date.now() - started).toBeGreaterThanOrEqual(950)
    })

    it('treats a 404 as no record, without retrying', async () => {
        const fetch = vi.fn(async () => new Response('', { status: 404 }))
        vi.stubGlobal('fetch', fetch)
        expect(await fetchClassDetail('1272', 1834)).toBeNull()
        expect(fetch).toHaveBeenCalledTimes(1)
    })
})

describe('term codes', () => {
    it('agree with the app, which keys live seats by the same code', () => {
        for (const year of [2024, 2025, 2026, 2027, 2030]) {
            for (const season of ['Autumn', 'Fall', 'Winter', 'Spring', 'Summer']) {
                expect(strmForTerm(`${season} ${year}`)).toBe(appStrmForTerm(`${season} ${year}`))
            }
        }
        for (const bad of ['', 'Autumn', 'Monsoon 2026', 'Autumn 12', 'Spring 2200']) expect(strmForTerm(bad)).toBe(appStrmForTerm(bad))
    })
})
