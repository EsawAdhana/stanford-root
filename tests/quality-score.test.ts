import { describe, it, expect } from 'vitest'
import {
  pooledMean, addRatingCounts, percentileRanks, rankLabel, rankShare, rankScopeLabel,
  estimatePrior, shrinkToPrior, adjustAndRank, headlineSampleSize,
  scopedPercentileRanks, DEPARTMENT_RANK_MIN,
} from '@/lib/quality-score.mjs'

describe('pooledMean', () => {
    it('averages the individual responses, not the section summaries', () => {
        // 5 students said Excellent, 4 said Good -> 4.555..., the real Stanford row.
        expect(pooledMean([[5, 5], [4, 4]])!.mean).toBeCloseTo(4.5556, 4)
    })

    it('separates courses a median collapses onto 5.00', () => {
        // Both have median 5. One had a third of the class call it Poor or worse.
        const good = pooledMean([[5, 9]])!
        const bad = pooledMean([[5, 5], [4, 1], [1, 3]])!
        expect(good.mean).toBe(5)
        expect(bad.mean).toBeCloseTo(3.56, 2)
        expect(good.mean).not.toBe(bad.mean)
    })

    it('lets a big lecture outweigh a tiny seminar', () => {
        const pooled = pooledMean([[5, 5], [3, 400]])!
        expect(pooled.mean).toBeLessThan(3.1)
        expect(pooled.n).toBe(405)
    })

    // --- inputs built to break it ---
    it('returns null rather than NaN when there is nothing to average', () => {
        expect(pooledMean([])).toBeNull()
        expect(pooledMean([[5, 0]])).toBeNull()
        expect(pooledMean([[4, -3]])).toBeNull()
    })

    it('never divides by zero when every count is discarded', () => {
        const result = pooledMean([[0, 10], [7, 10], [NaN, 5]])
        expect(result).toBeNull()
    })

    it('ignores off-scale weights instead of dragging the mean off 1-5', () => {
        // Hours-per-week options (weight 12, 30) must not leak into a 1-5 rating.
        const pooled = pooledMean([[5, 10], [12, 10], [30, 10]])!
        expect(pooled.mean).toBe(5)
        expect(pooled.n).toBe(10)
    })

    it('survives NaN, null and string counts without poisoning the total', () => {
        const pooled = pooledMean([[5, 4], [4, NaN], [3, null as unknown as number]])!
        expect(pooled.mean).toBe(5)
        expect(pooled.n).toBe(4)
    })

    it('stays inside 1..5 for every possible distribution', () => {
        for (const dist of [[[1, 1]], [[5, 1]], [[1, 500], [5, 1]], [[1, 1], [2, 1], [3, 1], [4, 1], [5, 1]]]) {
            const pooled = pooledMean(dist as Array<[number, number]>)!
            expect(pooled.mean).toBeGreaterThanOrEqual(1)
            expect(pooled.mean).toBeLessThanOrEqual(5)
        }
    })

    it('reports a distribution that sums to n', () => {
        const pooled = pooledMean([[5, 3], [4, 2], [1, 1]])!
        expect(pooled.dist).toEqual([1, 0, 0, 2, 3])
        expect(pooled.dist.reduce((a: number, b: number) => a + b, 0)).toBe(pooled.n)
    })
})

describe('addRatingCounts', () => {
    it('accumulates across sections and terms', () => {
        const counts = new Map<number, number>()
        addRatingCounts(counts, { options: [{ weight: 5, count: 2 }, { weight: 4, count: 1 }] })
        addRatingCounts(counts, { options: [{ weight: 5, count: 3 }] })
        expect(counts.get(5)).toBe(5)
        expect(counts.get(4)).toBe(1)
    })

    it('tolerates missing, null and malformed questions', () => {
        const counts = new Map<number, number>()
        addRatingCounts(counts, {})
        addRatingCounts(counts, { options: undefined })
        addRatingCounts(counts, null as never)
        addRatingCounts(counts, { options: [{}, { weight: 5 }, { count: 3 }] })
        expect(counts.size).toBe(0)
    })

    it('coerces the string counts the scraper sometimes yields', () => {
        const counts = new Map<number, number>()
        addRatingCounts(counts, { options: [{ weight: '5', count: '4' }] } as never)
        expect(counts.get(5)).toBe(4)
    })
})

describe('percentileRanks', () => {
    it('puts the highest score at 100 and never emits 0', () => {
        const ranks = percentileRanks([3.5, 4.9, 4.2, 1.0])
        expect(Math.max(...ranks)).toBe(100)
        expect(Math.min(...ranks)).toBeGreaterThanOrEqual(1)
    })

    it('gives identical scores identical ranks', () => {
        const ranks = percentileRanks([4.5, 4.5, 4.5, 1.0])
        expect(ranks[0]).toBe(ranks[1])
        expect(ranks[1]).toBe(ranks[2])
    })

    it('does not reorder its output', () => {
        // Rank must line up with the input index, not with sorted position.
        const ranks = percentileRanks([5, 1, 3])
        expect(ranks[0]).toBe(100)
        expect(ranks[1]).toBeLessThan(ranks[2])
    })

    it('handles the degenerate sizes', () => {
        expect(percentileRanks([])).toEqual([])
        expect(percentileRanks([4.2])).toEqual([100])
    })

    it('is monotonic in the score', () => {
        const scores = Array.from({ length: 200 }, (_, i) => 3 + (i % 50) / 25)
        const ranks = percentileRanks(scores)
        for (let i = 0; i < scores.length; i++) {
            for (let j = 0; j < scores.length; j++) {
                if (scores[i] < scores[j]) expect(ranks[i]).toBeLessThanOrEqual(ranks[j])
            }
        }
    })
})

describe('rankLabel', () => {
  it('reads in one fixed direction that tracks the rating', () => {
    expect(rankLabel(71)).toBe('Ranks higher than 71% of all Stanford courses')
    expect(rankLabel(16)).toBe('Ranks higher than 16% of all Stanford courses')
    expect(rankLabel(2)).toBe('Ranks higher than 2% of all Stanford courses')
  })

  it('does not flip framing across the median', () => {
    // The old label called these "Top 50%" and "Bottom 49%" -- opposite-sounding
    // descriptions of two nearly identical courses.
    expect(rankLabel(50)).toBe('Ranks higher than 50% of all Stanford courses')
    expect(rankLabel(49)).toBe('Ranks higher than 49% of all Stanford courses')
  })

  it('never claims a course ranks above every course, itself included', () => {
    expect(rankLabel(100)).toBe('Ranks higher than 99% of all Stanford courses')
  })

  it('never claims a course ranks above none of them', () => {
    expect(rankLabel(0)).toBe('Ranks higher than 1% of all Stanford courses')
    expect(rankLabel(1)).toBe('Ranks higher than 1% of all Stanford courses')
  })

  it('is monotonic and stays in 1..99 across the whole range', () => {
    let previous = 0
    for (let pct = 0; pct <= 100; pct++) {
      const share = Number(rankLabel(pct)!.match(/than (\d+)%/)![1])
      expect(share).toBeGreaterThanOrEqual(1)
      expect(share).toBeLessThanOrEqual(99)
      expect(share).toBeGreaterThanOrEqual(previous)
      previous = share
    }
  })

  it('always uses the same wording, so no label implies a different direction', () => {
    for (let pct = 1; pct <= 100; pct++) {
      expect(rankLabel(pct)!.startsWith('Ranks higher than')).toBe(true)
      expect(rankLabel(pct)).not.toContain('Top')
      expect(rankLabel(pct)).not.toContain('Bottom')
    }
  })

  it('returns null for a missing percentile instead of rendering one', () => {
    expect(rankLabel(null)).toBeNull()
    expect(rankLabel(undefined)).toBeNull()
    expect(rankLabel(NaN)).toBeNull()
  })
})

describe('estimatePrior / shrinkToPrior', () => {
  // The real corpus values, from running estimatePrior over all 6,494 rated courses.
  const STANFORD = { grandMean: 4.284, weight: 5.2 }

  it('ranks a solid average from many people above a great one from two', () => {
    const many = shrinkToPrior(4.5, 100, STANFORD)
    const few = shrinkToPrior(4.6, 2, STANFORD)
    expect(many).toBeGreaterThan(few)
    expect(many).toBeCloseTo(4.489, 2)
    expect(few).toBeCloseTo(4.372, 2)
  })

  it('barely moves a course with a large sample', () => {
    expect(shrinkToPrior(4.65, 9846, STANFORD)).toBeCloseTo(4.65, 2)
  })

  it('pulls a single perfect response most of the way to the average', () => {
    // LAW 2409: one student, 5.00. It must not outrank a well-sampled 4.9.
    expect(shrinkToPrior(5, 1, STANFORD)).toBeLessThan(shrinkToPrior(4.9, 500, STANFORD))
  })

  it('never leaves the 1-5 scale', () => {
    for (const [mean, n] of [[1, 1], [5, 1], [1, 10000], [5, 10000]] as Array<[number, number]>) {
      const adj = shrinkToPrior(mean, n, STANFORD)
      expect(adj).toBeGreaterThanOrEqual(1)
      expect(adj).toBeLessThanOrEqual(5)
    }
  })

  it('is monotonic in n for a course above the average', () => {
    let prev = -Infinity
    for (const n of [1, 2, 5, 10, 50, 500, 5000]) {
      const adj = shrinkToPrior(4.8, n, STANFORD)
      expect(adj).toBeGreaterThan(prev)
      prev = adj
    }
  })

  it('recovers the planted weight from a synthetic corpus', () => {
    // Courses whose true means are spread with tau2 = 0.25 and responses with
    // sigma2 = 1.0 must imply a weight near sigma2/tau2 = 4.
    const rows = []
    for (let i = 0; i < 400; i++) {
      const trueMean = 3 + ((i % 20) - 9.5) * (0.5 / 5.77)
      rows.push({ mean: trueMean, n: 400, variance: 1.0 })
    }
    const { weight, grandMean } = estimatePrior(rows)
    expect(grandMean).toBeCloseTo(3, 1)
    expect(weight).toBeGreaterThan(2)
    expect(weight).toBeLessThan(8)
  })

  // --- inputs built to break it ---
  it('does not divide by zero when every course has the same mean', () => {
    // tau2 would be <= 0 here; the floor must keep the weight finite.
    const { weight } = estimatePrior(Array.from({ length: 50 }, () => ({ mean: 4.2, n: 30, variance: 0.6 })))
    expect(Number.isFinite(weight)).toBe(true)
    expect(weight).toBeGreaterThan(0)
  })

  it('falls back to a usable prior on an empty or unusable corpus', () => {
    for (const corpus of [[], [{ mean: NaN, n: 5, variance: 1 }], [{ mean: 4, n: 0, variance: 1 }]]) {
      const prior = estimatePrior(corpus as never)
      expect(Number.isFinite(prior.grandMean)).toBe(true)
      expect(Number.isFinite(prior.weight)).toBe(true)
      expect(prior.weight).toBeGreaterThan(0)
    }
  })

  it('weights the grand mean by responses, not by course count', () => {
    // One huge 5.0 course and many tiny 3.0 ones: response-weighting must favour the 5.
    const rows = [{ mean: 5, n: 10000, variance: 0.1 }]
    for (let i = 0; i < 20; i++) rows.push({ mean: 3, n: 2, variance: 0.1 })
    expect(estimatePrior(rows).grandMean).toBeGreaterThan(4.9)
  })

  it('reports the response variance pooledMean needs for the prior', () => {
    // All 5s -> no disagreement. Half 1s half 5s -> maximum disagreement.
    expect(pooledMean([[5, 10]])!.variance).toBe(0)
    expect(pooledMean([[1, 10], [5, 10]])!.variance).toBeCloseTo(4, 6)
  })
})

describe('adjustAndRank', () => {
  const obs = (mean: number, n: number) => ({ mean, n, variance: 0.65 })

  it('adjusts and ranks in one pass, keeping input order', () => {
    // A realistic corpus first -- a prior cannot be estimated from three points, and
    // with too few courses adjustAndRank correctly declines to shrink at all.
    const corpus = Array.from({ length: 500 }, (_, i) => obs(4.3 + ((i % 11) - 5) * 0.06, 60))
    const rows = [...corpus, obs(5, 2), obs(4.5, 500), obs(3.0, 500)]
    const { scores, percentiles } = adjustAndRank(rows)
    expect(scores.length).toBe(rows.length)
    const [tiny5, big45, big30] = percentiles.slice(-3)
    // The 2-response 5.0 must not outrank the well-sampled 4.5.
    expect(big45).toBeGreaterThan(tiny5)
    expect(big30).toBeLessThan(tiny5)
  })

  it('derives a different weight per category, which is the point of calling it per category', () => {
    // Same means, but one category's students disagree far more than the other's.
    const tight = Array.from({ length: 300 }, (_, i) => ({ mean: 4 + (i % 10) * 0.05, n: 40, variance: 0.2 }))
    const loose = Array.from({ length: 300 }, (_, i) => ({ mean: 4 + (i % 10) * 0.05, n: 40, variance: 1.2 }))
    expect(adjustAndRank(loose).prior.weight).toBeGreaterThan(adjustAndRank(tight).prior.weight)
  })

  it('shrinks toward its own category average, not a global one', () => {
    // A corpus centred on 4.2 must pull a small sample toward 4.2, not toward 3 or 5.
    const rows = Array.from({ length: 200 }, (_, i) => ({ mean: 4.2 + ((i % 7) - 3) * 0.1, n: 60, variance: 0.6 }))
    rows.push(obs(5, 1))
    const { prior, scores } = adjustAndRank(rows)
    expect(prior.grandMean).toBeCloseTo(4.2, 1)
    expect(scores[scores.length - 1]).toBeLessThan(5)
    expect(scores[scores.length - 1]).toBeGreaterThan(4.2)
  })

  it('survives an empty set without throwing', () => {
    const { scores, percentiles } = adjustAndRank([])
    expect(scores).toEqual([])
    expect(percentiles).toEqual([])
  })

  it('handles a single observation', () => {
    const { scores, percentiles } = adjustAndRank([obs(4.4, 30)])
    expect(percentiles).toEqual([100])
    expect(Number.isFinite(scores[0])).toBe(true)
  })
})

describe('adjustAndRank rounding', () => {
  it('never gives two identical displayed scores different percentiles', () => {
    // Ranking the unrounded score let 4.5678 and 4.5684 both display as 4.568 while
    // ranking 49th and 51st. Scores are rounded before ranking so that cannot recur.
    const rows = Array.from({ length: 2000 }, (_, i) => ({
      mean: 4 + (i * 0.0004137) % 1, n: 40 + (i % 300), variance: 0.6,
    }))
    const { scores, percentiles } = adjustAndRank(rows)
    const byScore = new Map<number, Set<number>>()
    scores.forEach((s: number, i: number) => {
      if (!byScore.has(s)) byScore.set(s, new Set())
      byScore.get(s)!.add(percentiles[i])
    })
    const ambiguous = [...byScore.entries()].filter(([, pcts]) => pcts.size > 1)
    expect(ambiguous).toEqual([])
  })

  it('returns scores already at the stored precision', () => {
    const { scores } = adjustAndRank(
      Array.from({ length: 500 }, (_, i) => ({ mean: 4 + (i % 97) / 313, n: 25, variance: 0.7 })),
    )
    for (const s of scores) expect(s).toBe(Math.round(s * 1000) / 1000)
  })

  it('keeps percentiles monotonic in the rounded score', () => {
    const rows = Array.from({ length: 1200 }, (_, i) => ({ mean: 3 + (i % 401) / 200, n: 60, variance: 0.65 }))
    const { scores, percentiles } = adjustAndRank(rows)
    const pairs = scores.map((s: number, i: number) => ({ s, p: percentiles[i] })).sort((a, b) => a.s - b.s)
    for (let i = 1; i < pairs.length; i++) expect(pairs[i].p).toBeGreaterThanOrEqual(pairs[i - 1].p)
  })
})

describe('headlineSampleSize', () => {
  it('uses the instruction-quality count so the headline matches the first chart', () => {
    expect(headlineSampleSize({
      quality: { score: 4.7, n: 122, pct: 60 },
      learning: { score: 4.4, n: 124, pct: 50 },
      organization: { score: 4.6, n: 121, pct: 80 },
    })).toBe(122)
  })

  it('falls back to the largest category when quality is absent', () => {
    expect(headlineSampleSize({
      learning: { score: 4.4, n: 124, pct: 50 },
      organization: { score: 4.6, n: 121, pct: 80 },
    })).toBe(124)
  })

  it('returns null for an empty breakdown instead of -Infinity', () => {
    expect(headlineSampleSize({})).toBeNull()
  })

  it('does not treat a zero quality count as absent', () => {
    // ?? not ||, so an explicit 0 is honoured rather than silently replaced.
    expect(headlineSampleSize({ quality: { score: 4, n: 0, pct: 1 }, learning: { score: 4, n: 9, pct: 5 } })).toBe(0)
  })
})

describe('rankShare', () => {
  it('returns just the clamped percentage for callers that style it themselves', () => {
    expect(rankShare(71)).toBe(71)
    expect(rankShare(100)).toBe(99)
    expect(rankShare(0)).toBe(1)
  })

  it('stays in step with rankLabel', () => {
    for (let pct = 0; pct <= 100; pct++) {
      expect(rankLabel(pct)).toBe(`Ranks higher than ${rankShare(pct)}% of all Stanford courses`)
    }
  })

  it('returns null for a missing percentile', () => {
    expect(rankShare(null)).toBeNull()
    expect(rankShare(undefined)).toBeNull()
    expect(rankShare(NaN)).toBeNull()
  })
})

describe('rankScopeLabel', () => {
  it('names the department when the rank was measured inside one', () => {
    expect(rankScopeLabel('CS')).toBe('CS courses')
    expect(rankScopeLabel('AFRICAAM')).toBe('AFRICAAM courses')
  })

  it('says so out loud when the rank is Stanford-wide, rather than going vague', () => {
    // "of courses" was the old wording and is now ambiguous between the two peer groups.
    expect(rankScopeLabel(null)).toBe('all Stanford courses')
    expect(rankScopeLabel(undefined)).toBe('all Stanford courses')
    expect(rankScopeLabel('')).toBe('all Stanford courses')
  })

  it('is what rankLabel renders, so the two can never disagree', () => {
    expect(rankLabel(71, 'CS')).toBe('Ranks higher than 71% of CS courses')
    expect(rankLabel(71, null)).toBe(`Ranks higher than 71% of ${rankScopeLabel(null)}`)
  })
})

describe('scopedPercentileRanks', () => {
  /** n courses in one department, scores 1..n so every rank is distinct. */
  const dept = (scope: string, n: number, offset = 0) =>
    Array.from({ length: n }, (_, i) => ({ scope, score: offset + i + 1 }))

  it('ranks a course against its own department, not the corpus', () => {
    // BIG's worst course beats every SMALL course on raw score, but it is still last
    // in BIG -- which is the whole point of the change.
    const items = [...dept('BIG', 10, 100), ...dept('OTHER', 10)]
    const out = scopedPercentileRanks(items)
    expect(out[0]).toEqual({ pct: 10, scope: 'BIG' })
    expect(out[9]).toEqual({ pct: 100, scope: 'BIG' })
    expect(out[10]).toEqual({ pct: 10, scope: 'OTHER' })
  })

  it('falls back to the corpus for a department below the floor, and says so', () => {
    const items = [...dept('BIG', 10), { scope: 'TINY', score: 0.5 }, { scope: 'TINY', score: 99 }]
    const out = scopedPercentileRanks(items)
    expect(out.at(-2)).toEqual({ pct: 8, scope: null })   // 1 of 12 at or below
    expect(out.at(-1)).toEqual({ pct: 100, scope: null }) // 12 of 12
    // A two-course department would otherwise have handed these 50 and 100.
    expect(out.at(-2)!.pct).not.toBe(50)
  })

  it('treats the floor as inclusive, so exactly DEPARTMENT_RANK_MIN qualifies', () => {
    const at = scopedPercentileRanks(dept('EDGE', DEPARTMENT_RANK_MIN))
    const below = scopedPercentileRanks(dept('EDGE', DEPARTMENT_RANK_MIN - 1))
    expect(at.every(r => r.scope === 'EDGE')).toBe(true)
    expect(below.every(r => r.scope === null)).toBe(true)
  })

  it('counts the fallback courses in the corpus ranking they fall back to', () => {
    // The corpus is every item, small departments included -- dropping them would make
    // the fallback rank describe a population the reader was never shown.
    const items = [...dept('BIG', 10, 10), { scope: 'TINY', score: 0 }]
    const out = scopedPercentileRanks(items)
    expect(out.at(-1)).toEqual({ pct: 9, scope: null }) // 1 of 11, not 1 of 10
  })

  it('gives tied scores in the same department the same rank', () => {
    const items = Array.from({ length: 12 }, () => ({ scope: 'TIE', score: 4.2 }))
    expect(new Set(scopedPercentileRanks(items).map(r => r.pct))).toEqual(new Set([100]))
  })

  it('ranks the same score differently in two departments, which is the point', () => {
    const items = [
      ...dept('STRONG', 10, 10),                 // 11..20
      { scope: 'STRONG', score: 15.5 },
      ...dept('WEAK', 10),                       // 1..10
      { scope: 'WEAK', score: 15.5 },
    ]
    const out = scopedPercentileRanks(items)
    expect(out[10].scope).toBe('STRONG')
    expect(out[21].scope).toBe('WEAK')
    expect(out[21].pct).toBeGreaterThan(out[10].pct)
    expect(out[21].pct).toBe(100)
  })

  it('does not let a null scope be grouped as its own department', () => {
    const items = [...dept('BIG', 10), ...Array.from({ length: 20 }, () => ({ scope: null as unknown as string, score: 50 }))]
    const out = scopedPercentileRanks(items)
    expect(out.slice(10).every(r => r.scope === null)).toBe(true)
    expect(out.slice(0, 10).every(r => r.scope === 'BIG')).toBe(true)
  })

  it('returns one entry per input, in input order, for an empty and a single input', () => {
    expect(scopedPercentileRanks([])).toEqual([])
    expect(scopedPercentileRanks([{ scope: 'X', score: 3 }])).toEqual([{ pct: 100, scope: null }])
  })

  it('matches percentileRanks exactly when nothing clears the floor', () => {
    const items = [{ scope: 'A', score: 3 }, { scope: 'B', score: 5 }, { scope: 'A', score: 4 }]
    const flat = percentileRanks(items.map(i => i.score))
    expect(scopedPercentileRanks(items).map(r => r.pct)).toEqual(flat)
  })

  it('honours an explicit floor of 1 so a caller can force department ranking', () => {
    const out = scopedPercentileRanks([{ scope: 'TINY', score: 1 }, { scope: 'TINY', score: 2 }], 1)
    expect(out).toEqual([{ pct: 50, scope: 'TINY' }, { pct: 100, scope: 'TINY' }])
  })
})
