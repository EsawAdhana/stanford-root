import { describe, it, expect } from 'vitest'
import { pickSectionsForTerm, parseMeetingTimes, stripSeconds, standInSectionChanged, parseDays, scheduledCrossListMember } from '@/lib/schedule-utils'
import { getCrossListPrimaryMap } from '@/lib/utils'
import type { Course, Section } from '@/types/course'

const TERM = 'Autumn 2026'

function section(over: Partial<Section> & { classId: number; component: string }): Section {
  return {
    term: TERM,
    sectionNumber: '01',
    units: 3,
    grading: '',
    classLevel: '',
    instructionalMode: '',
    status: 'Open',
    enrolled: 0,
    capacity: 0,
    waitlist: 0,
    waitlistMax: 0,
    openSeats: 0,
    startDate: '',
    endDate: '',
    meetings: [],
    ...over,
  } as Section
}

function meeting(days: string, time: string) {
  return { days, time, location: '', instructors: [] }
}

function course(sections: Section[]): Course {
  return {
    id: 'CS106A', subject: 'CS', code: '106A', title: 'Programming Methodology',
    description: '', units: '3-5', grading: '', instructors: [], terms: [TERM], sections,
  }
}

describe('pickSectionsForTerm — no section chosen yet', () => {
  // ExploreCourses returns CS106A's 60 discussions ahead of its single lecture.
  // Taking sections[0] put a random discussion on the calendar and dropped the
  // lecture entirely.
  it('stands in with the lecture even when discussions come first', () => {
    const c = course([
      section({ classId: 1, component: 'DIS', sectionNumber: '10', meetings: [meeting('Wednesday', '5:30:00 PM – 6:20:00 PM')] }),
      section({ classId: 2, component: 'DIS', sectionNumber: '02', meetings: [meeting('Wednesday', '2:30:00 PM – 3:20:00 PM')] }),
      section({ classId: 3, component: 'LEC', sectionNumber: '01', meetings: [meeting('Monday Wednesday Friday', '11:30:00 AM – 12:20:00 PM')] }),
    ])

    expect(pickSectionsForTerm(c, TERM).map(s => s.classId)).toEqual([3])
    expect(parseMeetingTimes(c, TERM)).toEqual([
      { days: ['Mon', 'Wed', 'Fri'], startTime: '11:30:00 AM', endTime: '12:20:00 PM', location: '' },
    ])
  })

  it('prefers a lab-adjacent primary too (LBS never stands in for LEC)', () => {
    const c = course([
      section({ classId: 1, component: 'LBS', meetings: [meeting('Wednesday', '3:30:00 PM – 5:20:00 PM')] }),
      section({ classId: 2, component: 'LEC', meetings: [meeting('Monday Wednesday Friday', '12:30:00 PM – 1:20:00 PM')] }),
    ])
    expect(pickSectionsForTerm(c, TERM).map(s => s.classId)).toEqual([2])
  })

  it('falls back to SEM when a course has no lecture', () => {
    const c = course([
      section({ classId: 1, component: 'DIS', meetings: [meeting('Friday', '9:30:00 AM – 10:20:00 AM')] }),
      section({ classId: 2, component: 'SEM', meetings: [meeting('Tuesday', '1:30:00 PM – 4:20:00 PM')] }),
    ])
    expect(pickSectionsForTerm(c, TERM).map(s => s.classId)).toEqual([2])
  })

  it('prefers a section that can actually be drawn over an untimed one', () => {
    const c = course([
      section({ classId: 1, component: 'LEC', meetings: [meeting('', '')] }),
      section({ classId: 2, component: 'LEC', meetings: [meeting('Tuesday Thursday', '10:30:00 AM – 11:50:00 AM')] }),
    ])
    expect(pickSectionsForTerm(c, TERM).map(s => s.classId)).toEqual([2])
  })

  // MATH 51 has five lectures and the catalog dump reorders them between
  // refreshes, so source order would change the displayed time overnight.
  it('picks the lowest-numbered lecture regardless of source order', () => {
    const sections = [
      section({ classId: 5, component: 'LEC', sectionNumber: '05', meetings: [meeting('Monday', '1:30:00 PM – 2:20:00 PM')] }),
      section({ classId: 4, component: 'LEC', sectionNumber: '04', meetings: [meeting('Monday', '12:30:00 PM – 1:20:00 PM')] }),
      section({ classId: 1, component: 'LEC', sectionNumber: '01', meetings: [meeting('Monday', '9:30:00 AM – 10:20:00 AM')] }),
    ]
    expect(pickSectionsForTerm(course(sections), TERM).map(s => s.classId)).toEqual([1])
    // Reordered dump must not change the answer.
    const reordered = [sections[2], sections[0], sections[1]]
    expect(pickSectionsForTerm(course(reordered), TERM).map(s => s.classId)).toEqual([1])
  })

  it('still returns exactly one section, not all 60 discussions', () => {
    const c = course([
      ...Array.from({ length: 60 }, (_, i) =>
        section({ classId: 100 + i, component: 'DIS', meetings: [meeting('Wednesday', '5:30:00 PM – 6:20:00 PM')] })),
      section({ classId: 3, component: 'LEC', meetings: [meeting('Monday', '11:30:00 AM – 12:20:00 PM')] }),
    ])
    expect(pickSectionsForTerm(c, TERM)).toHaveLength(1)
  })
})

describe('pickSectionsForTerm — explicit picks win', () => {
  it('returns every component the user picked', () => {
    const c: Course = {
      ...course([
        section({ classId: 1, component: 'LEC', meetings: [meeting('Monday', '11:30:00 AM – 12:20:00 PM')] }),
        section({ classId: 2, component: 'DIS', meetings: [meeting('Wednesday', '2:30:00 PM – 3:20:00 PM')] }),
        section({ classId: 3, component: 'DIS', meetings: [meeting('Thursday', '4:30:00 PM – 5:20:00 PM')] }),
      ]),
      selectedSectionIds: [1, 3],
    }
    expect(pickSectionsForTerm(c, TERM).map(s => s.classId)).toEqual([1, 3])
  })

  it('ignores sections from other terms', () => {
    const c = course([
      section({ classId: 1, component: 'LEC', term: 'Winter 2027', meetings: [meeting('Monday', '9:30:00 AM – 10:20:00 AM')] }),
      section({ classId: 2, component: 'LEC', term: TERM, meetings: [meeting('Friday', '1:30:00 PM – 2:20:00 PM')] }),
    ])
    expect(pickSectionsForTerm(c, TERM).map(s => s.classId)).toEqual([2])
  })
})

describe('standInSectionChanged — who gets the one-off notice', () => {
  const lectureLast = [
    section({ classId: 1, component: 'DIS', sectionNumber: '10', meetings: [meeting('Wednesday', '5:30:00 PM – 6:20:00 PM')] }),
    section({ classId: 3, component: 'LEC', sectionNumber: '01', meetings: [meeting('Monday', '11:30:00 AM – 12:20:00 PM')] }),
  ]

  it('flags an unpicked course whose stand-in moved off the old index-0 section', () => {
    expect(standInSectionChanged(course(lectureLast), TERM)).toBe(true)
  })

  it('stays quiet when the lecture was already first', () => {
    const lectureFirst = [lectureLast[1], lectureLast[0]]
    expect(standInSectionChanged(course(lectureFirst), TERM)).toBe(false)
  })

  it('stays quiet when the user picked a section themselves', () => {
    expect(standInSectionChanged({ ...course(lectureLast), selectedSectionIds: [1] }, TERM)).toBe(false)
  })

  it('stays quiet for a single-section course', () => {
    const one = [section({ classId: 9, component: 'LEC', meetings: [meeting('Friday', '9:30:00 AM – 10:20:00 AM')] })]
    expect(standInSectionChanged(course(one), TERM)).toBe(false)
  })

  it('ignores sections outside the saved term', () => {
    const c = course([
      section({ classId: 1, component: 'DIS', term: 'Winter 2027', meetings: [meeting('Wednesday', '5:30:00 PM – 6:20:00 PM')] }),
      section({ classId: 2, component: 'LEC', term: TERM, meetings: [meeting('Monday', '11:30:00 AM – 12:20:00 PM')] }),
    ])
    expect(standInSectionChanged(c, TERM)).toBe(false)
  })
})

describe('stripSeconds', () => {
  it('drops seconds without eating on-the-hour minutes', () => {
    expect(stripSeconds('2:30:00 PM – 3:20:00 PM')).toBe('2:30 PM – 3:20 PM')
    expect(stripSeconds('3:00:00 PM – 4:20:00 PM')).toBe('3:00 PM – 4:20 PM')
    expect(stripSeconds('12:00:00 PM – 1:00:00 PM')).toBe('12:00 PM – 1:00 PM')
  })

  it('leaves already-clean and empty values alone', () => {
    expect(stripSeconds('2:30 PM – 3:20 PM')).toBe('2:30 PM – 3:20 PM')
    expect(stripSeconds('')).toBe('')
  })
})

describe('parseDays — weekend meetings', () => {
  // 39 sections in the Autumn 2026 catalog meet on a weekend (CHPR233,
  // CSRE127B, BIOS215). Before Sat/Sun existed in DAY_ORDER these parsed to []
  // and the class silently vanished from the schedule.
  it('parses a lone weekend day', () => {
    expect(parseDays('Saturday')).toEqual(['Sat'])
    expect(parseDays('Sunday')).toEqual(['Sun'])
  })

  it('parses the abbreviations Stanford data uses', () => {
    expect(parseDays('Sat')).toEqual(['Sat'])
    expect(parseDays('Sun')).toEqual(['Sun'])
    expect(parseDays('Sa, Su')).toEqual(['Sat', 'Sun'])
  })

  it('orders a weekend day after the weekdays', () => {
    expect(parseDays('Saturday, Monday')).toEqual(['Mon', 'Sat'])
    expect(parseDays('Sunday, Saturday')).toEqual(['Sat', 'Sun'])
  })

  it('handles the real ExploreCourses whitespace shape', () => {
    // BIOS215 Autumn 2026, verbatim from data/catalog/full.json.
    expect(parseDays('Sunday\n\t\t\t\n\t\t\tSaturday')).toEqual(['Sat', 'Sun'])
  })

  it('still parses weekday-only patterns unchanged', () => {
    expect(parseDays('Monday\n\t\t\t\n\t\t\tWednesday')).toEqual(['Mon', 'Wed'])
    expect(parseDays('MWF')).toEqual(['Mon', 'Wed', 'Fri'])
    expect(parseDays('TuTh')).toEqual(['Tue', 'Thu'])
    expect(parseDays('Tues, Thurs')).toEqual(['Tue', 'Thu'])
  })

  it('does not invent days from junk', () => {
    expect(parseDays('')).toEqual([])
    expect(parseDays('TBA')).toEqual([])
    expect(parseDays('Not Applicable')).toEqual([])
  })
})

describe('scheduledCrossListMember — one class, one slot on the schedule', () => {
    /** COMM 172 / COMM 272 are the same Winter class; CS 106A is unrelated. */
    const catalog = [
        { id: 'COMM172', subject: 'COMM', code: '172', title: 'Media Psychology (COMM 272)' },
        { id: 'COMM272', subject: 'COMM', code: '272', title: 'Media Psychology (COMM 172)' },
        { id: 'CS106A', subject: 'CS', code: '106A', title: 'Programming Methodology' },
    ]
    const primaryMap = getCrossListPrimaryMap(catalog)

    it('reports the sibling already on the schedule', () => {
        const scheduled = [{ id: 'COMM172', subject: 'COMM', code: '172' }]
        expect(scheduledCrossListMember('COMM272', scheduled, primaryMap)?.id).toBe('COMM172')
    })

    it('works from either listing', () => {
        const scheduled = [{ id: 'COMM272', subject: 'COMM', code: '272' }]
        expect(scheduledCrossListMember('COMM172', scheduled, primaryMap)?.id).toBe('COMM272')
    })

    it('still reports the course itself when it is the one scheduled', () => {
        const scheduled = [{ id: 'COMM172', subject: 'COMM', code: '172' }]
        expect(scheduledCrossListMember('COMM172', scheduled, primaryMap)?.id).toBe('COMM172')
    })

    it('does not block an unrelated course', () => {
        const scheduled = [{ id: 'COMM172', subject: 'COMM', code: '172' }]
        expect(scheduledCrossListMember('CS106A', scheduled, primaryMap)).toBeUndefined()
    })

    it('matches regardless of id casing or spacing', () => {
        const scheduled = [{ id: 'comm 172', subject: 'COMM', code: '172' }]
        expect(scheduledCrossListMember('COMM272', scheduled, primaryMap)?.id).toBe('comm 172')
    })

    it('finds nothing on an empty schedule', () => {
        expect(scheduledCrossListMember('COMM272', [], primaryMap)).toBeUndefined()
    })
})
