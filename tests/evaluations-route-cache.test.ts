import { describe, it, expect, beforeEach, vi } from 'vitest'

// What the route actually asked Postgres for, per call.
const queried: string[][] = []

vi.mock('@/lib/stanford-auth', () => ({
  getStanfordUser: () => Promise.resolve({ id: 'u1', email: 'a@stanford.edu' }),
}))
vi.mock('@/lib/dev-flags', () => ({ isDevEvalsUnlocked: () => false }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))

// One row per course, so a course's presence in the response is unambiguous.
const ROWS: Record<string, { course_id: string; term: string; instructor: string }> = {
  CS106B: { course_id: 'CS106B', term: 'Autumn 2025', instructor: 'Bailey, Cynthia' },
  CS229: { course_id: 'CS229', term: 'Winter 2026', instructor: 'Ng, Andrew' },
  CS107: { course_id: 'CS107', term: 'Spring 2026', instructor: 'Troccoli, Nick' },
}

vi.mock('@/lib/supabase-admin', () => ({
  getPublicClient: () => ({
    from: () => ({
      select: () => ({
        in: (_col: string, ids: string[]) => {
          queried.push([...ids])
          return Promise.resolve({ data: ids.map(id => ROWS[id]).filter(Boolean), error: null })
        },
      }),
    }),
  }),
}))

const { POST } = await import('@/app/api/evaluations/route')
const { clearEvaluationCache } = await import('@/lib/evaluation-cache')

const post = async (courseIds: string[]) => {
  const res = await POST(new Request('http://localhost/api/evaluations', {
    method: 'POST',
    body: JSON.stringify({ courseIds }),
  }))
  return res.json() as Promise<Record<string, Array<{ term: string }>>>
}

beforeEach(() => {
  queried.length = 0
  clearEvaluationCache()
})

describe('/api/evaluations caching', () => {
  it('reads Postgres on the first request and not on the second', () => {
    return post(['CS106B']).then(async first => {
      expect(first.CS106B.map(e => e.term)).toEqual(['Autumn 2025'])
      expect(queried).toEqual([['CS106B']])

      const second = await post(['CS106B'])
      expect(second.CS106B.map(e => e.term)).toEqual(['Autumn 2025'])
      // The whole point: 556KB not read a second time.
      expect(queried).toEqual([['CS106B']])
    })
  })

  it('asks only for the courses it does NOT have, and still answers for all of them', async () => {
    // The case a naive merge breaks: querying `ids` instead of `missing` keeps
    // the egress, and dropping the cached ones from the response silently loses
    // evaluations the student was already shown.
    await post(['CS106B'])
    queried.length = 0

    const mixed = await post(['CS106B', 'CS229'])
    expect(queried).toEqual([['CS229']])
    expect(Object.keys(mixed).sort()).toEqual(['CS106B', 'CS229'])
    expect(mixed.CS106B.map(e => e.term)).toEqual(['Autumn 2025'])
    expect(mixed.CS229.map(e => e.term)).toEqual(['Winter 2026'])
  })

  it('does not query at all when everything is cached', async () => {
    await post(['CS106B', 'CS229'])
    queried.length = 0

    const again = await post(['CS229', 'CS106B'])
    expect(queried).toEqual([])
    expect(again.CS106B.map(e => e.term)).toEqual(['Autumn 2025'])
    expect(again.CS229.map(e => e.term)).toEqual(['Winter 2026'])
  })

  it('caches a course that has no evaluations instead of re-asking', async () => {
    const first = await post(['NOTRATED1'])
    expect(first.NOTRATED1).toEqual([])
    expect(queried).toEqual([['NOTRATED1']])

    const second = await post(['NOTRATED1'])
    expect(second.NOTRATED1).toEqual([])
    expect(queried).toEqual([['NOTRATED1']])
  })

  it('does not let a later request mutate the cached copy', async () => {
    // byCourse holds the cached array by reference. If anything ever pushed onto
    // it, the next student would see another course's evaluations appended.
    await post(['CS106B'])
    await post(['CS106B', 'CS229'])
    const third = await post(['CS106B'])
    expect(third.CS106B.map(e => e.term)).toEqual(['Autumn 2025'])
  })

  it('still rejects an oversized batch after caching was added', async () => {
    const res = await POST(new Request('http://localhost/api/evaluations', {
      method: 'POST',
      body: JSON.stringify({ courseIds: Array.from({ length: 51 }, (_, i) => `C${i}`) }),
    }))
    expect(res.status).toBe(400)
    expect(queried).toEqual([])
  })
})
