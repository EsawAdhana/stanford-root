import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PlansByTerm, SavedItem } from '@/lib/schedule-plans'
import { fakeSupabase } from './helpers/user-schedules-table'

/**
 * Plans on the saved row, driven through the real sync module against an
 * in-memory `user_schedules` row. Saves are conditional, as in production: an
 * update names the columns it writes and compares `schedule` and `plans` with
 * what the device last saw. A write that leaves out `plans` (an older tab, the
 * MCP) leaves them alone, as PostgREST does.
 *
 * Each device has its own cart, storage and copy of the sync module, so two
 * devices can hold different agreements with the row at the same time.
 */

const W = 'Winter 2027'

type Row = { schedule: SavedItem[]; plans?: PlansByTerm | null }
let row: Row | null = null

const upsert = vi.fn(async (payload: { user_id: string; schedule: SavedItem[]; plans?: unknown }) => {
  const { user_id: _userId, ...columns } = payload
  row = { ...(row ?? { schedule: [], plans: null }), ...(structuredClone(columns) as Partial<Row>) }
  return { error: null }
})

const selectSingle = vi.fn(async () => {
  if (row === null) return { data: null, error: { code: 'PGRST116' } }
  return { data: { schedule: structuredClone(row.schedule), plans: structuredClone(row.plans ?? null) }, error: null }
})

const table = fakeSupabase<SavedItem>({
  peek: () => (row ? row.schedule : null),
  peekPlans: () => row?.plans ?? null,
  write: upsert,
  read: () => selectSingle(),
})

vi.mock('@/lib/supabase', () => ({ supabase: { from: (name: string) => table.from(name) } }))

vi.mock('@/lib/analytics', () => ({ track: vi.fn(), trackOnce: vi.fn() }))
vi.mock('@/lib/cart-hydration', () => ({ cartHydrated: Promise.resolve(), setCartHydrated: vi.fn() }))

const catalog = ['CS229', 'CS161', 'CS255', 'CS107', 'MATH51', 'CS111'].map(id => ({
  id, subject: 'CS', code: id.slice(2), title: id, terms: [W], sections: [],
}))

vi.mock('@/lib/store', () => ({
  useCourseStore: {
    getState: () => ({ courses: catalog, hasLoaded: true, hasEnriched: true, fetchCourses: vi.fn(), fetchCourseDetails: vi.fn(), enrichedCourseIds: new Set() }),
    subscribe: () => () => {},
  },
}))

type Cart = { items: Record<string, unknown>[]; plans: PlansByTerm; unresolved: SavedItem[] }

/** The cart of whichever device is acting: the active plan's items and the parked plans, as the real store holds them. */
let cart: Cart = { items: [], plans: {}, unresolved: [] }
vi.mock('@/lib/cart-store', () => ({
  useCartStore: {
    getState: () => cart,
    setState: (update: unknown) => {
      const next = typeof update === 'function' ? (update as (s: Cart) => Partial<Cart>)(cart) : (update as Partial<Cart>)
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

type Sync = typeof import('@/lib/schedule-sync')

/**
 * One device. `load()` is a page load: storage and the persisted cart survive,
 * module state does not. `act()` makes it the device in front, with its own
 * cart and storage, for as long as the callback runs.
 */
function makeDevice() {
  const storage = makeStorage()
  let persisted: Cart = { items: [], plans: {}, unresolved: [] }
  let own: Cart = { items: [], plans: {}, unresolved: [] }
  let sync: Sync | null = null
  const device = {
    async load(): Promise<Sync> {
      vi.resetModules()
      ;(globalThis as { localStorage?: Storage }).localStorage = storage
      cart = structuredClone(persisted)
      sync = await import('@/lib/schedule-sync')
      own = cart
      return sync
    },
    park() {
      persisted = structuredClone({ items: cart.items.map(i => ({ id: i.id, selectedTerm: i.selectedTerm })), plans: cart.plans, unresolved: cart.unresolved })
    },
    async act<T>(fn: (sync: Sync) => Promise<T> | T): Promise<T> {
      if (!sync) await device.load()
      ;(globalThis as { localStorage?: Storage }).localStorage = storage
      cart = own
      try {
        return await fn(sync!)
      } finally {
        own = cart
      }
    },
    get cart() { return own },
  }
  return device
}

const USER = 'user-1'
const winter = (...ids: string[]) => ids.map(id => ({ id, selectedTerm: W }))
const ids = (c: Cart = cart) => c.items.map(i => i.id as string)
const rowIds = () => (row?.schedule ?? []).map(i => i.id)
const parkedIds = (plans: PlansByTerm | null | undefined, label: string) => (plans?.[W]?.parked[label] ?? []).map(i => i.id)

/** What the store's createPlan does: park the current Winter classes as A and make B active. */
function createPlanB() {
  cart = { ...cart, plans: { [W]: { order: ['A', 'B'], active: 'B', parked: { A: winter(...ids()) } } } }
}

/** What the store's switchPlan does, for Winter: park the classes on screen and bring `label` up. */
function switchTo(label: string) {
  const p = cart.plans[W]
  const parked = { ...p.parked, [p.active]: winter(...ids()) }
  const incoming = parked[label]
  delete parked[label]
  cart = { ...cart, items: incoming.map(i => ({ ...i })), plans: { [W]: { ...p, active: label, parked } } }
}

/** Adds classes to a parked plan, as the plan tabs' editor would after a switch and back. */
function addToParked(label: string, ...courseIds: string[]) {
  const p = cart.plans[W]
  cart = { ...cart, plans: { [W]: { ...p, parked: { ...p.parked, [label]: [...p.parked[label], ...winter(...courseIds)] } } } }
}

/** The previous release's save: `schedule` only, compared on `schedule` only. */
async function previousReleaseSave(next: SavedItem[], expected: SavedItem[]) {
  const { data } = await table.from('user_schedules').update({ schedule: next })
    .eq('user_id', USER).eq('schedule', JSON.stringify(expected)).select('user_id')
  return (data?.length ?? 0) > 0
}

describe('plans on the saved row', () => {
  beforeEach(() => {
    upsert.mockClear()
    selectSingle.mockClear()
    row = null
    cart = { items: [], plans: {}, unresolved: [] }
  })

  it('writes no plans column for a schedule without plans', async () => {
    row = { schedule: winter('CS229') }
    const laptop = makeDevice()
    const sync = await laptop.load()
    await sync.pullSchedule(USER)
    cart = { ...cart, items: [...cart.items, ...winter('CS161')] }
    await sync.flushAndPush(USER)
    expect(upsert).toHaveBeenLastCalledWith({ user_id: USER, schedule: winter('CS229', 'CS161') })
  })

  it('carries a plan made on the laptop to the phone', async () => {
    row = { schedule: winter('CS229', 'CS161') }
    const phone = makeDevice()
    let sync = await phone.load()
    await sync.pullSchedule(USER)
    phone.park()

    const laptop = makeDevice()
    sync = await laptop.load()
    await sync.pullSchedule(USER)
    createPlanB()
    cart = { ...cart, items: winter('CS229', 'CS255') }
    await sync.flushAndPush(USER)
    expect(rowIds()).toEqual(['CS229', 'CS255'])
    expect(parkedIds(row?.plans, 'A')).toEqual(['CS229', 'CS161'])

    sync = await phone.load()
    await sync.pullSchedule(USER)
    expect(ids()).toEqual(['CS229', 'CS255'])
    expect(cart.plans[W].active).toBe('B')
    expect(parkedIds(cart.plans, 'A')).toEqual(['CS229', 'CS161'])
  })

  it('adopts a switch made elsewhere instead of merging the two plans', async () => {
    row = { schedule: winter('CS229', 'CS255'), plans: { [W]: { order: ['A', 'B'], active: 'B', parked: { A: winter('CS229', 'CS161') } } } }
    const phone = makeDevice()
    const sync = await phone.load()
    await sync.pullSchedule(USER)

    // The laptop switches back to Plan A.
    row = { schedule: winter('CS229', 'CS161'), plans: { [W]: { order: ['A', 'B'], active: 'A', parked: { B: winter('CS229', 'CS255') } } } }
    await sync.pullSchedule(USER, { force: true })
    expect(ids()).toEqual(['CS229', 'CS161'])
    expect(cart.plans[W].active).toBe('A')
    expect(parkedIds(cart.plans, 'B')).toEqual(['CS229', 'CS255'])
  })

  it('leaves plans alone when a client that does not know them writes the schedule', async () => {
    row = { schedule: winter('CS229'), plans: { [W]: { order: ['A', 'B'], active: 'A', parked: { B: winter('CS255') } } } }
    // The MCP or a tab from before this release: it names only `schedule`.
    expect(await previousReleaseSave(winter('CS229', 'MATH51'), winter('CS229'))).toBe(true)
    expect(parkedIds(row?.plans, 'B')).toEqual(['CS255'])
    // A release from before conditional saves, too.
    await table.from('user_schedules').upsert({ user_id: USER, schedule: winter('CS107') })
    expect(parkedIds(row?.plans, 'B')).toEqual(['CS255'])
  })

  it('clears the row\'s plans when the last extra plan is deleted', async () => {
    row = { schedule: winter('CS229'), plans: { [W]: { order: ['A', 'B'], active: 'A', parked: { B: winter('CS255') } } } }
    const laptop = makeDevice()
    const sync = await laptop.load()
    await sync.pullSchedule(USER)
    cart = { ...cart, plans: {} }
    await sync.flushAndPush(USER)
    expect(row?.plans).toBeNull()
    expect(rowIds()).toEqual(['CS229'])
  })

  it('keeps plans built signed out when signing in to a saved schedule', async () => {
    row = { schedule: winter('CS107') }
    const fresh = makeDevice()
    const sync = await fresh.load()
    cart = { items: winter('CS229', 'CS255'), plans: { [W]: { order: ['A', 'B'], active: 'B', parked: { A: winter('CS161') } } }, unresolved: [] }
    await sync.pullSchedule(USER)
    expect(ids().sort()).toEqual(['CS107', 'CS229', 'CS255'])
    expect(parkedIds(cart.plans, 'A')).toEqual(['CS161'])
    expect(parkedIds(row?.plans, 'A')).toEqual(['CS161'])
    expect(rowIds().sort()).toEqual(['CS107', 'CS229', 'CS255'])
  })

  it('does not treat an empty plan beside a full one as an empty schedule', async () => {
    row = { schedule: winter('MATH51') }
    const fresh = makeDevice()
    const sync = await fresh.load()
    cart = { items: [], plans: { [W]: { order: ['A', 'B'], active: 'B', parked: { A: winter('CS229', 'CS161') } } }, unresolved: [] }
    await sync.pullSchedule(USER)
    expect(parkedIds(cart.plans, 'A')).toEqual(['CS229', 'CS161'])
    expect(parkedIds(row?.plans, 'A')).toEqual(['CS229', 'CS161'])
  })

  it('pushes a plan made while the row was being read', async () => {
    row = { schedule: winter('CS229') }
    const laptop = makeDevice()
    const sync = await laptop.load()
    await sync.pullSchedule(USER)
    selectSingle.mockImplementationOnce(async () => {
      createPlanB()
      return { data: { schedule: winter('CS229'), plans: null }, error: null }
    })
    await sync.pullSchedule(USER, { force: true })
    expect(row?.plans?.[W].active).toBe('B')
  })

  describe('two devices at once', () => {
    const twoPlans = () => ({ schedule: winter('CS229', 'CS161'), plans: { [W]: { order: ['A', 'B'], active: 'A', parked: { B: winter('CS255') } } } as PlansByTerm })

    it('keeps both edits when one device edits a parked plan and the other the open one', async () => {
      row = twoPlans()
      const laptop = makeDevice()
      const phone = makeDevice()
      await laptop.act(s => s.pullSchedule(USER))
      await phone.act(s => s.pullSchedule(USER))

      await laptop.act(async s => {
        addToParked('B', 'MATH51')
        await s.flushAndPush(USER)
      })
      // The phone still thinks Plan B is just CS255. Its save must not put that back.
      await phone.act(async s => {
        cart = { ...cart, items: [...cart.items, ...winter('CS107')] }
        await s.flushAndPush(USER)
      })

      expect(rowIds()).toEqual(['CS229', 'CS161', 'CS107'])
      expect(parkedIds(row?.plans, 'B')).toEqual(['CS255', 'MATH51'])
      expect(ids(phone.cart)).toEqual(['CS229', 'CS161', 'CS107'])
      expect(parkedIds(phone.cart.plans, 'B')).toEqual(['CS255', 'MATH51'])

      await laptop.act(s => s.pullSchedule(USER, { force: true }))
      expect(ids(laptop.cart)).toEqual(['CS229', 'CS161', 'CS107'])
      expect(parkedIds(laptop.cart.plans, 'B')).toEqual(['CS255', 'MATH51'])
    })

    it('merges two edits to the same parked plan class by class', async () => {
      row = { ...twoPlans(), plans: { [W]: { order: ['A', 'B'], active: 'A', parked: { B: winter('CS255', 'CS111') } } } }
      const laptop = makeDevice()
      const phone = makeDevice()
      await laptop.act(s => s.pullSchedule(USER))
      await phone.act(s => s.pullSchedule(USER))

      await laptop.act(async s => {
        addToParked('B', 'MATH51')
        await s.flushAndPush(USER)
      })
      await phone.act(async s => {
        const p = cart.plans[W]
        cart = { ...cart, plans: { [W]: { ...p, parked: { B: winter('CS111') } } } } // removed CS255 from Plan B
        await s.flushAndPush(USER)
      })
      expect(parkedIds(row?.plans, 'B')).toEqual(['CS111', 'MATH51'])
    })

    it('keeps a new plan made on each device under its own letter', async () => {
      row = twoPlans()
      const laptop = makeDevice()
      const phone = makeDevice()
      await laptop.act(s => s.pullSchedule(USER))
      await phone.act(s => s.pullSchedule(USER))

      await laptop.act(async s => {
        const p = cart.plans[W]
        cart = { ...cart, plans: { [W]: { ...p, order: ['A', 'B', 'C'], parked: { ...p.parked, C: winter('MATH51') } } } }
        await s.flushAndPush(USER)
      })
      await phone.act(async s => {
        const p = cart.plans[W]
        cart = { ...cart, plans: { [W]: { ...p, order: ['A', 'B', 'C'], parked: { ...p.parked, C: winter('CS107') } } } }
        await s.flushAndPush(USER)
      })
      expect(row?.plans?.[W].order).toEqual(['A', 'B', 'C', 'D'])
      expect(parkedIds(row?.plans, 'C')).toEqual(['MATH51'])
      expect(parkedIds(row?.plans, 'D')).toEqual(['CS107'])
    })

    it('loses nothing when one device switches plan while the other edits the plan it left', async () => {
      row = twoPlans()
      const laptop = makeDevice()
      const phone = makeDevice()
      await laptop.act(s => s.pullSchedule(USER))
      await phone.act(s => s.pullSchedule(USER))

      // The laptop switches to Plan B and saves first.
      await laptop.act(async s => {
        switchTo('B')
        await s.flushAndPush(USER)
      })
      expect(rowIds()).toEqual(['CS255'])
      expect(parkedIds(row?.plans, 'A')).toEqual(['CS229', 'CS161'])

      // The phone, still on Plan A, adds a class to it.
      await phone.act(async s => {
        cart = { ...cart, items: [...cart.items, ...winter('CS107')] }
        await s.flushAndPush(USER)
      })
      // The switch stands, and the class lands in Plan A, where it was added.
      expect(row?.plans?.[W].active).toBe('B')
      expect(rowIds()).toEqual(['CS255'])
      expect(parkedIds(row?.plans, 'A')).toEqual(['CS229', 'CS161', 'CS107'])
      expect(ids(phone.cart)).toEqual(['CS255'])

      await laptop.act(s => s.pullSchedule(USER, { force: true }))
      expect(parkedIds(laptop.cart.plans, 'A')).toEqual(['CS229', 'CS161', 'CS107'])
    })

    it('loses nothing when the edit lands first and the switch second', async () => {
      row = twoPlans()
      const laptop = makeDevice()
      const phone = makeDevice()
      await laptop.act(s => s.pullSchedule(USER))
      await phone.act(s => s.pullSchedule(USER))

      await phone.act(async s => {
        cart = { ...cart, items: [...cart.items, ...winter('CS107')] }
        await s.flushAndPush(USER)
      })
      // The laptop never saw CS107 and switches away from Plan A.
      await laptop.act(async s => {
        switchTo('B')
        await s.flushAndPush(USER)
      })
      expect(row?.plans?.[W].active).toBe('B')
      expect(rowIds()).toEqual(['CS255'])
      expect(parkedIds(row?.plans, 'A')).toEqual(['CS229', 'CS161', 'CS107'])
      expect(parkedIds(laptop.cart.plans, 'A')).toEqual(['CS229', 'CS161', 'CS107'])
    })

    it('keeps a plan added elsewhere when this device deletes down to one plan', async () => {
      row = twoPlans()
      const laptop = makeDevice()
      const phone = makeDevice()
      await laptop.act(s => s.pullSchedule(USER))
      await phone.act(s => s.pullSchedule(USER))

      // The laptop adds Plan C, then the phone deletes Plan B, which the laptop is not on.
      await laptop.act(async s => {
        const p = cart.plans[W]
        cart = { ...cart, plans: { [W]: { ...p, order: ['A', 'B', 'C'], parked: { ...p.parked, C: winter('MATH51') } } } }
        await s.flushAndPush(USER)
      })
      await phone.act(async s => {
        cart = { ...cart, plans: {} }
        await s.flushAndPush(USER)
      })
      expect(row?.plans?.[W].order).toEqual(['A', 'C'])
      expect(rowIds()).toEqual(['CS229', 'CS161'])
      expect(parkedIds(row?.plans, 'C')).toEqual(['MATH51'])
    })
  })

  describe('a tab still running the previous release', () => {
    const plansOpenOnB = () => ({ schedule: winter('CS255'), plans: { [W]: { order: ['A', 'B'], active: 'B', parked: { A: winter('CS229', 'CS161') } } } as PlansByTerm })

    it('puts its edit in the open plan and leaves the parked plans alone', async () => {
      row = plansOpenOnB()
      const laptop = makeDevice()
      await laptop.act(s => s.pullSchedule(USER))

      expect(await previousReleaseSave(winter('CS255', 'MATH51'), winter('CS255'))).toBe(true)
      expect(parkedIds(row?.plans, 'A')).toEqual(['CS229', 'CS161'])

      upsert.mockClear()
      await laptop.act(s => s.pullSchedule(USER, { force: true }))
      expect(ids(laptop.cart)).toEqual(['CS255', 'MATH51'])
      expect(parkedIds(laptop.cart.plans, 'A')).toEqual(['CS229', 'CS161'])
      // Nothing to write back: the merge is the row.
      expect(upsert).not.toHaveBeenCalled()
    })

    it('cannot save a list cached before the plan switch', async () => {
      row = plansOpenOnB()
      // Its cache is Plan A from before the switch, so its compare finds nothing.
      expect(await previousReleaseSave(winter('CS229', 'CS161', 'MATH51'), winter('CS229', 'CS161'))).toBe(false)
      expect(rowIds()).toEqual(['CS255'])
      expect(parkedIds(row?.plans, 'A')).toEqual(['CS229', 'CS161'])
    })

    it('keeps parked plans through a blind save from before conditional saves', async () => {
      row = plansOpenOnB()
      const laptop = makeDevice()
      await laptop.act(s => s.pullSchedule(USER))
      await table.from('user_schedules').upsert({ user_id: USER, schedule: winter('CS255', 'CS107') })
      await laptop.act(s => s.pullSchedule(USER, { force: true }))
      expect(ids(laptop.cart)).toEqual(['CS255', 'CS107'])
      expect(parkedIds(laptop.cart.plans, 'A')).toEqual(['CS229', 'CS161'])
      expect(parkedIds(row?.plans, 'A')).toEqual(['CS229', 'CS161'])
    })
  })

  describe('an emptied schedule with plans', () => {
    it('adopts the empty open plan from another device and keeps the parked one', async () => {
      row = { schedule: winter('CS229'), plans: { [W]: { order: ['A', 'B'], active: 'A', parked: { B: winter('CS255') } } } }
      const laptop = makeDevice()
      let sync = await laptop.load()
      await sync.pullSchedule(USER)
      laptop.park()

      // The phone removes the last class from Plan A while the laptop is closed.
      row = { ...row, schedule: [] }

      upsert.mockClear()
      sync = await laptop.load()
      await sync.pullSchedule(USER)
      expect(ids()).toEqual([])
      expect(parkedIds(cart.plans, 'B')).toEqual(['CS255'])
      expect(rowIds()).toEqual([])
      expect(upsert).not.toHaveBeenCalled()
    })

    it('adopts it in a tab that stayed open, too', async () => {
      row = { schedule: winter('CS229'), plans: { [W]: { order: ['A', 'B'], active: 'A', parked: { B: winter('CS255') } } } }
      const laptop = makeDevice()
      await laptop.act(s => s.pullSchedule(USER))
      row = { ...row, schedule: [] }
      await laptop.act(s => s.pullSchedule(USER, { force: true }))
      expect(ids(laptop.cart)).toEqual([])
      expect(parkedIds(laptop.cart.plans, 'B')).toEqual(['CS255'])
    })
  })
})

describe('mergeScheduleDocs with no base loses nothing either side built', () => {
  const S = 'Spring 2027'
  let mergeScheduleDocs: Sync['mergeScheduleDocs']
  beforeEach(async () => {
    ;({ mergeScheduleDocs } = await import('@/lib/schedule-sync'))
  })

  it('adds the row\'s classes to this device\'s active plan', () => {
    const merged = mergeScheduleDocs(
      null,
      { schedule: winter('CS229', 'CS255'), plans: { [W]: { order: ['A', 'B'], active: 'B', parked: { A: winter('CS229', 'CS161') } } } },
      { schedule: winter('CS107'), plans: {} },
    )
    expect(merged.schedule.map(i => i.id).sort()).toEqual(['CS107', 'CS229', 'CS255'])
    expect(parkedIds(merged.plans, 'A')).toEqual(['CS229', 'CS161'])
    expect(merged.plans[W].active).toBe('B')
  })

  it('puts classes built signed out into the plan the row had open', () => {
    const merged = mergeScheduleDocs(
      null,
      { schedule: winter('CS107'), plans: {} },
      { schedule: winter('CS229', 'CS255'), plans: { [W]: { order: ['A', 'B'], active: 'B', parked: { A: winter('CS161') } } } },
    )
    expect(merged.plans[W].active).toBe('B')
    expect(merged.schedule.map(i => i.id).sort()).toEqual(['CS107', 'CS229', 'CS255'])
    expect(parkedIds(merged.plans, 'A')).toEqual(['CS161'])
  })

  it('unions plan by plan and keeps this device\'s active plan', () => {
    const merged = mergeScheduleDocs(
      null,
      { schedule: winter('CS229'), plans: { [W]: { order: ['A', 'B'], active: 'A', parked: { B: winter('CS255') } } } },
      { schedule: winter('CS255', 'MATH51'), plans: { [W]: { order: ['A', 'B', 'C'], active: 'B', parked: { A: winter('CS161'), C: winter('CS107') } } } },
    )
    expect(merged.plans[W].order).toEqual(['A', 'B', 'C'])
    expect(merged.plans[W].active).toBe('A')
    expect(merged.schedule.map(i => i.id).sort()).toEqual(['CS161', 'CS229'])
    expect(parkedIds(merged.plans, 'B')).toEqual(['CS255', 'MATH51'])
    expect(parkedIds(merged.plans, 'C')).toEqual(['CS107'])
  })

  it('leaves terms without plans to the plain merge', () => {
    const merged = mergeScheduleDocs(
      null,
      { schedule: [...winter('CS229'), { id: 'CS107', selectedTerm: S }], plans: { [W]: { order: ['A', 'B'], active: 'A', parked: { B: [] } } } },
      { schedule: [{ id: 'MATH51', selectedTerm: S }, { id: 'CS107', selectedTerm: S, selectedUnits: 5 }], plans: {} },
    )
    const spring = merged.schedule.filter(i => i.selectedTerm === S).sort((a, b) => a.id.localeCompare(b.id))
    expect(spring).toEqual([{ id: 'CS107', selectedTerm: S }, { id: 'MATH51', selectedTerm: S }])
  })

  it('keeps one cart entry per course across terms, this device\'s first', () => {
    const merged = mergeScheduleDocs(
      null,
      { schedule: [{ id: 'CS229', selectedTerm: S }], plans: {} },
      { schedule: winter('CS229'), plans: { [W]: { order: ['A', 'B'], active: 'A', parked: { B: winter('CS229') } } } },
    )
    expect(merged.schedule.filter(i => i.id === 'CS229')).toEqual([{ id: 'CS229', selectedTerm: S }])
    // A parked plan may still hold the course: it is not on the cart.
    expect(parkedIds(merged.plans, 'B')).toEqual(['CS229'])
  })
})
