/** True on the read-only shared schedule (/s), whose viewer is not the owner. */
export function isSharedSchedulePath(pathname: string | null | undefined): boolean {
  return pathname === '/s' || Boolean(pathname?.startsWith('/s/'))
}

/** What the browser held when this page load started, before the visitor did anything. */
export interface StateAtLoad {
  /** Classes in the saved cart right after it was read back from localStorage. */
  savedClasses: number
  /** Whether the first session check found a signed-in student. */
  signedIn: boolean
}

/**
 * Someone who has used the schedule before: they had saved classes when the
 * page loaded, or they were signed in. A first-time visitor who adds a class
 * during this visit is still a first-time visitor until the next page load.
 */
export function isReturningVisitor(state: StateAtLoad): boolean {
  return state.savedClasses > 0 || state.signedIn
}

/**
 * Remember the first answer of an async check for the rest of the page load,
 * so a later route change reuses it instead of looking at state the visitor
 * has since changed.
 */
export function onceForPageLoad<T>(check: () => Promise<T>): () => Promise<T> {
  let result: Promise<T> | null = null
  return () => {
    if (!result) result = check()
    return result
  }
}
