import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * The catalog loads in two phases: light rows for the list, then eight full
 * shards with sections, times and descriptions. When any shard failed, the
 * store kept the light data with `isEnriching` and `hasEnriched` both false,
 * and every later `fetchCourses()` returned early on `hasLoaded`, so the tab
 * stayed on light data until a reload. A later call should retry phase 2 only.
 */

const fetchCatalogJson = vi.fn()
vi.mock('@/lib/catalog-fetch', () => ({ fetchCatalogJson: (url: string) => fetchCatalogJson(url) }))
vi.mock('@/lib/course-mapper', () => ({ rowToCourse: (row: unknown) => row }))

const light = [{ id: 'CS106A', title: 'Programming Methodology' }]
const full = [{ id: 'CS106A', title: 'Programming Methodology', sections: [{ classId: 1 }], description: 'Intro' }]

/** Light list succeeds; each full shard follows `shard`. */
function respond(shard: 'ok' | 'fail') {
  fetchCatalogJson.mockImplementation(async (url: string) => {
    if (!url.includes('full=1')) return light
    if (shard === 'fail') throw new Error('shard 503')
    return url.endsWith('shard=0') ? full : []
  })
}

async function freshStore() {
  vi.resetModules()
  const { useCourseStore } = await import('@/lib/store')
  return useCourseStore
}

describe('catalog enrichment after a shard fails', () => {
  beforeEach(() => {
    fetchCatalogJson.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('retries only the full shards on the next fetchCourses()', async () => {
    const store = await freshStore()
    respond('fail')
    await store.getState().fetchCourses()
    expect(store.getState()).toMatchObject({ hasLoaded: true, hasEnriched: false, isEnriching: false, catalogError: false })
    expect(store.getState().courses).toEqual(light)

    respond('ok')
    fetchCatalogJson.mockClear()
    await store.getState().fetchCourses()

    const urls = fetchCatalogJson.mock.calls.map(c => c[0] as string)
    expect(urls.every(u => u.includes('full=1'))).toBe(true)
    expect(store.getState()).toMatchObject({ hasEnriched: true, isEnriching: false })
    expect(store.getState().courses).toEqual(full)
  })

  it('shows enriching during the retry and keeps the light list on screen', async () => {
    const store = await freshStore()
    respond('fail')
    await store.getState().fetchCourses()

    // Hold every shard until the test has looked at the in-between state.
    const pending: (() => void)[] = []
    fetchCatalogJson.mockImplementation((url: string) =>
      new Promise(r => { pending.push(() => r(url.endsWith('shard=0') ? full : [])) })
    )
    const retry = store.getState().fetchCourses()
    await vi.waitFor(() => expect(store.getState().isEnriching).toBe(true))
    expect(store.getState().courses).toEqual(light)
    expect(store.getState().isLoading).toBe(false)

    for (const release of pending) release()
    await retry
    expect(store.getState()).toMatchObject({ hasEnriched: true, isEnriching: false })
  })

  it('a second failure leaves the light list and can be retried again', async () => {
    const store = await freshStore()
    respond('fail')
    await store.getState().fetchCourses()
    await store.getState().fetchCourses()
    expect(store.getState()).toMatchObject({ hasEnriched: false, isEnriching: false, catalogError: false })
    expect(store.getState().courses).toEqual(light)

    respond('ok')
    await store.getState().fetchCourses()
    expect(store.getState().hasEnriched).toBe(true)
  })

  it('a fully loaded catalog is not refetched', async () => {
    const store = await freshStore()
    respond('ok')
    await store.getState().fetchCourses()
    fetchCatalogJson.mockClear()
    await store.getState().fetchCourses()
    expect(fetchCatalogJson).not.toHaveBeenCalled()
  })
})
