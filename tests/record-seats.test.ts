import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildCourses, collectSeats, fetchAllRelatedClasses, fetchCombinedSeats, memberSeatsFrom, seatsFromDetail } from '../scripts/navigator-catalog.mjs'

/**
 * The search index lags Navigator's class record: on 2026-09-24 EE 349 read
 * 32/80 Open in the index and 30/30 Closed in the record. Classes the scrape
 * already reads a record for take their seats from it.
 */
const hit = (over: Record<string, unknown> = {}) => ({
    subject: 'EE', catalogNbr: '349', courseTitle: 'Topics', crseId: '1', termOffered: 'Autumn 2026', strm: '1272',
    classNbr: 6400, classSection: '01', componentPrimary: 'LEC', components: ['Lecture'], units: [3],
    gradingBasisDescr: 'Letter', enrlCap: 80, enrlTot: 32, waitCap: 10, waitTot: 0, enrlStatDescr: 'Open', meetings: [],
    ...over,
})
const record = (over: Record<string, unknown> = {}) => ({
    classNbr: 6400, sectionTotalEnrollment: 30, sectionCapacityEnrollment: 30, sectionTotalWaitlist: 2,
    sectionCapacityWaitlist: 10, sectionEnrollmentStatusDescr: 'Closed', ...over,
})
const EE186 = {
    ...record({ classNbr: 6325, sectionTotalEnrollment: 39, sectionCapacityEnrollment: 50, sectionTotalWaitlist: 24, sectionCapacityWaitlist: 50, sectionEnrollmentStatusDescr: 'Open' }),
    combinedSections: [{
        combinedEnrlCap: 50, combinedEnrlTot: 50, combinedWaitCap: 50, combinedWaitTot: 24,
        sections: [
            { cmbndclassClassNbr: 6325, cmbndclassEnrlCap: 50, cmbndclassEnrlTot: 39, cmbndclassWaitCap: 50, cmbndclassWaitTot: 24 },
            { cmbndclassClassNbr: 28402, cmbndclassEnrlCap: 30, cmbndclassEnrlTot: 11, cmbndclassWaitCap: 0, cmbndclassWaitTot: 0 },
        ],
    }],
}

describe('seats from the class record', () => {
    it('reads the record, and nothing from something that is not one', () => {
        expect(seatsFromDetail(record())).toEqual({ enrolled: 30, capacity: 30, waitlist: 2, waitlistMax: 10, status: 'Closed' })
        expect(seatsFromDetail(null)).toBeNull()
        expect(seatsFromDetail('Class not found')).toBeNull()
        expect(seatsFromDetail({ classNbr: 1 })).toBeNull()
    })

    it('lists each room member as the room record has it, with no status', () => {
        expect(memberSeatsFrom('1272', EE186).get('1272|28402')).toEqual({ enrolled: 11, capacity: 30, waitlist: 0, waitlistMax: 0, status: '' })
    })

    it("never lets a sibling's listing of a class replace that class's own record", () => {
        const seats = new Map()
        collectSeats('1272', 28402, record({ classNbr: 28402, sectionTotalEnrollment: 12, sectionCapacityEnrollment: 30, sectionEnrollmentStatusDescr: 'Closed' }), seats)
        collectSeats('1272', 6325, EE186, seats)
        expect(seats.get('1272|28402')).toMatchObject({ enrolled: 12, status: 'Closed' })
        expect(seats.get('1272|6325')).toMatchObject({ enrolled: 39, status: 'Open' })
    })

    it('fills a member in when its own record was never read', () => {
        const seats = new Map()
        collectSeats('1272', 6325, EE186, seats)
        expect(seats.get('1272|28402')).toMatchObject({ enrolled: 11, capacity: 30 })
    })
})

describe('the dump takes seats from the record when it has one', () => {
    const build = (seatsByClass: Map<string, unknown>) => buildCourses([hit()], new Map(), { seatsByClass })[0].sections[0]

    it('EE 349: the record says 30/30 Closed, the index said 32/80 Open', () => {
        const seats = new Map(); collectSeats('1272', 6400, record(), seats)
        expect(build(seats)).toMatchObject({ enrolled: 30, capacity: 30, waitlist: 2, waitlistMax: 10, status: 'Closed' })
    })

    it('keeps the index where the record has no reading', () => {
        expect(build(new Map())).toMatchObject({ enrolled: 32, capacity: 80, status: 'Open' })
    })

    it('treats a zero cap in the record as a gap, not a class of nobody', () => {
        const seats = new Map(); collectSeats('1272', 6400, record({ sectionCapacityEnrollment: 0, sectionCapacityWaitlist: 0 }), seats)
        expect(build(seats)).toMatchObject({ enrolled: 30, capacity: 80, waitlistMax: 10 })
    })

    it("keeps the index's status for a member that came with no status", () => {
        const seats = new Map([['1272|6400', { enrolled: 30, capacity: 30, waitlist: 0, waitlistMax: 0, status: '' }]])
        expect(build(seats)).toMatchObject({ enrolled: 30, capacity: 30, status: 'Open' })
    })

    it('does not use a reading from another term', () => {
        const seats = new Map(); collectSeats('1274', 6400, record(), seats)
        expect(build(seats)).toMatchObject({ enrolled: 32, capacity: 80 })
    })
})

describe('both scrape passes hand the seats back', () => {
    afterEach(() => vi.unstubAllGlobals())

    it('the related-class pass and the room pass', async () => {
        vi.stubGlobal('fetch', vi.fn(async (url: string) => {
            const nbr = Number(url.split('/').pop())
            const body = nbr === 6325 ? EE186 : record({ classNbr: nbr })
            return new Response(JSON.stringify(body), { status: 200 })
        }))
        const multi = hit({ classNbr: 7000, components: ['Lecture', 'Discussion'], crseId: '9' })
        const related = await fetchAllRelatedClasses([multi], { concurrency: 1 })
        expect(related.seatsByClass.get('1272|7000')).toMatchObject({ enrolled: 30, status: 'Closed' })

        const ee = hit({ subject: 'EE', catalogNbr: '186', classNbr: 6325, crseId: 'A' })
        const cs = hit({ subject: 'CS', catalogNbr: '140M', classNbr: 28402, crseId: 'A' })
        const seatsByClass = new Map()
        const { requests } = await fetchCombinedSeats([ee, cs], new Map(), { concurrency: 1, seatsByClass })
        expect(requests).toBe(1)
        expect(seatsByClass.get('1272|6325')).toMatchObject({ enrolled: 39, status: 'Open' })
        expect(seatsByClass.get('1272|28402')).toMatchObject({ enrolled: 11, status: '' })
    })
})
