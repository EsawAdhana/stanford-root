import { describe, expect, it } from 'vitest'
import { CACHE_VERSION } from '@/lib/store'
import { rowToCourse } from '@/lib/course-mapper'

// The catalog cache in IndexedDB holds whole Course objects for up to 24h and is
// only discarded on a CACHE_VERSION mismatch. So adding a field to Course
// reaches nobody with a warm cache until CACHE_VERSION changes: "new courses
// only" shipped that way once and matched zero courses for every returning
// visitor. This pairs the cached shape with the version, so growing one without
// the other fails here instead of in production.
// v15 dropped `difficulty` (hrs/unit is derived from hours + units now) and
// started normalising title/description in rowToCourse, so a v14 cache holds
// both a dead field and untidied text.
// v16 added qualityPct/qualityN, and redefined `quality` from a median of section
// medians to a pooled mean, so a v15 cache holds a number computed the old way.
// v17 added ratingBreakdown, and redefined `quality` again as the mean of the adjusted
// per-category scores, so a v16 cache holds both a stale number and no breakdown.
// v18 added crossListWith, which the browser needs to group paired undergrad/grad
// listings; without it a v17 cache groups them wrongly and shows the wrong rating.
// v19 added rankScope and redefined every percentile: qualityPct and each
// ratingBreakdown pct are now ranked within the course's own department where that
// department is big enough. A v18 cache holds Stanford-wide percentiles with no scope,
// which the label would then describe as department ranks.
const CACHED_COURSE_FIELDS_AT_V19 = [
  'id', 'subject', 'code', 'title', 'description', 'units', 'grading',
  'instructors', 'terms', 'sections', 'hours', 'quality', 'qualityPct',
  'rankScope', 'qualityN', 'ratingBreakdown', 'crossListWith', 'isNew',
].sort()

describe('catalog cache version', () => {
  it('is bumped whenever the cached Course shape changes', () => {
    const shape = Object.keys(rowToCourse({
      course_id: 'CS106B', subject: 'CS', code: '106B', title: 'Programming Abstractions',
      description: 'x', units: '5', grading: 'Letter (ABCD/NP)', instructors: [], terms: [],
      sections: [], hours: 10, quality: 4.32, quality_pct: 61, quality_n: 840,
      rating_breakdown: { quality: { score: 4.4, n: 840, pct: 66, scope: 'CS' } }, rank_scope: 'CS',
      cross_list_with: ['CS106X'], difficulty: 2, isNew: false,
    })).sort()

    expect(
      shape,
      `Course gained or lost a field. Bump CACHE_VERSION (currently ${CACHE_VERSION}) ` +
      'and update this list, or returning visitors keep a catalog without it.',
    ).toEqual(CACHED_COURSE_FIELDS_AT_V19)
    expect(CACHE_VERSION).toBeGreaterThanOrEqual(19)
  })
})
