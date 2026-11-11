import { describe, expect, it } from 'vitest'
import { applyQuery, sortCourses } from '@/hooks/use-filtered-courses'
import { getCrossListPrimaryMap } from '@/lib/utils'
import type { Course } from '@/types/course'

/**
 * Reproduced on a production build: "cs106a" listed CS 100ACE first and the
 * class itself second, because A-Z ran over every match and CS 100ACE's title
 * mentions CS 106A.
 */

const course = (id: string, title: string, units = '3'): Course => ({
  id, subject: id.replace(/[0-9].*$/, ''), code: id.replace(/^[A-Z&]+/, ''), title, description: '',
  units, grading: 'Letter', instructors: [], terms: ['Winter 2027'], sections: [],
}) as unknown as Course

const catalog = [
  course('CS100ACE', 'Problem-solving Lab for CS106A', '1'),
  course('CS106AX', 'Programming Methodology and Abstractions', '5'),
  course('CS106A', 'Programming Methodology', '5'),
  course('CS106B', 'Programming Abstractions', '5'),
  course('CS1060', 'Made-up four digit code', '2'),
  course('ENGR40M', 'An Intro to Making', '3'),
  course('CS103', 'Mathematical Foundations of Computing', '5'),
]
const pm = getCrossListPrimaryMap(catalog)
const ratings = new Map<string, { quality?: number }>([
  ['CS100ACE', { quality: 4.9 }], ['CS106AX', { quality: 4.8 }], ['CS106A', { quality: 4.1 }],
  ['CS106B', { quality: 4.5 }], ['CS1060', { quality: 4.95 }], ['CS103', { quality: 4.7 }],
])

const list = (q: string, sortBy = 'az', order: 'asc' | 'desc' = 'asc') =>
  sortCourses(applyQuery(catalog, q, pm), sortBy, order, ratings, q).map(c => c.id)

describe('a course-code search', () => {
  it('lists the exact code first, then codes that start with it', () => {
    expect(list('cs106a')).toEqual(['CS106A', 'CS106AX', 'CS100ACE'])
    expect(list('CS 106A')).toEqual(['CS106A', 'CS106AX', 'CS100ACE'])
    expect(list('CS-106A')).toEqual(['CS106A', 'CS106AX', 'CS100ACE'])
  })

  it('keeps the exact match first under any sort, and the sort orders each group', () => {
    expect(list('cs106a', 'rating', 'desc')).toEqual(['CS106A', 'CS106AX', 'CS100ACE'])
    expect(list('cs106a', 'az', 'desc')).toEqual(['CS106A', 'CS106AX', 'CS100ACE'])
    // No exact match: prefix matches by rating, then the rest by rating.
    expect(list('cs 106', 'rating', 'desc')).toEqual(['CS1060', 'CS106AX', 'CS106B', 'CS106A', 'CS100ACE'])
  })

  it('leaves the chosen sort alone for queries that are not a code', () => {
    expect(list('programming')).toEqual(['CS106A', 'CS106AX', 'CS106B'])
    expect(list('cs', 'rating', 'desc')).toEqual(['CS1060', 'CS100ACE', 'CS106AX', 'CS103', 'CS106B', 'CS106A'])
    expect(list('')).toEqual(['CS100ACE', 'CS103', 'CS106A', 'CS106AX', 'CS106B', 'CS1060', 'ENGR40M'])
  })
})
