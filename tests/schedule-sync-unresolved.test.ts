import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * The destructive path: a saved course the catalog cannot resolve is dropped
 * from the cart, and the cart is what gets pushed back to `user_schedules`.
 * Without the guard the row is erased server-side, which is not something a
 * later catalog fix can undo. These drive the real module with Supabase and the
 * catalog stubbed, so the assertion is on the payload actually upserted.
 */

type SchedulePayload = { user_id: string; schedule: { id: string }[] }
type ScheduleRow = { data: { schedule: { id: string; selectedTerm?: string }[] } | null; error: null }

/** The stored row: whatever the last read returned or the last write stored. */
let row: SchedulePayload['schedule'] | null = []
const upsert = vi.fn(async (payload: SchedulePayload) => {
  row = payload.schedule
  return { error: null }
})
const selectSingle = vi.fn(async (): Promise<ScheduleRow> => ({ data: { schedule: [] }, error: null }))

// Saves are compare-and-set against `row`; `upsert` is still the spy every write goes through.
vi.mock('@/lib/supabase', async () => {
  const { fakeSupabase } = await import('./helpers/user-schedules-table')
  return {
    supabase: fakeSupabase({
      peek: () => row,
      write: upsert,
      read: async () => {
        const result = await selectSingle()
        row = result.data?.schedule ?? null
        return result
      },
    }),
  }
})

vi.mock('@/lib/analytics', () => ({ track: vi.fn(), trackOnce: vi.fn() }))
vi.mock('@/lib/cart-hydration', () => ({ cartHydrated: Promise.resolve(), setCartHydrated: vi.fn() }))

const catalog = [{ id: 'CS106A', subject: 'CS', code: '106A', title: 'Programming Methodology', terms: ['Autumn 2026'], sections: [{ classId: 1801 }] }]

vi.mock('@/lib/store', () => ({
  useCourseStore: {
    getState: () => ({ courses: catalog, hasLoaded: true, fetchCourseDetails: vi.fn(), enrichedCourseIds: new Set() }),
    subscribe: () => () => {},
  },
  getCoursesById: (courses: { id: string }[]) => new Map(courses.map(c => [c.id, c])),
}))

let cartItems: Record<string, unknown>[] = []
/** Saved entries the catalog cannot draw, which the real store keeps beside `items`. */
let cartUnresolved: { id: string }[] = []
vi.mock('@/lib/cart-store', () => ({
  useCartStore: {
    getState: () => ({ items: cartItems, unresolved: cartUnresolved }),
    setState: (updater: unknown) => {
      type Cart = { items?: Record<string, unknown>[]; unresolved?: { id: string }[] }
      const next = typeof updater === 'function'
        ? (updater as (s: Cart) => Cart)({ items: cartItems, unresolved: cartUnresolved })
        : (updater as Cart)
      if (next.items) cartItems = next.items
      if (next.unresolved) cartUnresolved = next.unresolved
    },
  },
}))

describe('schedule sync keeps unresolvable saved courses', () => {
  beforeEach(() => {
    upsert.mockClear()
    cartItems = []
    cartUnresolved = []
  })

  it('pushes back a course the catalog dropped, instead of erasing it', async () => {
    // Server has a course that left the catalog plus one that survived.
    selectSingle.mockResolvedValueOnce({
      data: { schedule: [{ id: 'CS224U', selectedTerm: 'Spring 2027' }, { id: 'CS106A', selectedTerm: 'Autumn 2026' }] },
      error: null,
    })

    const { pullSchedule, flushAndPush } = await import('@/lib/schedule-sync')
    await pullSchedule('user-1')

    // The cart only carries what the catalog can render...
    expect(cartItems.map(i => i.id)).toEqual(['CS106A'])

    // The pull itself writes nothing; the erasure would land on the next push,
    // which any later edit triggers. That is the write to check.
    await flushAndPush('user-1')
    expect(upsert).toHaveBeenCalled()
    for (const [payload] of upsert.mock.calls) {
      expect(payload.schedule.map(item => item.id)).toContain('CS224U')
    }
  })

  it('keeps every field of an undrawable entry, including a legacy single section', async () => {
    selectSingle.mockResolvedValueOnce({
      data: { schedule: [{ id: 'CS224U', selectedTerm: 'Spring 2027', selectedSectionId: 7154, selectedUnits: 4, color: 'blue' } as never] },
      error: null,
    })
    const { pullSchedule } = await import('@/lib/schedule-sync')
    await pullSchedule('user-3')
    expect(cartUnresolved).toEqual([{ id: 'CS224U', selectedTerm: 'Spring 2027', selectedSectionIds: [7154], selectedUnits: 4, color: 'blue' }])
  })

  it('keeps what this device already held undrawn when a merge hydrates only the row\'s extras', async () => {
    // A device that has not synced as this user, holding a class plus a saved
    // entry the catalog cannot draw (a plan switch or an earlier load put it there).
    cartItems = [{ id: 'CS106A', selectedTerm: 'Autumn 2026' }]
    cartUnresolved = [{ id: 'CS224U', selectedTerm: 'Spring 2027' } as { id: string }]
    selectSingle.mockResolvedValueOnce({
      data: { schedule: [{ id: 'CS106A', selectedTerm: 'Autumn 2026' }, { id: 'PHIL187C', selectedTerm: 'Autumn 2026' }] },
      error: null,
    })
    // A fresh tab: one that already pulled as another account would rightly refuse to merge.
    vi.resetModules()
    const { pullSchedule } = await import('@/lib/schedule-sync')
    await pullSchedule('user-2')
    expect(cartUnresolved.map(i => i.id).sort()).toEqual(['CS224U', 'PHIL187C'])
    const pushed = upsert.mock.calls.at(-1)![0].schedule.map(item => item.id).sort()
    expect(pushed).toEqual(['CS106A', 'CS224U', 'PHIL187C'])
  })
})
