import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Two devices (or a device and the MCP, or a tab running an older release)
 * saving the same `user_schedules` row. Every browser save used to be a blind
 * upsert of the whole list, so whichever device wrote last erased whatever the
 * other had saved since it last read the row. The audit probes of 2026-11-10
 * (P1 to P4 below) passed when that loss happened; here they assert it does not.
 *
 * Saves are now compare-and-set: write only if the row still holds what this
 * device last read or wrote, otherwise read it again, merge three ways and
 * retry. These drive the real module against one in-memory row that compares
 * the way Postgres compares jsonb.
 */

type ScheduleItem = { id: string; selectedTerm?: string; selectedUnits?: number; selectedSectionIds?: number[] }

let row: ScheduleItem[] | null = null
let failNextWrite = false
let holdSelect: Promise<void> | null = null
/** Runs once, right after a read returns, as if another device saved just then. */
let afterNextRead: (() => void) | null = null
/** When set, another writer changes the row right after every read this device makes. */
let rowChangesAfterEachRead = false
const calls: string[] = []

const upsert = vi.fn(async (payload: { user_id: string; schedule: ScheduleItem[] }) => {
  if (failNextWrite) {
    failNextWrite = false
    return { error: { message: 'offline' } }
  }
  row = payload.schedule.map(i => ({ ...i }))
  return { error: null }
})
const selectSingle = vi.fn(async (): Promise<unknown> => {
  const snapshot = row === null ? null : row.map(i => ({ ...i }))
  if (holdSelect) await holdSelect
  if (afterNextRead) {
    const hook = afterNextRead
    afterNextRead = null
    hook()
  }
  if (rowChangesAfterEachRead && row) row = [...row, { id: 'OTHER' + row.length }]
  return snapshot === null ? { data: null, error: { code: 'PGRST116' } } : { data: { schedule: snapshot }, error: null }
})

vi.mock('@/lib/supabase', async () => {
  const { fakeSupabase } = await import('./helpers/user-schedules-table')
  return {
    supabase: fakeSupabase({
      peek: () => row,
      write: upsert,
      read: () => selectSingle(),
      onCall: method => calls.push(method),
    }),
  }
})
vi.mock('@/lib/analytics', () => ({ track: vi.fn(), trackOnce: vi.fn() }))
vi.mock('@/lib/cart-hydration', () => ({ cartHydrated: Promise.resolve(), setCartHydrated: vi.fn() }))

const course = (id: string) => ({ id, subject: 'CS', code: id.slice(2), title: id, terms: ['Autumn 2026'], sections: [] })
const CATALOG_IDS = ['CS106A', 'CS103', 'CS107', 'CS109', 'CS111', 'CS161']
let catalog = CATALOG_IDS.map(course)

vi.mock('@/lib/store', () => ({
  useCourseStore: {
    getState: () => ({ courses: catalog, hasLoaded: true, isLoading: false, hasEnriched: true, fetchCourses: vi.fn(), fetchCourseDetails: vi.fn(), enrichedCourseIds: new Set() }),
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
        ? (updater as (s: { items: unknown[] }) => { items?: unknown[] })({ items: cartItems })
        : (updater as { items?: Record<string, unknown>[] })
      if (next.items) cartItems = next.items as Record<string, unknown>[]
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
const ids = () => cartItems.map(i => i.id as string).sort()
const serverIds = () => (row ?? []).map(i => i.id).sort()
const persist = () => cartItems.map(i => ({ id: i.id as string, selectedTerm: i.selectedTerm as string | undefined, selectedUnits: i.selectedUnits as number | undefined }))

let tab: typeof import('@/lib/schedule-sync') | null = null
/** A fresh page load of one device: new module state, that device's localStorage and persisted cart. */
async function openTab(storage: Storage, persistedCart: ScheduleItem[] = []) {
  vi.resetModules()
  ;(globalThis as { localStorage?: Storage }).localStorage = storage
  cartItems = persistedCart.map(i => ({ ...i }))
  tab = await import('@/lib/schedule-sync')
  return tab
}

/** What a tab still running the release before this change sends: the whole list, no condition. */
async function oldReleaseSaves(schedule: ScheduleItem[]) {
  const { supabase } = await import('@/lib/supabase')
  await supabase.from('user_schedules').upsert({ user_id: USER, schedule }, { onConflict: 'user_id' })
}

beforeEach(() => {
  upsert.mockClear()
  selectSingle.mockClear()
  row = null
  failNextWrite = false
  holdSelect = null
  afterNextRead = null
  rowChangesAfterEachRead = false
  calls.length = 0
  catalog = CATALOG_IDS.map(course)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  tab?.cancelDebouncedPush()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('the audit probes no longer lose data', () => {
  it('P1 a tab that stayed in front keeps what another device saved when it next edits', async () => {
    row = [{ id: 'CS106A' }, { id: 'CS103' }]
    const laptop = await openTab(makeStorage())
    await laptop.pullSchedule(USER)
    expect(ids()).toEqual(['CS103', 'CS106A'])

    // The phone adds two courses. The laptop window never loses focus.
    row = [{ id: 'CS106A' }, { id: 'CS103' }, { id: 'CS107' }, { id: 'CS109' }]

    vi.useFakeTimers()
    cartItems = [...cartItems, course('CS111')]
    laptop.debouncedPush(USER)
    await vi.advanceTimersByTimeAsync(1600)
    vi.useRealTimers()
    await vi.waitFor(() => expect(serverIds()).toEqual(['CS103', 'CS106A', 'CS107', 'CS109', 'CS111']))

    // The laptop now shows the phone's courses too.
    expect(ids()).toEqual(['CS103', 'CS106A', 'CS107', 'CS109', 'CS111'])
  })

  it('P2 an edit made while a re-read is in flight is merged with the newer row', async () => {
    row = [{ id: 'CS106A' }, { id: 'CS103' }]
    const laptop = await openTab(makeStorage())
    await laptop.pullSchedule(USER)

    row = [{ id: 'CS106A' }, { id: 'CS103' }, { id: 'CS107' }, { id: 'CS109' }]

    let release!: () => void
    holdSelect = new Promise<void>(r => { release = r })
    const pull = laptop.pullSchedule(USER, { force: true })
    await vi.waitFor(() => expect(selectSingle).toHaveBeenCalledTimes(2))
    cartItems = cartItems.filter(i => i.id !== 'CS103') // removed on the laptop, before the read returns
    release()
    holdSelect = null
    await pull

    // The laptop's removal and the phone's two adds both survive.
    expect(serverIds()).toEqual(['CS106A', 'CS107', 'CS109'])
    expect(ids()).toEqual(['CS106A', 'CS107', 'CS109'])
  })

  it('P3 an emptied row does not empty a device that still holds several courses', async () => {
    row = [{ id: 'CS106A' }, { id: 'CS103' }]
    const storage = makeStorage()
    const phone = await openTab(storage)
    await phone.pullSchedule(USER)
    const persisted = persist()

    // Some other client writes [] (the 2026-09-30 wipe, or any future bug).
    row = []

    const phoneAgain = await openTab(storage, persisted)
    await phoneAgain.pullSchedule(USER)
    expect(ids()).toEqual(['CS103', 'CS106A'])
    // And it puts them back, so the next device to load finds them.
    expect(serverIds()).toEqual(['CS103', 'CS106A'])
  })

  it('P3 the same holds for a tab that stays open and re-reads on focus', async () => {
    row = [{ id: 'CS106A' }, { id: 'CS103' }, { id: 'CS107' }]
    const laptop = await openTab(makeStorage())
    await laptop.pullSchedule(USER)
    row = []
    await laptop.pullSchedule(USER, { force: true })
    expect(ids()).toEqual(['CS103', 'CS106A', 'CS107'])
    expect(serverIds()).toEqual(['CS103', 'CS106A', 'CS107'])
  })

  it('P4 a saved course the catalog no longer lists survives a later merge', async () => {
    row = [{ id: 'CS106A' }, { id: 'CS999' }]
    const storage = makeStorage()
    const first = await openTab(storage)
    await first.pullSchedule(USER)
    const laptop = await openTab(storage, persist())
    await laptop.pullSchedule(USER)
    expect(ids()).toEqual(['CS106A'])
    expect(serverIds()).toEqual(['CS106A', 'CS999'])

    // An add on the laptop fails to save (offline), and another device adds a course meanwhile.
    cartItems = [...cartItems, course('CS103')]
    failNextWrite = true
    await laptop.flushAndPush(USER)
    row = [...row!, { id: 'CS107' }]

    await laptop.pullSchedule(USER, { force: true })
    expect(serverIds()).toEqual(['CS103', 'CS106A', 'CS107', 'CS999'])
    expect(ids()).toEqual(['CS103', 'CS106A', 'CS107'])
  })
})

describe('compare-and-set saves', () => {
  it('needs nothing new on the server, and a tab still on the old release cannot make the new one lose its save', async () => {
    row = [{ id: 'CS106A' }]
    const laptop = await openTab(makeStorage())
    await laptop.pullSchedule(USER)

    // A phone still running the previous release saves blind, as it always has.
    await oldReleaseSaves([{ id: 'CS106A' }, { id: 'CS103' }])
    expect(serverIds()).toEqual(['CS103', 'CS106A'])

    // The new release's save finds the row changed and merges instead of overwriting.
    cartItems = [...cartItems, course('CS107')]
    await laptop.flushAndPush(USER)
    expect(serverIds()).toEqual(['CS103', 'CS106A', 'CS107'])
    expect(ids()).toEqual(['CS103', 'CS106A', 'CS107'])

    // The new release used only reads, conditional updates and inserts, which
    // the live table's own-row select, insert and update policies already
    // allow. The one upsert is the old release's.
    expect(new Set(calls)).toEqual(new Set(['select', 'update', 'upsert']))
    expect(calls.filter(c => c === 'upsert')).toHaveLength(1)
  })

  it('treats a row created between its read and its first insert as a conflict and merges', async () => {
    const laptop = await openTab(makeStorage(), [{ id: 'CS106A' }])
    // The account has no row when the laptop reads; the phone creates one right after.
    afterNextRead = () => { row = [{ id: 'CS103' }] }
    await laptop.pullSchedule(USER)

    expect(calls).toEqual(['select', 'insert', 'select', 'update'])
    expect(serverIds()).toEqual(['CS103', 'CS106A'])
    expect(ids()).toEqual(['CS103', 'CS106A'])
  })

  it('inserts the first row when the account has none', async () => {
    const laptop = await openTab(makeStorage(), [{ id: 'CS106A' }])
    await laptop.pullSchedule(USER)
    expect(calls).toEqual(['select', 'insert'])
    expect(serverIds()).toEqual(['CS106A'])
  })

  it('gives up after a bounded number of attempts when the row keeps changing, and keeps the local edit', async () => {
    row = [{ id: 'CS106A' }]
    const laptop = await openTab(makeStorage())
    await laptop.pullSchedule(USER)

    cartItems = [...cartItems, course('CS103')]
    // Another device saved since this one last read, and keeps saving.
    row = [...row!, { id: 'CS107' }]
    rowChangesAfterEachRead = true
    calls.length = 0
    await laptop.flushAndPush(USER)

    const updates = calls.filter(c => c === 'update').length
    // The push's own write plus MAX_SAVE_ATTEMPTS merged writes, all refused.
    expect(updates).toBe(1 + laptop.MAX_SAVE_ATTEMPTS)
    expect(upsert).not.toHaveBeenCalled()
    expect(ids()).toEqual(['CS103', 'CS106A'])
  })

  it('saves an edit made while the merged write was in flight, after it', async () => {
    row = [{ id: 'CS106A' }]
    const laptop = await openTab(makeStorage())
    await laptop.pullSchedule(USER)
    row = [{ id: 'CS106A' }, { id: 'CS107' }]

    cartItems = [...cartItems, course('CS103')]
    let releaseWrite!: () => void
    upsert.mockImplementationOnce(payload => new Promise(r => {
      releaseWrite = () => { row = payload.schedule.map(i => ({ ...i })); r({ error: null }) }
    }))
    const pull = laptop.pullSchedule(USER, { force: true })
    await vi.waitFor(() => expect(upsert).toHaveBeenCalledTimes(1))
    cartItems = [...cartItems, course('CS109')] // the student adds another course meanwhile
    releaseWrite()
    await pull

    expect(ids()).toEqual(['CS103', 'CS106A', 'CS107', 'CS109'])
    await vi.waitFor(() => expect(serverIds()).toEqual(['CS103', 'CS106A', 'CS107', 'CS109']), { timeout: 3000 })
  })

  it('writes nothing on a re-read when nothing changed, even if the row comes back with its keys reordered', async () => {
    row = [{ id: 'CS106A', selectedTerm: 'Autumn 2026', selectedUnits: 5 }, { id: 'CS103' }]
    const laptop = await openTab(makeStorage())
    await laptop.pullSchedule(USER)
    // jsonb hands objects back with its own key order.
    row = [{ selectedUnits: 5, selectedTerm: 'Autumn 2026', id: 'CS106A' }, { id: 'CS103' }]
    await laptop.pullSchedule(USER, { force: true })
    await laptop.pullSchedule(USER, { force: true })
    expect(upsert).not.toHaveBeenCalled()
    await laptop.flushPendingPush(USER)
    expect(upsert).not.toHaveBeenCalled()
  })

  it('never reads a course another tab of this browser saved as removed here after a reload', async () => {
    row = [{ id: 'CS106A' }]
    const storage = makeStorage()
    const tabA = await openTab(storage)
    await tabA.pullSchedule(USER)

    // Tab A adds CS103 and saves it.
    cartItems = [...cartItems, course('CS103')]
    await tabA.flushAndPush(USER)
    expect(serverIds()).toEqual(['CS103', 'CS106A'])

    // Tab B never saw CS103. It adds CS107 and is closed before its save
    // lands, leaving its own list in this browser's localStorage. Then it is
    // opened again.
    const tabB = await openTab(storage, [{ id: 'CS106A' }, { id: 'CS107' }])
    await tabB.pullSchedule(USER)

    expect(serverIds()).toContain('CS103')
    expect(ids()).toContain('CS103')
  })

  /** `n` saved courses the catalog does not list, each as long as a real entry gets. */
  const longRow = (n: number) => Array.from({ length: n }, (_, i) => ({
    id: 'OLD' + i, selectedTerm: 'Autumn 2026', selectedSectionIds: [12345, 23456], selectedUnits: 5,
  }))

  it('compares a schedule as large as the largest saved one', async () => {
    // About 8,000 encoded characters, like the 5,204-character row of 2026-11-11.
    row = [{ id: 'CS106A' }, ...longRow(60)]
    const laptop = await openTab(makeStorage())
    await laptop.pullSchedule(USER)
    cartItems = [...cartItems, course('CS103')]
    calls.length = 0
    await laptop.flushAndPush(USER)
    expect(calls).toEqual(['update'])
    expect(serverIds()).toContain('CS103')
    expect(row).toHaveLength(62)
  })

  it('falls back to a plain save when the schedule is too large to compare in a URL', async () => {
    row = [{ id: 'CS106A' }, ...longRow(120)]
    const laptop = await openTab(makeStorage())
    await laptop.pullSchedule(USER)
    cartItems = [...cartItems, course('CS103')]
    calls.length = 0
    await laptop.flushAndPush(USER)
    // Not an update the gateway would refuse, so the save still lands.
    expect(calls).toEqual(['upsert'])
    expect(serverIds()).toContain('CS103')
    expect(row).toHaveLength(122)
  })

  it('does not write before this tab has read the row', async () => {
    row = [{ id: 'CS106A' }, { id: 'CS103' }]
    const laptop = await openTab(makeStorage(), [])
    await laptop.flushAndPush(USER)
    expect(calls).toEqual([])
    expect(serverIds()).toEqual(['CS103', 'CS106A'])
  })
})

describe('mergeSchedules', () => {
  let merge: typeof import('@/lib/schedule-sync').mergeSchedules
  beforeEach(async () => {
    merge = (await openTab(makeStorage())).mergeSchedules
  })
  const A = { id: 'A' }, B = { id: 'B' }, C = { id: 'C' }, D = { id: 'D' }
  const idsOf = (items: { id: string }[]) => items.map(i => i.id)

  it('keeps adds from both sides and applies removals from both sides', () => {
    // Base A B C. Here: removed B, added D. There: removed C, added... nothing.
    expect(idsOf(merge([A, B, C], [A, C, D], [A, B]))).toEqual(['A', 'D'])
  })

  it('is the union when there is no base', () => {
    expect(idsOf(merge(null, [A, B], [B, C]))).toEqual(['B', 'C', 'A'])
  })

  it('returns the row itself, untouched, when nothing changed on either side', () => {
    const theirs = [{ id: 'B', selectedUnits: 3 }, A]
    const result = merge([A, { id: 'B', selectedUnits: 3 }], [A, { selectedUnits: 3, id: 'B' }], theirs)
    expect(result).toEqual(theirs)
    expect(result[0]).toBe(theirs[0])
  })

  it('takes a section change from whichever side made it', () => {
    const base = [{ id: 'A', selectedSectionIds: [1] }]
    expect(merge(base, [{ id: 'A', selectedSectionIds: [2] }], base)).toEqual([{ id: 'A', selectedSectionIds: [2] }])
    expect(merge(base, base, [{ id: 'A', selectedSectionIds: [3] }])).toEqual([{ id: 'A', selectedSectionIds: [3] }])
    // Both changed it: this device wins.
    expect(merge(base, [{ id: 'A', selectedSectionIds: [2] }], [{ id: 'A', selectedSectionIds: [3] }])).toEqual([{ id: 'A', selectedSectionIds: [2] }])
  })

  it('reads the old single-section form as the same choice', () => {
    const legacy = [{ id: 'A', selectedSectionId: 7 }]
    const theirs = [{ id: 'A', selectedSectionId: 7 }]
    expect(merge(legacy, [{ id: 'A', selectedSectionIds: [7] }], theirs)[0]).toBe(theirs[0])
  })

  it('lets a removal win over an edit made on the other side', () => {
    const base = [A, { id: 'B', selectedUnits: 3 }]
    expect(idsOf(merge(base, [A, { id: 'B', selectedUnits: 4 }], [A]))).toEqual(['A'])
    expect(idsOf(merge(base, [A], [A, { id: 'B', selectedUnits: 4 }]))).toEqual(['A'])
  })

  it('lets an empty row clear one course but not several', () => {
    expect(idsOf(merge([A], [A], []))).toEqual([])
    expect(idsOf(merge([A, B], [A, B], []))).toEqual(['A', 'B'])
    // Courses this device added since are kept either way.
    expect(idsOf(merge([A], [A, D], []))).toEqual(['D'])
  })

  it('never returns the same course twice', () => {
    expect(idsOf(merge([A], [A, A, B], [A, C, C]))).toEqual(['A', 'C', 'B'])
  })
})
