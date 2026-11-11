import { describe, expect, it } from 'vitest'
import { buildScheduleICS } from '@/lib/ics-export'
import type { Course, Section } from '@/types/course'

/**
 * The exported calendar must land each class on the days it actually meets.
 * Ten weekly repeats from a guessed term start put Autumn 2026 classes on
 * Thanksgiving week (Mon 11/23, Wed 11/25, Fri 11/27) and dropped the last
 * week (11/30, 12/2, 12/4), and started Winter 2027 Monday classes on Jan 11
 * instead of Jan 4.
 *
 * Sections below are copied from the catalog dump (data/catalog/full.json,
 * 2026-11-11), so they carry the Registrar's real first and last days.
 */

const A = 'Autumn 2026'
const W = 'Winter 2027'

function section(term: string, classId: number, startDate: string, endDate: string, days: string, time: string, location?: string): Section {
  return {
    term, classId, sectionNumber: '01', component: 'LEC', units: 5, grading: 'Letter', instructionalMode: 'In Person',
    status: 'Open', enrolled: 0, capacity: 0, waitlist: 0, waitlistMax: 0, startDate, endDate,
    meetings: [{ days, time, location }],
  }
}

function course(id: string, subject: string, code: string, s: Section): Course {
  return { id, subject, code, title: id, description: '', units: '5', grading: 'Letter', instructors: [], terms: [s.term], sections: [s], selectedTerm: s.term, selectedSectionIds: [s.classId] } as Course
}

const MATH51_AUT = course('MATH51', 'MATH', '51', section(A, 6636, '2026-09-22', '2026-12-04', 'Monday, Wednesday, Friday', '10:30 AM – 11:20 AM', '420-041'))
const PHIL2_AUT = course('PHIL2', 'PHIL', '2', section(A, 26438, '2026-09-22', '2026-12-04', 'Tuesday, Thursday', '1:30 PM – 2:50 PM', '370-370'))
const MATH51_WIN = course('MATH51', 'MATH', '51', section(W, 6942, '2027-01-04', '2027-03-12', 'Monday, Wednesday, Friday', '10:30 AM – 11:20 AM', '370-370'))
const LAW1009_WIN = course('LAW1009', 'LAW', '1009', section(W, 1125, '2027-01-04', '2027-03-08', 'Monday', '4:15 PM – 7:15 PM'))

type Parsed = { summary: string; dtstart: string; rrule: string; exdates: string[] }

function parseEvents(ics: string): Parsed[] {
  return ics.split('BEGIN:VEVENT').slice(1).map(block => {
    const get = (name: string) => block.match(new RegExp(`^${name}[^:]*:(.*)$`, 'm'))?.[1] ?? ''
    return { summary: get('SUMMARY'), dtstart: get('DTSTART'), rrule: get('RRULE'), exdates: get('EXDATE').split(',').filter(Boolean) }
  })
}

/** Every date (YYYYMMDD) an event lands on, read the way a calendar app reads it. */
function occurrences(e: Parsed): string[] {
  const d0 = e.dtstart.slice(0, 8)
  let d = new Date(Date.UTC(+d0.slice(0, 4), +d0.slice(4, 6) - 1, +d0.slice(6, 8)))
  const time = e.dtstart.slice(9)
  const until = e.rrule.match(/UNTIL=(\d{8})T(\d{6})Z/)
  const count = Number(e.rrule.match(/COUNT=(\d+)/)?.[1] ?? Infinity)
  const out: string[] = []
  for (let i = 0; i < Math.min(count, 60); i++) {
    const ymd = d.toISOString().slice(0, 10).replace(/-/g, '')
    if (until) {
      // The meeting's start in UTC, Pacific time being UTC-7 or UTC-8.
      const startUtc = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8), +time.slice(0, 2) + 8, +time.slice(2, 4)))
      const u = until[1]
      const untilUtc = new Date(Date.UTC(+u.slice(0, 4), +u.slice(4, 6) - 1, +u.slice(6, 8), +until[2].slice(0, 2), +until[2].slice(2, 4), +until[2].slice(4, 6)))
      if (startUtc > untilUtc) break
    }
    if (!e.exdates.includes(`${ymd}T${time}`)) out.push(ymd)
    d = new Date(d.getTime() + 7 * 86400000)
  }
  return out
}

const byDay = (events: Parsed[]) => Object.fromEntries(events.map(e => [new Date(Date.UTC(+e.dtstart.slice(0, 4), +e.dtstart.slice(4, 6) - 1, +e.dtstart.slice(6, 8))).getUTCDay(), occurrences(e)]))

describe('buildScheduleICS', () => {
  it('runs an Autumn 2026 MWF class from Sep 23 to Dec 4, skipping Thanksgiving week', () => {
    const events = parseEvents(buildScheduleICS([MATH51_AUT], A))
    expect(events).toHaveLength(3)
    const days = byDay(events)
    const mon = days[1], wed = days[3], fri = days[5]

    // Sep 22 is a Tuesday, so the first meetings are Wed 9/23, Fri 9/25, Mon 9/28.
    expect(mon[0]).toBe('20260928')
    expect(wed[0]).toBe('20260923')
    expect(fri[0]).toBe('20260925')

    // Thanksgiving week is off; the last week of classes is on.
    for (const d of ['20261123', '20261125', '20261127']) expect([...mon, ...wed, ...fri]).not.toContain(d)
    expect(mon.at(-1)).toBe('20261130')
    expect(wed.at(-1)).toBe('20261202')
    expect(fri.at(-1)).toBe('20261204')
    expect(mon).toHaveLength(9) // 9/28 .. 11/30, less 11/23
    expect(wed).toHaveLength(10) // 9/23 .. 12/2, less 11/25
    expect(fri).toHaveLength(10) // 9/25 .. 12/4, less 11/27

    expect(events[0].dtstart).toMatch(/T103000$/)
  })

  it('skips Democracy Day and Thanksgiving for a Tue/Thu class', () => {
    const days = byDay(parseEvents(buildScheduleICS([PHIL2_AUT], A)))
    const tue = days[2], thu = days[4]
    expect(tue[0]).toBe('20260922')
    expect(thu[0]).toBe('20260924')
    expect(tue).not.toContain('20261103')
    expect(tue).not.toContain('20261124')
    expect(thu).not.toContain('20261126')
    expect(tue.at(-1)).toBe('20261201')
    expect(thu.at(-1)).toBe('20261203')
  })

  it('starts Winter 2027 Monday classes on Jan 4 and skips the Monday holidays', () => {
    const mon = byDay(parseEvents(buildScheduleICS([MATH51_WIN], W)))[1]
    expect(mon[0]).toBe('20270104')
    expect(mon[1]).toBe('20270111')
    expect(mon).not.toContain('20270118') // MLK Day
    expect(mon).not.toContain('20270215') // Presidents' Day
    expect(mon.at(-1)).toBe('20270308')
  })

  it('keeps Presidents\' Day for Law, which holds classes that day', () => {
    const mon = byDay(parseEvents(buildScheduleICS([LAW1009_WIN], W)))[1]
    expect(mon).toContain('20270215')
    expect(mon).not.toContain('20270118')
    // An evening class on the last day is still in: UNTIL is end of day Pacific.
    expect(mon.at(-1)).toBe('20270308')
  })

  it('falls back to the approximate start and ten weeks for a section without dates', () => {
    const undated = course('X1', 'X', '1', section(A, 1, '', '', 'Monday', '9:00 AM – 9:50 AM'))
    const [e] = parseEvents(buildScheduleICS([undated], A))
    expect(e.rrule).toBe('FREQ=WEEKLY;COUNT=10')
    expect(e.dtstart).toBe('20260928T090000') // first Monday on or after Sep 22
  })
})
