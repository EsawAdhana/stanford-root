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

const upsert = vi.fn(async (_payload: SchedulePayload) => ({ error: null }))
const selectSingle = vi.fn(async (): Promise<ScheduleRow> => ({ data: { schedule: [] }, error: null }))

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

const catalog = [{ id: 'CS106A', subject: 'CS', code: '106A', title: 'Programming Methodology', terms: ['Autumn 2026'], sections: [{ classId: 1801 }] }]

vi.mock('@/lib/store', () => ({
  useCourseStore: {
    getState: () => ({ courses: catalog, hasLoaded: true, fetchCourseDetails: vi.fn(), enrichedCourseIds: new Set() }),
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

describe('schedule sync keeps unresolvable saved courses', () => {
  beforeEach(() => {
    upsert.mockClear()
    cartItems = []
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
})
