import {
  classifyUpstreamStatus,
  navigatorClassUrl,
  parseNavigatorSeat,
  type LiveSeat,
  type SeatsResponse,
} from '@/lib/seats'

/**
 * Live per-class enrollment from Navigator, shared by GET /api/seats and the
 * hosted MCP server (src/app/api/mcp). One cache and one circuit breaker per
 * instance, whichever caller asks, so the upstream load stays bounded.
 */

// A student deciding whether to enroll does not refresh faster than this, and
// it collapses a burst on a popular course into a single upstream read.
const CACHE_TTL_MS = 45_000
// Serve a stale reading rather than a wrong one while upstream is unhappy.
const STALE_SERVE_MS = 10 * 60_000
// Navigator answered 120 requests at concurrency 12 without complaint, but
// there is no published rate limit, so stay well under what one page needs.
const UPSTREAM_CONCURRENCY = 4
const UPSTREAM_TIMEOUT_MS = 4_000
// With 24 sections at concurrency 4, a hanging upstream would otherwise hold the
// response for six timeouts in a row. Return what landed instead; the page is
// already showing the daily snapshot and will overlay whatever arrives.
const TOTAL_BUDGET_MS = 6_000
// On a 429, stop asking. Retrying into a throttle is how an IP gets blocked,
// and a stale seat count is a much smaller problem than that.
const CIRCUIT_OPEN_MS = 5 * 60_000
// Navigator answers 500 for a classNbr that does not exist in that term (a
// stale catalog row, a section that was cancelled), so a 5xx is NOT by itself
// evidence that upstream is in trouble — only a run of them, on classes that
// have read cleanly before. Without that second condition one crafted URL full
// of invented class numbers would open the breaker for every visitor.
const UPSTREAM_5XX_STREAK = 8
// Remember a class that has no reading, so one stale id is not re-asked on
// every page view.
const MISS_TTL_MS = 5 * 60_000

type Entry = { seat: LiveSeat; at: number }

const cache = new Map<string, Entry>()
const misses = new Map<string, number>()
const inFlight = new Map<string, Promise<LiveSeat | null>>()
let circuitOpenUntil = 0
let consecutive5xx = 0
let lastSweep = 0

function sweep(now: number) {
  if (now - lastSweep < 60_000) return
  lastSweep = now
  for (const [key, entry] of cache) {
    if (now - entry.at > STALE_SERVE_MS) cache.delete(key)
  }
  for (const [key, at] of misses) {
    if (now - at > MISS_TTL_MS) misses.delete(key)
  }
}

/** Identify the caller. Navigator can see who to ask if they want it stopped. */
function userAgent(): string {
  const contact = process.env.NAVIGATOR_CONTACT
  return contact
    ? `StanfordRoot/1.0 (+https://www.stanfordroot.com; ${contact})`
    : 'StanfordRoot/1.0 (+https://www.stanfordroot.com)'
}

async function fetchSeat(strm: number, classNbr: number, knownGood: boolean): Promise<LiveSeat | null> {
  const res = await fetch(navigatorClassUrl(strm, classNbr), {
    headers: { Accept: 'application/json', 'User-Agent': userAgent() },
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    cache: 'no-store',
  })
  const verdict = classifyUpstreamStatus(res.status, knownGood)
  if (verdict === 'throttled') {
    circuitOpenUntil = Date.now() + CIRCUIT_OPEN_MS
    return null
  }
  if (verdict === 'failure') {
    if (++consecutive5xx >= UPSTREAM_5XX_STREAK) {
      circuitOpenUntil = Date.now() + CIRCUIT_OPEN_MS
      consecutive5xx = 0
    }
    return null
  }
  if (verdict === 'miss') return null
  consecutive5xx = 0
  return parseNavigatorSeat(await res.json())
}

/** One upstream read per (strm, classNbr) per TTL, however many callers ask. */
function readSeat(strm: number, classNbr: number): Promise<LiveSeat | null> {
  const key = `${strm}:${classNbr}`
  const now = Date.now()
  const cached = cache.get(key)
  if (cached && now - cached.at < CACHE_TTL_MS) return Promise.resolve(cached.seat)
  const fallback = () => {
    const entry = cache.get(key)
    return entry && Date.now() - entry.at < STALE_SERVE_MS ? entry.seat : null
  }
  if (now < circuitOpenUntil) return Promise.resolve(fallback())
  const missedAt = misses.get(key)
  if (missedAt && now - missedAt < MISS_TTL_MS) return Promise.resolve(fallback())
  const existing = inFlight.get(key)
  if (existing) return existing
  const promise = fetchSeat(strm, classNbr, cached !== undefined)
    .then(seat => {
      if (seat) {
        cache.set(key, { seat, at: Date.now() })
        return seat
      }
      // A failed read falls back to the last good one until it ages out, so a
      // single upstream blip does not flip the page back to the daily snapshot.
      misses.set(key, Date.now())
      return fallback()
    })
    .catch(() => fallback())
    .finally(() => inFlight.delete(key))
  inFlight.set(key, promise)
  return promise
}

async function readAll(strm: number, classNbrs: number[]): Promise<(LiveSeat | null)[]> {
  const out: (LiveSeat | null)[] = new Array(classNbrs.length).fill(null)
  let next = 0
  const workers = Array.from(
    { length: Math.min(UPSTREAM_CONCURRENCY, classNbrs.length) },
    async () => {
      while (next < classNbrs.length) {
        const i = next++
        out[i] = await readSeat(strm, classNbrs[i])
      }
    }
  )
  await Promise.race([
    Promise.all(workers),
    new Promise(resolve => setTimeout(resolve, TOTAL_BUDGET_MS)),
  ])
  return out
}

/** Seats for these class numbers, from cache when fresh. Never throws. */
export async function readLiveSeats(strm: number, classNbrs: number[]): Promise<SeatsResponse> {
  sweep(Date.now())

  const results = await readAll(strm, classNbrs)
  const seats: Record<string, LiveSeat> = {}
  let oldest = 0
  for (const seat of results) {
    if (!seat) continue
    seats[String(seat.classNbr)] = seat
    const at = cache.get(`${strm}:${seat.classNbr}`)?.at ?? Date.now()
    oldest = oldest === 0 ? at : Math.min(oldest, at)
  }

  return {
    seats,
    fetchedAt: oldest ? new Date(oldest).toISOString() : null,
    degraded: Date.now() < circuitOpenUntil || Object.keys(seats).length < classNbrs.length,
  }
}
