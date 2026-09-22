import { describe, it, expect } from 'vitest'
import { isScheduledForTerm, scheduledSectionIds, pickSectionsForTerm } from '@/lib/schedule-utils'
import type { Course, Section } from '@/types/course'

const TERM = 'Autumn 2026'
const OTHER_TERM = 'Winter 2027'

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

function course(sections: Section[], over: Partial<Course> = {}): Course {
  return {
    id: 'CS106A', subject: 'CS', code: '106A', title: 'Programming Methodology',
    description: '', units: '3-5', grading: '', instructors: [], terms: [TERM], sections,
    ...over,
  }
}

const CS106A = course([
  section({ classId: 1, component: 'DIS', sectionNumber: '10', meetings: [meeting('Wednesday', '5:30:00 PM – 6:20:00 PM')] }),
  section({ classId: 2, component: 'DIS', sectionNumber: '02', meetings: [meeting('Wednesday', '2:30:00 PM – 3:20:00 PM')] }),
  section({ classId: 3, component: 'LEC', sectionNumber: '01', meetings: [meeting('Monday Wednesday Friday', '11:30:00 AM – 12:20:00 PM')] }),
  section({ classId: 4, component: 'LEC', sectionNumber: '01', term: OTHER_TERM, meetings: [meeting('Tuesday Thursday', '9:00:00 AM – 10:20:00 AM')] }),
])

// The course page marks a section "Added" from these ids. Every case below is one
// where the calendar draws a block and the page used to show "View on Calendar"
// on all of the course's sections, because it read selectedSectionIds directly.
describe('scheduledSectionIds — agrees with what the calendar draws', () => {
  it('reports the stand-in for a quick-add that carries no section pick', () => {
    // addItem(course, currentTerm) from the schedule search: term, no sectionId.
    const entry = { selectedTerm: TERM }

    expect(scheduledSectionIds(CS106A, entry, TERM)).toEqual([3])
    expect(scheduledSectionIds(CS106A, entry, TERM))
      .toEqual(pickSectionsForTerm({ ...CS106A, selectedSectionIds: undefined }, TERM).map(s => s.classId))
  })

  it('reports the stand-in when a saved pick no longer exists in the catalog', () => {
    // A catalog refresh reissues classIds; the saved 9999 matches nothing, so the
    // calendar falls back to the lecture and the page has to say the same.
    const entry = { selectedTerm: TERM, selectedSectionIds: [9999] }

    expect(scheduledSectionIds(CS106A, entry, TERM)).toEqual([3])
  })

  it('reports the stand-in for an entry saved with no term at all', () => {
    // An .ics import whose course carried no term still shows on every term it is
    // offered in — that is the schedule view's filter.
    const entry = { terms: [TERM] }

    expect(scheduledSectionIds(CS106A, entry, TERM)).toEqual([3])
  })

  it('reports an empty pick array as the stand-in, not as nothing scheduled', () => {
    const entry = { selectedTerm: TERM, selectedSectionIds: [] }

    expect(scheduledSectionIds(CS106A, entry, TERM)).toEqual([3])
  })

  it('keeps every real pick when the student chose LEC + DIS', () => {
    const entry = { selectedTerm: TERM, selectedSectionIds: [3, 2] }

    expect(scheduledSectionIds(CS106A, entry, TERM).sort()).toEqual([2, 3])
  })

  it('does not leak a pick saved for another term into this one', () => {
    // classId 4 is the Winter lecture; asking about Autumn must not return it,
    // and must not stand in for Autumn either.
    const entry = { selectedTerm: OTHER_TERM, selectedSectionIds: [4] }

    expect(scheduledSectionIds(CS106A, entry, TERM)).toEqual([])
    expect(scheduledSectionIds(CS106A, entry, OTHER_TERM)).toEqual([4])
  })

  it('returns nothing for a course that is not on the schedule', () => {
    expect(scheduledSectionIds(CS106A, undefined, TERM)).toEqual([])
  })

  it('returns nothing for a term the course does not offer', () => {
    const entry = { selectedTerm: 'Spring 2027' }

    expect(scheduledSectionIds(CS106A, entry, 'Spring 2027')).toEqual([])
  })

  it('returns nothing when the course carries no sections yet', () => {
    // The persisted cart is metadata-only until the catalog hydrates it.
    const bare = course([])

    expect(scheduledSectionIds(bare, { selectedTerm: TERM }, TERM)).toEqual([])
  })
})

describe('isScheduledForTerm', () => {
  it('matches on the saved term when there is one', () => {
    expect(isScheduledForTerm({ selectedTerm: TERM, terms: [OTHER_TERM] }, TERM)).toBe(true)
    expect(isScheduledForTerm({ selectedTerm: TERM, terms: [OTHER_TERM] }, OTHER_TERM)).toBe(false)
  })

  it('falls back to the offered terms only when no term was saved', () => {
    expect(isScheduledForTerm({ terms: [TERM] }, TERM)).toBe(true)
    expect(isScheduledForTerm({ terms: [OTHER_TERM] }, TERM)).toBe(false)
  })

  it('is false for an entry with neither', () => {
    expect(isScheduledForTerm({}, TERM)).toBe(false)
  })
})
