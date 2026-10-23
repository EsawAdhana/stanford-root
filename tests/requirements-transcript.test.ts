import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findTerm, parseTranscript } from '@/lib/requirements/transcript'

/**
 * Synthetic samples in the layouts the parser targets. None is a real
 * student's transcript: the rows follow PeopleSoft's unofficial transcript
 * columns and My Academic Path's class history, with made-up grades.
 */

const rows: [string][] = JSON.parse(readFileSync(join(__dirname, '..', 'public', 'requirements', 'courses.json'), 'utf8')).rows
const SUBJECTS = new Set(rows.map(r => r[0].split(' ')[0]))

const AXESS = `
Stanford University Unofficial Transcript
Name: Student, Sample   Student ID: 00000000
Print Date: 10/22/2026
Academic Program History
Program: Undergraduate Matriculated
Test Credits Applied Toward Undergraduate Matriculated
MATH 19 CALCULUS 3.00 3.00 CR
MATH 20 CALCULUS 3.00 3.00 CR
Beginning of Undergraduate Record
2023-2024 Autumn
Course Title Attempted Earned Grade Points
COLLEGE 101 LEC WHY COLLEGE? YOUR EDUCATION AND THE GOOD LIFE 3.00 3.00 A 12.000
CS 106B LEC PROGRAMMING ABSTRACTIONS 5.00 5.00 A- 18.500
MATH 51 LEC LINEAR ALGEBRA, MULTIVARIABLE CALCULUS 5.00 5.00 B+ 16.500
PHYSICS 41 LEC MECHANICS 4.00 4.00 S 0.000
TERM GPA: 3.78 TERM TOTALS: 17.00 17.00
2023-2024 Winter
CS 107 LEC COMPUTER ORGANIZATION AND SYSTEMS 5.00 5.00 A 20.000
ATHLETIC 10 ACT VARSITY SPORT EXPERIENCE 1.00 1.00 S 0.000
PHYSICS 43 LEC ELECTRICITY AND MAGNETISM 4.00 0.00 NP 0.000
2023-2024 Spring
CS 161 LEC DESIGN AND ANALYSIS OF ALGORITHMS 5.00 0.00 W 0.000
CUM GPA: 3.80
Beginning of Graduate Record
2026-2027 Autumn
CS 229 LEC MACHINE LEARNING 4.00 0.00
CS 247G LEC DESIGN FOR PLAY 4.00 0.00
`

describe('Axess unofficial transcript', () => {
  const { courses, skipped } = parseTranscript(AXESS, SUBJECTS)
  const byCode = Object.fromEntries(courses.map(c => [c.code, c]))

  it('reads every course row and nothing else', () => {
    expect(courses.map(c => c.code)).toEqual([
      'MATH 19', 'MATH 20', 'COLLEGE 101', 'CS 106B', 'MATH 51', 'PHYSICS 41', 'CS 107', 'ATHLETIC 10', 'PHYSICS 43', 'CS 161', 'CS 229', 'CS 247G',
    ])
    expect(skipped).toEqual([])
  })

  it('turns "2023-2024 Winter" into Winter 2024 and Autumn into the first year', () => {
    expect(byCode['COLLEGE 101'].term).toBe('Autumn 2023')
    expect(byCode['CS 107'].term).toBe('Winter 2024')
    expect(byCode['CS 161'].term).toBe('Spring 2024')
  })

  it('reads units and grade from the end of the row', () => {
    expect(byCode['CS 106B']).toMatchObject({ units: 5, grade: 'A-', title: 'Programming Abstractions' })
    expect(byCode['PHYSICS 41']).toMatchObject({ units: 4, grade: 'S' })
    expect(byCode['PHYSICS 43']).toMatchObject({ units: 4, grade: 'NP' })
  })

  it('files test credit under Test credit and graduate courses under the graduate career', () => {
    expect(byCode['MATH 19']).toMatchObject({ term: 'Test credit', grade: 'CR' })
    expect(byCode['CS 106B'].career).toBe('UG')
    expect(byCode['CS 229']).toMatchObject({ career: 'GR', term: 'Autumn 2026', units: 4, grade: '' })
  })
})

describe('My Academic Path class history', () => {
  it('reads the term from the row', () => {
    const { courses } = parseTranscript(['CS 106B - Programming Abstractions AU/23 5 A', 'CS 107 Computer Organization WI/24 5 A-', 'ENGLISH 106A AI 360 SP/26 5 IP'].join('\n'), SUBJECTS)
    expect(courses.map(c => [c.code, c.term, c.units, c.grade])).toEqual([
      ['CS 106B', 'Autumn 2023', 5, 'A'],
      ['CS 107', 'Winter 2024', 5, 'A-'],
      ['ENGLISH 106A', 'Spring 2026', 5, ''],
    ])
  })
})

describe('a typed list', () => {
  it('reads "code, term, units, grade" and "code grade units"', () => {
    const { courses } = parseTranscript('Autumn 2024\nCS 103 A 5\ncs106a, Autumn 2023, 5, B+\nMS&E 211 4', SUBJECTS)
    expect(courses.map(c => [c.code, c.term, c.units, c.grade])).toEqual([
      ['CS 103', 'Autumn 2024', 5, 'A'],
      ['CS 106A', 'Autumn 2023', 5, 'B+'],
      ['MS&E 211', 'Autumn 2024', 4, ''],
    ])
  })
})

describe('inputs that should not fool it', () => {
  it('does not read headings, totals or a title ending in a grade-like word as courses', () => {
    const text = 'Autumn 2024\nTERM 2024 GPA 3.9\nCUM GPA 3.80 TOTALS 17.00\nPHYSICS 41 MECHANICS I 4.00\nPage 2 of 3'
    const { courses } = parseTranscript(text, SUBJECTS)
    expect(courses).toEqual([{ code: 'PHYSICS 41', title: 'Mechanics I', term: 'Autumn 2024', units: 4, grade: '' }])
  })

  it('splits a title pdf.js glued to the units column', () => {
    const { courses } = parseTranscript('2026-2027 Autumn\nCS 161 LEC DESIGN AND ANALYSIS OF ALGORITHMS5.00 0.00\nCS 107 LEC SYSTEMS5.00 5.00 A 20.000', SUBJECTS)
    expect(courses.map(c => [c.code, c.units, c.grade])).toEqual([
      ['CS 161', 5, ''],
      ['CS 107', 5, 'A'],
    ])
  })

  it('skips a course row with no term instead of guessing one', () => {
    const { courses, skipped } = parseTranscript('CS 106B PROGRAMMING ABSTRACTIONS 5.00 5.00 A', SUBJECTS)
    expect(courses).toEqual([])
    expect(skipped).toHaveLength(1)
  })

  it('reads the same row twice only once', () => {
    const { courses } = parseTranscript('Autumn 2024\nCS 103 A 5\nCS 103 A 5', SUBJECTS)
    expect(courses).toHaveLength(1)
  })
})

describe('findTerm', () => {
  it.each([
    ['2024-2025 Autumn', 'Autumn 2024'],
    ['2024-25 Spring', 'Spring 2025'],
    ['Fall Quarter 2023', 'Autumn 2023'],
    ['SU/25', 'Summer 2025'],
    ['2026 Winter', 'Winter 2026'],
  ])('%s -> %s', (input, term) => {
    expect(findTerm(input)).toBe(term)
  })
})
