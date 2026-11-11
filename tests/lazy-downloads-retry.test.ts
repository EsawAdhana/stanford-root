import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * The instructor directory and the syllabus index download on first use and
 * are shared by every caller. A failed download used to be remembered as an
 * empty result for the whole session: instructor search found no one, and
 * every syllabus button stayed disabled, with no retry until a reload.
 */

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body })
const failed = (status: number) => ({ ok: false, status, json: async () => ({}) })

beforeEach(() => {
  fetchMock.mockReset()
  vi.resetModules()
})

describe('instructor directory download', () => {
  const dump = { names: ['Lee, Pat'], courseLinks: { CS103: { 'P. Lee': 'pat-lee' } } }

  it('retries after a failed download instead of remembering it', async () => {
    const { loadDump } = await import('@/hooks/use-instructor-search')
    fetchMock.mockResolvedValueOnce(failed(503))
    expect(await loadDump()).toBeNull()

    fetchMock.mockResolvedValueOnce(ok(dump))
    const second = await loadDump()
    expect(second?.names.length).toBeGreaterThan(0)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('treats a network error the same way', async () => {
    const { loadDump } = await import('@/hooks/use-instructor-search')
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    expect(await loadDump()).toBeNull()
    fetchMock.mockResolvedValueOnce(ok(dump))
    expect(await loadDump()).not.toBeNull()
  })

  it('downloads once when it succeeds', async () => {
    const { loadDump } = await import('@/hooks/use-instructor-search')
    fetchMock.mockResolvedValue(ok(dump))
    await Promise.all([loadDump(), loadDump()])
    await loadDump()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('syllabus index download', () => {
  const index = { courses: { CS103: { terms: ['Autumn 2025'] } } }

  it('retries after a failed download instead of remembering it', async () => {
    const { loadIndex } = await import('@/hooks/use-syllabus-index')
    fetchMock.mockResolvedValueOnce(failed(500))
    expect(await loadIndex()).toBeNull()

    fetchMock.mockResolvedValueOnce(ok(index))
    expect(await loadIndex()).toEqual(index)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('retries after a malformed index', async () => {
    const { loadIndex } = await import('@/hooks/use-syllabus-index')
    fetchMock.mockResolvedValueOnce(ok({ nope: true }))
    expect(await loadIndex()).toBeNull()
    fetchMock.mockResolvedValueOnce(ok(index))
    expect(await loadIndex()).toEqual(index)
  })

  it('downloads once when it succeeds', async () => {
    const { loadIndex } = await import('@/hooks/use-syllabus-index')
    fetchMock.mockResolvedValue(ok(index))
    await loadIndex()
    await loadIndex()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
