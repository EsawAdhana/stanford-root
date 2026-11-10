import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useEvaluationStore } from '@/lib/evaluation-store'

/**
 * A failed evaluations request used to store [] for its courses. The next
 * successful request cached the whole map in sessionStorage, [] included, so
 * after a reload the course skipped refetching (its entry existed) and showed
 * "No evaluations on record" with no error, for the cache's 30 minutes.
 */

const storage = new Map<string, string>()
vi.stubGlobal('sessionStorage', {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => { storage.set(k, v) },
  removeItem: (k: string) => { storage.delete(k) },
})

const report = { term: 'Autumn 2025', instructor: 'Lee, Pat', courseCode: 'Au25-CS-103-01', respondents: '', questions: [], comments: [] }

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body })
const failed = (status: number) => ({ ok: false, status, json: async () => ({}) })

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

const store = () => useEvaluationStore.getState()
/** A reload: in-memory state gone, sessionStorage kept. */
const reload = () => useEvaluationStore.setState({ evaluations: {}, errorCourses: {}, loadingCourses: {}, isBulkLoading: false })

describe('evaluation fetch failures', () => {
  beforeEach(() => {
    storage.clear()
    fetchMock.mockReset()
    reload()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('does not cache a failed course as empty, so it refetches after a reload', async () => {
    fetchMock.mockResolvedValueOnce(failed(500))
    await store().fetchBulkEvaluations(['CS106A'])
    expect(store().errorCourses.CS106A).toBe(true)
    expect('CS106A' in store().evaluations).toBe(false)

    fetchMock.mockResolvedValueOnce(ok({ CS103: [report] }))
    await store().fetchBulkEvaluations(['CS103'])
    const cached = JSON.parse(storage.get('evaluations-cache')!).data
    expect('CS106A' in cached).toBe(false)

    reload()
    fetchMock.mockResolvedValueOnce(ok({ CS106A: [report] }))
    await store().fetchBulkEvaluations(['CS106A'])
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(store().evaluations.CS106A).toHaveLength(1)
  })

  it('retries a failed course in the same session and clears its error', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await store().fetchBulkEvaluations(['CS106A'])
    expect(store().errorCourses.CS106A).toBe(true)

    fetchMock.mockResolvedValueOnce(ok({ CS106A: [report] }))
    await store().fetchBulkEvaluations(['CS106A'])
    expect(store().errorCourses.CS106A).toBeUndefined()
    expect(store().evaluations.CS106A).toHaveLength(1)
  })

  it('a course that really has no evaluations stays loaded as empty and is not refetched', async () => {
    fetchMock.mockResolvedValueOnce(ok({}))
    await store().fetchBulkEvaluations(['CS999'])
    expect(store().evaluations.CS999).toEqual([])
    await store().fetchBulkEvaluations(['CS999'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('a 401 leaves the course unloaded so it fetches once the student is signed in', async () => {
    fetchMock.mockResolvedValueOnce(failed(401))
    await store().fetchBulkEvaluations(['CS106A'])
    expect('CS106A' in store().evaluations).toBe(false)
    expect(store().errorCourses.CS106A).toBeUndefined()
    expect(store().loadingCourses.CS106A).toBeUndefined()

    fetchMock.mockResolvedValueOnce(ok({ CS106A: [report] }))
    await store().fetchBulkEvaluations(['CS106A'])
    expect(store().evaluations.CS106A).toHaveLength(1)
  })
})
