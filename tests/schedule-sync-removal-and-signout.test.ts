import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Two ways the sync used to put the wrong schedule in the cart.
 *
 * A removal whose push failed (or had not landed yet) came back on the next
 * pull: the cart differed from the last sync, so the pull merged, and the
 * union re-added the course the row still listed.
 *
 * A pull still running at sign-out wrote the signed-out user's schedule back
 * into the cart that sign-out had just cleared, and marked the device synced
 * for them.
 *
 * These drive the real module against an in-memory `user_schedules` row.
 */

type ScheduleItem = { id: string }

const rows = new Map<string, ScheduleItem[]>()
let failPushes = 0
const upsert = vi.fn(async (payload: { user_id: string; schedule: ScheduleItem[] }) => {
  if (failPushes > 0) {
    failPushes--
    return { error: { message: 'network' } }
  }
  rows.set(payload.user_id, payload.schedule.map(i => ({ ...i })))
  return { error: null }
})
/** Lets a test hold a read open to act while it is in flight. */
let beforeRead: (() => Promise<void>) | null = null
const read = vi.fn(async (userId: string) => {
  if (beforeRead) {
    const hook = beforeRead
    beforeRead = null
    await hook()
  }
  const row = rows.get(userId)
  return row ? { data: { schedule: row.map(i => ({ ...i })) }, error: null } : { data: null, error: { code: 'PGRST116' } }
})

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      upsert,
      select: () => ({ eq: (_col: string, userId: string) => ({ single: () => read(userId) }) }),
    }),
  },
}))
vi.mock('@/lib/analytics', () => ({ track: vi.fn(), trackOnce: vi.fn() }))
vi.mock('@/lib/cart-hydration', () => ({ cartHydrated: Promise.resolve(), setCartHydrated: vi.fn() }))

const catalog = ['CS106A', 'CS103', 'CS107', 'MATH51'].map(id => ({ id, subject: id.replace(/\d.*/, ''), code: id.replace(/^\D+/, ''), terms: [], sections: [] }))
vi.mock('@/lib/store', () => ({
  useCourseStore: {
    getState: () => ({ courses: catalog, hasLoaded: true, isLoading: false, hasEnriched: true, fetchCourses: vi.fn(), fetchCourseDetails: vi.fn(), enrichedCourseIds: new Set() }),
    subscribe: () => () => {},
  },
  getCoursesById: (courses: { id: string }[]) => new Map(courses.map(c => [c.id, c])),
}))

let cart: Record<string, unknown>[] = []
vi.mock('@/lib/cart-store', () => ({
  useCartStore: {
    getState: () => ({ items: cart }),
    setState: (updater: unknown) => {
      const next = typeof updater === 'function'
        ? (updater as (s: { items: unknown[] }) => { items: unknown[] })({ items: cart })
        : (updater as { items: Record<string, unknown>[] })
      cart = next.items as Record<string, unknown>[]
    },
  },
}))

const storage = new Map<string, string>()
;(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => { storage.set(k, v) },
  removeItem: (k: string) => { storage.delete(k) },
}

const ids = () => cart.map(i => i.id as string).sort()
const rowIds = (u: string) => (rows.get(u) ?? []).map(i => i.id).sort()
const settle = () => new Promise(r => setTimeout(r, 0))

async function openTab() {
  vi.resetModules()
  return import('@/lib/schedule-sync')
}

beforeEach(() => {
  rows.clear()
  storage.clear()
  cart = []
  failPushes = 0
  beforeRead = null
  upsert.mockClear()
  read.mockClear()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('a removal made on this device', () => {
  it('stays removed when its push failed and the window regains focus', async () => {
    rows.set('u1', [{ id: 'CS106A' }, { id: 'CS103' }])
    const sync = await openTab()
    await sync.pullSchedule('u1')
    expect(ids()).toEqual(['CS103', 'CS106A'])

    cart = cart.filter(i => i.id !== 'CS103')
    failPushes = 1
    sync.debouncedPush('u1') // removal pushes immediately, and fails
    await settle()

    await sync.pullSchedule('u1', { force: true })
    expect(ids()).toEqual(['CS106A'])
    expect(rowIds('u1')).toEqual(['CS106A'])
  })

  it('stays removed when the pull reads the row before its push lands', async () => {
    rows.set('u1', [{ id: 'CS106A' }, { id: 'CS103' }])
    const sync = await openTab()
    await sync.pullSchedule('u1')
    // An earlier edit, so the push code knows the count and pushes the
    // removal at once instead of debouncing it (a debounce is flushed first).
    sync.debouncedPush('u1')
    sync.cancelDebouncedPush()

    // Hold the removal's push until the pull has read the old row.
    let releasePush!: () => void
    upsert.mockImplementationOnce(payload => new Promise(r => {
      releasePush = () => { rows.set(payload.user_id, payload.schedule.map(i => ({ ...i }))); r({ error: null }) }
    }))
    cart = cart.filter(i => i.id !== 'CS103')
    sync.debouncedPush('u1')
    await sync.pullSchedule('u1', { force: true })
    releasePush()
    await settle()

    expect(ids()).toEqual(['CS106A'])
    expect(rowIds('u1')).toEqual(['CS106A'])
  })

  it('still takes a course another device added', async () => {
    rows.set('u1', [{ id: 'CS106A' }, { id: 'CS103' }])
    const sync = await openTab()
    await sync.pullSchedule('u1')

    cart = cart.filter(i => i.id !== 'CS103')
    failPushes = 1
    sync.debouncedPush('u1')
    await settle()
    rows.set('u1', [{ id: 'CS106A' }, { id: 'CS103' }, { id: 'MATH51' }]) // added elsewhere

    await sync.pullSchedule('u1', { force: true })
    expect(ids()).toEqual(['CS106A', 'MATH51'])
    expect(rowIds('u1')).toEqual(['CS106A', 'MATH51'])
  })

  it('is not undone by the row when the merged push also fails', async () => {
    rows.set('u1', [{ id: 'CS106A' }, { id: 'CS103' }])
    const sync = await openTab()
    await sync.pullSchedule('u1')

    cart = cart.filter(i => i.id !== 'CS103')
    failPushes = 2 // the removal's push and the merge's push
    sync.debouncedPush('u1')
    await settle()
    await sync.pullSchedule('u1', { force: true })
    expect(ids()).toEqual(['CS106A'])

    // Network back. The next pull must merge again, not let the stale row win.
    await sync.pullSchedule('u1', { force: true })
    expect(ids()).toEqual(['CS106A'])
    expect(rowIds('u1')).toEqual(['CS106A'])
  })

  it('a schedule built before signing in still merges with the row', async () => {
    rows.set('u1', [{ id: 'CS106A' }])
    cart = [{ id: 'CS107' }]
    const sync = await openTab()
    await sync.pullSchedule('u1')
    expect(ids()).toEqual(['CS106A', 'CS107'])
    expect(rowIds('u1')).toEqual(['CS106A', 'CS107'])
  })
})

describe('a pull still running at sign-out', () => {
  it('does not write the signed-out schedule back into the cart', async () => {
    rows.set('u1', [{ id: 'CS106A' }, { id: 'CS103' }])
    const sync = await openTab()
    beforeRead = async () => {
      // signOut(): suspend, clear the cart, sign-out request, reset.
      sync.suspendPush()
      cart = []
      sync.resetSyncState()
    }
    await sync.pullSchedule('u1')

    expect(ids()).toEqual([])
    expect(storage.get('navigator-schedule-synced-user')).toBeUndefined()
    expect(upsert).not.toHaveBeenCalled()
  })

  it('does not hand its result to the next user who signs in', async () => {
    rows.set('u1', [{ id: 'CS106A' }])
    rows.set('u2', [{ id: 'MATH51' }])
    const sync = await openTab()
    let second!: Promise<void>
    beforeRead = async () => {
      sync.suspendPush()
      cart = []
      sync.resetSyncState()
      second = sync.pullSchedule('u2')
    }
    await sync.pullSchedule('u1')
    await second

    expect(ids()).toEqual(['MATH51'])
    expect(storage.get('navigator-schedule-synced-user')).toBe('u2')
    expect(rowIds('u1')).toEqual(['CS106A'])
  })
})
