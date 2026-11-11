import { describe, expect, it } from 'vitest'
import { departmentSearchEmptyText, filterDepartments } from '@/lib/search-utils'

/**
 * Reproduced on a production build: searching "computer science" in Add
 * Department showed a blank list with no words. The picker only knows subject
 * codes, so the search can't find a department by its name; the empty list has
 * to say so instead of looking broken.
 */

const depts = ['CS', 'CSB', 'CSRE', 'ECOS', 'MATH', 'ME'].map(code => ({ code, count: 1, name: code }))
const codes = (q: string) => filterDepartments(depts, q).map(d => d.code)

describe('department picker search', () => {
  it('matches codes by prefix', () => {
    expect(codes('cs')).toEqual(['CS', 'CSB', 'CSRE'])
    expect(codes('M')).toEqual(['MATH', 'ME'])
    expect(codes('')).toHaveLength(depts.length)
    expect(codes('   ')).toHaveLength(depts.length)
  })

  it('finds nothing for a department name, and says what to type instead', () => {
    expect(codes('computer science')).toEqual([])
    expect(departmentSearchEmptyText('computer science')).toBe(
      'No departments match “computer science”. Search by subject code, like CS or MATH.',
    )
  })

  it('says nothing before a search', () => {
    expect(departmentSearchEmptyText('')).toBeNull()
    expect(departmentSearchEmptyText('  ')).toBeNull()
  })
})
