import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { mergeCourseRows } from '@/lib/supabase-admin'
import { rowToCourse } from '@/lib/course-mapper'
import { isScheduledForTerm, scheduledSectionIds } from '@/lib/schedule-utils'
import {
  buildCrossListGroups,
  compareCourseCodes,
  getCrossListPrimaryMap,
  normalizeCourseId,
  resolveToCanonicalPrimary,
} from '@/lib/utils'
import { compareTerms, getDefaultTerm } from '@/lib/terms'
import type { Course } from '@/types/course'

/**
 * Add a class from the schedule search, click its own calendar block, and the
 * course page has to agree that it is on the schedule. Three separate pieces have
 * to line up for that, and each of them broke it on its own:
 *
 *   1. The entry carries no section pick, so the page must read the stand-in the
 *      calendar drew (see tests/scheduled-section-ids.test.ts).
 *   2. The URL is the listing that was added, but the page client-redirects a
 *      cross-listed listing to its canonical primary — so the cart entry is often
 *      a sibling, not `cartItem`.
 *   3. The Sections panel opens on one term. Picking that term off `cartItem`
 *      alone left a sibling's class showing under the default tab, where nothing
 *      reads as added.
 *
 * Checked over the committed dump because the failures are all catalog shapes —
 * which listing is canonical, which terms each listing is offered in — and a
 * hand-written fixture is exactly where they hid.
 */

const rows = JSON.parse(fs.readFileSync('data/catalog/full.json', 'utf8')) as Record<string, unknown>[]
const courses = mergeCourseRows(rows).map(rowToCourse)
const byId = new Map(courses.map(c => [c.id, c]))
const primaryMap = getCrossListPrimaryMap(courses)

const byNormalizedId = new Map(courses.map(c => [normalizeCourseId(c.id), c]))
const landingCache = new Map<string, Course | undefined>()
// buildCrossListGroups is the same grouping getCrossListGroupIds does, built once
// rather than rescanning 8,669 courses per lookup.
const groupsByCanonical: Map<string, string[]> = buildCrossListGroups(courses)

/** Where src/app/[code]/course-page-client.tsx sends `/{id}` once the catalog is in memory. */
function landingPageFor(urlId: string): Course | undefined {
  const cached = landingCache.get(urlId)
  if (cached !== undefined || landingCache.has(urlId)) return cached
  const canonical = resolveToCanonicalPrimary(normalizeCourseId(urlId), primaryMap)
  const page = byNormalizedId.get(canonical) ?? byId.get(urlId)
  landingCache.set(urlId, page)
  return page
}

function groupIdsFor(pageId: string): string[] {
  const canonical = resolveToCanonicalPrimary(normalizeCourseId(pageId), primaryMap)
  return groupsByCanonical.get(canonical) ?? [pageId]
}

/** What src/components/course-detail-content.tsx shows for a scheduled class. */
function pageStateFor(added: Course, term: string) {
  const entry = { id: added.id, selectedTerm: term, terms: added.terms }
  const page = landingPageFor(added.id)
  if (!page) return { landedOn: null, opensTab: null, reads: 'no page' as const }

  const cartItem = entry.id === page.id ? entry : undefined
  const crossListIds = groupIdsFor(page.id)
  const sibling = entry.id !== page.id && crossListIds.includes(entry.id) ? entry : undefined
  const scheduledTerm = cartItem?.selectedTerm ?? sibling?.selectedTerm

  const pageTerms = Array.from(new Set((page.sections || []).map(s => s.term))).sort(compareTerms)
  const opensTab = scheduledTerm && pageTerms.includes(scheduledTerm)
    ? scheduledTerm
    : getDefaultTerm(pageTerms)

  const ids = scheduledSectionIds(page, cartItem, opensTab)
  if ((page.sections || []).some(s => s.term === opensTab && ids.includes(s.classId))) {
    return { landedOn: page.id, opensTab, reads: 'Added' as const }
  }
  if (sibling && isScheduledForTerm(sibling, opensTab)) {
    return { landedOn: page.id, opensTab, reads: 'Added as sibling' as const }
  }
  return { landedOn: page.id, opensTab, reads: 'unadded' as const }
}

function everyScheduledPair() {
  const pairs: { course: Course; term: string }[] = []
  for (const course of courses) {
    for (const term of new Set((course.sections || []).map(s => s.term))) {
      pairs.push({ course, term })
    }
  }
  return pairs.sort((a, b) =>
    compareCourseCodes(a.course.id, b.course.id) || compareTerms(a.term, b.term))
}

describe('a class on the schedule reads as added on its own course page', () => {
  const pairs = everyScheduledPair()

  it('has a meaningful number of pairs to check', () => {
    expect(pairs.length).toBeGreaterThan(10_000)
  })

  it('never opens a tab where a scheduled class looks unadded', () => {
    const unadded = pairs
      .map(({ course, term }) => ({ course, term, state: pageStateFor(course, term) }))
      .filter(r => r.state.reads === 'unadded')
      // The only allowed miss: the canonical listing carries no sections in the
      // term the class was scheduled for, so no tab on that page can show it.
      // ME 350 is scheduled for Winter under its own listing; AA 296, the
      // primary, is Autumn-only. There is nothing for the page to select.
      .filter(r => {
        const page = landingPageFor(r.course.id)
        const pageTerms = new Set((page?.sections || []).map(s => s.term))
        return pageTerms.has(r.term)
      })

    expect(unadded.map(r => `${r.course.id} (${r.term}) -> /${r.state.landedOn} opened ${r.state.opensTab}`))
      .toEqual([])
  })

  it('keeps the term-mismatched cross-listings to the handful the catalog actually has', () => {
    const stranded = pairs.filter(({ course, term }) => {
      const page = landingPageFor(course.id)
      if (!page || page.id === course.id) return false
      return !(page.sections || []).some(s => s.term === term)
    })

    // A rise here means the cross-list grouping started merging listings that are
    // not offered together, which strands a scheduled class on a page that cannot
    // show it. Worth looking at rather than re-baselining.
    expect(stranded.length).toBeLessThanOrEqual(40)
  })

  it('opens the scheduled term even when the page is reached through a sibling listing', () => {
    // ANTHRO 443 (Winter) redirects to /ANTHRO143, which is offered in three
    // terms and defaults to Autumn. Before the fix this landed on Autumn with
    // "View on Calendar" on every section.
    const anthro = byId.get('ANTHRO443')
    if (!anthro) return
    const state = pageStateFor(anthro, 'Winter 2027')

    expect(state.landedOn).toBe('ANTHRO143')
    expect(state.opensTab).toBe('Winter 2027')
    expect(state.reads).toBe('Added as sibling')
  })

  it('still marks a plain non-cross-listed course on its own page', () => {
    const cs106a = byId.get('CS106A')
    if (!cs106a) return
    const term = Array.from(new Set((cs106a.sections || []).map(s => s.term))).sort(compareTerms)[0]
    const state = pageStateFor(cs106a, term)

    expect(state.landedOn).toBe('CS106A')
    expect(state.opensTab).toBe(term)
    expect(state.reads).toBe('Added')
  })
})
