import { describe, expect, it } from 'vitest'
import { searchCourses, queryNamesInstructor } from '@/lib/search-utils'
import type { Course } from '@/types/course'

/**
 * Reproduced on a production build: "Mehran Sahami", "Chris Piech" and
 * "Andrew Ng" found 0 classes while "Sahami, Mehran" found 20, and the empty
 * list sat under an "Instructors: Mehran Sahami" link that said otherwise.
 * The course search only matched the name as one substring of "Last, First".
 */

const course = (id: string, title: string, instructors: string[]): Course => ({
  id, subject: id.replace(/[0-9].*$/, ''), code: id.replace(/^[A-Z&]+/, ''), title, description: '',
  units: '3', grading: 'Letter', instructors, terms: ['Winter 2027'], sections: [],
}) as unknown as Course

const catalog = [
  course('CS106A', 'Programming Methodology', ['Sahami, Mehran', 'Piech, Chris']),
  course('CS109', 'Introduction to Probability for Computer Scientists', ['Piech, C.']),
  course('CS229', 'Machine Learning', ['Ng, Andrew']),
  course('CS230', 'Deep Learning', ['Ng, A.', 'Katanforoosh, Kian']),
  course('MATH51', 'Linear Algebra', ['Smith, M. S.']),
  course('PSYCH1', 'Introduction to Psychology', ['Nguyen, Andrew']),
  course('EDUC100', 'Learning Sciences', ['Law, Wing-Sum']),
  course('HISTORY1', 'History of Mehran', []),
]

const ids = (q: string) => searchCourses(catalog, q).map(c => c.id).sort()

describe('searching an instructor by name', () => {
  it('finds classes for first-name-first queries', () => {
    expect(ids('Mehran Sahami')).toEqual(['CS106A'])
    expect(ids('Chris Piech')).toEqual(['CS106A', 'CS109'])
    expect(ids('Andrew Ng')).toEqual(['CS229', 'CS230'])
  })

  it('still finds the catalog form, any case, with or without the comma', () => {
    expect(ids('Sahami, Mehran')).toEqual(['CS106A'])
    expect(ids('sahami mehran')).toEqual(['CS106A'])
    expect(ids('PIECH CHRIS')).toEqual(['CS106A', 'CS109'])
    expect(ids('sahami')).toEqual(['CS106A'])
  })

  it('does not match on initials alone', () => {
    // Smith, M. S. has both initials but neither name.
    expect(ids('Mehran Sahami')).not.toContain('MATH51')
    expect(queryNamesInstructor('mehran sahami', 'Smith, M. S.')).toBe(false)
  })

  it('needs every word to name the person, not just a prefix of one', () => {
    // "Ng" is not "Nguyen".
    expect(ids('Andrew Ng')).not.toContain('PSYCH1')
    expect(ids('Andrew Sahami')).toEqual([])
    expect(queryNamesInstructor('chris chris', 'Piech, Chris')).toBe(false)
  })

  it('keeps hyphenated names whole', () => {
    expect(ids('Wing-Sum Law')).toEqual(['EDUC100'])
  })

  it('leaves code and title searches as they were', () => {
    expect(ids('machine learning')).toEqual(['CS229'])
    expect(ids('cs 106a')).toEqual(['CS106A'])
    expect(ids('mehran')).toEqual(['CS106A', 'HISTORY1'])
  })
})
