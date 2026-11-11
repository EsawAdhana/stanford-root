import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase } from './helpers/user-schedules-table'

/**
 * A cart that is another account's saved schedule must never be merged into
 * the account signing in. Signed-out work merges (that is the point of the
 * merge), but a cart this tab or device last pulled as someone else is their
 * schedule, and merging it handed one student's classes to the next.
 *
 * One `user_schedules` row per account, driven through the real sync module.
 */

type Item = { id: string; selectedTerm?: string }
const rows = new Map<string, Item[]>()

const upsert = vi.fn(async (payload: { user_id: string; schedule: Item[] }) => {
  rows.set(payload.user_id, structuredClone(payload.schedule))
  return { error: null }
})

const table = fakeSupabase<Item>({
  peek: userId => rows.get(userId) ?? null,
  write: upsert,
  read: async userId => rows.has(userId)
    ? { data: { user_id: userId, schedule: structuredClone(rows.get(userId)) }, error: null }
    : { data: null, error: { code: 'PGRST116' } },
})

vi.mock('@/lib/supabase', () => ({ supabase: { from: (name: string) => table.from(name) } }))

vi.mock('@/lib/analytics', () => ({ track: vi.fn(), trackOnce: vi.fn() }))
vi.mock('@/lib/cart-hydration', () => ({ cartHydrated: Promise.resolve(), setCartHydrated: vi.fn() }))

const A = 'Autumn 2026'
const catalog = ['CS106A', 'CS103', 'CS107', 'MATH51'].map(id => ({ id, subject: id.replace(/\d.*/, ''), code: id.replace(/^[A-Z]+/, ''), title: id, terms: [A], sections: [] }))

vi.mock('@/lib/store', () => ({
  useCourseStore: {
    getState: () => ({ courses: catalog, hasLoaded: true, hasEnriched: true, fetchCourses: vi.fn(), fetchCourseDetails: vi.fn(), enrichedCourseIds: new Set() }),
    subscribe: () => () => {},
  },
  getCoursesById: (courses: { id: string }[]) => new Map(courses.map(c => [c.id, c])),
}))

let cart: { items: Item[]; plans: Record<string, unknown>; unresolved: Item[] } = { items: [], plans: {}, unresolved: [] }
vi.mock('@/lib/cart-store', () => ({
  useCartStore: {
    getState: () => cart,
    setState: (update: unknown) => {
      const next = typeof update === 'function' ? (update as (s: typeof cart) => Partial<typeof cart>)(cart) : (update as Partial<typeof cart>)
      cart = { ...cart, ...next }
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

async function loadTab(storage: Storage) {
  vi.resetModules()
  ;(globalThis as { localStorage?: Storage }).localStorage = storage
  return import('@/lib/schedule-sync')
}

const autumn = (...ids: string[]) => ids.map(id => ({ id, selectedTerm: A }))
const cartIds = () => cart.items.map(i => i.id).sort()

describe('a cart that belongs to another account', () => {
  beforeEach(() => {
    upsert.mockClear()
    rows.clear()
    rows.set('student-a', autumn('CS106A', 'CS103'))
    rows.set('student-b', autumn('MATH51'))
    cart = { items: [], plans: {}, unresolved: [] }
  })

  it('is replaced, not merged, when a tab that pulled as one student pulls as another', async () => {
    const sync = await loadTab(makeStorage())
    await sync.pullSchedule('student-a')
    expect(cartIds()).toEqual(['CS103', 'CS106A'])

    // Student B signs in on this browser and the tab never saw A sign out.
    await sync.pullSchedule('student-b')
    expect(cartIds()).toEqual(['MATH51'])
    expect(rows.get('student-b')!.map(i => i.id)).toEqual(['MATH51'])
    expect(upsert).not.toHaveBeenCalled()
  })

  it('is replaced when another tab\'s sign-out cleared the device marker but this tab never heard', async () => {
    const storage = makeStorage()
    const sync = await loadTab(storage)
    await sync.pullSchedule('student-a')
    // The other tab's sign-out cleared the marker; this tab missed the event.
    storage.removeItem('navigator-schedule-synced-user')
    await sync.pullSchedule('student-b')
    expect(cartIds()).toEqual(['MATH51'])
    expect(upsert).not.toHaveBeenCalled()
  })

  it('is replaced on a device whose last sync was another student, even after a reload', async () => {
    const storage = makeStorage()
    const first = await loadTab(storage)
    await first.pullSchedule('student-a')

    // A's session lapsed while the browser was closed: no sign-out ran, so the
    // persisted cart and the device marker are still A's.
    const persisted = structuredClone(cart)
    cart = persisted
    const second = await loadTab(storage)
    await second.pullSchedule('student-b')
    expect(cartIds()).toEqual(['MATH51'])
    expect(upsert).not.toHaveBeenCalled()
  })

  it('leaves the next account empty, not holding the old one, when it has no saved row', async () => {
    rows.delete('student-b')
    const sync = await loadTab(makeStorage())
    await sync.pullSchedule('student-a')
    cart = { ...cart, unresolved: [{ id: 'PHIL187C', selectedTerm: A }] }
    await sync.pullSchedule('student-b')
    expect(cart.items).toEqual([])
    expect(cart.unresolved).toEqual([])
    expect(rows.has('student-b')).toBe(false)
  })

  it('still merges a schedule built signed out into the account that signs in', async () => {
    const sync = await loadTab(makeStorage())
    cart = { ...cart, items: autumn('CS107') }
    await sync.pullSchedule('student-b')
    expect(cartIds()).toEqual(['CS107', 'MATH51'])
    expect(rows.get('student-b')!.map(i => i.id).sort()).toEqual(['CS107', 'MATH51'])
  })
})
