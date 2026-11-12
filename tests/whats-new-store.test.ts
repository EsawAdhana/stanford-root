import { beforeEach, describe, expect, it, vi } from 'vitest'

function stubStorage(store: Map<string, string> | 'blocked') {
  const storage = store === 'blocked'
    ? { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } }
    : { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v) } }
  vi.stubGlobal('window', { localStorage: storage })
}

async function freshStore() {
  vi.resetModules()
  return import('@/lib/whats-new-store')
}

describe("what's-new store (header dot and card)", () => {
  beforeEach(() => vi.unstubAllGlobals())

  it('shows the dot for a browser that has never opened the card', async () => {
    stubStorage(new Map())
    const { useWhatsNewStore } = await freshStore()
    expect(useWhatsNewStore.getState().seen).toBeNull()
    useWhatsNewStore.getState().load()
    expect(useWhatsNewStore.getState().seen).toBe(false)
  })

  it('opening the card clears the dot and survives a reload', async () => {
    const storage = new Map<string, string>()
    stubStorage(storage)
    let { useWhatsNewStore, SEEN_KEY } = await freshStore()
    useWhatsNewStore.getState().load()
    useWhatsNewStore.getState().show()
    expect(useWhatsNewStore.getState()).toMatchObject({ open: true, seen: true })
    expect(storage.has(SEEN_KEY)).toBe(true)

    ;({ useWhatsNewStore } = await freshStore())
    useWhatsNewStore.getState().load()
    expect(useWhatsNewStore.getState()).toMatchObject({ open: false, seen: true })
  })

  it('reopening after it was seen still opens it', async () => {
    stubStorage(new Map([['whats-new-seen:2026-11-schedule', 'x']]))
    const { useWhatsNewStore } = await freshStore()
    useWhatsNewStore.getState().load()
    useWhatsNewStore.getState().show()
    expect(useWhatsNewStore.getState().open).toBe(true)
    useWhatsNewStore.getState().setOpen(false)
    expect(useWhatsNewStore.getState().open).toBe(false)
  })

  it('blocked storage shows no dot and still opens', async () => {
    stubStorage('blocked')
    const { useWhatsNewStore } = await freshStore()
    useWhatsNewStore.getState().load()
    expect(useWhatsNewStore.getState().seen).toBe(true)
    expect(() => useWhatsNewStore.getState().show()).not.toThrow()
    expect(useWhatsNewStore.getState().open).toBe(true)
  })
})
