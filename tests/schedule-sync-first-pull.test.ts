import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * A tab that has not finished its first pull does not know what the saved
 * schedule is, so nothing it writes can be trusted over the row.
 *
 * The failure this pins down (2026-09-30): 28 signed-out tabs were open in one
 * browser and the student signed in from one of them. Every tab started a
 * pull, and each pull waits for the catalog before it can hydrate. A tab that
 * was hidden in that window ran flushPendingPush, which saw no last-synced
 * signature and pushed that tab's cart: empty, because the browser had never
 * held this schedule. The saved 16 courses were replaced by [] and every
 * device then adopted the empty row.
 *
 * These drive the real module against an in-memory `user_schedules` row with
 * a catalog that loads only when the test says so.
 */

type ScheduleItem = { id: string; selectedTerm?: string }

let serverSchedule: ScheduleItem[] | null = null

type UpsertResult = { error: { message: string } | null }

const upsert = vi.fn(async (payload: { user_id: string; schedule: ScheduleItem[] }): Promise<UpsertResult> => {
  serverSchedule = payload.schedule.map(i => ({ ...i }))
  return { error: null }
})
const selectSingle = vi.fn(async (): Promise<unknown> =>
  serverSchedule === null
    ? { data: null, error: { code: 'PGRST116' } }
    : { data: { schedule: serverSchedule.map(i => ({ ...i })) }, error: null }
)

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      upsert,
      select: () => ({ eq: () => ({ single: selectSingle }) }),
    }),
  },
}))

vi.mock('@/lib/analytics', () => ({ track: vi.fn(), trackOnce: vi.fn() }))
vi.mock('@/lib/cart-hydration', () => ({ cartHydrated: Promise.resolve(), setCartHydrated: vi.fn() }))

const catalog = [
  { id: 'CS106A', subject: 'CS', code: '106A', title: 'Programming Methodology', terms: ['Autumn 2026'], sections: [] },
  { id: 'CS103', subject: 'CS', code: '103', title: 'Math Foundations', terms: ['Autumn 2026'], sections: [] },
  { id: 'CS107', subject: 'CS', code: '107', title: 'Computer Organization', terms: ['Autumn 2026'], sections: [] },
]

/** The catalog store, which stays empty until `loadCatalog()`, like a tab still downloading it. */
const courseState = {
  courses: [] as typeof catalog,
  hasLoaded: false,
  hasEnriched: true,
  fetchCourses: vi.fn(),
  fetchCourseDetails: vi.fn(),
  enrichedCourseIds: new Set<string>(),
}
let courseListeners: ((s: typeof courseState) => void)[] = []
function loadCatalog() {
  courseState.courses = catalog
  courseState.hasLoaded = true
  for (const l of [...courseListeners]) l(courseState)
}

vi.mock('@/lib/store', () => ({
  useCourseStore: {
    getState: () => courseState,
    subscribe: (l: (s: typeof courseState) => void) => {
      courseListeners.push(l)
      return () => { courseListeners = courseListeners.filter(x => x !== l) }
    },
  },
  getCoursesById: (courses: { id: string }[]) => new Map(courses.map(c => [c.id, c])),
}))

/** This tab's in-memory cart. */
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
const ids = () => cartItems.map(i => i.id as string)
const serverIds = () => (serverSchedule ?? []).map(i => i.id)

let currentTab: typeof import('@/lib/schedule-sync') | null = null

/** A fresh tab: new module state, an empty catalog, and this browser's localStorage. */
async function openTab(storage = makeStorage()) {
  vi.resetModules()
  ;(globalThis as { localStorage?: Storage }).localStorage = storage
  currentTab = await import('@/lib/schedule-sync')
  return currentTab
}

/** Resolves once the tab's pull has read the row and is waiting on the catalog. */
async function pullIsWaitingOnCatalog() {
  await vi.waitFor(() => expect(courseState.fetchCourses).toHaveBeenCalled())
}

describe('a tab before its first pull lands', () => {
  beforeEach(() => {
    upsert.mockClear()
    selectSingle.mockClear()
    courseState.fetchCourses.mockClear()
    courseState.courses = []
    courseState.hasLoaded = false
    courseListeners = []
    serverSchedule = SAVED.map(i => ({ ...i }))
    cartItems = []
  })

  // A debounce left armed by one test must not fire into the next one's row.
  afterEach(() => currentTab?.cancelDebouncedPush())

  it('does not erase the saved schedule when hidden while the catalog loads', async () => {
    const tab = await openTab()
    const pull = tab.pullSchedule(USER)
    await pullIsWaitingOnCatalog()

    // Student switches to another tab.
    await tab.flushPendingPush(USER)

    expect(upsert).not.toHaveBeenCalled()
    expect(serverIds()).toEqual(['CS106A', 'CS103'])

    loadCatalog()
    await pull
    expect(ids()).toEqual(['CS106A', 'CS103'])
    expect(serverIds()).toEqual(['CS106A', 'CS103'])
  })

  it('does not erase the saved schedule when closed while the catalog loads', async () => {
    const tab = await openTab()
    void tab.pullSchedule(USER)
    await pullIsWaitingOnCatalog()

    // beforeunload: the tab goes away and its pull never finishes.
    await tab.flushPendingPush(USER)

    expect(upsert).not.toHaveBeenCalled()
    expect(serverIds()).toEqual(['CS106A', 'CS103'])
  })

  it('does not replace the saved schedule with a stale cache from an earlier visit', async () => {
    // This browser synced before, then CS107 was added and CS103 removed on
    // another device. Its persisted cart still holds the old list.
    const storage = makeStorage()
    storage.setItem('navigator-schedule-synced-user', USER)
    serverSchedule = [{ id: 'CS106A' }, { id: 'CS107' }]
    cartItems = [{ id: 'CS106A' }, { id: 'CS103' }]

    const tab = await openTab(storage)
    const pull = tab.pullSchedule(USER)
    await pullIsWaitingOnCatalog()
    await tab.flushPendingPush(USER)

    expect(upsert).not.toHaveBeenCalled()
    expect(serverIds()).toEqual(['CS106A', 'CS107'])

    loadCatalog()
    await pull
    expect(ids()).toEqual(['CS106A', 'CS107'])
  })

  it('does not push the empty cart after its first pull failed', async () => {
    const tab = await openTab()
    selectSingle.mockResolvedValueOnce({ data: null, error: { code: '500', message: 'upstream timeout' } })
    await tab.pullSchedule(USER)

    // Anything that writes the cart store fires the push subscription, even a
    // write that changes nothing.
    tab.debouncedPush(USER)
    await tab.flushPendingPush(USER)
    await vi.waitFor(() => expect(selectSingle).toHaveBeenCalledTimes(2))

    expect(upsert).not.toHaveBeenCalled()
    expect(serverIds()).toEqual(['CS106A', 'CS103'])
  })

  it('still saves a course added after its first pull failed', async () => {
    loadCatalog()
    const tab = await openTab()
    selectSingle.mockResolvedValueOnce({ data: null, error: { code: '500', message: 'upstream timeout' } })
    await tab.pullSchedule(USER)

    cartItems = [{ id: 'CS107' }] // student adds a course
    tab.debouncedPush(USER)

    // The add lands on top of the saved schedule rather than replacing it.
    // Long enough for the 1.5s push debounce, so this fails on what lands, not on timing.
    await vi.waitFor(() => expect(serverIds().sort()).toEqual(['CS103', 'CS106A', 'CS107']), { timeout: 3000 })
    expect(ids().sort()).toEqual(['CS103', 'CS106A', 'CS107'])
  })

  it('still saves a course added after a failed first pull on a browser that synced before', async () => {
    loadCatalog()
    const storage = makeStorage()
    storage.setItem('navigator-schedule-synced-user', USER)
    cartItems = [{ id: 'CS106A' }, { id: 'CS103' }]
    const tab = await openTab(storage)
    selectSingle.mockResolvedValueOnce({ data: null, error: { code: '500', message: 'upstream timeout' } })
    await tab.pullSchedule(USER)

    cartItems = [...cartItems, { id: 'CS107' }]
    tab.debouncedPush(USER)

    // A cache that was edited is work, so the row must not win over the add.
    await vi.waitFor(() => expect(serverIds().sort()).toEqual(['CS103', 'CS106A', 'CS107']), { timeout: 3000 })
  })

  it('lands a course added during its first read on top of the saved schedule', async () => {
    loadCatalog()
    const tab = await openTab()
    // The student adds a course while the row is still in flight.
    selectSingle.mockImplementationOnce(async () => {
      cartItems = [{ id: 'CS107' }]
      return { data: { schedule: SAVED.map(i => ({ ...i })) }, error: null }
    })
    await tab.pullSchedule(USER)

    expect(serverIds().sort()).toEqual(['CS103', 'CS106A', 'CS107'])
    expect(ids().sort()).toEqual(['CS103', 'CS106A', 'CS107'])
  })

  it('still pushes a removal made during a later re-read', async () => {
    loadCatalog()
    const tab = await openTab()
    await tab.pullSchedule(USER)
    expect(ids()).toEqual(['CS106A', 'CS103'])

    selectSingle.mockImplementationOnce(async () => {
      cartItems = [{ id: 'CS106A' }] // student removes CS103 mid-read
      return { data: { schedule: SAVED.map(i => ({ ...i })) }, error: null }
    })
    await tab.pullSchedule(USER, { force: true })

    expect(serverIds()).toEqual(['CS106A'])
    expect(ids()).toEqual(['CS106A'])
  })
})

describe('a tab signing out', () => {
  beforeEach(() => {
    upsert.mockClear()
    selectSingle.mockClear()
    serverSchedule = SAVED.map(i => ({ ...i }))
    cartItems = []
    loadCatalog()
  })

  afterEach(() => currentTab?.cancelDebouncedPush())

  it('does not erase the saved schedule when hidden while sign-out is in flight', async () => {
    const tab = await openTab()
    await tab.pullSchedule(USER)
    expect(ids()).toEqual(['CS106A', 'CS103'])

    // signOut(): suspend, clear the cart, then await the network sign-out.
    tab.suspendPush()
    cartItems = []
    // The student switches tabs before that request returns.
    await tab.flushPendingPush(USER)

    expect(upsert).not.toHaveBeenCalled()
    expect(serverIds()).toEqual(['CS106A', 'CS103'])
  })
})
