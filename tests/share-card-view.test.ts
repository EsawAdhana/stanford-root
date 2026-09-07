import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { getDefaultViewFromDump } from '@/lib/catalog-dump'
import { compareCourseCodes } from '@/lib/utils'

/**
 * The share card draws the browse view, so every figure on it has to be the
 * figure a visitor sees. The trap this guards is specific and already happened
 * once: counting the catalog dump directly gives 3,968 classes for Autumn 2026
 * where the app shows 2,969, because the app hides closed, conflicting and
 * study-abroad sections first. A card that prints the dump's number is wrong in
 * a way nobody would notice until it was public.
 *
 * These run against the committed dump, and assert relationships rather than
 * literal counts, so a catalog refresh does not turn them red.
 */

type LightRow = { course_id?: string; terms?: string[]; grading?: string }

/** Distinct gradeable courses the dump lists in a term, with no filters applied. */
function unfilteredCount(term: string): number {
  const rows: LightRow[] = JSON.parse(fs.readFileSync('data/catalog/light.json', 'utf8'))
  const ids = new Set<string>()
  for (const row of rows) {
    const g = (row.grading || '').trim()
    if (!g || g === 'TBD') continue
    if (!row.course_id) continue
    if ((row.terms || []).includes(term)) ids.add(row.course_id)
  }
  return ids.size
}

describe('getDefaultViewFromDump', () => {
  it('reports the filtered count, not the raw dump count', async () => {
    const view = await getDefaultViewFromDump(4)
    expect(view).not.toBeNull()
    const raw = unfilteredCount(view!.term)
    // The default view hides classes, so it must be a strict subset. Equality
    // here would mean the filter pipeline stopped running.
    expect(view!.total).toBeLessThan(raw)
    expect(view!.total).toBeGreaterThan(0)
  })

  it('agrees with its own sidebar count for the open term', async () => {
    const view = await getDefaultViewFromDump(4)
    const pill = view!.termCounts.find(t => t.term === view!.term)
    // The results bar and the checked term pill are the same number in the app.
    expect(pill?.count).toBe(view!.total)
  })

  it('lists terms chronologically, not alphabetically', async () => {
    const view = await getDefaultViewFromDump(1)
    const terms = view!.termCounts.map(t => t.term)
    // Alphabetical would put Autumn first and Winter last across the year
    // boundary, which is not the order the sidebar shows.
    const seasons = terms.map(t => t.split(' ')[0])
    if (terms.length >= 2 && seasons.includes('Autumn') && seasons.includes('Winter')) {
      expect(terms.indexOf('Autumn 2026')).toBeLessThan(terms.indexOf('Winter 2027'))
    }
    expect(terms.length).toBeGreaterThan(0)
  })

  it('returns the courses in the order the list shows them', async () => {
    const view = await getDefaultViewFromDump(4)
    expect(view!.courses).toHaveLength(4)
    const parsed = view!.courses.map(c => {
      const at = c.code.lastIndexOf(' ')
      return { subject: c.code.slice(0, at), code: c.code.slice(at + 1) }
    })
    for (let i = 1; i < parsed.length; i++) {
      const order =
        parsed[i - 1].subject.localeCompare(parsed[i].subject) ||
        compareCourseCodes(parsed[i - 1].code, parsed[i].code)
      expect(order).toBeLessThan(0)
    }
  })

  it('formats every field the way a course card does', async () => {
    const view = await getDefaultViewFromDump(12)
    for (const course of view!.courses) {
      expect(course.units).toMatch(/^(\d+(-\d+)? Units?|\d+\+ Units|—)$/)
      if (course.hours !== null) expect(course.hours).toMatch(/^\d+\.\d hrs\/unit$/)
      if (course.rating !== null) expect(course.rating).toMatch(/^\d\.\d$/)
      expect(course.instructor.length).toBeGreaterThan(0)
      // Season only: a term string on a card never carries a full year.
      expect(course.terms).not.toMatch(/\b20\d\d\b/)
    }
  })

  it('offers a scrubber letter for the first course it lists', async () => {
    const view = await getDefaultViewFromDump(1)
    const first = view!.courses[0].code.charAt(0).toUpperCase()
    expect(view!.letters).toContain(/[A-Z]/.test(first) ? first : '#')
    expect(view!.letters.indexOf('#')).toBeLessThanOrEqual(0)
  })
})
