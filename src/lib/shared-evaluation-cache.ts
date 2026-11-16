import { getCache, waitUntil } from '@vercel/functions'

/**
 * Evaluations cached in Vercel's Runtime Cache, which every server instance in
 * a region reads, in front of the per-instance cache in evaluation-cache.ts.
 *
 * The per-instance cache missed on about 3 of every 4 views: in the month to
 * 2026-11-15 Supabase served 13,827 evaluation reads for 18,551 signed-in course
 * views, about 3.0 GB of the project's 3.4 GB of egress against a 5 GB Free-plan
 * quota. Each instance starts empty, and each deploy starts every instance over.
 * This copy is shared and survives deploys, so a course costs one Supabase read
 * a day rather than one per instance per hour.
 *
 * Evaluations only change when scrape-evaluations or the sentiment labeler runs,
 * so a day of staleness after a scrape is the cost; expire the 'evaluations' tag
 * to drop it sooner. The cache is server-side only and the routes check the
 * Stanford login before reading it, so it never widens who can see the data.
 */

/** Seconds a shared entry lives. */
export const SHARED_TTL_SECONDS = 24 * 60 * 60

/**
 * Part of every key. Entries outlive deploys, so a deploy that changes the shape
 * of what is stored must bump this, or it would read the old shape for a day.
 */
export const SHARED_CACHE_VERSION = 1

/** Past this, the page falls back to Supabase rather than wait on the cache. */
export const SHARED_TIMEOUT_MS = 800

/** Runtime Cache refuses items over 2 MB; stay under it with room for encoding. */
export const MAX_ITEM_CHARS = 1_900_000

export const SHARED_TAG = 'evaluations'

type Kind = 'course' | 'instructor'
type Store = { get: (key: string) => Promise<unknown>; set: (key: string, value: unknown, options?: { name?: string; tags?: string[]; ttl?: number }) => Promise<void> }
type Envelope<T> = { v: number; data: T }

let storeOverride: Store | null | undefined
let deferOverride: ((p: Promise<unknown>) => void) | undefined

/** For tests: replace the cache (null means unavailable) and how background writes are kept alive. */
export function setSharedCacheForTests(store: Store | null | undefined, defer?: (p: Promise<unknown>) => void) {
  storeOverride = store
  deferOverride = defer
}

function store(): Store | null {
  if (storeOverride !== undefined) return storeOverride
  try {
    return getCache({ namespace: 'stanford-root' })
  } catch {
    return null
  }
}

const keyOf = (kind: Kind, id: string) => `${kind}-evaluations:v${SHARED_CACHE_VERSION}:${id}`

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(undefined), ms)
    promise.then(
      value => { clearTimeout(timer); resolve(value) },
      () => { clearTimeout(timer); resolve(undefined) },
    )
  })
}

/**
 * The cached value, or null on a miss, a timeout, an error, or anything that is
 * not what this version wrote. Never throws: the caller then reads Supabase.
 */
export async function readShared<T>(kind: Kind, id: string, isValid: (data: unknown) => data is T): Promise<T | null> {
  const cache = store()
  if (!cache) return null
  let got: unknown
  try {
    got = await withTimeout(cache.get(keyOf(kind, id)), SHARED_TIMEOUT_MS)
  } catch {
    return null
  }
  if (!got || typeof got !== 'object') return null
  const envelope = got as Partial<Envelope<unknown>>
  if (envelope.v !== SHARED_CACHE_VERSION || !isValid(envelope.data)) return null
  return envelope.data
}

/**
 * Stores a value without holding up the response: the write runs after it is
 * sent. Too-large values and failures are skipped; the next view reads Supabase.
 */
export function writeShared(kind: Kind, id: string, data: unknown): void {
  const cache = store()
  if (!cache) return
  const envelope: Envelope<unknown> = { v: SHARED_CACHE_VERSION, data }
  let size: number
  try {
    size = JSON.stringify(envelope).length
  } catch {
    return
  }
  if (size > MAX_ITEM_CHARS) return
  let write: Promise<unknown>
  try {
    write = cache
      .set(keyOf(kind, id), envelope, { ttl: SHARED_TTL_SECONDS, tags: [SHARED_TAG], name: `${kind}-evaluations` })
      .catch(err => console.error('Shared evaluation cache write failed:', err instanceof Error ? err.message : err))
  } catch {
    return
  }
  ;(deferOverride ?? waitUntil)(write)
}

export const isEvaluationList = (data: unknown): data is unknown[] => Array.isArray(data)
