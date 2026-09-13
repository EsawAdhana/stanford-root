/**
 * LOCAL PREVIEW ONLY. Recomputes the rating columns into data/catalog/*.json exactly
 * as refreshMetrics() would, so the app can be run before the migration is applied.
 * `npm run dump:catalog` supersedes this once courses.rating_breakdown exists.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync } from 'node:fs'
import { buildCrossListGroups, deriveEvalPairings, normalizeCourseId } from '../src/lib/utils'
import { addRatingCounts, pooledMean, estimatePrior, shrinkToPrior, scopedPercentileRanks, round3, headlineSampleSize } from '../src/lib/quality-score.mjs'
import { categorizeQuestion, courseLevelSignature, normalizeTerm } from '../src/lib/eval-reports.mjs'

const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split('\n').filter(l => l.includes('=')).map(l => {
  const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
}))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
async function loadAll<T>(t: string, c: string): Promise<T[]> {
  const rows: T[] = []; let from = 0
  for (;;) {
    const { data, error } = await sb.from(t).select(c).range(from, from + 999)
    if (error) throw new Error(error.message)
    rows.push(...(data as unknown as T[])); if (data.length < 1000) break; from += 1000
  }
  return rows
}

const RATING_CATEGORIES = ['quality', 'learning', 'organization'] as const
type Cat = typeof RATING_CATEGORIES[number]
const category = (t: unknown): Cat | 'hours' | null => {
  const c = categorizeQuestion(String(t ?? ''))
  return c === 'quality' || c === 'learning' || c === 'organization' || c === 'hours' ? c : null
}
const median = (values: number[]) => {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b); const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const units = (v: unknown) => {
  const m = String(v || '').match(/\d+(?:\.\d+)?/g)
  return Math.max(...(m?.map(Number) || [1]))
}

const [evalRows, courseRows] = await Promise.all([
  loadAll<any>('evaluations', 'course_id,course_code,term,instructor,questions'),
  loadAll<any>('courses', 'course_id,subject,title,units'),
])
const catalogIds = new Set(courseRows.map(r => normalizeCourseId(String(r.course_id))))
const pairings: Map<string, string[]> = deriveEvalPairings(evalRows, catalogIds)
const courses = courseRows.map(r => ({
  id: String(r.course_id),
  title: String(r.title || ''),
  crossListWith: pairings.get(normalizeCourseId(String(r.course_id))) || [],
}))
const courseUnits = new Map(courseRows.map(r => [String(r.course_id), units(r.units)]))
const groups: Map<string, string[]> = buildCrossListGroups(courses)
const sizes = [...groups.values()].map(g => g.length).sort((a, b) => b - a)
console.log(`grouping: ${groups.size} classes, largest group ${sizes[0]} codes, ${sizes.filter(n => n > 1).length} multi-code`)
const groupOf = new Map<string, string>()
for (const [canonical, members] of groups) for (const m of members) groupOf.set(m, canonical)

const questionsByGroup = new Map<string, any[]>()
const seen = new Set<string>(); let dupes = 0
for (const r of evalRows) {
  const canonical = groupOf.get(r.course_id) ?? r.course_id
  // normalizeTerm, matching refreshMetrics(): the same report reaches us under two
  // spellings of its term ("Autumn 2023-24" and "Autumn 2023", "1236 SLS" and
  // "Winter 2024"), and keying on the raw string counted each of those twice. That
  // inflated 19,714 reports out of 17,735 and pulled 1,686 scores off the real value.
  const key = `${canonical}||${r.course_code}||${normalizeTerm(r.term)}||${courseLevelSignature(r)}`
  if (seen.has(key)) { dupes++; continue }
  seen.add(key)
  if (!questionsByGroup.has(canonical)) questionsByGroup.set(canonical, [])
  questionsByGroup.get(canonical)!.push(...(r.questions || []))
}
console.log(`${seen.size} distinct reports over ${questionsByGroup.size} classes (${dupes} duplicate rows skipped)`)

const pooledByCategory = new Map<Cat, Map<string, Map<number, number>>>(RATING_CATEGORIES.map(k => [k, new Map()]))
const hoursByGroup = new Map<string, number[]>()
for (const [canonical, questions] of questionsByGroup) {
  for (const q of questions) {
    const cat = category(q?.text)
    if (!cat) continue
    if (cat === 'hours') {
      if (Number.isFinite(q.median) && q.median > 0) {
        if (!hoursByGroup.has(canonical)) hoursByGroup.set(canonical, [])
        hoursByGroup.get(canonical)!.push(q.median)
      }
      continue
    }
    const per = pooledByCategory.get(cat)!
    if (!per.has(canonical)) per.set(canonical, new Map())
    addRatingCounts(per.get(canonical)!, q)
  }
}

// Scores are per class; ranks are per LISTING, against the listing's own department.
// Same rule as refreshMetrics -- see scrape-evaluations.mjs.
type Pair = { subject: string | null; canonical: string; key: string }
const listings = (() => {
  const seen = new Set<string>(); const out: Pair[] = []
  for (const r of courseRows) {
    const id = String(r.course_id)
    const canonical = groupOf.get(id) ?? id
    const subject = (r.subject as string) || null
    const key = `${subject}||${canonical}`
    if (seen.has(key)) continue
    seen.add(key); out.push({ subject, canonical, key })
  }
  return out
})()

const breakdown = new Map<string, Partial<Record<Cat, { score: number; n: number; pct: number; scope: string | null }>>>()
for (const key of RATING_CATEGORIES) {
  const scoreOf = new Map<string, { score: number; n: number }>()
  const ids: string[] = []; const obs: any[] = []
  for (const [canonical, counts] of pooledByCategory.get(key)!) {
    const p = pooledMean(counts); if (!p) continue
    ids.push(canonical); obs.push(p)
  }
  const prior = estimatePrior(obs)
  ids.forEach((canonical, i) => scoreOf.set(canonical, {
    score: round3(shrinkToPrior(obs[i].mean, obs[i].n, prior)), n: obs[i].n,
  }))
  const pairs = listings.filter(l => scoreOf.has(l.canonical))
  const ranks = scopedPercentileRanks(pairs.map(l => ({ scope: l.subject, score: scoreOf.get(l.canonical)!.score })))
  const inDept = ranks.filter(r => r.scope != null).length
  console.log(`  ${key.padEnd(13)} mean ${prior.grandMean.toFixed(3)} weight ${prior.weight.toFixed(2)} ${ids.length} classes, ${inDept}/${pairs.length} listings in-department`)
  pairs.forEach((l, i) => {
    if (!breakdown.has(l.key)) breakdown.set(l.key, {})
    breakdown.get(l.key)![key] = { ...scoreOf.get(l.canonical)!, pct: ranks[i].pct, scope: ranks[i].scope }
  })
}

const perPair = new Map<string, any>()
for (const [key, parts] of breakdown) {
  const values = Object.values(parts) as { score: number; n: number }[]
  perPair.set(key, {
    quality: round3(values.reduce((s, p) => s + p.score, 0) / values.length),
    quality_n: headlineSampleSize(parts as any),
    rating_breakdown: parts,
  })
}
const overallPairs = listings.filter(l => perPair.has(l.key))
const overallRanks = scopedPercentileRanks(overallPairs.map(l => ({ scope: l.subject, score: perPair.get(l.key).quality })))
overallPairs.forEach((l, i) => {
  perPair.get(l.key).quality_pct = overallRanks[i].pct
  perPair.get(l.key).rank_scope = overallRanks[i].scope
})
console.log(`  overall       ${overallPairs.length} listings, ${overallRanks.filter(r => r.scope != null).length} ranked within their department`)

for (const file of ['light.json', 'full.json']) {
  const path = `data/catalog/${file}`
  const rows = JSON.parse(readFileSync(path, 'utf8')) as any[]
  let rated = 0
  for (const row of rows) {
    const id = String(row.course_id)
    const canonical = groupOf.get(id) ?? id
    const value = perPair.get(`${(row.subject as string) || null}||${canonical}`)
    const hours = median(hoursByGroup.get(canonical) || [])
    delete row.quality_pct; delete row.quality_n; delete row.rank_scope
    delete row.rating_breakdown; delete row.cross_list_with
    row.quality = null
    const pairs = pairings.get(normalizeCourseId(id))
    if (pairs && pairs.length > 0) row.cross_list_with = pairs
    if (hours != null) {
      row.hours = hours
      row.difficulty = hours / (courseUnits.get(id) || 1)
    }
    if (!value) continue
    row.quality = value.quality
    row.quality_n = value.quality_n
    row.quality_pct = value.quality_pct
    row.rank_scope = value.rank_scope
    row.rating_breakdown = value.rating_breakdown
    rated++
  }
  writeFileSync(path, JSON.stringify(rows))
  console.log(`${file}: ${rows.length} rows, ${rated} rated`)
}
