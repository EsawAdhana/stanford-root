/**
 * Recovers a tab left open across a deploy.
 *
 * Each deploy replaces the JavaScript files under /_next/static, so a tab that
 * loaded before it asks for files that no longer exist the next time it needs
 * one, and the error boundary showed "Something went wrong!" instead. Recorded
 * as ChunkLoadError ("Failed to load chunk /_next/static/chunks/...") about once
 * a day in November 2026, with one session hitting it 9 times. Reloading fetches
 * the new deploy's files, which is all the visitor needed.
 */

/** Long enough to cover a reload and the crash that follows; a later crash gets its own reload. */
export const RELOAD_GUARD_MS = 30_000

const GUARD_KEY = 'stale-chunk-reload-at'

/** Whether an error means the page's code is from an older deploy. */
export function isStaleChunkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  if (error.name === 'ChunkLoadError') return true
  // Same failure as worded by Webpack, Chrome and Safari for dynamic imports.
  return /Loading chunk [\w-]+ failed|Failed to load chunk|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i
    .test(error.message)
}

type GuardStorage = Pick<Storage, 'getItem' | 'setItem'>

/**
 * Reloads once for a stale-chunk error and says whether it did. A second stale
 * crash within RELOAD_GUARD_MS means reloading is not fixing it, so the error
 * page stays up rather than looping. Without storage (blocked in private mode)
 * there is no way to tell a loop apart, so it does not reload at all.
 */
export function reloadForStaleChunk(
  error: unknown,
  { storage, reload, now = Date.now() }: { storage: GuardStorage | null; reload: () => void; now?: number },
): boolean {
  if (!isStaleChunkError(error) || !storage) return false
  try {
    const last = Number(storage.getItem(GUARD_KEY))
    if (Number.isFinite(last) && last > 0 && now - last < RELOAD_GUARD_MS) return false
    storage.setItem(GUARD_KEY, String(now))
  } catch {
    return false
  }
  reload()
  return true
}
