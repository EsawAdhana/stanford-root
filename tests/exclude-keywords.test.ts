import { describe, expect, it } from 'vitest'
import { filterCourses, type CourseFilterCriteria } from '@/lib/course-filter'
import { getCrossListPrimaryMap } from '@/lib/utils'
import type { Course } from '@/types/course'

/**
 * Excluded keywords hide a class when any keyword is a case-insensitive substring
 * of its title, description or code. A link with 674 keywords took 1.1 s per filter
 * pass over the 8,861-course catalog (two passes per click), so the keywords are
 * matched as one pattern. Keywords are text, never pattern syntax: "c++", "a.b",
 * "porphyry's" and "(ai)" must match only themselves.
 */

const course = (id: string, title: string, description = ''): Course => ({
  id, subject: id.replace(/[0-9].*$/, ''), code: id.replace(/^[A-Z&]+/, ''), title, description,
  units: '3', grading: 'Letter', instructors: [], terms: ['Winter 2027'], sections: [],
}) as unknown as Course

const CRITERIA: CourseFilterCriteria = {
  excludedWords: [], selectedDepts: [], selectedTerms: [], selectedFormats: [],
  selectedLevels: [], selectedGers: [], selectedSchools: [], unitMin: 0, unitMax: 30,
  timeMin: 0, timeMax: 1440, hideConflicts: false, hideUnavailable: false,
  hideStudyAbroad: false, newOnly: false,
}

const shown = (catalog: Course[], excludedWords: string[]) =>
  filterCourses(catalog, { ...CRITERIA, excludedWords }, getCrossListPrimaryMap(catalog), []).map(c => c.id)

describe('excluded keywords', () => {
  const catalog = [
    course('CS106B', 'Programming Abstractions', 'Uses C++ and recursion.'),
    course('CS107', 'Computer Organization and Systems', 'Written in C, with a C-ish style.'),
    course('PHIL113A', "Porphyry's Introduction to Logic"),
    course('PHIL1', 'Introduction to Philosophy', 'Porphyrys is misspelled here.'),
    course('OIT274', 'Data and Decisions - Base'),
    course('OIT276', 'Data and Decisions Accelerated'),
    course('STS135', 'Constructing "Intelligence" (AI)'),
    course('STS1', 'Introduction to Science and Technology', 'Mentions ai in passing.'),
    course('MATH1', 'a.b', ''),
    course('MATH2', 'axb', ''),
    course('ECON1', 'Costs $100 [draft] a|b back\\slash', ''),
    course('ECON2', 'plain', 'nothing special'),
    course('HISTORY1', 'HISTORY of Things', ''),
  ]

  it('hides nothing with no keywords', () => {
    expect(shown(catalog, [])).toHaveLength(catalog.length)
  })

  it('treats pattern characters as plain text', () => {
    expect(shown(catalog, ['c++'])).not.toContain('CS106B')
    expect(shown(catalog, ['c++'])).toContain('CS107')
    expect(shown(catalog, ['a.b'])).not.toContain('MATH1')
    expect(shown(catalog, ['a.b'])).toContain('MATH2')
    expect(shown(catalog, ['(ai)'])).not.toContain('STS135')
    expect(shown(catalog, ['(ai)'])).toContain('STS1')
    expect(shown(catalog, ['$100'])).not.toContain('ECON1')
    expect(shown(catalog, ['[draft]'])).not.toContain('ECON1')
    expect(shown(catalog, ['back\\slash'])).not.toContain('ECON1')
  })

  it('does not let "|" in a keyword split it into two keywords', () => {
    const ids = shown(catalog, ['a|b'])
    expect(ids).not.toContain('ECON1')
    expect(ids).toContain('MATH1')
    expect(ids).toContain('ECON2')
  })

  it("matches an apostrophe and a spaced hyphen literally", () => {
    expect(shown(catalog, ["porphyry's"])).not.toContain('PHIL113A')
    expect(shown(catalog, ["porphyry's"])).toContain('PHIL1')
    expect(shown(catalog, ['decisions - base'])).not.toContain('OIT274')
    expect(shown(catalog, ['decisions - base'])).toContain('OIT276')
  })

  it('ignores case on both sides', () => {
    expect(shown(catalog, ['History'])).not.toContain('HISTORY1')
    expect(shown(catalog, ['HISTORY'])).not.toContain('HISTORY1')
  })

  it('hides a class when any one of many keywords matches, in title, description or code', () => {
    const ids = shown(catalog, ['zzz', 'recursion', 'qqq', '113a'])
    expect(ids).not.toContain('CS106B')
    expect(ids).not.toContain('PHIL113A')
    expect(ids).toContain('CS107')
  })

  it('gives the same answer as checking each keyword on its own', () => {
    const keywords = ['c++', 'a.b', '(ai)', '$100', 'a|b', "porphyry's", 'decisions - base',
      'history', 'in c,', 'mentions', 'x', 'and', '\\']
    for (let n = 1; n <= keywords.length; n++) {
      const words = keywords.slice(0, n)
      const expected = catalog.filter(c => {
        const text = `${c.title} ${c.description} ${c.code}`.toLowerCase()
        return !words.some(w => text.includes(w.toLowerCase()))
      }).map(c => c.id)
      expect(shown(catalog, words).sort()).toEqual(expected.sort())
    }
  })
})
