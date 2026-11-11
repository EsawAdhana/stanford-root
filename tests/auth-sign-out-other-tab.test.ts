import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Supabase tells every open tab about a sign-out. The failure this pins down:
 * two tabs open, the student signs out in one, and the other kept their
 * schedule in memory. The next person to sign in on that browser got the
 * schedule merged into their own account, plans and ignored overlaps included.
 *
 * Drives the real auth store, cart store and sync module. Supabase's auth
 * events are fired by hand, as the BroadcastChannel would deliver them.
 */

type AuthCallback = (event: string, session: unknown) => void | Promise<void>
let authCallback: AuthCallback | null = null

const upsert = vi.fn(async () => ({ error: null }))
const signOut = vi.fn(async () => ({ error: null }))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: () => new Promise(() => {}), // the events below decide the state
      onAuthStateChange: (cb: AuthCallback) => {
        authCallback = cb
        return { data: { subscription: { unsubscribe: () => {} } } }
      },
      signOut: () => signOut(),
    },
    from: () => ({
      upsert,
      select: () => ({
        eq: () => ({
          single: async () => ({ data: { schedule: [] }, error: null }),
          maybeSingle: async () => ({ data: { ignored_exam_clashes: null }, error: null }),
        }),
      }),
      update: () => ({ eq: async () => ({ error: null }) }),
    }),
  },
}))

vi.mock('@/lib/analytics', () => ({
  track: vi.fn(),
  trackOnce: vi.fn(),
  markLoginPending: vi.fn(),
  consumeLoginPending: () => false,
}))
vi.mock('@/lib/humanbehavior', () => ({ identifyVisitor: vi.fn() }))
vi.mock('@/lib/auth-errors', () => ({
  showAuthError: vi.fn(),
  showAuthLoading: vi.fn(),
  dismissAuthLoading: vi.fn(),
  showAuthRedirectStalled: vi.fn(),
}))
const clearEvaluations = vi.fn()
vi.mock('@/lib/evaluation-store', () => ({ useEvaluationStore: { getState: () => ({ clearAll: clearEvaluations }) } }))
vi.mock('@/lib/cart-hydration', () => ({ cartHydrated: Promise.resolve(), setCartHydrated: vi.fn() }))

const W = 'Winter 2027'
const CATALOG = ['CS229', 'CS161'].map(id => ({ id, subject: 'CS', code: id.slice(2), title: id, terms: [W], sections: [] }))

const noop = () => {}
;(globalThis as Record<string, unknown>).window = { addEventListener: noop, removeEventListener: noop, setTimeout, clearTimeout }
;(globalThis as Record<string, unknown>).document = { addEventListener: noop, removeEventListener: noop, visibilityState: 'visible' }

const student = (id: string, email: string) => ({ user: { id, email, user_metadata: {} } })
const tick = () => new Promise(r => setTimeout(r, 20))

async function loadTab() {
  vi.resetModules()
  authCallback = null
  const { useAuthStore } = await import('@/lib/auth-store')
  const { useCartStore } = await import('@/lib/cart-store')
  const { useCourseStore } = await import('@/lib/store')
  const { useIgnoredClashStore } = await import('@/lib/ignored-clashes')
  const { debouncedPush } = await import('@/lib/schedule-sync')
  useCourseStore.setState({ courses: CATALOG as never, hasLoaded: true, hasEnriched: true })
  useAuthStore.getState().initialize()
  return { useAuthStore, useCartStore, useIgnoredClashStore, debouncedPush }
}

describe('a sign-out in another tab', () => {
  beforeEach(() => {
    upsert.mockClear()
    signOut.mockClear()
    clearEvaluations.mockClear()
  })

  it('clears the student\'s schedule, plans and ignores from this tab, without saving the empty cart', async () => {
    const tab = await loadTab()
    await authCallback!('INITIAL_SESSION', student('student-a', 'a@stanford.edu'))
    await tick()

    // The schedule this tab holds for student A, as useSyncSchedule watches it.
    tab.useCartStore.setState({
      items: [{ ...CATALOG[0], selectedTerm: W } as never],
      plans: { [W]: { order: ['A', 'B'], active: 'A', parked: { B: [{ id: 'CS161', selectedTerm: W }] } } },
      unresolved: [{ id: 'PHIL187C', selectedTerm: W }],
    })
    tab.useIgnoredClashStore.getState().replace({ 'Autumn 2026': ['2026-12-07@1140:CS145+CS329X'] }, 'student-a')
    tab.useCartStore.subscribe(() => tab.debouncedPush('student-a'))
    await tick()
    upsert.mockClear()

    await authCallback!('SIGNED_OUT', null)
    await tick()

    const cart = tab.useCartStore.getState()
    expect(cart.items).toEqual([])
    expect(cart.plans).toEqual({})
    expect(cart.unresolved).toEqual([])
    expect(tab.useIgnoredClashStore.getState().byTerm).toEqual({})
    expect(clearEvaluations).toHaveBeenCalled()
    expect(tab.useAuthStore.getState().user).toBeNull()
    // Clearing must not reach student A's saved row.
    expect(upsert).not.toHaveBeenCalled()
  })

  it('leaves a visitor\'s signed-out schedule alone when a non-Stanford sign-in is turned away', async () => {
    const tab = await loadTab()
    tab.useCartStore.setState({ items: [{ ...CATALOG[0], selectedTerm: W } as never] })

    await authCallback!('SIGNED_IN', student('gmail-user', 'someone@gmail.com'))
    expect(signOut).toHaveBeenCalled()
    await authCallback!('SIGNED_OUT', null)

    expect(tab.useCartStore.getState().items.map(i => i.id)).toEqual(['CS229'])
  })
})
