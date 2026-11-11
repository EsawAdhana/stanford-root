import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * The schedule fetches class details (sections, times) for the classes on it.
 * A failed request used to leave no trace, so the class list sat on "Finding
 * the exam slot…" (or "Time TBA") until a reload. These drive the real store
 * with `fetch` stubbed.
 */

const row = (id: string) => ({
  course_id: id, subject: 'CS', code: id.slice(2), title: id, description: 'A class.', units: '3',
  sections: [{ classId: 1, term: 'Autumn 2026', component: 'LEC', meetings: [] }],
})

let responses: Array<'fail' | 'ok' | 'hang'> = []
const fetchMock = vi.fn(async (_url: string, init?: { body?: string }) => {
  const next = responses.shift() ?? 'ok'
  if (next === 'hang') return new Promise<never>(() => {})
  if (next === 'fail') throw new TypeError('Failed to fetch')
  const ids: string[] = init?.body ? JSON.parse(init.body).ids : [_url.split('/').pop()!]
  const body = init?.body ? ids.map(row) : row(ids[0])
  return { ok: true, status: 200, json: async () => body }
})

async function loadStore() {
  vi.resetModules()
  ;(globalThis as { fetch?: unknown }).fetch = fetchMock
  const { useCourseStore } = await import('@/lib/store')
  useCourseStore.setState({ courses: [{ id: 'CS161', subject: 'CS', code: '161', title: 'CS161', terms: ['Autumn 2026'] } as never] })
  return useCourseStore
}

describe('fetching class details for the schedule', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    fetchMock.mockClear()
    responses = []
  })
  afterEach(() => vi.useRealTimers())

  it('tries three times, then records the failure so the schedule can say so', async () => {
    const store = await loadStore()
    responses = ['fail', 'fail', 'fail']
    const done = store.getState().fetchCourseDetails(['CS161', 'CS229'])
    await vi.runAllTimersAsync()
    await done
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect([...store.getState().failedDetailIds].sort()).toEqual(['CS161', 'CS229'])
    expect(store.getState().enrichedCourseIds.has('CS161')).toBe(false)
  })

  it('rides out a blip: one failure, then the details arrive', async () => {
    const store = await loadStore()
    responses = ['fail', 'ok']
    const done = store.getState().fetchCourseDetails(['CS161'])
    await vi.runAllTimersAsync()
    await done
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(store.getState().failedDetailIds.has('CS161')).toBe(false)
    expect(store.getState().enrichedCourseIds.has('CS161')).toBe(true)
    expect(store.getState().courses.find(c => c.id === 'CS161')?.sections).toHaveLength(1)
  })

  it('counts a retry as loading again, not failed, while it is out', async () => {
    const store = await loadStore()
    store.setState({ failedDetailIds: new Set(['CS161']) })
    responses = ['hang']
    void store.getState().fetchCourseDetails(['CS161'])
    await Promise.resolve()
    expect(store.getState().failedDetailIds.has('CS161')).toBe(false)
  })

  it('lets the course page start a fresh try after the schedule\'s fetch failed', async () => {
    const store = await loadStore()
    store.setState({ failedDetailIds: new Set(['CS161']) })
    responses = ['hang']
    void store.getState().fetchCourseDetail('CS161')
    await Promise.resolve()
    expect(store.getState().failedDetailIds.has('CS161')).toBe(false)
  })
})
