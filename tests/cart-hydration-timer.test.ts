import { describe, it, expect, vi, afterEach } from 'vitest'

afterEach(() => { vi.useRealTimers(); vi.resetModules(); vi.restoreAllMocks() })

describe('cart hydration timeout', () => {
  it('does not warn when hydration finishes in time', async () => {
    vi.useFakeTimers()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const mod = await import('@/lib/cart-hydration')
    mod.setCartHydrated()
    await vi.advanceTimersByTimeAsync(5000)
    await mod.cartHydrated
    expect(warn).not.toHaveBeenCalled()
  })

  it('warns and resolves when hydration never happens', async () => {
    vi.useFakeTimers()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const mod = await import('@/lib/cart-hydration')
    await vi.advanceTimersByTimeAsync(3000)
    await mod.cartHydrated
    expect(warn).toHaveBeenCalledTimes(1)
  })
})
