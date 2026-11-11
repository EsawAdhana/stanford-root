/**
 * Tracks when the cart store's persist middleware has finished rehydrating from localStorage.
 * Used by schedule-sync to avoid reading stale/empty cart state before hydration completes,
 * which would cause the wrong data to be merged or overwritten by a later rehydration.
 */
let resolveHydration: (() => void) | null = null
let timeoutId: ReturnType<typeof setTimeout> | null = null

/** Wait for cart hydration, with a 3s timeout so a persist that never fires cannot hang sync. */
export const cartHydrated: Promise<void> = new Promise<void>((resolve) => {
  resolveHydration = resolve
  timeoutId = setTimeout(() => {
    // Only reached when hydration really never happened: setCartHydrated clears this timer.
    if (resolveHydration) {
      console.warn('[cart-hydration] Timed out waiting for persist rehydration; proceeding with current cart state')
      resolveHydration = null
      resolve()
    }
  }, 3000)
})

export function setCartHydrated(): void {
  if (timeoutId) {
    clearTimeout(timeoutId)
    timeoutId = null
  }
  if (resolveHydration) {
    resolveHydration()
    resolveHydration = null
  }
}
