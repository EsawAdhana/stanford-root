import { describe, it, expect } from 'vitest'
import { resolveCrossListRating } from '@/lib/utils'
import type { Course } from '@/types/course'

/**
 * AFRICAAM 10 is listed as CSRE 10 and TAPS 10. Its evaluations are filed under the
 * latter two only, so reading the rating off the AFRICAAM row alone showed nothing
 * while the CSRE listing of the same class showed 4.85.
 */
const member = (p: Partial<Course>) => p as Pick<Course, 'quality' | 'qualityN' | 'qualityPct' | 'rankScope' | 'ratingBreakdown'>

describe('resolveCrossListRating', () => {
  it('finds the rating when this listing has none but a sibling does', () => {
    const out = resolveCrossListRating([
      member({}),                                                  // AFRICAAM 10
      member({ quality: 4.85, qualityN: 20, qualityPct: 99 }),      // CSRE 10
      member({ quality: 4.85, qualityN: 20, qualityPct: 99 }),      // TAPS 10
    ])
    expect(out.quality).toBe(4.85)
    expect(out.qualityPct).toBe(99)
    expect(out.qualityN).toBe(20)
  })

  it('agrees with averaging when the listings hold the same data, as they always do', () => {
    // Every multi-listing report in the table is a byte-identical duplicate, so both
    // rules must land on the same number. This pins that equivalence.
    const listings = [member({}), member({ quality: 4.85, qualityN: 20, qualityPct: 99 }),
      member({ quality: 4.85, qualityN: 20, qualityPct: 99 })]
    const rated = listings.filter(l => l.quality != null)
    const averaged = rated.reduce((sum, l) => sum + l.quality!, 0) / rated.length
    expect(resolveCrossListRating(listings).quality).toBeCloseTo(averaged, 10)
  })

  it('does not average percentiles, which would rank nothing', () => {
    // Defensive: no group differs today, but a rank is not a quantity -- the mean of
    // the 95th and 4th percentiles maps to no course's score.
    const out = resolveCrossListRating([
      member({ quality: 4.9, qualityN: 400, qualityPct: 95 }),
      member({ quality: 3.2, qualityN: 5, qualityPct: 4 }),
    ])
    expect(out.qualityPct).toBe(95)
    expect(out.quality).toBe(4.9)
  })

  it('carries the per-category breakdown across with it', () => {
    const breakdown = { quality: { score: 4.9, n: 20, pct: 98 } }
    const out = resolveCrossListRating([member({}), member({ quality: 4.9, qualityN: 20, ratingBreakdown: breakdown })])
    expect(out.ratingBreakdown).toBe(breakdown)
  })

  // --- inputs built to break it ---
  it('returns empty rather than a partial when no listing has a rating', () => {
    const out = resolveCrossListRating([member({}), member({})])
    expect(out.quality).toBeUndefined()
    expect(out.qualityPct).toBeUndefined()
    expect(out.ratingBreakdown).toBeUndefined()
  })

  it('never mixes one listing\'s score with another\'s percentile', () => {
    const out = resolveCrossListRating([
      member({ quality: 4.1, qualityN: 10, qualityPct: 30 }),
      member({ quality: 4.8, qualityN: 90, qualityPct: 91 }),
    ])
    expect([out.quality, out.qualityN, out.qualityPct]).toEqual([4.8, 90, 91])
  })

  it('handles an empty group and null members', () => {
    expect(resolveCrossListRating([]).quality).toBeUndefined()
    expect(resolveCrossListRating([null as never, undefined as never]).quality).toBeUndefined()
  })

  it('treats a missing qualityN as no evidence, not as the best evidence', () => {
    const out = resolveCrossListRating([
      member({ quality: 5, qualityPct: 100 }),                 // no n at all
      member({ quality: 4.4, qualityN: 300, qualityPct: 60 }),
    ])
    expect(out.quality).toBe(4.4)
  })
})

/**
 * The score is shared by the whole cross-list group; the RANK is not. Each listing is
 * ranked against its own department, so the page must show the rank belonging to the
 * listing the reader opened -- not whichever sibling holds the most responses.
 */
describe('resolveCrossListRating, per-department ranks', () => {
  const csre = member({ quality: 4.85, qualityN: 20, qualityPct: 99, rankScope: 'CSRE' })
  const taps = member({ quality: 4.85, qualityN: 20, qualityPct: 62, rankScope: 'TAPS' })

  it('keeps the rank of the listing being displayed, not the sibling with the data', () => {
    const out = resolveCrossListRating([csre, taps], taps)
    expect(out.quality).toBe(4.85)
    expect(out.qualityPct).toBe(62)
    expect(out.rankScope).toBe('TAPS')
  })

  it('does not flip the rank when the same listing is passed the other way round', () => {
    expect(resolveCrossListRating([taps, csre], csre).rankScope).toBe('CSRE')
  })

  it('borrows a sibling rank only when this listing has none of its own', () => {
    const africaam = member({})
    const out = resolveCrossListRating([africaam, csre], africaam)
    expect(out.qualityPct).toBe(99)
    expect(out.rankScope).toBe('CSRE')
  })

  it('takes per-category ranks from this listing while keeping the sibling scores', () => {
    const withData = member({
      quality: 4.85, qualityN: 20, qualityPct: 99, rankScope: 'CSRE',
      ratingBreakdown: { quality: { score: 4.9, n: 20, pct: 97, scope: 'CSRE' } },
    })
    const thisOne = member({
      quality: 4.85, qualityN: 4, qualityPct: 41, rankScope: 'TAPS',
      ratingBreakdown: { quality: { score: 4.9, n: 4, pct: 41, scope: 'TAPS' } },
    })
    const out = resolveCrossListRating([withData, thisOne], thisOne)
    expect(out.qualityN).toBe(20)
    expect(out.ratingBreakdown!.quality).toEqual({ score: 4.9, n: 20, pct: 41, scope: 'TAPS' })
  })

  it('keeps the sibling category ranks for a category this listing was not ranked in', () => {
    const withData = member({
      quality: 4.85, qualityN: 20, qualityPct: 99, rankScope: 'CSRE',
      ratingBreakdown: {
        quality: { score: 4.9, n: 20, pct: 97, scope: 'CSRE' },
        learning: { score: 4.2, n: 20, pct: 55, scope: 'CSRE' },
      },
    })
    const thisOne = member({
      quality: 4.85, qualityN: 20, qualityPct: 41, rankScope: 'TAPS',
      ratingBreakdown: { quality: { score: 4.9, n: 20, pct: 41, scope: 'TAPS' } },
    })
    const out = resolveCrossListRating([withData, thisOne], thisOne)
    expect(out.ratingBreakdown!.learning).toEqual({ score: 4.2, n: 20, pct: 55, scope: 'CSRE' })
  })

  it('behaves exactly as before when no listing is named', () => {
    const out = resolveCrossListRating([csre, taps])
    expect(out.qualityPct).toBe(99)
    expect(out.rankScope).toBe('CSRE')
  })

  it('does not invent a breakdown when the sibling with the score has none', () => {
    const out = resolveCrossListRating([member({ quality: 4.1, qualityN: 9 })], member({ quality: 4.1, qualityN: 9 }))
    expect(out.ratingBreakdown).toBeUndefined()
  })
})
