import { describe, expect, it } from 'vitest'
import { addExcludedKeyword } from '@/lib/search-utils'

/**
 * Reproduced on a production build: typing "intro", Enter, then "INTRO", Enter
 * in Exclude Keywords made two chips for one keyword. Exclusion already ignores
 * case (see exclude-keywords.test.ts), so the second chip did nothing but
 * clutter the row.
 */
describe('adding an exclude keyword', () => {
  it('adds a new keyword, trimmed', () => {
    expect(addExcludedKeyword([], '  intro ')).toEqual(['intro'])
    expect(addExcludedKeyword(['intro'], 'seminar')).toEqual(['intro', 'seminar'])
  })

  it('treats a keyword in another case as the one already there', () => {
    expect(addExcludedKeyword(['intro'], 'INTRO')).toBeNull()
    expect(addExcludedKeyword(['intro'], 'Intro')).toBeNull()
    expect(addExcludedKeyword(['Intro'], ' intro ')).toBeNull()
  })

  it('adds nothing for a blank entry', () => {
    expect(addExcludedKeyword(['intro'], '   ')).toBeNull()
    expect(addExcludedKeyword([], '')).toBeNull()
  })
})
