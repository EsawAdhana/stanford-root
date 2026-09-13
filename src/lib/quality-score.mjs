/**
 * The one place a course quality number is defined.
 *
 * Imported by both the scraper (scripts/scrape-evaluations.mjs, plain node) and the
 * UI (src/components/course-evaluations.tsx), so the catalog badge and the course
 * page can never disagree. Plain .mjs for that reason -- the scraper can't load TS.
 *
 * Why a pooled mean and not a median: the scale is bounded at 5 and the mode sits on
 * that ceiling, so a median lands on exactly 5.00 for ~70% of Stanford courses and
 * stops telling them apart -- courses spanning the 30th to 97th percentile all render
 * identically. Pooling every individual response also lets a 400-person lecture
 * outweigh a 5-person seminar, which a median of per-section medians does not.
 */

/** Response weights we treat as a 1-5 rating. Anything else is a different question. */
const RATING_WEIGHTS = [1, 2, 3, 4, 5]

/**
 * @param {Iterable<[number, number]>} counts weight -> number of students who chose it
 * @returns {{ mean: number, n: number, dist: number[], variance: number } | null} null when nothing usable
 */
export function pooledMean(counts) {
    let n = 0
    let total = 0
    const dist = [0, 0, 0, 0, 0]
    for (const [weight, count] of counts) {
        if (!Number.isFinite(weight) || !Number.isFinite(count)) continue
        if (!RATING_WEIGHTS.includes(weight) || count <= 0) continue
        n += count
        total += weight * count
        dist[weight - 1] += count
    }
    if (n === 0) return null
    const mean = total / n
    // Variance of the individual responses -- feeds the shrinkage prior below.
    let ss = 0
    for (let w = 1; w <= 5; w++) ss += dist[w - 1] * (w - mean) ** 2
    return { mean, n, dist, variance: ss / n }
}

/**
 * How much a small sample should be distrusted, estimated from the corpus itself.
 *
 * A course's observed mean is its true quality plus sampling noise. Empirical Bayes
 * splits the two: sigma2 is how much individual students disagree within a course,
 * tau2 is how much courses genuinely differ from each other. Their ratio is the
 * number of responses at which a course's own data outweighs the Stanford average --
 * so nothing is hand-tuned, and re-running the scraper re-derives it.
 *
 * @param {Array<{ mean: number, n: number, variance: number }>} observations
 * @returns {{ grandMean: number, weight: number }}
 */
export function estimatePrior(observations) {
    const rows = observations.filter(o => o && o.n > 0 && Number.isFinite(o.mean))
    if (rows.length === 0) return { grandMean: 3, weight: 1 }

    const totalN = rows.reduce((sum, o) => sum + o.n, 0)
    const grandMean = rows.reduce((sum, o) => sum + o.mean * o.n, 0) / totalN
    const sigma2 = rows.reduce((sum, o) => sum + o.variance * o.n, 0) / totalN

    const observedVar = rows.reduce((sum, o) => sum + (o.mean - grandMean) ** 2, 0) / rows.length
    const samplingNoise = rows.reduce((sum, o) => sum + sigma2 / o.n, 0) / rows.length
    // What's left after removing the noise is the real spread between courses. Floored
    // so a degenerate corpus can't divide by ~0 and shrink every course to the mean.
    const tau2 = Math.max(observedVar - samplingNoise, 1e-4)

    return { grandMean, weight: sigma2 / tau2 }
}

/**
 * The course's rating with small samples pulled toward the Stanford average, so a 5.00
 * from two students does not outrank a 4.7 from four hundred. At n >> weight this is
 * just the raw mean.
 *
 * @param {number} mean
 * @param {number} n
 * @param {{ grandMean: number, weight: number }} prior
 */
export function shrinkToPrior(mean, n, prior) {
    const { grandMean, weight } = prior
    return (n * mean + weight * grandMean) / (n + weight)
}

/**
 * Accumulate a question's option counts into a weight -> count map.
 * @param {Map<number, number>} into
 * @param {{ options?: Array<{ weight?: unknown, count?: unknown }> }} question
 */
export function addRatingCounts(into, question) {
    for (const option of question?.options || []) {
        const weight = Number(option?.weight)
        const count = Number(option?.count)
        if (!Number.isFinite(weight) || !Number.isFinite(count)) continue
        if (!RATING_WEIGHTS.includes(weight) || count <= 0) continue
        into.set(weight, (into.get(weight) || 0) + count)
    }
    return into
}

/**
 * Percentile rank (1-100, 100 = highest rated) of each score within the whole set.
 *
 * Ties all take the rank of the last course in the tie, so two courses with the same
 * mean can never render different ranks. Returns a parallel array to `scores`.
 * @param {number[]} scores
 * @returns {number[]}
 */
export function percentileRanks(scores) {
    const order = scores.map((score, index) => index).sort((a, b) => scores[a] - scores[b])
    const out = new Array(scores.length)
    for (let i = 0; i < order.length; i++) {
        let last = i
        while (last + 1 < order.length && scores[order[last + 1]] === scores[order[i]]) last++
        const pct = Math.max(1, Math.round(((last + 1) / order.length) * 100))
        for (let j = i; j <= last; j++) out[order[j]] = pct
        i = last
    }
    return out
}

/**
 * A department needs this many rated courses before it is its own peer group.
 *
 * 197 subjects have at least one rated course and 85 of them have ten or fewer, so an
 * unconditional within-department rank would hand a two-course subject a 50th and a
 * 100th percentile and call that a ranking. Below the floor the course keeps its rank
 * against every rated course at Stanford, and the label says which peer group it used.
 */
export const DEPARTMENT_RANK_MIN = 10

/**
 * Percentile each score within its own scope, falling back to the whole corpus for
 * scopes that are too small to rank inside.
 *
 * Returns the scope each rank was actually computed in -- null for the fallback -- so
 * the label can never claim a peer group the number was not measured against.
 *
 * @param {Array<{ scope: string | null, score: number }>} items
 * @param {number} minScopeSize
 * @returns {Array<{ pct: number, scope: string | null }>}
 */
export function scopedPercentileRanks(items, minScopeSize = DEPARTMENT_RANK_MIN) {
    const sizes = new Map()
    for (const item of items) sizes.set(item.scope, (sizes.get(item.scope) || 0) + 1)

    const corpusRanks = percentileRanks(items.map(item => item.score))
    const out = new Array(items.length)
    const indexesByScope = new Map()
    items.forEach((item, index) => {
        if (item.scope == null || (sizes.get(item.scope) || 0) < minScopeSize) {
            out[index] = { pct: corpusRanks[index], scope: null }
            return
        }
        if (!indexesByScope.has(item.scope)) indexesByScope.set(item.scope, [])
        indexesByScope.get(item.scope).push(index)
    })
    for (const [scope, indexes] of indexesByScope) {
        const ranks = percentileRanks(indexes.map(index => items[index].score))
        indexes.forEach((index, i) => { out[index] = { pct: ranks[i], scope } })
    }
    return out
}

/**
 * Adjust a set of comparable observations for sample size, then rank them against
 * each other. This is the whole pipeline for one question type.
 *
 * Call it ONCE PER CATEGORY, never across categories: each question has its own
 * response spread and its own corpus average (Stanford students disagree more about
 * "how much did you learn" than about organization, and rate organization ~0.19 lower
 * overall), so a shared prior would shrink each toward the wrong mean by the wrong
 * amount and make the ranks non-comparable.
 *
 * @param {Array<{ mean: number, n: number, variance: number }>} observations
 * @returns {{ prior: { grandMean: number, weight: number }, scores: number[], percentiles: number[] }}
 */
export function adjustAndRank(observations) {
    const prior = estimatePrior(observations)
    // Round BEFORE ranking. The rounded value is what gets stored and shown, so ranking
    // the unrounded one let two courses display an identical score and a different
    // percentile (589 pairs did, e.g. two courses at 4.568 ranked 49th and 51st).
    const scores = observations.map(o => round3(shrinkToPrior(o.mean, o.n, prior)))
    return { prior, scores, percentiles: percentileRanks(scores) }
}

/** The stored precision for a rating. Ranking and display must agree on it. */
export function round3(value) {
    return Math.round(value * 1000) / 1000
}

/**
 * How the rank is worded.
 *
 * One fixed direction, never flipped. "Top X%" reads as praise for a below-median course
 * ("Top 84%"), and flipping between Top and Bottom means two nearly identical courses
 * either side of the median get opposite-sounding labels -- the 50th percentile read
 * "Top 50%" while the 49th read "Bottom 49%". Phrased this way the number always moves
 * in the same direction as the rating, so a sorted list reads monotonically.
 *
 * `pct` is the share of courses at or below this one, so it includes the course itself
 * and anything tied with it. Clamped to 1..99 because no course ranks above all courses
 * (itself included) and none ranks above none of them.
 *
 * The peer group is always named. A department rank and a Stanford-wide rank are
 * different numbers on the same 1-99 scale, so "62%" alone is ambiguous between the two
 * and a reader cannot tell which one they are looking at.
 *
 * @param {number | null | undefined} pct
 * @param {string | null} [scope] subject the rank was computed in, null = all of Stanford
 */
export function rankLabel(pct, scope) {
    const share = rankShare(pct)
    return share == null ? null : `Ranks higher than ${share}% of ${rankScopeLabel(scope)}`
}

/**
 * Names the peer group a percentile was measured against.
 * @param {string | null} [scope]
 */
export function rankScopeLabel(scope) {
    return scope ? `${scope} courses` : 'all Stanford courses'
}

/**
 * Just the percentage, for callers that style it separately from the sentence.
 * @param {number | null | undefined} pct
 * @returns {number | null}
 */
export function rankShare(pct) {
    if (pct == null || !Number.isFinite(pct)) return null
    return Math.min(99, Math.max(1, Math.round(pct)))
}

/**
 * The sample size shown beside the overall rating.
 *
 * Prefer the instruction-quality question: its chart is the first one under the headline,
 * so any other choice makes the two most prominent numbers on the page differ by a few
 * (the questions have slightly different response rates). Falls back to the largest
 * category for the handful of classes whose evaluations omit that question.
 *
 * @param {Record<string, { n: number, [k: string]: unknown }>} parts
 */
export function headlineSampleSize(parts) {
    const values = Object.values(parts)
    if (values.length === 0) return null
    return parts.quality?.n ?? Math.max(...values.map(p => p.n))
}
