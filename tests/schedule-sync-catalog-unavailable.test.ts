import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * A pull hydrates the saved schedule against the course catalog. When the
 * catalog load failed (the store sets `hasLoaded` with no courses) or took
 * longer than the 10s wait, every saved course came back unresolved and the
 * pull set the visible cart to [], with the "missing from the catalog" notice
 * listing the whole schedule. The pull must leave the cart alone instead and
 * try again later.
 */

type ScheduleItem = { id: string }

let serverSchedule: ScheduleItem[] = []
const upsert = vi.fn(async (payload: { schedule: ScheduleItem[] }) => {
  serverSchedule = payload.schedule.map(i => ({ ...i }))
  return { error: null }
})
const selectSingle = vi.fn(async () => ({ data: { schedule: serverSchedule.map(i => ({ ...i })) }, error: null }))

// Saves are compare-and-set against the row above; `upsert` is still the spy every write goes through.
vi.mock('@/lib/supabase', async () => {
  const { fakeSupabase } = await import('./helpers/user-schedules-table')
  return { supabase: fakeSupabase({ peek: () => serverSchedule, write: upsert, read: () => selectSingle() }) }
})
vi.mock('@/lib/analytics', () => ({ track: vi.fn(), trackOnce: vi.fn() }))
vi.mock('@/lib/cart-hydration', () => ({ cartHydrated: Promise.resolve(), setCartHydrated: vi.fn() }))

const catalog = [
  { id: 'CS106A', subject: 'CS', code: '106A', title: 'Programming Methodology', terms: ['Autumn 2026'], sections: [] },
  { id: 'CS103', subject: 'CS', code: '103', title: 'Math Foundations', terms: ['Autumn 2026'], sections: [] },
]

type CourseState = { courses: typeof catalog; hasLoaded: boolean; isLoading: boolean; hasEnriched: boolean; fetchCourses: ReturnType<typeof vi.fn>; fetchCourseDetails: ReturnType<typeof vi.fn>; enrichedCourseIds: Set<string> }
const courseState: CourseState = {
  courses: [], hasLoaded: false, isLoading: false, hasEnriched: true,
  fetchCourses: vi.fn(), fetchCourseDetails: vi.fn(), enrichedCourseIds: new Set(),
}
let listeners: ((s: CourseState) => void)[] = []
function setCourses(patch: Partial<CourseState>) {
  Object.assign(courseState, patch)
  for (const l of [...listeners]) l(courseState)
}

vi.mock('@/lib/store', () => ({
  useCourseStore: {
    getState: () => courseState,
    subscribe: (l: (s: CourseState) => void) => {
      listeners.push(l)
      return () => { listeners = listeners.filter(x => x !== l) }
    },
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

const USER = 'user-1'
const ids = () => cartItems.map(i => i.id as string)

/** A browser that has synced as USER before, holding the saved schedule as its cache. */
async function openSyncedTab() {
  vi.resetModules()
  const map = new Map<string, string>([['navigator-schedule-synced-user', USER]])
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v) },
    removeItem: (k: string) => { map.delete(k) },
  }
  return import('@/lib/schedule-sync')
}

describe('a pull when the catalog is unavailable', () => {
  beforeEach(() => {
    upsert.mockClear()
    selectSingle.mockClear()
    courseState.fetchCourses.mockReset()
    listeners = []
    serverSchedule = [{ id: 'CS106A' }, { id: 'CS103' }]
    cartItems = [{ id: 'CS106A', title: 'Programming Methodology' }, { id: 'CS103', title: 'Math Foundations' }]
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => vi.useRealTimers())

  it('keeps the cart when the catalog load failed', async () => {
    // What the store holds after a failed first load.
    Object.assign(courseState, { courses: [], hasLoaded: true, isLoading: false })
    // The retry fails too.
    courseState.fetchCourses.mockImplementation(async () => {
      setCourses({ isLoading: true })
      setCourses({ isLoading: false })
    })
    const tab = await openSyncedTab()
    await tab.pullSchedule(USER)

    expect(courseState.fetchCourses).toHaveBeenCalled()
    expect(ids()).toEqual(['CS106A', 'CS103'])
    expect(upsert).not.toHaveBeenCalled()
  })

  it('keeps the cart when the catalog takes longer than the wait', async () => {
    vi.useFakeTimers()
    Object.assign(courseState, { courses: [], hasLoaded: false, isLoading: true })
    const tab = await openSyncedTab()
    const pull = tab.pullSchedule(USER)
    await vi.advanceTimersByTimeAsync(10_001)
    await pull

    expect(ids()).toEqual(['CS106A', 'CS103'])
    expect(upsert).not.toHaveBeenCalled()
  })

  it('pulls again later and hydrates once the catalog is back', async () => {
    Object.assign(courseState, { courses: [], hasLoaded: true, isLoading: false })
    courseState.fetchCourses.mockImplementation(async () => {
      setCourses({ isLoading: true })
      setCourses({ isLoading: false })
    })
    const tab = await openSyncedTab()
    await tab.pullSchedule(USER)
    expect(ids()).toEqual(['CS106A', 'CS103'])

    // The row changed elsewhere meanwhile; the failed pull did not count as landed.
    serverSchedule = [{ id: 'CS106A' }]
    courseState.fetchCourses.mockImplementation(async () => {
      setCourses({ isLoading: true })
      setCourses({ courses: catalog, isLoading: false })
    })
    await tab.pullSchedule(USER)
    expect(ids()).toEqual(['CS106A'])
  })

  it('a retry that succeeds within the wait hydrates in the same pull', async () => {
    Object.assign(courseState, { courses: [], hasLoaded: true, isLoading: false })
    courseState.fetchCourses.mockImplementation(async () => {
      setCourses({ isLoading: true })
      setCourses({ courses: catalog, isLoading: false })
    })
    serverSchedule = [{ id: 'CS103' }]
    const tab = await openSyncedTab()
    await tab.pullSchedule(USER)
    expect(ids()).toEqual(['CS103'])
  })
})
