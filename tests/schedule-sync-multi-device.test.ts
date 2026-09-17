import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Two devices, one account. The failure this pins down: a device that loaded
 * before a removal still has the course in its persisted cart, and the pull
 * merge unions local over server — so its next push resurrects a course the
 * user deleted on the other device. A delete can never win a union, because
 * "I removed this" and "I have not seen this yet" are the same local state.
 *
 * These drive the real module against a shared in-memory `user_schedules` row,
 * so each assertion is on what actually round-tripped between the devices.
 */

type ScheduleItem = { id: string; selectedTerm?: string; selectedUnits?: number }

/** The single `user_schedules` row both devices read and write. */
let serverSchedule: ScheduleItem[] | null = null

type UpsertResult = { error: { message: string } | null }

const upsert = vi.fn(async (payload: { user_id: string; schedule: ScheduleItem[] }): Promise<UpsertResult> => {
  serverSchedule = payload.schedule.map(i => ({ ...i }))
  return { error: null }
})
const selectSingle = vi.fn(async () =>
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
  { id: 'CS106A', subject: 'CS', code: '106A', title: 'Programming Methodology', terms: ['Autumn 2026'], sections: [{ classId: 1801 }] },
  { id: 'CS103', subject: 'CS', code: '103', title: 'Math Foundations', terms: ['Autumn 2026'], sections: [{ classId: 1802 }] },
]

vi.mock('@/lib/store', () => ({
  useCourseStore: {
    getState: () => ({ courses: catalog, hasLoaded: true, hasEnriched: true, fetchCourses: vi.fn(), fetchCourseDetails: vi.fn(), enrichedCourseIds: new Set() }),
    subscribe: () => () => {},
  },
  getCoursesById: (courses: { id: string }[]) => new Map(courses.map(c => [c.id, c])),
}))

/** Stands in for the device-local (localStorage-persisted) cart. */
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

/** A per-device localStorage. Devices must not share one. */
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

const ids = () => cartItems.map(i => i.id as string)
const serverIds = () => (serverSchedule ?? []).map(i => i.id)

/**
 * One device across its own page loads. Its localStorage and its persisted
 * cart survive a reload; module state does not. Only one device can be the
 * live module at a time, so a change made "on the other device" is applied to
 * `serverSchedule` directly — which is all the other device would have done.
 */
function makeDevice() {
  const storage = makeStorage()
  let persisted: ScheduleItem[] = []
  return {
    async load() {
      vi.resetModules()
      ;(globalThis as { localStorage?: Storage }).localStorage = storage
      cartItems = persisted.map(i => ({ ...i }))
      return import('@/lib/schedule-sync')
    },
    /** What this device would have left in localStorage when it went away. */
    park() {
      persisted = cartItems.map(i => ({ id: i.id as string, selectedTerm: i.selectedTerm as string | undefined }))
    },
  }
}

const USER = 'user-1'

describe('two devices on one account', () => {
  beforeEach(() => {
    upsert.mockClear()
    selectSingle.mockClear()
    serverSchedule = null
    cartItems = []
  })

  it('does not resurrect a course removed elsewhere when backgrounded', async () => {
    // Phone signs in and syncs, so its cart is a cache of the saved row.
    serverSchedule = [{ id: 'CS106A' }, { id: 'CS103' }]
    const phone = makeDevice()
    const b = await phone.load()
    await b.pullSchedule(USER)
    expect(ids()).toEqual(['CS106A', 'CS103'])

    // Laptop removes CS103.
    serverSchedule = [{ id: 'CS106A' }]

    // Phone screen locks / app switches, with no local edit of its own.
    upsert.mockClear()
    await b.flushPendingPush(USER)

    // No write at all: the phone has nothing of its own to say, and its whole
    // list would have carried CS103 back.
    expect(upsert).not.toHaveBeenCalled()
    expect(serverIds()).toEqual(['CS106A'])
  })

  it('adopts the removal when brought back to the foreground', async () => {
    serverSchedule = [{ id: 'CS106A' }, { id: 'CS103' }]
    const phone = makeDevice()
    const b = await phone.load()
    await b.pullSchedule(USER)

    serverSchedule = [{ id: 'CS106A' }]
    await b.pullSchedule(USER, { force: true })

    expect(ids()).toEqual(['CS106A'])
  })

  it('adopts the removal on reload instead of merging it back', async () => {
    serverSchedule = [{ id: 'CS106A' }, { id: 'CS103' }]
    const phone = makeDevice()
    const b = await phone.load()
    await b.pullSchedule(USER)
    phone.park()

    serverSchedule = [{ id: 'CS106A' }]
    const b2 = await phone.load()
    await b2.pullSchedule(USER)

    expect(ids()).toEqual(['CS106A'])
    await b2.flushPendingPush(USER)
    expect(serverIds()).toEqual(['CS106A'])
  })

  it('keeps a removal of the last course removed', async () => {
    serverSchedule = [{ id: 'CS106A' }]
    const phone = makeDevice()
    const b = await phone.load()
    await b.pullSchedule(USER)
    phone.park()

    // Laptop empties the schedule.
    serverSchedule = []
    const b2 = await phone.load()
    await b2.pullSchedule(USER)

    expect(ids()).toEqual([])
    await b2.flushPendingPush(USER)
    expect(serverIds()).toEqual([])
  })

  it('still flushes a real local edit on backgrounding', async () => {
    serverSchedule = [{ id: 'CS106A' }]
    const laptop = makeDevice()
    const a = await laptop.load()
    await a.pullSchedule(USER)

    cartItems = [...cartItems, { id: 'CS103' }] // user adds a course
    upsert.mockClear()
    await a.flushPendingPush(USER)

    expect(upsert).toHaveBeenCalled()
    expect(serverIds().sort()).toEqual(['CS103', 'CS106A'])
  })

  it('still merges a schedule built before signing in', async () => {
    // Never-synced device: the anonymous cart is real work, not a stale cache.
    serverSchedule = [{ id: 'CS103' }]
    const fresh = makeDevice()
    const c = await fresh.load()
    cartItems = [{ id: 'CS106A' }]
    await c.pullSchedule(USER)

    expect(ids().sort()).toEqual(['CS103', 'CS106A'])
    expect(serverIds().sort()).toEqual(['CS103', 'CS106A'])
  })

  it('merges again after a sign-out, when local is anonymous work once more', async () => {
    serverSchedule = [{ id: 'CS106A' }]
    const laptop = makeDevice()
    const a = await laptop.load()
    await a.pullSchedule(USER)

    // Sign out clears the cart; the student then builds a new schedule while
    // logged out. That is not a stale cache and must not be replaced.
    a.resetSyncState()
    cartItems = [{ id: 'CS103' }]
    await a.pullSchedule(USER)

    expect(ids().sort()).toEqual(['CS103', 'CS106A'])
  })

  it('does not let a foreground re-read discard an edit that never reached the server', async () => {
    serverSchedule = [{ id: 'CS106A' }]
    const laptop = makeDevice()
    const a = await laptop.load()
    await a.pullSchedule(USER)

    // Student adds a course, but the write fails — offline, dead wifi.
    cartItems = [...cartItems, { id: 'CS103' }]
    upsert.mockImplementationOnce(async () => ({ error: { message: 'offline' } }))
    await a.flushAndPush(USER)
    expect(serverIds()).toEqual(['CS106A'])

    // Tab comes back to the foreground and re-reads. The unsynced add is real
    // work and has to survive, then land.
    await a.pullSchedule(USER, { force: true })

    expect(ids().sort()).toEqual(['CS103', 'CS106A'])
    expect(serverIds().sort()).toEqual(['CS103', 'CS106A'])
  })

  it('does not wipe local when the account has no saved row yet', async () => {
    serverSchedule = [{ id: 'CS106A' }]
    const laptop = makeDevice()
    const a = await laptop.load()
    await a.pullSchedule(USER)
    expect(ids()).toEqual(['CS106A'])
    laptop.park()

    // Row vanishes (fresh project, RLS hiccup, manual delete). Ambiguous, so
    // the local schedule is the only copy left and must survive.
    serverSchedule = null
    const a2 = await laptop.load()
    await a2.pullSchedule(USER)

    expect(ids()).toEqual(['CS106A'])
    expect(serverIds()).toEqual(['CS106A'])
  })
})
