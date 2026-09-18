/**
 * Backfills `analytics_events.traffic_class` for rows that predate the
 * /api/track bot filter.
 *
 *   node --env-file=.env.local scripts/label-traffic-class.mjs            # dry run
 *   node --env-file=.env.local scripts/label-traffic-class.mjs --write    # apply
 *
 * Requires migration 20260917_analytics_traffic_class.sql to have been applied.
 *
 * This table stores no user agent for historical rows, so the classification is
 * behavioural and works on the *session* (really the device: `session_id` lives
 * in localStorage and never expires, so one id is one browser, possibly for
 * months). Every event in a session gets that session's label.
 *
 * The one signal that does most of the work is path spread. A student arrives
 * from search on a course they care about, so provably-human sessions put 92.8%
 * of their hits on the most in-demand fifth of the catalog. A crawler walks the
 * catalog, so its hits are near-uniform: 25/20/19/19/17% across the same five
 * buckets, a rank correlation of +0.03 with real demand. That is why a
 * single-pageview session whose only path is one almost nothing else ever
 * touched is called a bot, and one sitting on a popular course page is not.
 *
 * Re-runnable and idempotent: it recomputes from scratch and writes only the
 * sessions whose label differs from what is already stored.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const WRITE = process.argv.includes('--write')

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.')
  process.exit(1)
}

/** Only a real Stanford OAuth session can produce these. A crawler cannot. */
const AUTH_PROOF = new Set([
  'login_completed',
  'schedule_synced',
  'ics_exported',
  'ics_imported',
])

/** Deliberate actions. Autocapture never emits these on its own. */
const INTERACTION = new Set([
  'search_performed',
  'course_added_to_schedule',
  'login_started',
  'eval_gate_viewed',
  'login_failed',
])

/** Above this, two pageviews are one render firing twice, not a person reading. */
const MACHINE_PACE_PER_MIN = 30

/** A path that is the lone path of at most this many sessions is catalog tail. */
const TAIL_THRESHOLD = 2

const headers = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
}

async function request(path, init = {}) {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
        ...init,
        headers: { ...headers, ...(init.headers ?? {}) },
      })
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
      return res
    } catch (err) {
      if (attempt === 5) throw err
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)))
    }
  }
}

/**
 * True once the migration has run. Checked rather than assumed so a dry run
 * still works beforehand: seeing the distribution is the point of the dry run,
 * and it should not require touching the schema first.
 */
async function hasTrafficClassColumn() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/analytics_events?select=traffic_class&limit=1`,
    { headers },
  )
  return res.ok
}

async function fetchAllEvents(withLabel) {
  const rows = []
  let last = 0
  const columns =
    `id,session_id,event,path,created_at,user_id` + (withLabel ? ',traffic_class' : '')
  process.stdout.write('reading analytics_events')
  for (;;) {
    const res = await request(
      `analytics_events?select=${columns}&id=gt.${last}&order=id.asc&limit=1000`,
    )
    const batch = await res.json()
    if (batch.length === 0) break
    rows.push(...batch)
    // Keyset pagination on the primary key. Offset paging times out on this
    // table once the offset gets deep.
    last = batch[batch.length - 1].id
    if (rows.length % 50000 === 0) process.stdout.write('.')
  }
  process.stdout.write('\n')
  return rows
}

function classify(rows) {
  const sessions = new Map()
  for (const row of rows) {
    const key = row.session_id ?? '(null)'
    let s = sessions.get(key)
    if (!s) {
      s = { events: new Set(), paths: new Map(), first: row.created_at, last: row.created_at, n: 0, user: null, stored: row.traffic_class }
      sessions.set(key, s)
    }
    s.events.add(row.event)
    s.paths.set(row.path, (s.paths.get(row.path) ?? 0) + 1)
    if (row.created_at < s.first) s.first = row.created_at
    if (row.created_at > s.last) s.last = row.created_at
    s.n++
    if (row.user_id) s.user = row.user_id
  }

  // How many sessions have each path as their *only* path. A popular course
  // collects many; a crawler's walk leaves one apiece across the whole catalog.
  const soleCount = new Map()
  for (const s of sessions.values()) {
    if (s.paths.size !== 1) continue
    const only = s.paths.keys().next().value
    soleCount.set(only, (soleCount.get(only) ?? 0) + 1)
  }

  const labels = new Map()
  for (const [key, s] of sessions) {
    const minutes = Math.max(
      (new Date(s.last).getTime() - new Date(s.first).getTime()) / 60000,
      0.001,
    )
    const pace = s.n > 1 ? s.n / minutes : 0
    const proven =
      Boolean(s.user) || [...s.events].some((e) => AUTH_PROOF.has(e))
    const acted = [...s.events].some((e) => INTERACTION.has(e))

    let label
    if (proven || acted) {
      label = 'human'
    } else if (s.paths.size >= 2) {
      // Slow multi-page browsing is a person. Two paths milliseconds apart is
      // this app's cross-list routing double-firing, which happens to humans
      // and crawlers alike, so it cannot be called either way.
      label = pace < MACHINE_PACE_PER_MIN ? 'human' : 'uncertain'
    } else {
      const only = s.paths.keys().next().value
      label = (soleCount.get(only) ?? 0) <= TAIL_THRESHOLD ? 'bot' : 'uncertain'
    }
    labels.set(key, { label, stored: s.stored, events: s.n })
  }
  return labels
}

async function main() {
  const migrated = await hasTrafficClassColumn()
  if (!migrated) {
    console.log(
      'Note: analytics_events.traffic_class does not exist yet. Showing the\n' +
      '      distribution only. Apply supabase/migrations/20260917_analytics_traffic_class.sql\n' +
      '      before running with --write.\n',
    )
    if (WRITE) {
      console.error('Refusing to write: run the migration first.')
      process.exit(1)
    }
  }
  const rows = await fetchAllEvents(migrated)
  console.log(`events: ${rows.length.toLocaleString()}`)

  const labels = classify(rows)
  const sessionCounts = { human: 0, bot: 0, uncertain: 0 }
  const eventCounts = { human: 0, bot: 0, uncertain: 0 }
  for (const { label, events } of labels.values()) {
    sessionCounts[label]++
    eventCounts[label] += events
  }

  const totalSessions = labels.size
  const totalEvents = rows.length
  console.log(`\n${'class'.padEnd(11)}${'sessions'.padStart(10)}${'share'.padStart(8)}${'events'.padStart(11)}${'share'.padStart(8)}`)
  for (const key of ['human', 'uncertain', 'bot']) {
    console.log(
      key.padEnd(11) +
        sessionCounts[key].toLocaleString().padStart(10) +
        `${((100 * sessionCounts[key]) / totalSessions).toFixed(1)}%`.padStart(8) +
        eventCounts[key].toLocaleString().padStart(11) +
        `${((100 * eventCounts[key]) / totalEvents).toFixed(1)}%`.padStart(8),
    )
  }
  console.log(
    `\nstrict real (human):              ${sessionCounts.human.toLocaleString()} sessions, ${eventCounts.human.toLocaleString()} events`,
  )
  console.log(
    `wide real (human + uncertain):    ${(sessionCounts.human + sessionCounts.uncertain).toLocaleString()} sessions, ${(eventCounts.human + eventCounts.uncertain).toLocaleString()} events`,
  )

  // Only the sessions whose stored label is already right can be skipped.
  const toWrite = { bot: [], uncertain: [], human: [] }
  for (const [key, { label, stored }] of labels) {
    if (stored === label) continue
    if (key === '(null)') continue
    toWrite[label].push(key)
  }
  const pending = toWrite.bot.length + toWrite.uncertain.length + toWrite.human.length
  console.log(`\nsessions needing a label change: ${pending.toLocaleString()}`)

  if (!WRITE) {
    console.log('\nDry run. Nothing written. Re-run with --write to apply.')
    return
  }

  for (const label of ['bot', 'uncertain', 'human']) {
    const ids = toWrite[label]
    if (ids.length === 0) continue
    // Batched by session id, so the URL stays well inside proxy limits while
    // one request still relabels every event in ~100 sessions.
    const BATCH = 100
    let done = 0
    for (let i = 0; i < ids.length; i += BATCH) {
      const chunk = ids.slice(i, i + BATCH)
      const list = chunk.map((id) => `"${id.replace(/"/g, '\\"')}"`).join(',')
      await request(`analytics_events?session_id=in.(${list})`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ traffic_class: label }),
      })
      done += chunk.length
      process.stdout.write(`\r  ${label}: ${done.toLocaleString()} / ${ids.length.toLocaleString()} sessions`)
    }
    process.stdout.write('\n')
  }
  console.log('\nDone.')
}

main().catch((err) => {
  console.error('\nFailed:', err.message)
  process.exit(1)
})
