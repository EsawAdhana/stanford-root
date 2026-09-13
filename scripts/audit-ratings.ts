/**
 * Full-catalog invariant audit for the rating pipeline.
 *
 * Imports the REAL application code -- the shared cross-list grouping, the evaluation
 * store's merge, quality-score.mjs -- rather than reimplementing it, so this audit and
 * production cannot disagree by construction. Run after any change to the rating maths,
 * the evaluation merge, or the cross-list grouping.
 *
 *   npm run audit:ratings
 *
 * Exits non-zero if any invariant is violated.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { resolveCrossListRating, normalizeCourseId, buildCrossListGroups, deriveEvalPairings } from '../src/lib/utils'
import { useEvaluationStore } from '../src/lib/evaluation-store'
import { toCourseEvaluation, type EvaluationRow } from '../src/lib/evaluation-row'
import { addRatingCounts, pooledMean, percentileRanks, adjustAndRank, round3, headlineSampleSize, scopedPercentileRanks, DEPARTMENT_RANK_MIN } from '../src/lib/quality-score.mjs'
import { categorizeQuestion, courseLevelSignature, dedupeCourseLevelReports } from '../src/lib/eval-reports.mjs'
import type { Course, CourseEvaluation } from '../src/types/course'

let failures = 0
let checks = 0
const out: string[] = []

function check(name: string, violations: string[], detail?: string) {
  checks++
  if (violations.length === 0) {
    out.push(`  PASS  ${name}${detail ? `  (${detail})` : ''}`)
    return
  }
  failures++
  out.push(`  FAIL  ${name} -- ${violations.length} violation(s)`)
  for (const v of violations.slice(0, 6)) out.push(`          ${v}`)
  if (violations.length > 6) out.push(`          ... and ${violations.length - 6} more`)
}
const info = (msg: string) => out.push(`  info  ${msg}`)

/**
 * Key-order-independent JSON comparison. Postgres normalises jsonb key order (shortest
 * key first, then alphabetical), so a stored breakdown round-trips as {n, pct, score}
 * while the freshly computed one is {score, n, pct}. Comparing the raw strings reported
 * all 5,214 rated rows as differing when every value was identical.
 */
function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`
}
const section = (t: string) => { out.push(''); out.push(t) }

// ---------------------------------------------------------------- load
const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split('\n').filter(l => l.includes('=')).map(l => {
    const i = l.indexOf('=')
    return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
  }),
)
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

async function loadAll<T>(table: string, cols: string): Promise<T[]> {
  const rows: T[] = []
  let from = 0
  for (;;) {
    const { data, error } = await sb.from(table).select(cols).range(from, from + 999)
    if (error) throw new Error(`${table}: ${error.message}`)
    rows.push(...(data as unknown as T[]))
    if (data.length < 1000) break
    from += 1000
  }
  return rows
}

console.log('Loading...')
type Row = EvaluationRow & { course_id: string; course_code: string; questions: any[] }
const [evalRows, courseRows] = await Promise.all([
  loadAll<Row>('evaluations', 'course_id,course_code,term,instructor,respondents,questions,comments'),
  loadAll<Record<string, unknown>>('courses', 'course_id,subject,code,title,units,grading'),
])
console.log(`  ${evalRows.length} evaluation rows, ${courseRows.length} course rows`)

const RATING_CATEGORIES = ['quality', 'learning', 'organization'] as const
type Cat = typeof RATING_CATEGORIES[number]
const category = (t: unknown): Cat | 'hours' | null => {
  const c = categorizeQuestion(String(t ?? ''))
  return c === 'quality' || c === 'learning' || c === 'organization' || c === 'hours' ? c : null
}
const isRating = (q: any) => {
  const c = category(q?.text)
  return c !== null && c !== 'hours'
}

/**
 * Answers a question's own responseRate accounts for that are NOT a 1-5 rating: Law
 * offers "Not applicable/Have no basis to answer" at weight 0, and someone picking it
 * counts as having responded while contributing no rating.
 */
const notApplicableCount = (q: any) =>
  (q?.options || [])
    .filter((o: any) => typeof o?.weight === 'number' && (o.weight < 1 || o.weight > 5))
    .reduce((sum: number, o: any) => sum + (Number(o?.count) || 0), 0)

// ================================================================
section('1. Evaluation rows (source data)')

{
  // Everything downstream assumes we read Stanford's option counts the way Stanford
  // does. If our pooled mean matched their published mean on every rating question,
  // that assumption is proven rather than asserted.
  const bad: string[] = []
  let compared = 0
  for (const r of evalRows) {
    for (const q of r.questions || []) {
      if (!isRating(q) || q?.type !== 'rating' || typeof q.mean !== 'number') continue
      const pooled = pooledMean(addRatingCounts(new Map(), q))
      if (!pooled) continue
      compared++
      if (Math.abs(pooled.mean - q.mean) > 0.011) {
        bad.push(`${r.course_id} ${String(r.term).slice(0, 20)} ours=${pooled.mean.toFixed(3)} stanford=${q.mean}`)
      }
    }
  }
  check("our pooled mean matches Stanford's published mean on every rating question", bad, `${compared} questions`)
}

{
  // Off-scale weights exist (Law uses weight 0 for "Not applicable"). They must always
  // be an explicit no-answer option, never a real rating we would be dropping.
  const bad: string[] = []
  const labels = new Set<string>()
  for (const r of evalRows) {
    for (const q of r.questions || []) {
      if (!isRating(q) || q?.type !== 'rating') continue
      for (const o of q.options || []) {
        if (typeof o?.weight !== 'number' || (o.weight >= 1 && o.weight <= 5)) continue
        labels.add(String(o.text))
        if (!/not applicable|no basis|n\/a/i.test(String(o.text))) {
          bad.push(`${r.course_id}: off-scale weight ${o.weight} labelled "${o.text}" count=${o.count}`)
        }
      }
      for (const o of q.options || []) {
        if (typeof o?.count === 'number' && o.count < 0) bad.push(`${r.course_id}: negative count`)
      }
    }
  }
  check('every off-scale weight is an explicit "not applicable" option', bad,
    labels.size ? `labels seen: ${[...labels].join(' | ')}` : 'none present')
}

{
  // Our term parser must agree with the PeopleSoft strm the Law rows lead with.
  const SEASON: Record<string, string> = { 2: 'Fall', 4: 'Winter', 6: 'Spring', 8: 'Summer' }
  const bad: string[] = []
  let compared = 0
  for (const r of evalRows) {
    const m = String(r.term || '').match(/^1(\d)(\d)(\d)\s/)
    if (!m) continue
    const season = SEASON[m[3]]
    if (!season) continue
    compared++
    // strm 1YYT: YY is the academic year's ending year, T the season code.
    const endYear = 2000 + Number(`${m[1]}${m[2]}`)
    const want = season === 'Fall' ? endYear - 1 : endYear
    const parsed = toCourseEvaluation(r as EvaluationRow).term
    if (parsed !== `${season} ${want}`) bad.push(`strm=${m[0].trim()} parsed="${parsed}" expected "${season} ${want}"`)
  }
  check('parsed term agrees with the PeopleSoft strm', bad, `${compared} strm-prefixed rows`)
}

{
  // Informational: Stanford's own course_code prefix sometimes contradicts its term.
  const SEASON: Record<string, string> = { F: 'Fall', W: 'Winter', SP: 'Spring', S: 'Spring', SU: 'Summer' }
  let disagreements = 0
  const examples: string[] = []
  for (const r of evalRows) {
    const m = String(r.course_code || '').split('/')[0].match(/^([A-Za-z]{1,2})(\d{2})-/)
    if (!m) continue
    const season = SEASON[m[1].toUpperCase()]
    if (!season) continue
    const parsed = toCourseEvaluation(r as EvaluationRow).term
    if (!parsed.startsWith(season)) {
      disagreements++
      if (examples.length < 3) examples.push(`${r.course_id} code=${String(r.course_code).split('/')[0]} term="${parsed}"`)
    }
  }
  info(`course_code prefix contradicts the term field on ${disagreements} row(s) -- upstream data, we follow the term field` +
    (examples.length ? ` [${examples.join('; ')}]` : ''))
}

{
  const bad: string[] = []
  for (const r of evalRows) {
    if (!r.course_code) continue
    const codes = String(r.course_code).split('/').map(c =>
      normalizeCourseId(c.replace(/^[A-Za-z]{1,2}\d{2}-/, '').replace(/-\d+[A-Za-z]?$/, '').replace(/-/g, '')))
    if (!codes.includes(normalizeCourseId(r.course_id))) {
      bad.push(`${r.course_id} not among [${codes.join(', ')}] from ${r.course_code}`)
    }
  }
  check('every evaluation is filed under a code its course_code lists', bad)
}

{
  // Our count of a question's answers must equal what Stanford says answered it. Each
  // question carries its own responseRate ("15/16 (93.75%)"), which is the authoritative
  // figure: the per-report "N of M responded" header sometimes disagrees with it
  // (LAWGEN 117Q reports "10 of 16" on a question whose own rate is 15/16, and 15 is
  // what the option counts sum to).
  //
  // This is the check that would have caught the co-instructor duplication immediately:
  // pooling a section's identical copies produced two to thirteen times the answers any
  // single question reported.
  const bad: string[] = []
  let compared = 0
  let noRate = 0
  for (const r of evalRows) {
    for (const q of r.questions || []) {
      const cat = category(q?.text)
      if (!cat || cat === 'hours') continue
      const counted = pooledMean(addRatingCounts(new Map(), q))?.n ?? 0
      if (counted === 0) continue
      const m = String((q as { responseRate?: unknown }).responseRate ?? '').match(/^\s*(\d+)\s*\/\s*(\d+)/)
      if (!m) { noRate++; continue }
      compared++
      const expected = Number(m[1]) - notApplicableCount(q)
      if (counted !== expected) {
        bad.push(`${r.course_id} ${String(r.term).slice(0, 14)} ${cat}: counted ${counted}, expected ${expected} (rate ${m[1]}, ${notApplicableCount(q)} n/a)`)
      }
    }
  }
  check("each question's option counts match its own reported response rate", bad,
    `${compared} questions compared, ${noRate} without a parseable rate`)
}

{
  // And after de-duplication, a section must not pool more answers than its questions
  // individually reported -- the aggregate form of the check above.
  const bad: string[] = []
  let compared = 0
  const bySection = new Map<string, Row[]>()
  for (const r of evalRows) {
    const key = `${r.course_id}||${r.course_code}||${r.term}`
    if (!bySection.has(key)) bySection.set(key, [])
    bySection.get(key)!.push(r)
  }
  for (const [key, reports] of bySection) {
    const seen = new Set<string>()
    const kept: Row[] = []
    for (const r of reports) {
      const sig = courseLevelSignature(r)
      if (seen.has(sig)) continue
      seen.add(sig)
      kept.push(r)
    }
    for (const cat of RATING_CATEGORIES) {
      const counts = new Map<number, number>()
      let reported = 0
      let sawRate = false
      for (const r of kept) {
        for (const q of r.questions || []) {
          if (category(q?.text) !== cat) continue
          addRatingCounts(counts, q)
          const m = String((q as { responseRate?: unknown }).responseRate ?? '').match(/^\s*(\d+)\s*\/\s*(\d+)/)
          if (m) { reported += Number(m[1]) - notApplicableCount(q); sawRate = true }
        }
      }
      const n = pooledMean(counts)?.n ?? 0
      if (n === 0 || !sawRate) continue
      compared++
      if (n !== reported) bad.push(`${key.slice(0, 56)}.${cat}: pooled ${n}, questions reported ${reported}`)
    }
  }
  check('a de-duplicated section pools exactly what its questions reported', bad, `${compared} section-questions`)
}

// ================================================================
section('2. Metrics, computed exactly as refreshMetrics does')

const courses: Course[] = courseRows.map(r => ({
  id: String(r.course_id), subject: String(r.subject || ''), code: String(r.code || ''),
  title: String(r.title || ''), units: String(r.units ?? ''), grading: String(r.grading || ''),
  description: '', instructors: [], terms: [], sections: [],
} as Course))

const catalogIds = new Set(courses.map(c => normalizeCourseId(c.id)))
const evalPairings: Map<string, string[]> = deriveEvalPairings(evalRows, catalogIds)
for (const c of courses) c.crossListWith = evalPairings.get(normalizeCourseId(c.id)) || []
const groups: Map<string, string[]> = buildCrossListGroups(courses)
const groupOfCourse = new Map<string, string>()
for (const [canonical, members] of groups) for (const m of members) groupOfCourse.set(m, canonical)

const questionsByGroup = new Map<string, any[]>()
const seenReports = new Set<string>()
let duplicateRows = 0
for (const r of evalRows) {
  const canonical = groupOfCourse.get(r.course_id) ?? r.course_id
  const key = `${canonical}||${r.course_code}||${r.term}||${courseLevelSignature(r)}`
  if (seenReports.has(key)) { duplicateRows++; continue }
  seenReports.add(key)
  if (!questionsByGroup.has(canonical)) questionsByGroup.set(canonical, [])
  questionsByGroup.get(canonical)!.push(...(r.questions || []))
}
info(`${seenReports.size} distinct reports over ${questionsByGroup.size} classes; ${duplicateRows} duplicate rows collapsed`)

const pooledByCategory = new Map<Cat, Map<string, Map<number, number>>>(RATING_CATEGORIES.map(k => [k, new Map()]))
const rawByGroup = new Map<string, Partial<Record<Cat, { mean: number; n: number }>>>()
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

const breakdown = new Map<string, Partial<Record<Cat, { score: number; n: number; pct: number }>>>()
const priors: Record<string, { grandMean: number; weight: number }> = {}
for (const key of RATING_CATEGORIES) {
  const ids: string[] = []
  const obs: any[] = []
  for (const [canonical, counts] of pooledByCategory.get(key)!) {
    const p = pooledMean(counts)
    if (!p) continue
    ids.push(canonical); obs.push(p)
  }
  const { prior, scores, percentiles } = adjustAndRank(obs)
  priors[key] = prior
  ids.forEach((canonical, i) => {
    if (!breakdown.has(canonical)) breakdown.set(canonical, {})
    breakdown.get(canonical)![key] = { score: scores[i], n: obs[i].n, pct: percentiles[i] }
    if (!rawByGroup.has(canonical)) rawByGroup.set(canonical, {})
    rawByGroup.get(canonical)![key] = { mean: obs[i].mean, n: obs[i].n }
  })
}
const rated = [...breakdown.keys()]
const overallScore = new Map<string, number>()
const overallN = new Map<string, number>()
for (const id of rated) {
  const parts = Object.values(breakdown.get(id)!) as { score: number; n: number }[]
  overallScore.set(id, round3(parts.reduce((s, p) => s + p.score, 0) / parts.length))
  overallN.set(id, headlineSampleSize(breakdown.get(id)!) as number)
}

// Scores are per CLASS; percentiles are per LISTING. A course is ranked against its own
// department, and a cross-listed class is listed in one department per code -- so CSRE
// 10 and TAPS 10 carry the same score and two different ranks. Departments under
// DEPARTMENT_RANK_MIN rated listings fall back to a Stanford-wide rank, recorded as a
// null scope so nothing downstream can call it a department rank.
type Rank = { pct: number; scope: string | null }
const pairKey = (subject: unknown, canonical: string) => `${subject ?? null}||${canonical}`
const listings: { subject: string | null; canonical: string; key: string }[] = []
{
  const seen = new Set<string>()
  for (const c of courses) {
    const canonical = groupOfCourse.get(c.id) ?? c.id
    const subject = (c.subject as string) || null
    const key = pairKey(subject, canonical)
    if (seen.has(key)) continue
    seen.add(key)
    listings.push({ subject, canonical, key })
  }
}
const rankListings = (scoreOf: (canonical: string) => number | undefined) => {
  const pairs = listings.filter(l => scoreOf(l.canonical) != null)
  const ranks = scopedPercentileRanks(pairs.map(l => ({ scope: l.subject, score: scoreOf(l.canonical)! })))
  return new Map<string, Rank>(pairs.map((l, i) => [l.key, ranks[i]]))
}
const overallPct = rankListings(id => overallScore.get(id))
const catPct = new Map<Cat, Map<string, Rank>>(RATING_CATEGORIES.map(key =>
  [key, rankListings(id => breakdown.get(id)?.[key]?.score)]))

/** The stored rating_breakdown for one listing: class scores, this listing's ranks. */
const breakdownFor = (key: string, canonical: string) => {
  const parts = breakdown.get(canonical)
  if (!parts) return undefined
  const out: Record<string, { score: number; n: number; pct: number; scope: string | null }> = {}
  for (const cat of RATING_CATEGORIES) {
    const stat = parts[cat]
    if (!stat) continue
    const rank = catPct.get(cat)!.get(key)!
    out[cat] = { score: stat.score, n: stat.n, pct: rank.pct, scope: rank.scope }
  }
  return out
}

info(`${rated.length} rated classes; ` + RATING_CATEGORIES.map(k =>
  `${k} mean ${priors[k].grandMean.toFixed(3)} w ${priors[k].weight.toFixed(2)}`).join('; '))

{
  const bad: string[] = []
  for (const id of rated) {
    const q = overallScore.get(id)!, n = overallN.get(id)!
    if (!(q >= 1 && q <= 5)) bad.push(`${id} quality=${q}`)
    if (!(n > 0) || !Number.isInteger(n)) bad.push(`${id} quality_n=${n}`)
    for (const [cat, s] of Object.entries(breakdown.get(id)!) as [string, { score: number; n: number }][]) {
      if (!(s.score >= 1 && s.score <= 5)) bad.push(`${id}.${cat} score=${s.score}`)
      if (!(s.n > 0) || !Number.isInteger(s.n)) bad.push(`${id}.${cat} n=${s.n}`)
    }
  }
  for (const { key, subject } of listings) {
    for (const [label, rank] of [['quality_pct', overallPct.get(key)],
      ...RATING_CATEGORIES.map(cat => [`${cat}.pct`, catPct.get(cat)!.get(key)] as const)] as [string, Rank | undefined][]) {
      if (!rank) continue
      if (!(rank.pct >= 1 && rank.pct <= 100) || !Number.isInteger(rank.pct)) bad.push(`${key} ${label}=${rank.pct}`)
      // A scope that is not this listing's own subject would rank it against strangers.
      if (rank.scope != null && rank.scope !== subject) bad.push(`${key} ${label} scoped to ${rank.scope}`)
    }
  }
  check('every score in 1-5, every n a positive integer, every percentile in 1-100', bad)
}

{
  const bad: string[] = []
  for (const id of rated) {
    const parts = Object.values(breakdown.get(id)!) as { score: number }[]
    if (overallScore.get(id) !== round3(parts.reduce((s, p) => s + p.score, 0) / parts.length)) bad.push(`${id}`)
  }
  check('overall rating equals the mean of its category scores', bad)
}

{
  // The headline count must equal the count under the first chart on the page.
  const bad: string[] = []
  for (const id of rated) {
    const bd = breakdown.get(id)!
    const want = bd.quality?.n ?? Math.max(...(Object.values(bd) as { n: number }[]).map(p => p.n))
    if (overallN.get(id) !== want) bad.push(`${id} headline n=${overallN.get(id)} vs quality n=${want}`)
  }
  check('headline sample size equals the instruction-quality response count', bad)
}

{
  // Shrinkage must land exactly on weight/(n+weight) of the way from the raw mean to
  // the category mean, at the stored precision.
  const bad: string[] = []
  let compared = 0
  for (const id of rated) {
    for (const key of RATING_CATEGORIES) {
      const stat = breakdown.get(id)![key]
      const raw = rawByGroup.get(id)?.[key]
      if (!stat || !raw) continue
      compared++
      const { grandMean, weight } = priors[key]
      const want = round3((raw.n * raw.mean + weight * grandMean) / (raw.n + weight))
      if (stat.score !== want) bad.push(`${id}.${key} score=${stat.score} want=${want} (raw ${raw.mean.toFixed(4)} n=${raw.n})`)
      const lo = Math.min(raw.mean, grandMean) - 0.0006
      const hi = Math.max(raw.mean, grandMean) + 0.0006
      if (stat.score < lo || stat.score > hi) bad.push(`${id}.${key} adjusted outside [raw, mean]`)
    }
  }
  check('adjusted score is exactly weight/(n+weight) of the way to its category mean', bad, `${compared} scores`)
}

{
  // A percentile that is not a strict function of the displayed score is a visible
  // weirdism: two courses showing the same number with different ranks.
  const bad: string[] = []
  /**
   * `population` is the set the percentile was measured against, which is NOT `pairs`
   * for the Stanford-wide fallback: those listings are ranked against every rated
   * listing, small departments and large ones alike, and checking them against only
   * their fellow fallbacks would demand a share of the wrong denominator.
   */
  const verify = (label: string, pairs: { id: string; score: number; pct: number }[], population?: number[]) => {
    const byScore = new Map<number, Set<number>>()
    for (const p of pairs) {
      if (!byScore.has(p.score)) byScore.set(p.score, new Set())
      byScore.get(p.score)!.add(p.pct)
    }
    for (const [score, pcts] of byScore) {
      if (pcts.size > 1) bad.push(`${label}: score ${score} maps to percentiles ${[...pcts].sort().join(',')}`)
    }
    const sorted = [...pairs].sort((a, b) => a.score - b.score)
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].pct < sorted[i - 1].pct) bad.push(`${label}: ${sorted[i].id} not monotonic`)
    }
    // And it must be a real percentile: the share at or below must round to it.
    const scores = population ?? sorted.map(p => p.score)
    for (const p of pairs) {
      let atOrBelow = 0
      for (const s of scores) if (s <= p.score) atOrBelow++
      const want = Math.max(1, Math.round((atOrBelow / scores.length) * 100))
      if (want !== p.pct) { bad.push(`${label}: score ${p.score} pct ${p.pct}, true share ${atOrBelow}/${scores.length} -> ${want}`); break }
    }
  }
  const FALLBACK = '(all Stanford)'
  // Each peer group is its own population, so the checks run once per scope: a CS rank
  // and a Stanford-wide rank are not comparable and pooling them would fail spuriously.
  const byScope = (ranks: Map<string, Rank>, scoreOf: (canonical: string) => number | undefined) => {
    const groupsOfPairs = new Map<string, { id: string; score: number; pct: number }[]>()
    for (const l of listings) {
      const rank = ranks.get(l.key)
      const score = scoreOf(l.canonical)
      if (!rank || score == null) continue
      const bucket = rank.scope ?? FALLBACK
      if (!groupsOfPairs.has(bucket)) groupsOfPairs.set(bucket, [])
      groupsOfPairs.get(bucket)!.push({ id: l.key, score, pct: rank.pct })
    }
    return groupsOfPairs
  }
  const everyScore = (buckets: Map<string, { score: number }[]>) =>
    [...buckets.values()].flat().map(p => p.score)
  {
    const buckets = byScope(overallPct, id => overallScore.get(id))
    const corpus = everyScore(buckets)
    for (const [scope, pairs] of buckets) verify(`overall/${scope}`, pairs, scope === FALLBACK ? corpus : undefined)
  }
  for (const key of RATING_CATEGORIES) {
    const buckets = byScope(catPct.get(key)!, id => breakdown.get(id)?.[key]?.score)
    const corpus = everyScore(buckets)
    for (const [scope, pairs] of buckets) verify(`${key}/${scope}`, pairs, scope === FALLBACK ? corpus : undefined)
  }
  check('percentile is a monotonic, tie-consistent, true share within its own peer group', bad)

  {
    // The floor is what keeps a two-course department from handing out 50th and 100th
    // percentiles, so it has to hold in the output and not just in the helper.
    const floorBad: string[] = []
    const sizes = new Map<string, number>()
    for (const l of listings) {
      if (overallPct.get(l.key) == null) continue
      sizes.set(l.subject ?? '', (sizes.get(l.subject ?? '') || 0) + 1)
    }
    for (const l of listings) {
      const rank = overallPct.get(l.key)
      if (!rank) continue
      const size = sizes.get(l.subject ?? '') || 0
      if (rank.scope == null && size >= DEPARTMENT_RANK_MIN) floorBad.push(`${l.key} fell back with ${size} rated listings`)
      if (rank.scope != null && size < DEPARTMENT_RANK_MIN) floorBad.push(`${l.key} ranked in a department of ${size}`)
    }
    check(`departments with ${DEPARTMENT_RANK_MIN}+ rated listings rank in-department, smaller ones fall back`,
      floorBad, `${[...sizes.values()].filter(n => n >= DEPARTMENT_RANK_MIN).length} departments qualify`)
  }
}

{
  // A class with usable rating responses must get metrics, and vice versa.
  const bad: string[] = []
  const usable = new Set<string>()
  for (const key of RATING_CATEGORIES) {
    for (const [canonical, counts] of pooledByCategory.get(key)!) {
      if (pooledMean(counts)) usable.add(canonical)
    }
  }
  for (const id of usable) if (!breakdown.has(id)) bad.push(`${id} has usable responses but no metrics`)
  for (const id of rated) if (!usable.has(id)) bad.push(`${id} has metrics but no usable responses`)
  const noneUsable = [...questionsByGroup.keys()].filter(id => !usable.has(id))
  check('metrics exist exactly where usable rating responses exist', bad,
    `${usable.size} rated, ${noneUsable.length} classes with evaluations but zero usable 1-5 responses`)
}

{
  const bad: string[] = []
  for (const [id, values] of hoursByGroup) {
    const sorted = [...values].sort((a, b) => a - b)
    const mid = sorted.length >> 1
    const med = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
    if (!(med > 0) || med > 100) bad.push(`${id} hours median=${med}`)
  }
  check('hours/week median is positive and plausible', bad, `${hoursByGroup.size} classes`)
}

// ================================================================
section('3. Cross-listed classes')

const courseById = new Map(courses.map(c => [c.id, c]))
for (const c of courses) {
  const canonical = groupOfCourse.get(c.id) ?? c.id
  c.quality = overallScore.get(canonical)
  c.qualityN = overallN.get(canonical)
  const key = pairKey(c.subject || null, canonical)
  c.qualityPct = overallPct.get(key)?.pct
  c.rankScope = overallPct.get(key)?.scope ?? undefined
  c.ratingBreakdown = breakdownFor(key, canonical) as Course['ratingBreakdown']
}
const groupMembers = (id: string) => groups.get(groupOfCourse.get(id) ?? id) ?? [id]

{
  const bad: string[] = []
  let multi = 0
  for (const [canonical, members] of groups) {
    if (members.length < 2) continue
    multi++
    const shown = new Set(members.map(id => {
      const c = courseById.get(id)!
      const r = resolveCrossListRating(members.map(m => courseById.get(m)!).filter(Boolean))
      return `${r.quality}|${r.qualityPct}|${r.qualityN}|${stableJson(r.ratingBreakdown)}`
    }))
    if (shown.size > 1) bad.push(`${canonical}: ${shown.size} different ratings across ${members.length} listings`)
  }
  check('every listing of one class shows the same rating', bad, `${multi} cross-listed groups`)
}

{
  // A cross-listed class has ONE set of scores and one rank per department it is listed
  // in, so the scores must match across listings while the ranks are allowed to differ
  // -- but only where the departments do.
  const scoresOnly = (bd: Course['ratingBreakdown']) => stableJson(Object.fromEntries(
    Object.entries(bd || {}).map(([cat, s]) => [cat, { score: s!.score, n: s!.n }])))
  const bad: string[] = []
  const rankBad: string[] = []
  for (const [canonical, members] of groups) {
    const rated = members.filter(id => courseById.get(id)?.quality != null).map(id => courseById.get(id)!)
    if (new Set(rated.map(c => scoresOnly(c.ratingBreakdown))).size > 1) bad.push(`${canonical}: differing scores`)
    const bySubject = new Map<string, Set<string>>()
    for (const c of rated) {
      const print = `${c.qualityPct}|${c.rankScope ?? null}|${stableJson(c.ratingBreakdown)}`
      if (!bySubject.has(c.subject)) bySubject.set(c.subject, new Set())
      bySubject.get(c.subject)!.add(print)
    }
    for (const [subject, prints] of bySubject) {
      if (prints.size > 1) rankBad.push(`${canonical}/${subject}: ${prints.size} different ranks in one department`)
    }
  }
  check('all rated listings within a group hold identical scores', bad)
  check('two listings of one class in the same department hold identical ranks', rankBad)
}

{
  const bad: string[] = []
  for (const c of courses) {
    const members = groupMembers(c.id).map(id => courseById.get(id)!).filter(Boolean)
    const r = resolveCrossListRating(members.length ? members : [c])
    if (r.quality == null) continue
    if (!members.some(m => m.quality === r.quality && m.qualityN === r.qualityN &&
      m.qualityPct === r.qualityPct && m.ratingBreakdown === r.ratingBreakdown)) {
      bad.push(`${c.id} resolved a mix of listings`)
    }
  }
  check('resolved rating always comes from a single listing', bad)
}

{
  // Codes can share an evaluation report while the catalog does not declare them
  // cross-listed (paired undergrad/grad courses such as MATSCI 184 / 214). Split into
  // the case that is unambiguously broken and the case that needs a product decision.
  const clusters = new Map<string, Set<string>>()
  for (const r of evalRows) {
    const listed = String(r.course_code || '').split('/').map(c =>
      normalizeCourseId(c.replace(/^[A-Za-z]{1,2}\d{2}-/, '').replace(/-\d+[A-Za-z]?$/, '').replace(/-/g, '')))
      .filter(c => courseById.has(c))
    if (listed.length < 2) continue
    const canon = [...new Set(listed.map(c => groupOfCourse.get(c) ?? c))]
    if (canon.length < 2) continue
    const key = canon.sort().join(' | ')
    if (!clusters.has(key)) clusters.set(key, new Set())
    for (const c of canon) clusters.get(key)!.add(c)
  }
  const blank: string[] = []
  const disagree: string[] = []
  for (const [key, canon] of clusters) {
    const stats = [...canon].map(c => ({ c, q: overallScore.get(c), n: overallN.get(c) ?? 0 }))
    const withData = stats.filter(s => s.q != null)
    const without = stats.filter(s => s.q == null)
    if (withData.length > 0 && without.length > 0) {
      blank.push(`${without.map(s => s.c).join(',')} shows no rating; ${withData.map(s => `${s.c}=${s.q}`).join(', ')}`)
    } else if (withData.length > 1 && new Set(withData.map(s => s.q)).size > 1) {
      const spread = Math.max(...withData.map(s => s.q!)) - Math.min(...withData.map(s => s.q!))
      disagree.push(`${withData.map(s => `${s.c}=${s.q}(n=${s.n})`).join(' vs ')} spread ${spread.toFixed(2)}`)
    }
  }
  check('no code is left blank while a code sharing its evaluation has a rating', blank,
    `${clusters.size} clusters share an evaluation across catalog groups`)
  check('codes sharing an evaluation agree on the rating', disagree)
}

// ================================================================
section('4. On-screen totals vs the headline number')

const evalsByCourse = new Map<string, CourseEvaluation[]>()
for (const r of evalRows) {
  const ev = toCourseEvaluation(r as EvaluationRow)
  if (!evalsByCourse.has(r.course_id)) evalsByCourse.set(r.course_id, [])
  evalsByCourse.get(r.course_id)!.push(ev)
}
useEvaluationStore.setState({ evaluations: Object.fromEntries(evalsByCourse) })
/**
 * What the charts actually see. The store's merge keeps one row per instructor, because
 * the Instructors tab needs that; EvaluationOverview then collapses co-instructor copies
 * for the course-level charts. Mirror both steps or this compares against something the
 * UI never renders.
 */
const mergeFor = (ids: string[]) =>
  dedupeCourseLevelReports(useEvaluationStore.getState().getMergedEvaluations(ids)) as CourseEvaluation[]

/** The store's merge alone, for checks about report identity rather than chart totals. */
const mergeRawFor = (ids: string[]) => useEvaluationStore.getState().getMergedEvaluations(ids)

{
  // THE headline check: what the charts add up must equal the n behind the score.
  const bad: string[] = []
  let compared = 0
  for (const c of courses) {
    const members = groupMembers(c.id)
    const resolved = resolveCrossListRating(members.map(id => courseById.get(id)!).filter(Boolean))
    const bd = resolved.ratingBreakdown as Partial<Record<Cat, { n: number }>> | undefined
    if (!bd) continue
    const counts = new Map<Cat, Map<number, number>>(RATING_CATEGORIES.map(k => [k, new Map()]))
    for (const ev of mergeFor(members)) {
      for (const q of ev.questions || []) {
        const cat = category(q?.text)
        if (!cat || cat === 'hours') continue
        addRatingCounts(counts.get(cat)!, q)
      }
    }
    for (const key of RATING_CATEGORIES) {
      const want = bd[key]?.n
      if (want == null) continue
      compared++
      const got = pooledMean(counts.get(key)!)?.n ?? 0
      if (got !== want) bad.push(`${c.id}.${key} screen ${got} vs headline ${want}`)
    }
  }
  check('merged on-screen responses equal the precomputed n, per category', bad, `${compared} comparisons`)
}

{
  const bad: string[] = []
  for (const [canonical, members] of groups) {
    const all = members.flatMap(id => evalsByCourse.get(id) || [])
    if (all.length === 0) continue
    const distinct = new Set(all.map(ev => `${ev.courseCode}|${ev.term}|${ev.instructor}`))
    const merged = mergeRawFor(members)
    if (merged.length !== distinct.size) bad.push(`${canonical}: merged ${merged.length}, ${distinct.size} distinct reports`)
  }
  check('merge keeps exactly one copy of every distinct report', bad)
}

{
  const bad: string[] = []
  for (const [canonical, members] of groups) {
    if (members.length < 2) continue
    const totals = new Set(members.map(id => {
      const counts = new Map<number, number>()
      for (const ev of mergeFor(groupMembers(id))) {
        for (const q of ev.questions || []) if (category(q?.text) === 'quality') addRatingCounts(counts, q)
      }
      return pooledMean(counts)?.n ?? 0
    }))
    if (totals.size > 1) bad.push(`${canonical} -> totals ${[...totals].join(', ')}`)
  }
  check('response total does not depend on which listing you open', bad)
}

{
  // Co-taught sections file the same student comments under each instructor, so the
  // merged set legitimately repeats them (CS 24: 3,038 copies of 596 comments). What
  // matters is the list the student actually sees, which CommentsPanel de-dupes on
  // normalized text -- so assert the displayed list is free of repeats.
  const bad: string[] = []
  let worstRatio = 1
  let worstId = ''
  for (const [canonical, members] of groups) {
    const merged = mergeFor(members)
    const raw = merged.flatMap(ev => ev.comments || [])
    if (raw.length === 0) continue
    // Exactly the CommentsPanel key: normalized text.
    const displayed = new Set(raw.map(c => String(c).trim().toLowerCase()))
    const seen = new Set<string>()
    let repeats = 0
    for (const c of displayed) {
      if (seen.has(c)) repeats++
      seen.add(c)
    }
    if (repeats > 0) bad.push(`${canonical}: ${repeats} repeated comment(s) survive de-duplication`)
    if (raw.length / displayed.size > worstRatio) { worstRatio = raw.length / displayed.size; worstId = canonical }
  }
  check('the displayed comment list contains no duplicates', bad,
    `worst pre-de-dupe repetition ${worstRatio.toFixed(1)}x on ${worstId}`)
}

// ================================================================
section('5. Prebuilt catalog dump')

{
  const bad: string[] = []
  let checked = 0
  try {
    const light = JSON.parse(readFileSync('data/catalog/light.json', 'utf8')) as any[]
    for (const row of light) {
      const id = String(row.course_id)
      const canonical = groupOfCourse.get(id) ?? id
      const wantQ = overallScore.get(canonical)
      if (wantQ == null) {
        if (row.quality != null) bad.push(`${id} dump quality=${row.quality} with no supporting evaluations`)
        continue
      }
      checked++
      if (Number(row.quality) !== wantQ) bad.push(`${id} dump quality=${row.quality} want ${wantQ}`)
      if (Number(row.quality_n) !== overallN.get(canonical)) bad.push(`${id} dump quality_n=${row.quality_n} want ${overallN.get(canonical)}`)
      const key = pairKey(row.subject || null, canonical)
      const rank = overallPct.get(key)
      if (Number(row.quality_pct) !== rank?.pct) bad.push(`${id} dump quality_pct=${row.quality_pct} want ${rank?.pct}`)
      if ((row.rank_scope ?? null) !== (rank?.scope ?? null)) bad.push(`${id} dump rank_scope=${row.rank_scope} want ${rank?.scope}`)
      if (stableJson(row.rating_breakdown) !== stableJson(breakdownFor(key, canonical))) bad.push(`${id} dump breakdown differs`)
    }
  } catch (e) {
    bad.push(`could not read dump: ${(e as Error).message}`)
  }
  check('prebuilt dump matches freshly computed metrics', bad, `${checked} rated rows`)
}

{
  const bad: string[] = []
  try {
    const light = JSON.parse(readFileSync('data/catalog/light.json', 'utf8')) as any[]
    for (const row of light) {
      if (row.quality != null && !(row.quality > 0)) bad.push(`${row.course_id} quality=${row.quality}`)
      if (row.quality != null && row.quality_n == null) bad.push(`${row.course_id} quality without quality_n`)
      if (row.quality_pct != null && row.quality == null) bad.push(`${row.course_id} percentile without a score`)
      if (row.rating_breakdown && row.quality == null) bad.push(`${row.course_id} breakdown without a score`)
      if (row.quality == null && (row.quality_n != null || row.quality_pct != null || row.rank_scope != null)) bad.push(`${row.course_id} orphaned rating fields`)
      if (row.rank_scope != null && row.rank_scope !== row.subject) bad.push(`${row.course_id} rank_scope=${row.rank_scope} is not its own subject`)
    }
  } catch { /* reported above */ }
  check('dump rows have no half-populated rating fields', bad)
}

console.log('')
console.log(out.join('\n'))
console.log('')
console.log(`${checks - failures}/${checks} invariants hold`)
if (failures > 0) {
  console.log(`\n${failures} INVARIANT(S) VIOLATED`)
  process.exit(1)
}
console.log('\nAll invariants hold.')
