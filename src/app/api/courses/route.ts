import { NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import { getPublicClient, mergeCourseRows, FULL_COURSE_COLUMNS, LIGHT_COURSE_COLUMNS } from '@/lib/supabase-admin'
import { serverCatalogPath } from '@/lib/catalog-paths'
import { CATALOG_SHARD_COUNT, shardRange, isValidShard } from '@/lib/catalog-shards'

// Keyset pages beat OFFSET ranges under load. Full (sections) stays small so
// a sick DB can finish; light can be a bit larger.
const FULL_PAGE_SIZE = 100
const LIGHT_PAGE_SIZE = 300
const MAX_ATTEMPTS = 4

// In-memory cache (survives across requests in the same serverless instance).
// Stored pre-serialized: the full payload is ~45 MB of JSON, and re-running
// JSON.stringify per request would dwarf the handler's other work.
let cachedLight: string | null = null
let cachedFull: string | null = null
let lightTimestamp = 0
let fullTimestamp = 0
// Course data only changes via the daily scrape (refresh-courses.yml), which
// triggers a redeploy that resets this cache and the CDN cache. Within a
// deployment the data is static, so cache for a day.
const CACHE_TTL = 1000 * 60 * 60 * 24 // 24 h

// In-flight promises so concurrent cold requests share one DB scan (stampede guard)
let lightInFlight: Promise<string> | null = null
let fullInFlight: Promise<string> | null = null

// The full dump pre-sliced and pre-serialized, one string per shard. Built from
// the dump's own row order and never sorted, so concatenating shard 0..n-1 gives
// back exactly what ?full=1 returns -- tests/courses-route-cache.test.ts asserts
// that, because any reordering here would silently reorder the browse list.
let cachedShards: string[] | null = null
let shardsTimestamp = 0
let shardsInFlight: Promise<string[]> | null = null

// Safe on every branch below: this route reads no cookie and no Authorization
// header, calls nothing in @/lib/stanford-auth, and returns the same
// deployment-pinned dump to every caller, so there is no "previously authorized
// body" for a URL-keyed CDN entry to leak. /api/courses/[courseId] and
// /api/courses/batch already serve these same columns with this same header. The
// routes that DO read a user -- /api/evaluations, /api/class-years,
// /api/instructors/[slug] -- must stay no-store.
const CATALOG_CACHE_HEADERS = {
  'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=86400',
  'Content-Type': 'application/json',
} as const

// Allow one cold rebuild to finish after a catalog refresh (Vercel Pro / fluid).
export const maxDuration = 300

function isStatementTimeout(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false
  return err.code === '57014' || /statement timeout/i.test(err.message || '')
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms))
}

/** Prefer a prebuilt dump over a live DB scan (near-instant when present). */
async function readPrebuiltDump(full: boolean): Promise<string | null> {
  const name = full ? 'full.json' : 'light.json'
  try {
    return await readFile(serverCatalogPath(name), 'utf8')
  } catch {
    // fall through to Supabase Storage
  }
  // NOTE: this is a *public* Supabase Storage bucket. It is empty today (the
  // path 400s), and it must stay that way — populating it would republish the
  // full catalog at a world-readable URL, which is exactly what moving these
  // dumps out of public/ was meant to stop. Use a private bucket + signed URL
  // if this fallback is ever needed.
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!base) return null
  try {
    const res = await fetch(`${base}/storage/v1/object/public/catalog/${name}`, {
      cache: 'force-cache',
    })
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
}

async function fetchAllRows(columns: string, pageSize: number) {
  const supabase = getPublicClient()
  const rows: any[] = []
  let lastCourseId: string | null = null

  // No exact count — that query alone was multi-second after the refresh.
  while (true) {
    let data: any[] | null = null
    let error: { code?: string; message?: string } | null = null

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      let query = supabase
        .from('courses')
        .select(columns)
        .order('course_id', { ascending: true })
        .limit(pageSize)
      if (lastCourseId) query = query.gt('course_id', lastCourseId)

      const result = await query
      data = result.data
      error = result.error
      if (!error) break
      if (!isStatementTimeout(error) || attempt === MAX_ATTEMPTS) throw error
      await sleep(800 * attempt)
    }

    if (!data || data.length === 0) break
    rows.push(...data)
    lastCourseId = data[data.length - 1].course_id
    if (data.length < pageSize) break
  }

  return rows.filter(r => r.grading && r.grading.trim() !== '' && r.grading !== 'TBD')
}

// This route returns the whole catalog — 8,614 courses with every rating — in a
// single response, and it is the hot path, not a tooling endpoint: src/lib/store.ts
// fetches the light dump on first load and then the full dump unconditionally to
// enrich it. An earlier version of this comment said nothing in the app called it;
// store.ts:170 and store.ts:184 say otherwise.
// Left open it is the cheapest possible way to take the entire corpus, so it is
// Deliberately not gated and not rate limited.
//
// The endpoint serves a public page: the catalog at / is a client component and
// src/lib/store.ts fetches this route from the browser for both dumps -- light for
// the list, then full for sections and descriptions. A browser cannot hold a shared
// secret, so an x-catalog-key check took the catalog to 0 classes (verified against
// origin/main on the same machine: 3,108 classes there, 0 with the gate on).
//
// A per-IP limit is the obvious next thought and is worse than nothing here: most
// Stanford traffic arrives from a handful of campus NAT addresses, so any limit low
// enough to slow a scraper is low enough to break browse for everyone behind it. A
// 30/min limit throttled a single developer refreshing the page.
//
// What moving the dumps out of public/ still buys: the catalog is no longer a
// *static file* at a guessable path that Google will index and that ships in the
// build output. That part holds.
//
// What no-store was also meant to buy, and did not: scraper resistance.
// /api/courses?full=1 is itself a permanently addressable, guessable URL that hands
// any caller the full 33MB, and no-store never changed that -- it only stopped the
// CDN from being the thing that served it, at a measured cost of 281.7GB of Fast
// Origin Transfer in the Aug 17-Sep 16 cycle. A scraper pays one request either
// way; with s-maxage we stop paying origin egress for every student who loads the
// page. isBlockedCrawler in middleware.ts still runs on the edge request, so the
// deny list is unaffected. If the corpus needs real protection, it needs to stop
// being one response -- that is the /api/courses/batch shape, not a cache header.

async function getFull(): Promise<string> {
  if (cachedFull && Date.now() - fullTimestamp < CACHE_TTL) return cachedFull
  if (!fullInFlight) {
    fullInFlight = (async () => {
      const prebuilt = await readPrebuiltDump(true)
      if (prebuilt) {
        cachedFull = prebuilt
        fullTimestamp = Date.now()
        return cachedFull
      }
      const merged = mergeCourseRows(await fetchAllRows(FULL_COURSE_COLUMNS, FULL_PAGE_SIZE))
      cachedFull = JSON.stringify(merged)
      fullTimestamp = Date.now()
      return cachedFull
    })().finally(() => { fullInFlight = null })
  }
  return fullInFlight
}

async function getLight(): Promise<string> {
  if (cachedLight && Date.now() - lightTimestamp < CACHE_TTL) return cachedLight
  if (!lightInFlight) {
    lightInFlight = (async () => {
      const prebuilt = await readPrebuiltDump(false)
      if (prebuilt) {
        cachedLight = prebuilt
        lightTimestamp = Date.now()
        return cachedLight
      }
      const merged = mergeCourseRows(await fetchAllRows(LIGHT_COURSE_COLUMNS, LIGHT_PAGE_SIZE))
      cachedLight = JSON.stringify(merged)
      lightTimestamp = Date.now()
      return cachedLight
    })().finally(() => { lightInFlight = null })
  }
  return lightInFlight
}

/**
 * Reads the dump straight through rather than via getFull(), so an instance that
 * only ever serves shards holds ~35MB of shard strings instead of that plus the
 * 35MB whole-dump string.
 */
async function getShards (): Promise<string[]> {
  if (cachedShards && Date.now() - shardsTimestamp < CACHE_TTL) return cachedShards
  if (!shardsInFlight) {
    shardsInFlight = (async () => {
      const raw = await readPrebuiltDump(true)
      const rows: unknown[] = raw
        ? JSON.parse(raw)
        : mergeCourseRows(await fetchAllRows(FULL_COURSE_COLUMNS, FULL_PAGE_SIZE))
      cachedShards = Array.from({ length: CATALOG_SHARD_COUNT }, (_, i) => {
        const [from, to] = shardRange(i, rows.length)
        return JSON.stringify(rows.slice(from, to))
      })
      shardsTimestamp = Date.now()
      return cachedShards
    })().finally(() => { shardsInFlight = null })
  }
  return shardsInFlight
}

export async function GET(request: Request) {

  const { searchParams } = new URL(request.url)
  const full = searchParams.get('full') === '1'
  const shardParam = searchParams.get('shard')

  try {
    if (shardParam !== null) {
      // Number() is far too permissive for a cache key: '', '0x5', '1e0', ' 3' and
      // '+3' all coerce to a valid shard index, which would both answer a malformed
      // request and split one shard's CDN entry across several URLs.
      // Canonical form only, so one shard has exactly one URL: '00' passes a bare
      // \d+ check and coerces to 0, which would be a second CDN entry for shard 0.
      const shard = /^(0|[1-9]\d*)$/.test(shardParam) ? Number(shardParam) : NaN
      if (!full || !isValidShard(shard)) {
        return NextResponse.json(
          { error: `shard requires full=1 and an integer 0..${CATALOG_SHARD_COUNT - 1}` },
          { status: 400 }
        )
      }
      return new NextResponse((await getShards())[shard], { headers: CATALOG_CACHE_HEADERS })
    }

    const json = full ? await getFull() : await getLight()
    // Unsharded ?full=1 is 4.15MB gzipped and will not fit the edge cache, so it
    // stays a function hit on every request. Nothing in the app asks for it any
    // more (store.ts fetches shards); it is kept for local tooling.
    return new NextResponse(json, { headers: CATALOG_CACHE_HEADERS })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch courses'
    console.error('Failed to fetch courses:', err)
    return NextResponse.json(
      { error: process.env.NODE_ENV === 'production' ? 'Internal server error' : message },
      { status: 500 }
    )
  }
}
