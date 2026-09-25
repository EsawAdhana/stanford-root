import { describe, expect, it } from 'vitest'
import { displayedStatus, hasSeat } from '@/lib/seats'

/**
 * The course page badge used to be Navigator's per-listing flag, which reads
 * "Open" on classes with no seat. Rows are real Navigator readings, 2026-09-24.
 */
const seats = (enrolled: number, capacity: number, waitlist = 0, waitlistMax = 0) => ({ enrolled, capacity, waitlist, waitlistMax })

describe('the status shown on a section', () => {
    it('AA 174A: its own listing is Open, but the room with CS 137A and EE 160A is 90/90 with 20/20 waiting', () => {
        expect(displayedStatus('Open', seats(32, 90, 2, 20), seats(90, 90, 20, 20))).toBe('Closed')
    })

    it('EE 186: Open at 39/50, but the room is 50/50 with 24/50 waiting', () => {
        expect(displayedStatus('Open', seats(39, 50, 24, 50), seats(50, 50, 24, 50))).toBe('Wait List')
    })

    it('AA 228: stays Open, the room is 676/700', () => {
        expect(displayedStatus('Open', seats(176, 700), seats(676, 700, 0, 100))).toBe('Open')
    })

    it('CS 312: Open at 96/99 with 85 of 100 waiting is a wait list, not a seat', () => {
        expect(displayedStatus('Open', seats(96, 99, 85, 100))).toBe('Wait List')
    })

    it('EARTHSYS 10: Open at 163/300 with one waiting stays Open', () => {
        expect(displayedStatus('Open', seats(163, 300, 1, 50))).toBe('Open')
    })

    it('a full section with no wait list is Closed', () => {
        expect(displayedStatus('Open', seats(50, 50))).toBe('Closed')
        expect(displayedStatus('Open', seats(52, 50, 3, 3))).toBe('Closed')
    })

    it('leaves every other flag, and a section with no cap, as Navigator wrote it', () => {
        expect(displayedStatus('Closed', seats(11, 30))).toBe('Closed')
        expect(displayedStatus('Wait List', seats(50, 50, 1, 10))).toBe('Wait List')
        expect(displayedStatus('Open', seats(4, 0, 2, 0))).toBe('Open')
        expect(displayedStatus('', seats(0, 0))).toBe('')
    })

    it('agrees with the filter on every case above', () => {
        // The badge says Open exactly when hasSeat holds for the section and its room.
        const cases: [ReturnType<typeof seats>, ReturnType<typeof seats> | undefined][] = [
            [seats(32, 90, 2, 20), seats(90, 90, 20, 20)],
            [seats(176, 700), seats(676, 700, 0, 100)],
            [seats(96, 99, 85, 100), undefined],
            [seats(163, 300, 1, 50), undefined],
        ]
        for (const [own, room] of cases) {
            expect(displayedStatus('Open', own, room) === 'Open').toBe(hasSeat(own) && (!room || hasSeat(room)))
        }
    })
})
