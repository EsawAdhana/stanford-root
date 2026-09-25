import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildCourses, combinedSeatsFrom, fetchCombinedSeats } from '../scripts/navigator-catalog.mjs'
import { parseNavigatorSeat, type LiveSeat } from '@/lib/seats'
import { aggregateCrossListedSectionEnrollment, getCrossListPrimaryMap } from '@/lib/utils'
import { filterCourses, type CourseFilterCriteria } from '@/lib/course-filter'
import type { CombinedSeats, Course, Section } from '@/types/course'

/**
 * A cross-listed meeting has one cap for the room and a separate allotment per
 * listing. Enrolled and waitlist add across listings; caps do not, and each
 * listing's Open/Closed flag can disagree with the room. Every fixture below is
 * a real Navigator reading from 2026-09-24.
 */

/** Navigator's /api/classes/1272/6325 record, trimmed to the fields read. */
const EE186_DETAIL = {
    classNbr: 6325,
    sectionCapacityEnrollment: 50,
    sectionTotalEnrollment: 39,
    sectionCapacityWaitlist: 50,
    sectionTotalWaitlist: 24,
    sectionEnrollmentStatusDescr: 'Open',
    combinedSections: [{
        combinedEnrlCap: 50, combinedEnrlTot: 50, combinedWaitCap: 50, combinedWaitTot: 24,
        combinedSectionId: '8585',
        sections: [
            { cmbndclassClassNbr: 6325, cmbndclassSubject: 'EE', cmbndclassCatalogNbr: '186', cmbndclassEnrlCap: 50, cmbndclassEnrlTot: 39 },
            { cmbndclassClassNbr: 28402, cmbndclassSubject: 'CS', cmbndclassCatalogNbr: '140M', cmbndclassEnrlCap: 30, cmbndclassEnrlTot: 11 },
        ],
    }],
}
const EE186_ROOM: CombinedSeats = { enrolled: 50, capacity: 50, waitlist: 24, waitlistMax: 50 }

const section = (over: Partial<Section> = {}): Section => ({
    term: 'Autumn 2026', classId: 1, sectionNumber: '1', component: 'LEC', units: 4, grading: 'Letter',
    instructionalMode: '', status: 'Open', enrolled: 0, capacity: 0, waitlist: 0, waitlistMax: 0,
    startDate: '', endDate: '', meetings: [], ...over,
})

const course = (id: string, subject: string, code: string, title: string, sections: Section[]): Course =>
    ({ id, subject, code, title, description: '', grading: 'Letter', units: '4', instructors: [], terms: ['Autumn 2026'], sections }) as unknown as Course

const CRITERIA: CourseFilterCriteria = {
    excludedWords: [], selectedDepts: [], selectedTerms: ['Autumn 2026'], selectedFormats: [],
    selectedLevels: [], selectedGers: [], selectedSchools: [], unitMin: 0, unitMax: 30,
    timeMin: 0, timeMax: 1440, hideConflicts: false, hideUnavailable: true,
    hideStudyAbroad: false, newOnly: false,
}
const visible = (catalog: Course[]) =>
    filterCourses(catalog, CRITERIA, getCrossListPrimaryMap(catalog), []).map(c => c.id)

describe('reading the shared seats out of Navigator', () => {
    it('gives both listings of the meeting the room numbers, keyed by term', () => {
        const seats = combinedSeatsFrom('1272', EE186_DETAIL)
        expect(seats.get('1272|6325')).toEqual(EE186_ROOM)
        expect(seats.get('1272|28402')).toEqual(EE186_ROOM)
        expect(seats.has('1274|6325')).toBe(false)
    })

    const room = (cap: number, tot: number, wait: number, listings: [number, number, number][]) => ({
        combinedSections: [{
            combinedEnrlCap: cap, combinedEnrlTot: tot, combinedWaitCap: 50, combinedWaitTot: wait,
            sections: listings.map(([nbr, c, t]) => ({ cmbndclassClassNbr: nbr, cmbndclassEnrlCap: c, cmbndclassEnrlTot: t })),
        }],
    })

    it('caps the class at what its listings can still take: CEE 141A/241A are 18/18 and 30/30 in a room of 65', () => {
        const detail = room(65, 48, 20, [[1, 30, 30], [2, 18, 18]])
        expect(combinedSeatsFrom('1272', detail).get('1272|1')).toMatchObject({ enrolled: 48, capacity: 48 })
        expect(parseNavigatorSeat({ ...detail, classNbr: 1, sectionTotalEnrollment: 30, sectionCapacityEnrollment: 30 })?.combined)
            .toMatchObject({ enrolled: 48, capacity: 48 })
    })

    it('keeps the room cap when the listings have more seats than the room: AA 228 / CS 238', () => {
        const detail = room(700, 676, 0, [[1, 700, 176], [2, 500, 500]])
        expect(combinedSeatsFrom('1272', detail).get('1272|2')).toMatchObject({ enrolled: 676, capacity: 700 })
    })

    it('stops at the listings when the room is far bigger: MUSIC 154A / ARTSTUDI 131 in a room of 999', () => {
        const detail = room(999, 5, 0, [[1, 10, 1], [2, 250, 4]])
        expect(combinedSeatsFrom('1272', detail).get('1272|1')).toMatchObject({ enrolled: 5, capacity: 260 })
    })

    it('reports an over-enrolled room against its own cap', () => {
        const detail = room(50, 52, 0, [[1, 30, 31], [2, 30, 21]])
        expect(combinedSeatsFrom('1272', detail).get('1272|1')).toMatchObject({ enrolled: 52, capacity: 50 })
        expect(parseNavigatorSeat({ ...detail, classNbr: 1, sectionTotalEnrollment: 31, sectionCapacityEnrollment: 30 })?.combined)
            .toMatchObject({ enrolled: 52, capacity: 50 })
    })

    it('ignores a group of one and a group with no cap', () => {
        const lone = { combinedSections: [{ ...EE186_DETAIL.combinedSections[0], sections: [EE186_DETAIL.combinedSections[0].sections[0]] }] }
        const uncapped = { combinedSections: [{ ...EE186_DETAIL.combinedSections[0], combinedEnrlCap: 0 }] }
        expect(combinedSeatsFrom('1272', lone).size).toBe(0)
        expect(combinedSeatsFrom('1272', uncapped).size).toBe(0)
        expect(combinedSeatsFrom('1272', null).size).toBe(0)
        expect(combinedSeatsFrom('1272', { combinedSections: 'x' }).size).toBe(0)
    })

    it('carries the room onto the live seat, and nothing for a class not in it', () => {
        expect(parseNavigatorSeat(EE186_DETAIL)?.combined).toEqual(EE186_ROOM)
        expect(parseNavigatorSeat({ ...EE186_DETAIL, classNbr: 999 })?.combined).toBeUndefined()
        const { combinedSections: _, ...solo } = EE186_DETAIL
        expect(parseNavigatorSeat(solo)?.combined).toBeUndefined()
    })

    it('agrees with the scraper on the same record', () => {
        expect(parseNavigatorSeat(EE186_DETAIL)?.combined).toEqual(combinedSeatsFrom('1272', EE186_DETAIL).get('1272|6325'))
    })
})

describe('the dump stores the room on each cross-listed section', () => {
    const hit = (over: Record<string, unknown>) => ({
        subject: 'EE', catalogNbr: '186', courseTitle: 'Introduction to Embedded Systems', crseId: '1',
        termOffered: 'Autumn 2026', strm: '1272', classNbr: 6325, classSection: '01', componentPrimary: 'LEC',
        components: ['Lecture'], units: [4], gradingBasisDescr: 'Letter', enrlCap: 50, enrlTot: 39,
        waitCap: 50, waitTot: 24, enrlStatDescr: 'Open', meetings: [], ...over,
    })

    it('attaches it to the matching class only', () => {
        const combinedByClass = combinedSeatsFrom('1272', EE186_DETAIL)
        const [ee] = buildCourses([hit({}), hit({ termOffered: 'Winter 2027', strm: '1274', classNbr: 6400 })], new Map(), { combinedByClass })
        expect(ee.sections[0].combined).toEqual(EE186_ROOM)
        expect('combined' in ee.sections[1]).toBe(false)
    })

    it('does not reuse a room from another term for the same class number', () => {
        const combinedByClass = combinedSeatsFrom('1274', EE186_DETAIL)
        const [ee] = buildCourses([hit({})], new Map(), { combinedByClass })
        expect('combined' in ee.sections[0]).toBe(false)
    })
})

describe('fetching the shared seats', () => {
    afterEach(() => vi.unstubAllGlobals())

    const hit = (subject: string, catalogNbr: string, classNbr: number, crseId: string) =>
        ({ subject, catalogNbr, classNbr, crseId, strm: '1272', termOffered: 'Autumn 2026', courseCode: `${subject} ${catalogNbr}` })

    it('reads one record per shared meeting, skips classes already read, and never reads a lone listing', async () => {
        const asked: string[] = []
        vi.stubGlobal('fetch', vi.fn(async (url: string) => {
            asked.push(url.split('/').slice(-2).join('/'))
            return new Response(JSON.stringify(EE186_DETAIL), { status: 200 })
        }))
        const alreadyRead = new Map([['1272|7000', EE186_ROOM]])
        const { combinedByClass, requests } = await fetchCombinedSeats([
            hit('EE', '186', 6325, 'A'),
            hit('CS', '140M', 28402, 'A'),
            hit('CS', '106A', 5000, 'B'),
            hit('AA', '228', 7000, 'C'),
            hit('CS', '238', 7001, 'C'),
        ], alreadyRead, { concurrency: 1 })
        // EE 186 names CS 140M, so CS 140M is not re-read. CS 106A stands alone.
        // AA 228 was covered by the related-class pass; CS 238 was not.
        expect(asked).toEqual(['1272/6325', '1272/7001'])
        expect(requests).toBe(2)
        expect(combinedByClass.get('1272|28402')).toEqual(EE186_ROOM)
        expect(combinedByClass.has('1272|5000')).toBe(false)
    })

    it('keeps going when one record fails', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })))
        const { combinedByClass, requests } = await fetchCombinedSeats([hit('EE', '186', 6325, 'A'), hit('CS', '140M', 28402, 'A')], new Map(), { concurrency: 1 })
        // A miss names no siblings, so the second listing is still asked.
        expect(requests).toBe(2)
        expect(combinedByClass.size).toBe(0)
    })
})

describe('course page totals use the room, not the sum of allotments', () => {
    const cs = section({ classId: 28402, status: 'Closed', enrolled: 11, capacity: 30 })
    const ee = section({ classId: 6325, enrolled: 39, capacity: 50, waitlist: 24, waitlistMax: 50 })
    const catalog = [course('CS140M', 'CS', '140M', 'Embedded (EE 186)', [cs]), course('EE186', 'EE', '186', 'Embedded (CS 140M)', [ee])]
    const seat = (s: Section, combined?: CombinedSeats): LiveSeat =>
        ({ classNbr: s.classId, enrolled: s.enrolled, capacity: s.capacity, waitlist: s.waitlist, waitlistMax: s.waitlistMax, status: s.status, ...(combined ? { combined } : {}) })

    it('reads 50 / 50 from a live reading, where it used to read 50 / 80', () => {
        const live = new Map([[28402, seat(cs, EE186_ROOM)], [6325, seat(ee, EE186_ROOM)]])
        expect(aggregateCrossListedSectionEnrollment(cs, ['CS140M', 'EE186'], catalog, live)).toEqual(EE186_ROOM)
    })

    it('reads the room from the dump when there is no live reading', () => {
        const csWithRoom = { ...cs, combined: EE186_ROOM }
        const withRoom = [course('CS140M', 'CS', '140M', 'Embedded (EE 186)', [csWithRoom]), catalog[1]]
        expect(aggregateCrossListedSectionEnrollment(csWithRoom, ['CS140M', 'EE186'], withRoom)).toEqual(EE186_ROOM)
    })

    it('prefers a live room over a stale one in the dump', () => {
        const stale = { ...EE186_ROOM, enrolled: 44, waitlist: 0 }
        const csWithRoom = { ...cs, combined: stale }
        const withRoom = [course('CS140M', 'CS', '140M', 'Embedded (EE 186)', [csWithRoom]), catalog[1]]
        const live = new Map([[28402, seat(cs, EE186_ROOM)]])
        expect(aggregateCrossListedSectionEnrollment(csWithRoom, ['CS140M', 'EE186'], withRoom, live)).toEqual(EE186_ROOM)
    })

    it("does not borrow a room from a sibling matched only by section number", () => {
        const other = { enrolled: 90, capacity: 90, waitlist: 5, waitlistMax: 10 }
        const a = section({ classId: 1, enrolled: 5, capacity: 20 })
        const b = section({ classId: 2, enrolled: 7, capacity: 20, combined: other })
        const cat = [course('X1', 'X', '1', 'X (Y 1)', [a]), course('Y1', 'Y', '1', 'X (X 1)', [b])]
        expect(aggregateCrossListedSectionEnrollment(a, ['X1', 'Y1'], cat)).toEqual({ enrolled: 12, capacity: 40, waitlist: 0, waitlistMax: 0 })
    })

    it('still sums when Navigator has no room for it', () => {
        expect(aggregateCrossListedSectionEnrollment(cs, ['CS140M', 'EE186'], catalog)).toEqual({ enrolled: 50, capacity: 80, waitlist: 24, waitlistMax: 50 })
    })
})

describe('hide closed & waitlisted reads the room', () => {
    it('hides PHYSICS 13N: the APPPHYS listing reads Open at 0/16 with no waitlist, but the room is 16/16', () => {
        const room = { enrolled: 16, capacity: 16, waitlist: 0, waitlistMax: 5 }
        expect(visible([
            course('APPPHYS13N', 'APPPHYS', '13N', 'Physics (PHYSICS 13N)', [section({ classId: 1, status: 'Open', enrolled: 0, capacity: 16, combined: room })]),
            course('PHYSICS13N', 'PHYSICS', '13N', 'Physics (APPPHYS 13N)', [section({ classId: 2, status: 'Closed', enrolled: 16, capacity: 16, combined: room })]),
        ])).toEqual([])
    })

    it('keeps AA 228: CS 238 is full, but the room is 676/700 and AA 228 is open', () => {
        const room = { enrolled: 676, capacity: 700, waitlist: 0, waitlistMax: 100 }
        expect(visible([
            course('AA228', 'AA', '228', 'Decisions (CS 238)', [section({ classId: 1, enrolled: 176, capacity: 700, combined: room })]),
            course('CS238', 'CS', '238', 'Decisions (AA 228)', [section({ classId: 2, status: 'Closed', enrolled: 500, capacity: 500, combined: room })]),
        ])).toEqual(['AA228'])
    })

    it('hides CEE 141A / 241A: the room has space on paper, but both listings are full', () => {
        const r = { enrolled: 48, capacity: 48, waitlist: 20, waitlistMax: 40 }
        expect(visible([
            course('CEE141A', 'CEE', '141A', 'Infra (CEE 241A)', [section({ classId: 1, status: 'Closed', enrolled: 18, capacity: 18, combined: r })]),
            course('CEE241A', 'CEE', '241A', 'Infra (CEE 141A)', [section({ classId: 2, status: 'Closed', enrolled: 30, capacity: 30, combined: r })]),
        ])).toEqual([])
    })

    it('hides an over-enrolled room', () => {
        const room = { enrolled: 52, capacity: 50, waitlist: 0, waitlistMax: 0 }
        expect(visible([course('CS1', 'CS', '1', 'X', [section({ capacity: 60, enrolled: 10, combined: room })])])).toEqual([])
    })

    it('hides a room with a waitlist even if its count still shows a seat', () => {
        const room = { enrolled: 49, capacity: 50, waitlist: 2, waitlistMax: 10 }
        expect(visible([course('CS1', 'CS', '1', 'X', [section({ capacity: 60, enrolled: 10, combined: room })])])).toEqual([])
    })
})
