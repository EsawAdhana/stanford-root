import type { CourseEvaluation } from '@/types/course'
import { categorizeQuestion } from '@/lib/eval-reports.mjs'
import { addRatingCounts, pooledMean } from '@/lib/quality-score.mjs'

/**
 * The numbers behind the site's Charts tab (aggregateMetrics in
 * src/components/course-evaluations.tsx): 1-5 ratings pool every response,
 * hours and attendance are the median of each report's median.
 */
const POOLED = ['quality', 'learning', 'organization', 'goals'] as const
const BUCKETS: [number, number, string][] = [[0, 5, '0-5'], [5, 10, '5-10'], [10, 15, '10-15'], [15, 20, '15-20'], [20, 30, '20-30'], [30, Infinity, '30+']]

function median(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export function aggregate(reports: CourseEvaluation[]) {
  const pooled = new Map<string, Map<number, number>>()
  const medians: Record<string, number[]> = { hours: [], attendance_in_person: [], attendance_online: [] }
  const hours = new Map<string, number>()
  for (const r of reports) {
    for (const q of r.questions ?? []) {
      const cat = categorizeQuestion(q.text ?? '') as string
      if ((POOLED as readonly string[]).includes(cat)) {
        if (!pooled.has(cat)) pooled.set(cat, new Map())
        addRatingCounts(pooled.get(cat)!, q)
        continue
      }
      if (cat in medians && typeof q.median === 'number' && !Number.isNaN(q.median)) medians[cat].push(q.median)
      if (cat === 'hours') {
        for (const o of q.options ?? []) {
          const v = Number(o.weight)
          const n = Number(o.count)
          if (!Number.isFinite(v) || !(n > 0)) continue
          const b = BUCKETS.find(([lo, hi]) => v >= lo && v < hi)![2]
          hours.set(b, (hours.get(b) ?? 0) + n)
        }
      }
    }
  }
  const out: Record<string, unknown> = {}
  for (const [cat, counts] of pooled) {
    const p = pooledMean(counts)
    if (!p) continue
    let n = 0
    for (const c of counts.values()) n += c
    out[cat] = {
      mean: Math.round(p.mean * 100) / 100,
      responses: n,
      distribution_pct: Object.fromEntries([1, 2, 3, 4, 5].map(w => [String(w), Math.round((100 * (counts.get(w) ?? 0)) / n)])),
    }
  }
  for (const [cat, xs] of Object.entries(medians)) {
    const m = median(xs)
    if (m !== null) out[cat] = Math.round(m * 10) / 10
  }
  let total = 0
  for (const n of hours.values()) total += n
  if (total) out.hours_distribution_pct = Object.fromEntries(BUCKETS.map(([, , b]) => [b, Math.round((100 * (hours.get(b) ?? 0)) / total)]))
  return out
}
