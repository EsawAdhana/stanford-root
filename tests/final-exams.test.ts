import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  FINAL_EXAMS,
  clashSignature,
  clashTitle,
  examLoad,
  examSlotFor,
  formatExamColumn,
  formatExamDate,
  formatExamTime,
  type ExamEntry,
  type ScheduledExam,
} from '@/lib/final-exams'
import type { Course, Section } from '@/types/course'

const WINTER = 'Winter 2027'

function section(over: Partial<Section> & { classId: number; component: string }): Section {
  return {
    term: WINTER, sectionNumber: '01', units: 3, grading: '', classLevel: '', instructionalMode: '',
    status: 'Open', enrolled: 0, capacity: 0, waitlist: 0, waitlistMax: 0, openSeats: 0,
    startDate: '', endDate: '', meetings: [],
    ...over,
  } as Section
}

const meeting = (days: string, time: string) => ({ days, time, location: '', instructors: [] })

function course(id: string, sections: Section[], over: Partial<Course> = {}): Course {
  const [, subject, code] = /^([A-Z&]+)(.+)$/.exec(id)!
  return { id, subject, code, title: id, description: '', units: '3', grading: '', instructors: [], terms: [WINTER], sections, ...over }
}

/** A one-lecture course meeting `days` at `time`, in Winter unless told otherwise. */
function lecture(id: string, days: string, time: string, term = WINTER): Course {
  return course(id, [section({ classId: 1, component: 'LEC', term, meetings: [meeting(days, time)] })], { terms: [term] })
}

function slot(c: Course, term = WINTER) {
  const s = examSlotFor(c, term)
  if (!s || s.kind !== 'slot') return s
  return `${formatExamDate(s.date)} ${formatExamTime(s.start, s.end)}${s.group ? ' group' : ''}`
}

describe('examSlotFor reads the Registrar grid', () => {
  it('places each day family by start time (Winter 2027)', () => {
    expect(slot(lecture('CS229', 'Monday, Wednesday', '10:30 AM – 11:50 AM'))).toBe('Mon, Mar 15 3:30-6:30 PM')
    expect(slot(lecture('CS161', 'Monday, Wednesday, Friday', '1:30 PM – 2:50 PM'))).toBe('Wed, Mar 17 3:30-6:30 PM')
    expect(slot(lecture('X1', 'Tuesday, Thursday', '1:30 PM – 2:50 PM'))).toBe('Tue, Mar 16 3:30-6:30 PM')
    expect(slot(lecture('X2', 'Tuesday, Thursday', '9:00 AM – 10:20 AM'))).toBe('Wed, Mar 17 8:30-11:30 AM')
    expect(slot(lecture('X3', 'Monday, Wednesday', '9:30 AM – 10:20 AM'))).toBe('Thu, Mar 18 8:30-11:30 AM')
    expect(slot(lecture('X4', 'Tuesday, Thursday', '3:00 PM – 4:20 PM'))).toBe('Thu, Mar 18 12:15-3:15 PM')
    expect(slot(lecture('X5', 'Tuesday, Thursday', '12:00 PM – 1:20 PM'))).toBe('Fri, Mar 19 12:15-3:15 PM')
    expect(slot(lecture('X6', 'Monday, Wednesday, Friday', '3:30 PM – 4:20 PM'))).toBe('Wed, Mar 17 7-10 PM')
  })

  it('treats one M/W/F day as the MWF family', () => {
    expect(slot(lecture('X7', 'Monday', '12:30 PM – 3:20 PM'))).toBe('Fri, Mar 19 3:30-6:30 PM')
    expect(slot(lecture('X8', 'Friday', '2:30 PM – 4:20 PM'))).toBe('Tue, Mar 16 8:30-11:30 AM')
  })

  it('files Monday through Thursday, with or without Friday, under MWF', () => {
    expect(slot(lecture('X9', 'Monday, Tuesday, Wednesday, Thursday, Friday', '11:30 AM – 12:20 PM'))).toBe('Fri, Mar 19 8:30-11:30 AM')
    expect(slot(lecture('X10', 'Monday, Tuesday, Wednesday, Thursday', '8:30 AM – 9:20 AM'))).toBe('Mon, Mar 15 8:30-11:30 AM')
  })

  it('places 4:30 and 5:30-or-later classes on any day', () => {
    expect(slot(lecture('CS224N', 'Tuesday, Thursday', '4:30 PM – 5:50 PM'))).toBe('Mon, Mar 15 7-10 PM')
    expect(slot(lecture('X11', 'Wednesday', '6:00 PM – 8:50 PM'))).toBe('Thu, Mar 18 7-10 PM')
    expect(slot(lecture('X12', 'Tuesday', '5:30 PM – 6:50 PM'))).toBe('Thu, Mar 18 7-10 PM')
  })

  it('says off-grid for a start time or day mix the grid does not list', () => {
    expect(examSlotFor(lecture('X13', 'Monday, Wednesday', '5:00 PM – 6:20 PM'), WINTER)?.kind).toBe('off-grid')
    expect(examSlotFor(lecture('X14', 'Monday, Wednesday, Friday', '12:00 PM – 12:50 PM'), WINTER)?.kind).toBe('off-grid')
    expect(examSlotFor(lecture('X15', 'Tuesday, Thursday', '4:15 PM – 5:45 PM'), WINTER)?.kind).toBe('off-grid')
    // M + T is neither family, and 10:30 is not an any-day time.
    expect(examSlotFor(lecture('X16', 'Monday, Tuesday', '10:30 AM – 11:50 AM'), WINTER)?.kind).toBe('off-grid')
    expect(examSlotFor(lecture('X17', 'Tuesday, Friday', '9:30 AM – 10:20 AM'), WINTER)?.kind).toBe('off-grid')
    // A weekend day breaks MTWTh(F).
    expect(examSlotFor(lecture('X18', 'Monday, Tuesday, Wednesday, Thursday, Saturday', '8:30 AM – 9:20 AM'), WINTER)?.kind).toBe('off-grid')
  })

  it('says no-time when nothing has a meeting time', () => {
    expect(examSlotFor(lecture('X19', 'TBA', ''), WINTER)).toEqual({ kind: 'no-time' })
    expect(examSlotFor(course('X20', []), WINTER)).toEqual({ kind: 'no-time' })
  })

  it('returns null for a term with no published schedule', () => {
    expect(examSlotFor(lecture('X21', 'Monday', '10:30 AM – 11:20 AM', 'Autumn 2027'), 'Autumn 2027')).toBeNull()
  })
})

describe('group exams override the meeting time', () => {
  it('puts CS 106A on the CS group slot, not its MWF 11:30 lecture slot', () => {
    expect(slot(lecture('CS106A', 'Monday, Wednesday, Friday', '11:30 AM – 12:20 PM'))).toBe('Mon, Mar 15 8:30-11:30 AM group')
  })

  it('uses each quarter\'s own list', () => {
    expect(slot(lecture('MATH51', 'Monday, Wednesday, Friday', '10:30 AM – 11:20 AM'))).toBe('Tue, Mar 16 12:15-3:15 PM group')
    // CS 106AX has a group exam in Autumn only; in Winter its meeting time decides.
    expect(slot(lecture('CS106AX', 'Monday, Wednesday, Friday', '10:30 AM – 11:20 AM'))).toBe('Mon, Mar 15 3:30-6:30 PM')
    expect(slot(lecture('CS106AX', 'Monday, Wednesday, Friday', '10:30 AM – 11:20 AM', 'Autumn 2026'), 'Autumn 2026')).toBe('Mon, Dec 7 8:30-11:30 AM group')
  })

  it('matches the whole code, so MATH 51A is not MATH 51', () => {
    expect(slot(lecture('MATH51A', 'Monday, Wednesday, Friday', '10:30 AM – 11:20 AM'))).toBe('Mon, Mar 15 3:30-6:30 PM')
  })

  it('lists only real catalog courses', () => {
    const rows: { course_id: string }[] = JSON.parse(fs.readFileSync('data/catalog/light.json', 'utf8'))
    const ids = new Set(rows.map(r => r.course_id))
    for (const [term, schedule] of Object.entries(FINAL_EXAMS)) {
      for (const g of schedule.groups) {
        for (const code of g.codes) expect(ids.has(`${g.subject}${code}`), `${term} ${g.subject} ${code}`).toBe(true)
      }
    }
  })
})

describe('which section decides', () => {
  const lec = section({ classId: 10, component: 'LEC', meetings: [meeting('Monday, Wednesday', '10:30 AM – 11:50 AM')] })
  const dis = section({ classId: 11, component: 'DIS', sectionNumber: '02', meetings: [meeting('Friday', '9:30 AM – 10:20 AM')] })

  it('takes the lecture of a LEC + DIS pick', () => {
    expect(slot(course('CS221', [dis, lec], { selectedSectionIds: [11, 10] }))).toBe('Mon, Mar 15 3:30-6:30 PM')
  })

  it('takes the lecture when nothing is picked', () => {
    expect(slot(course('CS221', [dis, lec]))).toBe('Mon, Mar 15 3:30-6:30 PM')
  })

  it('takes the only lecture when just a discussion is picked', () => {
    expect(slot(course('CS221', [dis, lec], { selectedSectionIds: [11] }))).toBe('Mon, Mar 15 3:30-6:30 PM')
  })

  it('says it depends on the lecture when just a discussion is picked and the lectures differ', () => {
    // The discussion alone (Fri 9:30) would read as Thu 8:30 AM, which is no lecture's slot.
    const lec2 = section({ classId: 12, component: 'LEC', sectionNumber: '02', meetings: [meeting('Tuesday, Thursday', '1:30 PM – 2:50 PM')] })
    expect(examSlotFor(course('CS221', [dis, lec, lec2], { selectedSectionIds: [11] }), WINTER)).toEqual({ kind: 'pick-lecture' })
  })

  it('takes the slot when every lecture lands in it', () => {
    const lec2 = section({ classId: 12, component: 'LEC', sectionNumber: '02', meetings: [meeting('Monday, Wednesday', '10:30 AM – 11:20 AM')] })
    expect(slot(course('CS221', [dis, lec, lec2], { selectedSectionIds: [11] }))).toBe('Mon, Mar 15 3:30-6:30 PM')
  })

  it('goes by the lecture once one is picked with the discussion', () => {
    const lec2 = section({ classId: 12, component: 'LEC', sectionNumber: '02', meetings: [meeting('Tuesday, Thursday', '1:30 PM – 2:50 PM')] })
    expect(slot(course('CS221', [dis, lec, lec2], { selectedSectionIds: [11, 12] }))).toBe('Tue, Mar 16 3:30-6:30 PM')
  })

  it('says no time, not a slot, when none of the lectures has a time', () => {
    const tba1 = section({ classId: 14, component: 'LEC', meetings: [meeting('TBA', '')] })
    const tba2 = section({ classId: 15, component: 'LEC', sectionNumber: '02', meetings: [] })
    expect(examSlotFor(course('CS221', [dis, tba1, tba2], { selectedSectionIds: [11] }), WINTER)).toEqual({ kind: 'no-time' })
  })

  it('says it depends when one lecture has a time and another has none', () => {
    const tba = section({ classId: 14, component: 'LEC', sectionNumber: '02', meetings: [] })
    expect(examSlotFor(course('CS221', [dis, lec, tba], { selectedSectionIds: [11] }), WINTER)).toEqual({ kind: 'pick-lecture' })
  })

  it('ignores another term\'s sections', () => {
    const autumnLec = section({ classId: 13, component: 'LEC', term: 'Autumn 2026', meetings: [meeting('Tuesday, Thursday', '9:00 AM – 10:20 AM')] })
    expect(slot(course('CS221', [autumnLec, lec]))).toBe('Mon, Mar 15 3:30-6:30 PM')
  })
})

describe('Spring and Summer', () => {
  it('uses Spring\'s Saturday', () => {
    expect(slot(lecture('X30', 'Monday, Wednesday, Friday', '2:30 PM – 3:20 PM', 'Spring 2027'), 'Spring 2027')).toBe('Sat, Jun 5 8:30-11:30 AM')
    expect(slot(lecture('X31', 'Tuesday, Thursday', '9:00 AM – 10:20 AM', 'Spring 2027'), 'Spring 2027')).toBe('Mon, Jun 7 8:30-11:30 AM')
  })

  it('goes by start time alone in Summer', () => {
    expect(slot(lecture('X32', 'Tuesday, Thursday', '10:30 AM – 11:50 AM', 'Summer 2027'), 'Summer 2027')).toBe('Sat, Aug 14 8:30-11:30 AM')
    expect(slot(lecture('X33', 'Monday', '6:00 PM – 8:50 PM', 'Summer 2027'), 'Summer 2027')).toBe('Sat, Aug 14 7-10 PM')
  })

  it('has the weekdays the Registrar prints for every exam day', () => {
    const expected: Record<string, string[]> = {
      'Autumn 2026': ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
      'Winter 2027': ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
      'Spring 2027': ['Fri', 'Sat', 'Mon', 'Tue', 'Wed'],
      'Summer 2027': ['Fri', 'Sat'],
    }
    for (const [term, days] of Object.entries(expected)) {
      expect(FINAL_EXAMS[term].days.map(d => formatExamColumn(d).split(' ')[0]), term).toEqual(days)
    }
  })
})

describe('examLoad', () => {
  const exam = (date: string, start: number): ScheduledExam => ({ kind: 'slot', day: 0, date, start, end: start + 180, group: false })
  const entry = (courseId: string, date: string, start: number): ExamEntry => ({ courseId, label: courseId, exam: exam(date, start) })

  it('flags two exams in one slot as a clash', () => {
    const load = examLoad([entry('CS161', '2027-03-17', 930), entry('CS229', '2027-03-17', 930), entry('CS224N', '2027-03-15', 1140)])
    expect(load.clashes).toHaveLength(1)
    expect(load.clashes[0].entries.map(e => e.courseId)).toEqual(['CS161', 'CS229'])
    expect(load.heavyDays).toEqual([])
  })

  it('warns at three exams in a day, not two', () => {
    const two = examLoad([entry('A', '2027-03-15', 510), entry('B', '2027-03-15', 930)])
    expect(two.heavyDays).toEqual([])
    const three = examLoad([entry('C', '2027-03-15', 1140), entry('A', '2027-03-15', 510), entry('B', '2027-03-15', 930)])
    expect(three.heavyDays).toHaveLength(1)
    expect(three.heavyDays[0].entries.map(e => e.courseId)).toEqual(['A', 'B', 'C'])
    expect(three.clashes).toEqual([])
  })

  it('counts a clash pair toward the day', () => {
    const load = examLoad([entry('A', '2027-03-15', 510), entry('B', '2027-03-15', 510), entry('C', '2027-03-15', 930)])
    expect(load.clashes).toHaveLength(1)
    expect(load.heavyDays).toHaveLength(1)
  })

  it('gives the same signature whatever order the schedule lists courses', () => {
    const a = examLoad([entry('CS161', '2027-03-17', 930), entry('CS229', '2027-03-17', 930)])
    const b = examLoad([entry('CS229', '2027-03-17', 930), entry('CS161', '2027-03-17', 930)])
    expect(clashSignature(a.clashes)).toBe(clashSignature(b.clashes))
    expect(clashSignature([])).toBe('')
  })

  it('titles a clash by how many finals share the slot', () => {
    const two = examLoad([entry('CS145', '2026-12-07', 1140), entry('CS329X', '2026-12-07', 1140)])
    expect(clashTitle(two.clashes)).toBe('Two of your finals overlap')
    const three = examLoad([entry('A', '2026-12-07', 1140), entry('B', '2026-12-07', 1140), entry('C', '2026-12-07', 1140)])
    expect(clashTitle(three.clashes)).toBe('Three of your finals overlap')
  })

  it('counts slots instead when finals clash in more than one', () => {
    const load = examLoad([
      entry('A', '2026-12-07', 1140), entry('B', '2026-12-07', 1140),
      entry('C', '2026-12-09', 510), entry('D', '2026-12-09', 510),
    ])
    expect(clashTitle(load.clashes)).toBe('Your finals overlap in 2 exam slots')
  })

  it('falls back to a numeral past six finals in one slot', () => {
    const seven = examLoad('ABCDEFG'.split('').map(id => entry(id, '2026-12-07', 1140)))
    expect(clashTitle(seven.clashes)).toBe('7 of your finals overlap')
  })
})

describe('formatting', () => {
  it('prints times the way the Registrar does', () => {
    expect(formatExamTime(510, 690)).toBe('8:30-11:30 AM')
    expect(formatExamTime(735, 915)).toBe('12:15-3:15 PM')
    expect(formatExamTime(1140, 1320)).toBe('7-10 PM')
    expect(formatExamTime(690, 870)).toBe('11:30 AM-2:30 PM')
  })

  it('prints dates without drifting across timezones', () => {
    expect(formatExamDate('2027-03-16')).toBe('Tue, Mar 16')
    expect(formatExamColumn('2026-12-07')).toBe('Mon 12/7')
  })
})
