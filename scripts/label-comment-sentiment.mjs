/**
 * Scores every distinct `evaluations.comments` string with TypeSafe's Jev,
 * into `comment_sentiment`.
 *
 *   node --env-file=.env.local scripts/label-comment-sentiment.mjs            # dry run
 *   node --env-file=.env.local scripts/label-comment-sentiment.mjs --write    # score + upload
 *   node --env-file=.env.local scripts/label-comment-sentiment.mjs --limit 2000
 *   node --env-file=.env.local scripts/label-comment-sentiment.mjs --upload scores.json
 *
 * Scoring always writes its results to --out (default scores.json) before it
 * touches the database, and --upload skips scoring entirely and pushes an
 * existing file. Scoring is the slow, metered half; uploading is neither. They
 * are separable so that a missing table, an expired key, or a half-finished
 * upsert costs a retry of the cheap half and never of the paid half.
 *
 * Requires migration 20260920_comment_sentiment.sql and TYPESAFE_API_KEY.
 *
 * Jev is not an LLM: it answers typed questions with calibrated probabilities
 * in one parallel pass, so it is cheap enough to score the whole corpus and
 * fast enough to do it in one sitting -- ~815 comments/sec at concurrency 8,
 * and deterministic (0/60 label churn across three identical runs).
 *
 * Validated against `courses.quality`, which comes from Likert medians and
 * which Jev never sees: bucketing these scores orders quality monotonically
 * (positive 4.35 > mixed 4.24 > advice 4.17 > negative 4.09, 0.93 SD
 * apart), and per-course mean lean correlates at r = 0.71 over courses with
 * 5+ comments.
 *
 * Three things shape the design:
 *
 * Half the corpus is repeats -- 289,766 instances, 145,500 distinct -- so the
 * unit of work is the distinct string, not the row. That halves both the bill
 * and the wall clock, and stops "Take it!" being counted 736 times.
 *
 * It asks four independent yes/no questions rather than one three-way choice.
 * A three-way choice has to put logistical advice ("start the assignments
 * early") somewhere, and it picked `negative` at 0.90 confidence for two of the
 * seven such comments in a hand-labelled set. Asked as separate questions the
 * same comments score 0.07 praise and 0.08 blame -- visibly about neither --
 * while a genuinely mixed comment scores high on both. The residual becomes
 * something you can read rather than a bucket the model was forced into.
 *
 * It keeps instructor and course apart, because on a 1,000-comment sample they
 * disagreed 52.9% of the time and took opposite signs 3.2% of the time. The
 * extra two questions ride along in the same call for a fraction of a cent.
 *
 * Re-runnable and idempotent: it skips hashes already present, so an
 * interrupted run resumes by being run again.
 */

import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const JEV_KEY = process.env.TYPESAFE_API_KEY
const WRITE = process.argv.includes('--write')

const flag = (name, fallback) => {
  const i = process.argv.indexOf(name)
  return i === -1 ? fallback : process.argv[i + 1]
}
const LIMIT = Number(flag('--limit', Infinity))
const OUT = flag('--out', 'scores.json')
const UPLOAD = flag('--upload', null)

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.')
  process.exit(1)
}
if (!JEV_KEY) {
  console.error('Missing TYPESAFE_API_KEY. Add it to .env.local.')
  process.exit(1)
}

/** 20 comments per call is the sweet spot: 6x faster than one-per-call and
 *  half the tokens, because the rubric is sent once instead of twenty times. */
const PER_CALL = 20
const CONCURRENCY = Number(flag('--concurrency', 6))

/**
 * The `false` criterion has to name silence explicitly. Without "silent on it",
 * Jev reads a comment that never mentions the instructor as weak evidence
 * against them, and the instructor score drifts down on every course-only
 * comment -- which is a third of the corpus.
 */
const ask = (subject, polarity) => ({
  type: 'noul',
  instructions:
    polarity === 'praise'
      ? `Does this comment praise ${subject}?`
      : `Does this comment criticise ${subject}?`,
  criteria:
    polarity === 'praise'
      ? { true: `contains genuine praise of ${subject}`, false: `no praise of ${subject} -- silent on it, or critical` }
      : { true: `contains genuine criticism of ${subject}`, false: `no criticism of ${subject} -- silent on it, or praising` },
})

const INSTRUCTOR = 'the instructor or teaching staff'

/**
 * The trailing sentence is not padding. Scoped to just "structure, workload,
 * exams or material", Jev answers the question as asked and scores plain
 * overall praise low -- "This class has completely changed my life" came back
 * at 0.14, because a life being changed is not a remark about exam structure.
 * A hand audit of 100 comments put 19 of them in the advice bucket on that
 * basis. Naming the whole-class case explicitly fixed all 19 and moved the
 * correlation with `courses.quality` from r = 0.709 to r = 0.722.
 *
 * The difficulty carve-out came out of the same audit from the other side.
 * With workload left in as plain criticism, "not an easy class, don't fall
 * behind" and "a bit difficult but if you put in extra work its doable" both
 * scored as negative, and about half the negative bucket was difficulty
 * warnings about courses the student liked. Hard is not the same as bad here.
 *
 * The carve-out has to stay narrow. Phrased as a closed whitelist of what does
 * count, it swallowed 14,984 genuinely mixed comments -- "I had a mixed
 * experience", "the material starts out dry", "I wish there was more time in
 * the class" -- because none of those name a listed fault. Exempt difficulty
 * specifically; leave every other complaint in.
 */
const COURSE =
  'the course -- the class as a whole, or its content, structure, workload or exams. ' +
  'A recommendation to take it, or calling it good, fun, interesting or worthwhile, counts as praise. ' +
  'Being hard, fast-paced, dense or time-consuming is NOT criticism on its own -- Stanford students ' +
  'say that about courses they loved. Every other complaint still counts, including boring, dry, ' +
  'disorganised, badly taught, unfair, too short, a poor textbook, or not worth taking'

/** Column name -> the question that fills it. */
const QUESTIONS = {
  instructor_praise: ask(INSTRUCTOR, 'praise'),
  instructor_blame: ask(INSTRUCTOR, 'blame'),
  course_praise: ask(COURSE, 'praise'),
  course_blame: ask(COURSE, 'blame'),
}
const FIELDS = Object.keys(QUESTIONS)

const hashOf = (text) => createHash('sha256').update(text).digest('hex')

async function sb(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
  if (!res.ok) throw new Error(`supabase ${res.status}: ${await res.text()}`)
  // Prefer: return=minimal answers 201 with an empty body, not 204.
  const body = await res.text()
  return body ? JSON.parse(body) : null
}

/**
 * 429 and 529 are the documented backpressure codes; everything else is fatal.
 *
 * The backoff has to outlast a sustained throttle, not just a burst. A 6-try
 * ladder topping out at 16s gives up after half a minute, which is what killed
 * a full run 50k comments in; this one keeps going for ~8 minutes. Jitter stops
 * the whole worker pool from retrying in lockstep and re-tripping the limit.
 */
async function jev(state, questions, tries = 10) {
  for (let i = 0; i < tries; i++) {
    let res
    try {
      res = await fetch('https://api.typesafe.ai/v1/systemone', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${JEV_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ state, model: 'jev-latest', questions }),
      })
    } catch {
      // Connection reset mid-throttle -- same treatment as a 429.
      res = { status: 529, ok: false }
    }
    if (res.status === 429 || res.status === 529) {
      const wait = Math.min(500 * 2 ** i, 60000) * (0.5 + Math.random())
      await new Promise((r) => setTimeout(r, wait))
      continue
    }
    if (!res.ok) throw new Error(`jev ${res.status}: ${await res.text()}`)
    return res.json()
  }
  throw new Error('jev: retries exhausted')
}

async function pool(items, n, fn) {
  const out = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i], i)
      }
    }),
  )
  return out
}

async function loadDistinctComments() {
  const byHash = new Map()
  let instances = 0
  for (let page = 0; ; page++) {
    const rows = await sb(
      `evaluations?select=comments&limit=1000&offset=${page * 1000}`,
    )
    if (!rows.length) break
    for (const row of rows) {
      for (const raw of row.comments || []) {
        if (typeof raw !== 'string') continue
        const text = raw.trim()
        if (text.length <= 5) continue
        instances++
        const h = hashOf(text)
        if (!byHash.has(h)) byHash.set(h, text)
      }
    }
    if (rows.length < 1000) break
  }
  return { byHash, instances }
}

async function loadLabelledHashes() {
  const seen = new Set()
  for (let page = 0; ; page++) {
    const rows = await sb(
      `comment_sentiment?select=comment_hash&limit=1000&offset=${page * 1000}`,
    )
    if (!rows.length) break
    for (const r of rows) seen.add(r.comment_hash)
    if (rows.length < 1000) break
  }
  return seen
}

async function upsert(rows) {
  for (let i = 0; i < rows.length; i += 500) {
    await sb('comment_sentiment?on_conflict=comment_hash', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(rows.slice(i, i + 500)),
    })
    if (i && i % 20000 === 0) console.log(`  uploaded ${i}/${rows.length}`)
  }
}

/** Scored rows already on disk from an earlier, possibly interrupted run. */
function loadCache() {
  try {
    return JSON.parse(readFileSync(OUT, 'utf8'))
  } catch {
    return []
  }
}

async function main() {
  if (UPLOAD) {
    const rows = JSON.parse(readFileSync(UPLOAD, 'utf8'))
    console.log(`uploading ${rows.length} rows from ${UPLOAD}...`)
    await upsert(rows)
    console.log(`Wrote ${rows.length} rows to comment_sentiment.`)
    return
  }

  const { byHash, instances } = await loadDistinctComments()
  console.log(
    `${instances} comment instances, ${byHash.size} distinct ` +
      `(${(100 - (100 * byHash.size) / instances).toFixed(1)}% repeats)`,
  )

  const cached = loadCache()
  const done = new Set(cached.map((r) => r.comment_hash))
  if (done.size) console.log(`${done.size} already scored in ${OUT}, resuming`)
  try {
    for (const h of await loadLabelledHashes()) done.add(h)
  } catch {
    console.log('comment_sentiment not readable yet -- run the migration first')
    if (WRITE && !UPLOAD) process.exit(1)
  }

  const todo = [...byHash.entries()]
    .filter(([h]) => !done.has(h))
    .slice(0, LIMIT)
    .map(([hash, text]) => ({ hash, text }))

  if (!todo.length) {
    console.log('Nothing to score.')
    return
  }
  console.log(`scoring ${todo.length} distinct comments x ${FIELDS.length} questions...`)

  const batches = []
  for (let i = 0; i < todo.length; i += PER_CALL) {
    batches.push(todo.slice(i, i + PER_CALL))
  }

  const started = Date.now()
  let tokens = 0
  let model = 'jev-latest'
  let completed = 0

  const scored = []
  const labelled = (
    await pool(batches, CONCURRENCY, async (batch) => {
      const state = Object.fromEntries(
        batch.map((c, i) => [`comment_${i}`, c.text]),
      )
      const questions = {}
      batch.forEach((_, i) => {
        for (const [field, q] of Object.entries(QUESTIONS)) {
          questions[`${field}__${i}`] = {
            ...q,
            instructions: `For comment_${i} only: ${q.instructions}`,
          }
        }
      })
      const res = await jev(state, questions)
      tokens += res.usage.input_tokens
      model = res.model

      completed += batch.length
      if (completed % 5000 < PER_CALL) {
        // Checkpoint: a throttle 100k comments in should cost minutes, not $2.
        writeFileSync(OUT, JSON.stringify(cached.concat(scored.flat())))
      }
      if (completed % 10000 < PER_CALL) {
        const rate = completed / ((Date.now() - started) / 1000)
        console.log(
          `  ${completed}/${todo.length}  ${rate.toFixed(0)}/s  ` +
            `eta ${(((todo.length - completed) / rate) / 60).toFixed(1)}m`,
        )
      }

      const rows = batch.map((c, i) => {
        const row = { comment_hash: c.hash, model: res.model }
        for (const field of FIELDS) row[field] = res.answers[`${field}__${i}`].noul
        return row
      })
      scored.push(rows)
      return rows
    })
  ).flat()

  const secs = (Date.now() - started) / 1000

  /** Mirrors how a page would read the table back, so a dry run is a preview. */
  const bucket = (r) => {
    // Mirrors the single cutoff in src/lib/comment-sentiment.ts.
    const praise = Math.max(r.instructor_praise, r.course_praise) >= 0.6
    const blame = Math.max(r.instructor_blame, r.course_blame) >= 0.6
    if (praise && !blame) return 'positive'
    if (blame && !praise) return 'negative'
    if (praise && blame) return 'mixed'
    return 'advice'
  }
  const dist = {}
  for (const r of labelled) {
    const b = bucket(r)
    dist[b] = (dist[b] || 0) + 1
  }
  const split = labelled.filter(
    (r) =>
      Math.sign(r.instructor_praise - r.instructor_blame) !==
      Math.sign(r.course_praise - r.course_blame),
  ).length

  console.log(
    `\n${labelled.length} scored by ${model} in ${secs.toFixed(1)}s ` +
      `(${(labelled.length / secs).toFixed(0)}/s)`,
  )
  console.log(
    '  bucketed at 0.6: ' +
      Object.entries(dist)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k} ${v} (${((100 * v) / labelled.length).toFixed(1)}%)`)
        .join('   '),
  )
  console.log(
    `  instructor and course disagree on ${split} ` +
      `(${((100 * split) / labelled.length).toFixed(1)}%)`,
  )
  console.log(
    `  ${(tokens / 1e6).toFixed(1)}M input tokens = $${((tokens / 1e6) * 0.042).toFixed(2)}`,
  )

  const all = cached.concat(labelled)
  writeFileSync(OUT, JSON.stringify(all))
  console.log(`  ${all.length} scores cached to ${OUT}`)

  if (!WRITE) {
    console.log('\nDry run, database untouched. Re-run with --write to apply.')
    console.log('Sample:')
    for (const r of labelled.slice(0, 5)) {
      const text = byHash.get(r.comment_hash).replace(/\s+/g, ' ').slice(0, 84)
      console.log(
        `  [${bucket(r).padEnd(11)} instr ${r.instructor_praise.toFixed(2)}/${r.instructor_blame.toFixed(2)}` +
          ` course ${r.course_praise.toFixed(2)}/${r.course_blame.toFixed(2)}] ${text}`,
      )
    }
    return
  }

  await upsert(all)
  console.log(`\nWrote ${all.length} rows to comment_sentiment.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
