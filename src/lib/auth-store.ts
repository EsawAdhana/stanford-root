import { create } from 'zustand'
import { supabase } from './supabase'
import type { User, Session } from '@supabase/supabase-js'
import {
  pullSchedule,
  cancelDebouncedPush,
  resetSyncState,
  suspendPush,
} from './schedule-sync'
import { useCartStore } from './cart-store'
import { useEvaluationStore } from './evaluation-store'
import { track } from './analytics'
import {
  showAuthError,
  showAuthLoading,
  dismissAuthLoading,
  showAuthRedirectStalled,
} from './auth-errors'
import { identifyVisitor } from './humanbehavior'

export type SignInSource = 'hero' | 'header' | 'eval_gate' | 'nudge'

/** Delay before the "Redirecting…" toast so a fast hop doesn't flash it. */
const SIGN_IN_TOAST_DELAY_MS = 150

/**
 * How long to wait for the browser to actually leave for Google. The whole chain
 * (Supabase `/authorize` → Google) has to commit a new document before `pagehide`
 * fires. Measured worst honest case was 8.1s at 2.5s RTT / 120kbps — worse than any
 * standard "slow 3G" preset — so this leaves real headroom. Firing early is cheap
 * anyway: it does not cancel the pending navigation, so a redirect that lands late
 * still works and takes the toast with it.
 */
const REDIRECT_WATCHDOG_MS = 15000

// Module-level so the pageshow/pagehide/visibility handlers in initialize() can
// cancel timers started by signInWithGoogle().
let signInToastTimer: number | null = null
let redirectWatchdogTimer: number | null = null

function clearSignInTimers() {
  if (typeof window === 'undefined') return
  if (signInToastTimer !== null) {
    window.clearTimeout(signInToastTimer)
    signInToastTimer = null
  }
  if (redirectWatchdogTimer !== null) {
    window.clearTimeout(redirectWatchdogTimer)
    redirectWatchdogTimer = null
  }
}

interface AuthState {
  user: User | null
  session: Session | null
  isLoading: boolean
  isSigningIn: boolean
  initialize: () => () => void
  signInWithGoogle: (options?: { returnPath?: string; source?: SignInSource }) => Promise<void>
  signOut: () => Promise<void>
}

/**
 * Hand the signed-in student's identity to Human Behavior. Called for a fresh
 * sign-in and for a restored session, so returning students stop being recorded
 * as anonymous cookies from their next page load onward.
 */
function identifyForAnalytics(user: { id: string; email?: string | null; user_metadata?: Record<string, unknown> | null }) {
  if (!user.email) return
  const fullName = user.user_metadata?.full_name
  identifyVisitor({
    email: user.email,
    name: typeof fullName === 'string' ? fullName : undefined,
    userId: user.id,
  })
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  session: null,
  isLoading: true,
  isSigningIn: false,

  initialize: () => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      const user = session?.user ?? null

      if (user && !user.email?.endsWith('@stanford.edu')) {
        void supabase.auth.signOut().catch(err => console.error('Failed to sign out non-Stanford user:', err))
        set({ user: null, session: null, isLoading: false })
        return
      }

      if (user) {
        // Returned signed-in (e.g. via OAuth callback): clear any leftover
        // "Redirecting…" loading state from before the redirect.
        identifyForAnalytics(user)
        dismissAuthLoading()
        set({ user, session, isLoading: false, isSigningIn: false })
      } else {
        set({ user, session, isLoading: false })
      }
    }).catch((err) => {
      console.error('Failed to get session:', err)
      set({ user: null, session: null, isLoading: false })
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      const user = session?.user ?? null

      if (user && !user.email?.endsWith('@stanford.edu')) {
        void supabase.auth.signOut().catch(err => console.error('Failed to sign out non-Stanford user:', err))
        set({ user: null, session: null, isLoading: false, isSigningIn: false })
        if (event === 'SIGNED_IN') {
          showAuthError('stanford_required')
        }
        return
      }

      if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && user) {
        identifyForAnalytics(user)
        dismissAuthLoading()
        set({ user, session, isLoading: false, isSigningIn: false })
        pullSchedule(user.id)
      } else {
        set({ user, session, isLoading: false })
      }

      if (event === 'SIGNED_IN' && user) {
        track('login_completed')
      }
    })

    // Back from Google/Stanford (bfcache or full reload): clear stuck "Redirecting…"
    // UI so login buttons aren't disabled forever.
    const clearSigningInUi = () => {
      clearSignInTimers()
      dismissAuthLoading()
      if (get().isSigningIn) set({ isSigningIn: false })
    }
    const handlePageShow = () => clearSigningInUi()
    // The navigation committed (or the page entered bfcache). Drop the pending
    // timers: a frozen toast timer would otherwise resume on a bfcache restore and
    // show "Redirecting…" *after* pageshow already cleared it.
    const handlePageHide = () => clearSignInTimers()
    // Came back to the tab/app but we're still on this page, so the redirect never
    // took. pageshow doesn't fire for a plain tab or app switch.
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') clearSigningInUi()
    }
    window.addEventListener('pageshow', handlePageShow)
    window.addEventListener('pagehide', handlePageHide)
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      subscription.unsubscribe()
      window.removeEventListener('pageshow', handlePageShow)
      window.removeEventListener('pagehide', handlePageHide)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  },

  signInWithGoogle: async (options) => {
    if (typeof window === 'undefined') return
    if (get().isSigningIn) return

    const returnPath = options?.returnPath
    if (options?.source) {
      track('login_started', { source: options.source })
    }

    set({ isSigningIn: true })
    clearSignInTimers()
    // Delay toast slightly so a fast navigate doesn't flash "Redirecting…".
    signInToastTimer = window.setTimeout(() => {
      signInToastTimer = null
      showAuthLoading()
    }, SIGN_IN_TOAST_DELAY_MS)

    // Armed before the await, so it covers both a signInWithOAuth() call that never
    // settles and a redirect the browser never completes. Every path that resolves
    // the sign-in either navigates away or calls clearSignInTimers().
    redirectWatchdogTimer = window.setTimeout(() => {
      redirectWatchdogTimer = null
      if (!get().isSigningIn) return
      dismissAuthLoading()
      set({ isSigningIn: false })
      showAuthRedirectStalled(() => {
        void get().signInWithGoogle(options)
      })
    }, REDIRECT_WATCHDOG_MS)

    const next = returnPath ?? `${window.location.pathname}${window.location.search}`
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`

    try {
      // skipBrowserRedirect: we navigate ourselves with replace() (no double
      // redirect from supabase-js, and Back won't return to a stuck button).
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo,
          skipBrowserRedirect: true,
          queryParams: {
            hd: 'stanford.edu',
          },
        },
      })

      if (error) {
        console.error('OAuth sign-in failed:', error)
        clearSignInTimers()
        dismissAuthLoading()
        set({ isSigningIn: false })
        const isLocalhost = window.location.hostname === 'localhost'
        const hint = isLocalhost
          ? ' Add http://localhost:3000/auth/callback to Supabase Auth → Redirect URLs.'
          : undefined
        showAuthError('oauth_failed', hint ? `${error.message}${hint}` : error.message)
        return
      }

      if (data?.url) {
        // Leave the watchdog armed: if the browser never actually leaves — a stalled
        // request to Supabase or Google, a dropped connection, a refused navigation —
        // it is the only thing that clears the spinner and the loading toast.
        window.location.replace(data.url)
        return
      }

      clearSignInTimers()
      dismissAuthLoading()
      set({ isSigningIn: false })
      showAuthError('oauth_failed', 'No redirect URL returned from Supabase.')
    } catch (err) {
      console.error('OAuth sign-in failed:', err)
      clearSignInTimers()
      dismissAuthLoading()
      set({ isSigningIn: false })
      showAuthError('oauth_failed')
    }
  },

  signOut: async () => {
    // Suspend pushes before clearing local state: clearCart() triggers the
    // cart subscription, which would otherwise push an empty schedule and wipe
    // the user's saved server schedule. resetSyncState() lifts the suspension.
    suspendPush()
    cancelDebouncedPush()
    useCartStore.getState().clearCart()
    useEvaluationStore.getState().clearAll()
    await supabase.auth.signOut()
    resetSyncState()
    set({ user: null, session: null })
  }
}))
