import { describe, expect, it } from 'vitest'
import { applyQuery } from '@/hooks/use-filtered-courses'
import { getCrossListPrimaryMap } from '@/lib/utils'
import type { Course } from '@/types/course'

/**
 * Reproduced on a production build: "CS-106A" and "cs.106a" found 0 classes
 * while "cs 106a" found CS 106A. Students paste codes from syllabi and emails
 * written either way.
 */

const course = (id: string, title: string): Course => ({
  id, subject: id.replace(/[0-9].*$/, ''), code: id.replace(/^[A-Z&]+/, ''), title, description: '',
  units: '3', grading: 'Letter', instructors: [], terms: ['Winter 2027'], sections: [],
}) as unknown as Course

const catalog = [
  course('CS106A', 'Programming Methodology'),
  course('CS106AX', 'Programming Methodology and Abstractions'),
  course('CS106B', 'Programming Abstractions'),
  course('CS140M', 'Introduction to Embedded Systems (EE 186)'),
  course('EE186', 'Introduction to Embedded Systems (CS 140M)'),
  course('ME210', 'Data-Driven Design'),
  course('HISTORY1', 'Notes on e.g. 1066'),
]
const pm = getCrossListPrimaryMap(catalog)
const ids = (q: string) => applyQuery(catalog, q, pm).map(c => c.id).sort()

describe('course codes written with a hyphen or a dot', () => {
  it('match like a space', () => {
    const spaced = ids('cs 106a')
    expect(spaced).toEqual(['CS106A', 'CS106AX'])
    expect(ids('CS-106A')).toEqual(spaced)
    expect(ids('cs.106a')).toEqual(spaced)
    expect(ids('CS - 106A')).toEqual(spaced)
    expect(ids('cs_106a')).toEqual(spaced)
    expect(ids('CS–106A')).toEqual(spaced)
  })

  it('reach the class through a cross-listed code too', () => {
    expect(ids('EE-186')).toEqual(ids('EE 186'))
    expect(ids('EE-186')).toContain('CS140M')
  })

  it('leave punctuation elsewhere in a query alone', () => {
    expect(ids('data-driven')).toEqual(['ME210'])
    expect(ids('e.g. 1066')).toEqual(['HISTORY1'])
  })
})
