import { afterEach, describe, it, expect } from 'vitest'
import {
  NAVIGATOR_ORIGIN,
  classifyUpstreamStatus,
  navigatorClassUrl,
  strmForTerm,
  parseNavigatorSeat,
  parseClassNbrParam,
  MAX_CLASS_NBRS_PER_REQUEST,
  type LiveSeat,
} from '@/lib/seats'
import { aggregateCrossListedSectionEnrollment } from '@/lib/utils'
import type { Course, Section } from '@/types/course'

function section(overrides: Partial<Section> = {}): Section {
  return {
    term: 'Autumn 2026',
    classId: 1,
    sectionNumber: '1',
    component: 'LEC',
    units: 3,
    grading: 'Letter',
    classLevel: '',
    instructionalMode: '',
    status: 'Open',
    enrolled: 0,
    capacity: 0,
    waitlist: 0,
    waitlistMax: 0,
    startDate: '',
    endDate: '',
    meetings: [],
    ...overrides,
  }
}

function seat(overrides: Partial<LiveSeat> = {}): LiveSeat {
  return { classNbr: 1, enrolled: 0, capacity: 0, waitlist: 0, waitlistMax: 0, status: 'Open', ...overrides }
}

describe('strmForTerm', () => {
  // Verified against Navigator's own `strm` facet, 2026-08-25.
  it.each([
    ['Autumn 2024', 1252],
    ['Autumn 2025', 1262],
    ['Winter 2026', 1264],
    ['Spring 2026', 1266],
    ['Summer 2026', 1268],
    ['Autumn 2026', 1272],
    ['Winter 2027', 1274],
    ['Spring 2027', 1276],
    ['Summer 2027', 1278],
  ])('%s -> %i', (term, strm) => {
    expect(strmForTerm(term)).toBe(strm)
  })

  it('treats Fall as Autumn (the catalog uses both spellings)', () => {
    expect(strmForTerm('Fall 2026')).toBe(1272)
  })

  it('rolls the century without wrapping to a 3-digit code', () => {
    // Autumn 2099 -> academic year ends 2100 -> "00" must stay two digits.
    expect(strmForTerm('Autumn 2099')).toBe(1002)
  })

  it.each([
    [''],
    ['   '],
    ['Autumn'],
    ['2026'],
    ['Quarter 2026'],
    ['Autumn 12'],
    ['Autumn 99999'],
    ['Autumn abcd'],
    ['autumn 2026'], // season is capitalised in the catalog; do not guess
  ])('rejects %j rather than sending a made-up term code upstream', term => {
    expect(strmForTerm(term)).toBeNull()
  })

  it('tolerates extra whitespace', () => {
    expect(strmForTerm('  Autumn   2026 ')).toBe(1272)
  })
})

describe('parseNavigatorSeat', () => {
  it('reads a real Navigator record', () => {
    expect(
      parseNavigatorSeat({
        classNbr: 13194,
        sectionTotalEnrollment: 2,
        sectionCapacityEnrollment: 999,
        sectionTotalWaitlist: 0,
        sectionCapacityWaitlist: 0,
        sectionEnrollmentStatusDescr: 'Open',
      })
    ).toEqual(seat({ classNbr: 13194, enrolled: 2, capacity: 999, status: 'Open' }))
  })

  it('accepts numeric strings, which PeopleSoft-backed fields sometimes are', () => {
    const parsed = parseNavigatorSeat({
      classNbr: '1883',
      sectionTotalEnrollment: '17',
      sectionCapacityEnrollment: '350',
    })
    expect(parsed).toMatchObject({ classNbr: 1883, enrolled: 17, capacity: 350 })
  })

  it('falls back to the class status when there is no enrollment status', () => {
    expect(
      parseNavigatorSeat({ classNbr: 5, sectionTotalEnrollment: 0, sectionClassStatusDescr: 'Cancelled' })?.status
    ).toBe('Cancelled')
  })

  it.each([
    ['null', null],
    ['a string body', 'Not Found'],
    ['an HTML error page', '<html>500</html>'],
    ['an empty object', {}],
    ['a record with no classNbr', { sectionTotalEnrollment: 4, sectionCapacityEnrollment: 10 }],
    ['a record with no enrollment fields at all', { classNbr: 1883, courseTitle: 'Whatever' }],
    ['classNbr 0', { classNbr: 0, sectionTotalEnrollment: 4 }],
  ])('returns null for %s so the page keeps the daily snapshot', (_label, body) => {
    expect(parseNavigatorSeat(body)).toBeNull()
  })

  it('clamps nonsense counts to 0 instead of rendering a negative', () => {
    const parsed = parseNavigatorSeat({
      classNbr: 7,
      sectionTotalEnrollment: -5,
      sectionCapacityEnrollment: 'lots',
    })
    expect(parsed).toMatchObject({ enrolled: 0, capacity: 0 })
  })
})

describe('parseClassNbrParam', () => {
  it('parses, trims and de-duplicates', () => {
    expect(parseClassNbrParam(' 3, 1 ,3,2 ')).toEqual([3, 1, 2])
  })

  it('drops junk without dropping the whole request', () => {
    expect(parseClassNbrParam('1,,abc,-4,0,2')).toEqual([1, 2])
  })

  it('caps the fan-out a crafted URL can ask for', () => {
    const many = Array.from({ length: 200 }, (_, i) => i + 1).join(',')
    expect(parseClassNbrParam(many)).toHaveLength(MAX_CLASS_NBRS_PER_REQUEST)
  })

  it.each([[null], ['']])('returns [] for %j', raw => {
    expect(parseClassNbrParam(raw)).toEqual([])
  })
})

describe('aggregateCrossListedSectionEnrollment with live seats', () => {
  const anchor = section({ classId: 100, enrolled: 5, capacity: 30, waitlist: 1, waitlistMax: 10 })
  const sibling = section({ classId: 200, enrolled: 3, capacity: 30, waitlist: 0, waitlistMax: 10 })
  const courses: Course[] = [
    { id: 'A', subject: 'A', code: '1', title: '', description: '', units: '3', grading: '', instructors: [], sections: [anchor] },
    { id: 'B', subject: 'B', code: '1', title: '', description: '', units: '3', grading: '', instructors: [], sections: [sibling] },
  ]

  it('sums both the people and the seats when there is no live reading', () => {
    // Each listing is capped separately, so the class seats 60, not 30.
    expect(aggregateCrossListedSectionEnrollment(anchor, ['A', 'B'], courses)).toEqual({
      enrolled: 8,
      capacity: 60,
      waitlist: 1,
      waitlistMax: 20,
    })
  })

  it('sums the live readings across cross-listed siblings', () => {
    const live = new Map([
      [100, seat({ classNbr: 100, enrolled: 20, capacity: 30, waitlist: 4, waitlistMax: 10 })],
      [200, seat({ classNbr: 200, enrolled: 9, capacity: 30, waitlist: 2, waitlistMax: 10 })],
    ])
    expect(aggregateCrossListedSectionEnrollment(anchor, ['A', 'B'], courses, live)).toEqual({
      enrolled: 29,
      capacity: 60,
      waitlist: 6,
      waitlistMax: 20,
    })
  })

  it('mixes a live sibling with a snapshot sibling rather than dropping either', () => {
    const live = new Map([[100, seat({ classNbr: 100, enrolled: 20, capacity: 30, waitlist: 0, waitlistMax: 10 })]])
    // Live anchor 20 + snapshot sibling 3.
    expect(aggregateCrossListedSectionEnrollment(anchor, ['A', 'B'], courses, live).enrolled).toBe(23)
  })

  it('keeps the snapshot capacity when the live reading has none, so the line still renders', () => {
    const live = new Map([[100, seat({ classNbr: 100, enrolled: 12, capacity: 0, waitlist: 0, waitlistMax: 0 })]])
    const agg = aggregateCrossListedSectionEnrollment(anchor, ['A'], courses, live)
    expect(agg).toMatchObject({ enrolled: 12, capacity: 30, waitlistMax: 10 })
  })

  it('reports a live drop to zero enrolled instead of the stale snapshot', () => {
    const live = new Map([
      [100, seat({ classNbr: 100, enrolled: 0, capacity: 30 })],
      [200, seat({ classNbr: 200, enrolled: 0, capacity: 30 })],
    ])
    expect(aggregateCrossListedSectionEnrollment(anchor, ['A', 'B'], courses, live).enrolled).toBe(0)
  })

  it('ignores a live reading for an unrelated classId', () => {
    const live = new Map([[999, seat({ classNbr: 999, enrolled: 500, capacity: 500 })]])
    expect(aggregateCrossListedSectionEnrollment(anchor, ['A', 'B'], courses, live).enrolled).toBe(8)
  })
  it('never applies a live reading to a section from another term', () => {
    // classNbr is unique per term, not globally: 1883 is CS 103 in Autumn 2026
    // and CEE 180 in Spring 2027. The aggregate only ever sees same-term
    // siblings, so a reading fetched for one term must not leak into another.
    const autumn = section({ classId: 1883, term: 'Autumn 2026', enrolled: 0, capacity: 350 })
    const spring = section({ classId: 1883, term: 'Spring 2027', enrolled: 4, capacity: 40 })
    const twoTerms: Course[] = [
      { id: 'A', subject: 'A', code: '1', title: '', description: '', units: '3', grading: '', instructors: [], sections: [autumn, spring] },
    ]
    const live = new Map([[1883, seat({ classNbr: 1883, enrolled: 300, capacity: 350 })]])
    // Autumn is what was fetched, so it takes the live number...
    expect(aggregateCrossListedSectionEnrollment(autumn, ['A'], twoTerms, live).enrolled).toBe(300)
    // ...and Spring, which shares the classNbr, must keep its own snapshot.
    expect(aggregateCrossListedSectionEnrollment(spring, ['A'], twoTerms, undefined).enrolled).toBe(4)
  })
})

describe('classifyUpstreamStatus', () => {
  it('parses a 200', () => {
    expect(classifyUpstreamStatus(200, false)).toBe('ok')
  })

  it('treats a 500 on an unknown class as a miss, not an outage', () => {
    // Verified against Navigator 2026-08-25: /api/classes/1272/99999999 -> 500,
    // and so does every invented class number. Counting those as an outage let
    // one bad id turn live seats off for every visitor.
    expect(classifyUpstreamStatus(500, false)).toBe('miss')
  })

  it('treats a 500 on a class that read cleanly before as a real failure', () => {
    expect(classifyUpstreamStatus(500, true)).toBe('failure')
    expect(classifyUpstreamStatus(503, true)).toBe('failure')
  })

  it.each([[429], [403]])('treats %i as throttling however unfamiliar the class', status => {
    expect(classifyUpstreamStatus(status, false)).toBe('throttled')
  })

  it.each([[404], [400], [301]])('treats %i as a miss', status => {
    expect(classifyUpstreamStatus(status, true)).toBe('miss')
  })
})

describe('navigatorClassUrl', () => {
  const saved = process.env.NAVIGATOR_BASE_URL
  afterEach(() => {
    if (saved === undefined) delete process.env.NAVIGATOR_BASE_URL
    else process.env.NAVIGATOR_BASE_URL = saved
  })

  it('points at the real Navigator when nothing is configured', () => {
    delete process.env.NAVIGATOR_BASE_URL
    expect(navigatorClassUrl(1272, 1883)).toBe(`${NAVIGATOR_ORIGIN}/api/classes/1272/1883`)
  })

  it('honours a local stand-in, trailing slash and all', () => {
    process.env.NAVIGATOR_BASE_URL = 'http://localhost:3300/'
    expect(navigatorClassUrl(1272, 1883)).toBe('http://localhost:3300/api/classes/1272/1883')
  })

  it('never silently drops the class number', () => {
    process.env.NAVIGATOR_BASE_URL = 'http://localhost:3300'
    expect(navigatorClassUrl(1276, 1878)).toContain('/1276/1878')
  })
})

describe('cross-listed capacity never reads under the people in it', () => {
  const mk = (classId: number, enrolled: number, capacity: number) =>
    section({ classId, enrolled, capacity, waitlist: 0, waitlistMax: 0 })

  it('reports the real pooled cap for CEE 121 / CEE 221 rather than one listing of it', () => {
    const a = mk(1, 44, 60)
    const b = mk(2, 40, 60)
    const courses: Course[] = [
      { id: 'CEE121', subject: 'CEE', code: '121', title: '', description: '', units: '3', grading: '', instructors: [], sections: [a] },
      { id: 'CEE221', subject: 'CEE', code: '221', title: '', description: '', units: '3', grading: '', instructors: [], sections: [b] },
    ]
    const agg = aggregateCrossListedSectionEnrollment(a, ['CEE121', 'CEE221'], courses)
    expect(agg).toMatchObject({ enrolled: 84, capacity: 120 })
    expect(agg.enrolled).toBeLessThanOrEqual(agg.capacity)
  })

  it('leaves a class with one listing exactly as the registrar reports it', () => {
    const only = mk(9, 30, 25)
    const courses: Course[] = [
      { id: 'X1', subject: 'X', code: '1', title: '', description: '', units: '3', grading: '', instructors: [], sections: [only] },
    ]
    // Over-enrolled single sections are real; the aggregate must not paper over them.
    expect(aggregateCrossListedSectionEnrollment(only, ['X1'], courses)).toMatchObject({ enrolled: 30, capacity: 25 })
  })
})
