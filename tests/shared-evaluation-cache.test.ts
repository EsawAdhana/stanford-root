import { describe, it, expect, beforeEach, vi } from 'vitest'

const queried: string[][] = []
let failSupabase = false

vi.mock('@/lib/stanford-auth', () => ({
  getStanfordUser: () => Promise.resolve({ id: 'u1', email: 'a@stanford.edu' }),
}))
vi.mock('@/lib/dev-flags', () => ({ isDevEvalsUnlocked: () => false }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))
vi.mock('@/lib/comment-sentiment', () => ({ attachSentiment: () => Promise.resolve() }))

const ROWS: Record<string, { course_id: string; term: string; instructor: string }> = {
  CS106B: { course_id: 'CS106B', term: 'Autumn 2025', instructor: 'Bailey, Cynthia' },
  CS229: { course_id: 'CS229', term: 'Winter 2026', instructor: 'Ng, Andrew' },
}

vi.mock('@/lib/supabase-admin', () => ({
  getServiceClient: () => ({
    from: () => ({
      select: () => ({
        in: (_col: string, ids: string[]) => {
          queried.push([...ids])
          if (failSupabase) return Promise.resolve({ data: null, error: new Error('down') })
          return Promise.resolve({ data: ids.map(id => ROWS[id]).filter(Boolean), error: null })
        },
      }),
    }),
  }),
}))

const { POST } = await import('@/app/api/evaluations/route')
const { clearEvaluationCache } = await import('@/lib/evaluation-cache')
const shared = await import('@/lib/shared-evaluation-cache')

/** A Runtime Cache stand-in: a Map that copies values like the real one serializes them. */
function fakeStore() {
  const map = new Map<string, string>()
  const writes: { key: string; options?: { ttl?: number; tags?: string[] } }[] = []
  return {
    map,
    writes,
    get: vi.fn(async (key: string) => (map.has(key) ? JSON.parse(map.get(key)!) : null)),
    set: vi.fn(async (key: string, value: unknown, options?: { ttl?: number; tags?: string[] }) => {
      writes.push({ key, options })
      map.set(key, JSON.stringify(value))
    }),
  }
}

let pending: Promise<unknown>[] = []
const defer = (p: Promise<unknown>) => { pending.push(p) }
const settle = async () => { await Promise.all(pending); pending = [] }

const post = async (courseIds: string[]) => {
  const res = await POST(new Request('http://localhost/api/evaluations', { method: 'POST', body: JSON.stringify({ courseIds }) }))
  return { status: res.status, body: await res.json() as Record<string, Array<{ term: string }>> }
}

/** A new server instance: its own memory is empty, the shared cache is not. */
const newInstance = () => clearEvaluationCache()

beforeEach(() => {
  queried.length = 0
  failSupabase = false
  pending = []
  clearEvaluationCache()
})

describe('shared evaluation cache', () => {
  it('lets a second instance skip Supabase', async () => {
    const store = fakeStore()
    shared.setSharedCacheForTests(store, defer)
    await post(['CS106B'])
    await settle()
    expect(queried).toEqual([['CS106B']])
    expect(store.writes[0].options).toMatchObject({ ttl: shared.SHARED_TTL_SECONDS, tags: [shared.SHARED_TAG] })

    newInstance()
    const { body } = await post(['CS106B'])
    expect(body.CS106B.map(e => e.term)).toEqual(['Autumn 2025'])
    expect(queried).toEqual([['CS106B']])
  })

  it('asks Supabase only for what neither cache has', async () => {
    const store = fakeStore()
    shared.setSharedCacheForTests(store, defer)
    await post(['CS106B'])
    await settle()
    newInstance()
    queried.length = 0
    const { body } = await post(['CS106B', 'CS229'])
    expect(queried).toEqual([['CS229']])
    expect(body.CS229.map(e => e.term)).toEqual(['Winter 2026'])
    expect(body.CS106B.map(e => e.term)).toEqual(['Autumn 2025'])
  })

  it('remembers a course with no evaluations', async () => {
    const store = fakeStore()
    shared.setSharedCacheForTests(store, defer)
    await post(['NOTRATED1'])
    await settle()
    newInstance()
    const { body } = await post(['NOTRATED1'])
    expect(body.NOTRATED1).toEqual([])
    expect(queried).toEqual([['NOTRATED1']])
  })

  it('falls back to Supabase when the cache throws', async () => {
    const store = { get: vi.fn().mockRejectedValue(new Error('cache down')), set: vi.fn().mockRejectedValue(new Error('cache down')) }
    shared.setSharedCacheForTests(store, defer)
    const { status, body } = await post(['CS106B'])
    await settle()
    expect(status).toBe(200)
    expect(body.CS106B.map(e => e.term)).toEqual(['Autumn 2025'])
    expect(queried).toEqual([['CS106B']])
  })

  it('does not wait on a cache that hangs', async () => {
    vi.useFakeTimers()
    try {
      const store = { get: vi.fn(() => new Promise(() => {})), set: vi.fn(async () => {}) }
      shared.setSharedCacheForTests(store, defer)
      const result = post(['CS106B'])
      await vi.advanceTimersByTimeAsync(shared.SHARED_TIMEOUT_MS + 1)
      const { body } = await result
      expect(body.CS106B.map(e => e.term)).toEqual(['Autumn 2025'])
      expect(queried).toEqual([['CS106B']])
    } finally {
      vi.useRealTimers()
    }
  })

  it('works with no cache at all', async () => {
    shared.setSharedCacheForTests(null, defer)
    const { body } = await post(['CS106B'])
    expect(body.CS106B.map(e => e.term)).toEqual(['Autumn 2025'])
  })

  it('ignores entries from another version or of the wrong shape', async () => {
    const store = fakeStore()
    shared.setSharedCacheForTests(store, defer)
    const key = `course-evaluations:v${shared.SHARED_CACHE_VERSION}:CS106B`
    store.map.set(key, JSON.stringify({ v: shared.SHARED_CACHE_VERSION + 1, data: [{ term: 'stale shape' }] }))
    expect((await post(['CS106B'])).body.CS106B.map(e => e.term)).toEqual(['Autumn 2025'])

    newInstance(); queried.length = 0
    store.map.set(key, JSON.stringify({ v: shared.SHARED_CACHE_VERSION, data: 'not a list' }))
    expect((await post(['CS106B'])).body.CS106B.map(e => e.term)).toEqual(['Autumn 2025'])
    expect(queried).toEqual([['CS106B']])
  })

  it('skips writing an item over the size limit', () => {
    const store = fakeStore()
    shared.setSharedCacheForTests(store, defer)
    shared.writeShared('course', 'HUGE', [{ comments: ['x'.repeat(shared.MAX_ITEM_CHARS)] }])
    expect(store.set).not.toHaveBeenCalled()
  })

  it('caches nothing when Supabase fails', async () => {
    const store = fakeStore()
    shared.setSharedCacheForTests(store, defer)
    failSupabase = true
    const { status } = await post(['CS106B'])
    await settle()
    expect(status).toBe(500)
    expect(store.set).not.toHaveBeenCalled()
  })
})
