import { describe, expect, it, vi } from 'vitest'
import { RELOAD_GUARD_MS, isStaleChunkError, reloadForStaleChunk } from '@/lib/stale-chunk-reload'

function memoryStorage() {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) } }
}

function chunkError(message = 'Failed to load chunk /_next/static/chunks/c1640549133b010e.js from module 64893') {
  const e = new Error(message)
  e.name = 'ChunkLoadError'
  return e
}

describe('isStaleChunkError', () => {
  it('matches the errors production recorded', () => {
    expect(isStaleChunkError(chunkError())).toBe(true)
  })

  it('matches the browser wordings of a missing dynamic import', () => {
    for (const msg of [
      'Loading chunk 8792 failed.',
      'Failed to fetch dynamically imported module: https://www.stanfordroot.com/_next/static/chunks/a.js',
      'Importing a module script failed.',
      'error loading dynamically imported module',
    ]) expect(isStaleChunkError(new Error(msg)), msg).toBe(true)
  })

  it('leaves real bugs alone', () => {
    for (const e of [
      new Error('switchPlan is not defined'),
      new TypeError("Cannot read properties of undefined (reading 'price')"),
      new Error("Failed to execute 'insertBefore' on 'Node'"),
      'Failed to load chunk',
      null,
    ]) expect(isStaleChunkError(e)).toBe(false)
  })
})

describe('reloadForStaleChunk', () => {
  it('reloads once for a stale chunk', () => {
    const reload = vi.fn()
    expect(reloadForStaleChunk(chunkError(), { storage: memoryStorage(), reload, now: 1_000_000 })).toBe(true)
    expect(reload).toHaveBeenCalledOnce()
  })

  it('does not loop when the reload did not fix it', () => {
    const storage = memoryStorage()
    const reload = vi.fn()
    reloadForStaleChunk(chunkError(), { storage, reload, now: 1_000_000 })
    expect(reloadForStaleChunk(chunkError(), { storage, reload, now: 1_000_000 + 2_000 })).toBe(false)
    expect(reload).toHaveBeenCalledOnce()
  })

  it('reloads again for a later deploy', () => {
    const storage = memoryStorage()
    const reload = vi.fn()
    reloadForStaleChunk(chunkError(), { storage, reload, now: 1_000_000 })
    expect(reloadForStaleChunk(chunkError(), { storage, reload, now: 1_000_000 + RELOAD_GUARD_MS + 1 })).toBe(true)
    expect(reload).toHaveBeenCalledTimes(2)
  })

  it('never reloads for other errors', () => {
    const reload = vi.fn()
    expect(reloadForStaleChunk(new Error('useIgnoredClashes is not defined'), { storage: memoryStorage(), reload })).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })

  it('does not reload when storage is blocked or throws', () => {
    const reload = vi.fn()
    expect(reloadForStaleChunk(chunkError(), { storage: null, reload })).toBe(false)
    const throwing = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } }
    expect(reloadForStaleChunk(chunkError(), { storage: throwing, reload })).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })

  it('treats a garbage stored value as no previous reload', () => {
    const storage = memoryStorage()
    storage.setItem('stale-chunk-reload-at', 'not a number')
    const reload = vi.fn()
    expect(reloadForStaleChunk(chunkError(), { storage, reload, now: 5 })).toBe(true)
  })
})
