/**
 * The term a student was browsing, handed to the course page without touching the URL.
 *
 * The Sections panel used to read `terms` off the query string, which meant every course
 * link carried the catalog filters (`/AA199?terms=Winter+2027&q=mark&...`). A
 * course URL should be just the course, so the preference travels here instead.
 *
 * sessionStorage rather than a module variable because the course page is
 * server-rendered: module state would be shared across requests on the server, and
 * reading it during render would desync hydration. This is read in an effect, client
 * only, and consumed on read so a later direct visit to a course gets the default term
 * rather than inheriting a stale one.
 */
const KEY = 'preferred-terms'

export function setPreferredTerms(terms: readonly string[] | null | undefined): void {
  if (typeof window === 'undefined') return
  try {
    if (!terms || terms.length === 0) sessionStorage.removeItem(KEY)
    else sessionStorage.setItem(KEY, JSON.stringify(terms))
  } catch {
    // sessionStorage unavailable (private mode, quota) — the default term is fine.
  }
}

/** Reads and clears the stashed terms. Returns [] when there is nothing pending. */
export function takePreferredTerms(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return []
    sessionStorage.removeItem(KEY)
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : []
  } catch {
    return []
  }
}
