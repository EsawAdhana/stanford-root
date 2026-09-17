import type { AnalyticsEvent } from './analytics-events'

const SESSION_KEY = 'root_session_id'
const LOGIN_PENDING_KEY = 'root_login_pending'
const ONCE_KEY_PREFIX = 'root_tracked_once:'

/** Stable anonymous device/session id, independent of auth. Lets us distinguish
 *  devices and attribute pre-login activity. */
function getSessionId(): string {
  try {
    let id = localStorage.getItem(SESSION_KEY)
    if (!id) {
      id = crypto.randomUUID()
      localStorage.setItem(SESSION_KEY, id)
    }
    return id
  } catch {
    return 'unknown'
  }
}

/**
 * Records a first-party analytics event. Client-only, fire-and-forget, and never
 * throws — analytics must not break the app. `user_id` is attached server-side
 * from the auth cookie, so it is not sent here.
 */
export function track(event: AnalyticsEvent, props: Record<string, unknown> = {}): void {
  if (typeof window === 'undefined') return
  try {
    const body = JSON.stringify({
      event,
      props,
      session_id: getSessionId(),
      path: window.location.pathname,
    })
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon('/api/track', new Blob([body], { type: 'application/json' }))
    } else {
      fetch('/api/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => { /* ignore */ })
    }
  } catch {
    // Never let analytics break the app
  }
}

/**
 * Records that *this tab* has started an interactive sign-in.
 *
 * sessionStorage, not localStorage, and that is the whole point: it is scoped to
 * one tab and it survives the round trip out to Google and back, which is
 * exactly the lifetime of one login attempt.
 */
export function markLoginPending(): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.setItem(LOGIN_PENDING_KEY, '1')
  } catch {
    // Safari private mode and friends. Worst case the login goes uncounted.
  }
}

/**
 * True exactly once per sign-in that this tab started, and false for every
 * other way a Supabase `SIGNED_IN` can arrive.
 *
 * Why this exists: `onAuthStateChange` fires `SIGNED_IN` for a token refresh
 * and a restored session as well as a real login, it fires in *every* open tab
 * because Supabase broadcasts auth across them, and a duplicate-listener bug
 * could fire it many times within a single tab. Over Sep 15-17 that turned
 * roughly 750 real logins into 22,044 recorded `login_completed` events — 54%
 * of all analytics volume, from real students, before a single bot was
 * involved. One session recorded 1,215 of them: 67 genuine auth transitions,
 * each multiplied by ~14 open tabs and up to 12 stacked listeners, arriving in
 * bursts with a median gap of 0.01s.
 *
 * Clearing before returning is what makes it idempotent: the first caller in a
 * burst takes the flag and everyone behind it sees nothing.
 */
export function consumeLoginPending(): boolean {
  if (typeof window === 'undefined') return false
  try {
    if (sessionStorage.getItem(LOGIN_PENDING_KEY) === null) return false
    sessionStorage.removeItem(LOGIN_PENDING_KEY)
    return true
  } catch {
    return false
  }
}

/**
 * Fires `event` at most once per `key` per `ttlMs`, across every tab on this
 * device.
 *
 * For events that are a consequence of app state rather than a user action, so
 * N open tabs all reaching the same state is one thing happening, not N. The
 * claim is a localStorage timestamp and is deliberately not atomic — two tabs
 * racing the same millisecond can both fire. That is acceptable here: the bug
 * being fixed is a 300x multiplier, not an occasional double count.
 */
export function trackOnce(
  event: AnalyticsEvent,
  key: string,
  ttlMs: number,
  props: Record<string, unknown> = {},
): void {
  if (typeof window === 'undefined') return
  const storageKey = `${ONCE_KEY_PREFIX}${event}:${key}`
  try {
    const now = Date.now()
    const previous = Number(localStorage.getItem(storageKey))
    if (Number.isFinite(previous) && previous > 0 && now - previous < ttlMs) return
    localStorage.setItem(storageKey, String(now))
  } catch {
    // Storage unavailable: fall through and track, since under-counting a real
    // event is worse than the duplicate this guard was meant to stop.
  }
  track(event, props)
}
