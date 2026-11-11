import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * flushPendingPush runs when a tab is hidden or closed, so it cannot wait for
 * anything. Before the cart store has read the saved cart back from
 * localStorage, the cart in memory is the store's empty initial state, and
 * writing that over the row is the 2026-11-10 wipe again by another route.
 *
 * Each test opens a fresh tab whose cart hydration resolves only when the test
 * says so, against an in-memory `user_schedules` row.
 */

type ScheduleItem = { id: string; selectedTerm?: string }

let serverSchedule: ScheduleItem[] | null = null

const upsert = vi.fn(async (payload: { user_id: string; schedule: ScheduleItem[] }) => {
  serverSchedule = payload.schedule.map(i => ({ ...i }))
  return { error: null }
})
const selectSingle = vi.fn(async (): Promise<unknown> =>
  serverSchedule === null
    ? { data: null, error: { code: 'PGRST116' } }
    : { data: { schedule: serverSchedule.map(i => ({ ...i })) }, error: null }
)

// Saves are compare-and-set against the row above; `upsert` is still the spy every write goes through.
vi.mock('@/lib/supabase', async () => {
  const { fakeSupabase } = await import('./helpers/user-schedules-table')
  return { supabase: fakeSupabase({ peek: () => serverSchedule, write: upsert, read: () => selectSingle() }) }
})

vi.mock('@/lib/analytics', () => ({ track: vi.fn(), trackOnce: vi.fn() }))

/** Cart hydration for the current tab, resolved by `finishHydration()`. */
let finishHydration: () => void = () => {}
vi.mock('@/lib/cart-hydration', () => ({
  get cartHydrated() {
    return hydration
  },
  setCartHydrated: vi.fn(),
}))
let hydration: Promise<void> = Promise.resolve()

const catalog = [
  { id: 'CS106A', subject: 'CS', code: '106A', title: 'Programming Methodology', terms: ['Autumn 2026'], sections: [] },
  { id: 'CS103', subject: 'CS', code: '103', title: 'Math Foundations', terms: ['Autumn 2026'], sections: [] },
  { id: 'CS107', subject: 'CS', code: '107', title: 'Computer Organization', terms: ['Autumn 2026'], sections: [] },
]

const courseState = {
  courses: catalog,
  hasLoaded: true,
  isLoading: false,
  hasEnriched: true,
  fetchCourses: vi.fn(),
  fetchCourseDetails: vi.fn(),
  enrichedCourseIds: new Set<string>(),
}

vi.mock('@/lib/store', () => ({
  useCourseStore: {
    getState: () => courseState,
    subscribe: () => () => {},
  },
  getCoursesById: (courses: { id: string }[]) => new Map(courses.map(c => [c.id, c])),
}))

let cartItems: Record<string, unknown>[] = []
vi.mock('@/lib/cart-store', () => ({
  useCartStore: {
    getState: () => ({ items: cartItems }),
    setState: (updater: unknown) => {
      const next = typeof updater === 'function'
        ? (updater as (s: { items: unknown[] }) => { items: unknown[] })({ items: cartItems })
        : (updater as { items: Record<string, unknown>[] })
      cartItems = next.items as Record<string, unknown>[]
    },
  },
}))

function makeStorage(): Storage {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, String(v)) },
    removeItem: (k: string) => { map.delete(k) },
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() { return map.size },
  } as Storage
}

const USER = 'user-1'
const SAVED = [{ id: 'CS106A' }, { id: 'CS103' }]
const serverIds = () => (serverSchedule ?? []).map(i => i.id).sort()
const course = (id: string) => ({ ...catalog.find(c => c.id === id)!, selectedTerm: 'Autumn 2026' })

let currentTab: typeof import('@/lib/schedule-sync') | null = null

/** A fresh tab whose cart has not been read back from localStorage yet. */
async function openUnhydratedTab(storage = makeStorage()) {
  hydration = new Promise<void>(r => { finishHydration = r })
  vi.resetModules()
  ;(globalThis as { localStorage?: Storage }).localStorage = storage
  currentTab = await import('@/lib/schedule-sync')
  return currentTab
}

/** Lets every queued microtask (and the pull chained on them) run. */
const settle = () => new Promise(r => setTimeout(r, 0))

describe('flushPendingPush before the cart has loaded from localStorage', () => {
  beforeEach(() => {
    upsert.mockClear()
    selectSingle.mockClear()
    serverSchedule = SAVED.map(i => ({ ...i }))
    cartItems = []
  })

  afterEach(() => currentTab?.cancelDebouncedPush())

  it('pushes nothing when the tab is hidden before hydration', async () => {
    const tab = await openUnhydratedTab()
    await tab.flushPendingPush(USER)
    expect(upsert).not.toHaveBeenCalled()
    expect(serverIds()).toEqual(['CS103', 'CS106A'])
  })

  it('pushes nothing when hidden while a pull is waiting on hydration, even on a browser that synced this user before', async () => {
    const storage = makeStorage()
    storage.setItem('navigator-schedule-synced-user', USER)
    const tab = await openUnhydratedTab(storage)
    const pull = tab.pullSchedule(USER)
    await settle()
    await tab.flushPendingPush(USER)
    await tab.flushPendingPush(USER)
    expect(upsert).not.toHaveBeenCalled()
    expect(selectSingle).not.toHaveBeenCalled()

    // Hydration then lands with the persisted cart and the pull adopts the row.
    cartItems = [course('CS106A'), course('CS103')]
    finishHydration()
    await pull
    expect(serverIds()).toEqual(['CS103', 'CS106A'])
  })

  it('does not let an edit before hydration push the pre-hydration cart', async () => {
    const tab = await openUnhydratedTab()
    // Something sets the cart before persist has read it back (the store's
    // empty initial state plus one add). The edit triggers a pull, which must
    // wait for hydration instead of pushing.
    cartItems = [course('CS107')]
    tab.debouncedPush(USER)
    await settle()
    await tab.flushPendingPush(USER)
    expect(upsert).not.toHaveBeenCalled()

    finishHydration()
    await vi.waitFor(() => expect(upsert).toHaveBeenCalled())
    // The pull merges rather than replacing the saved courses.
    expect(serverIds()).toEqual(['CS103', 'CS106A', 'CS107'])
  })

  it('still flushes an edit once hydration and a pull have landed', async () => {
    const tab = await openUnhydratedTab()
    finishHydration()
    await tab.pullSchedule(USER)
    expect(serverIds()).toEqual(['CS103', 'CS106A'])
    upsert.mockClear()

    cartItems = [...cartItems, course('CS107')]
    tab.debouncedPush(USER)
    await tab.flushPendingPush(USER)
    expect(upsert).toHaveBeenCalledTimes(1)
    expect(serverIds()).toEqual(['CS103', 'CS106A', 'CS107'])
  })

  it('still flushes a removal once hydration and a pull have landed', async () => {
    const tab = await openUnhydratedTab()
    finishHydration()
    await tab.pullSchedule(USER)
    upsert.mockClear()

    cartItems = cartItems.filter(i => i.id !== 'CS103')
    // The removal's immediate push did not land (closing tab); the flush is
    // what has to carry it.
    await tab.flushPendingPush(USER)
    expect(upsert).toHaveBeenCalledTimes(1)
    expect(serverIds()).toEqual(['CS106A'])
  })
})
