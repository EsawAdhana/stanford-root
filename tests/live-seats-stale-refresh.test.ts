import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * useLiveSeats refreshes when the tab regains focus, without an abort signal.
 * A refresh started before the student switched terms could land after the
 * new term's load and overwrite it, and since class numbers repeat across
 * terms its counts showed on the new term's sections.
 *
 * There is no React renderer in this repo's tests, so this drives the hook
 * through a minimal stand-in for the four React hooks it uses.
 */

type Effect = { deps: unknown[] | undefined; cleanup?: void | (() => void) }
const state: unknown[] = []
const refs: { current: unknown }[] = []
const effects: Effect[] = []
let cursor = 0
let pending: (() => void)[] = []

vi.mock('react', () => ({
  useState: (init: unknown) => {
    const i = cursor++
    if (!(i in state)) state[i] = typeof init === 'function' ? (init as () => unknown)() : init
    return [state[i], (v: unknown) => { state[i] = v }]
  },
  useRef: (init: unknown) => {
    const i = cursor++
    refs[i] ??= { current: init }
    return refs[i]
  },
  useCallback: (fn: unknown) => { cursor++; return fn },
  useEffect: (fn: () => void | (() => void), deps?: unknown[]) => {
    const i = cursor++
    const prev = effects[i]
    const changed = !prev || !deps || deps.some((d, k) => d !== prev.deps?.[k])
    if (!changed) return
    pending.push(() => {
      if (typeof prev?.cleanup === 'function') prev.cleanup()
      effects[i] = { deps, cleanup: fn() }
    })
  },
}))

vi.mock('@/lib/seats', () => ({
  strmForTerm: (term: string) => (term === 'Autumn 2026' ? '1272' : '1274'),
  MAX_CLASS_NBRS_PER_REQUEST: 50,
}))

const listeners = new Map<string, () => void>()
vi.stubGlobal('document', {
  visibilityState: 'visible',
  addEventListener: (t: string, f: () => void) => listeners.set(`doc:${t}`, f),
  removeEventListener: () => {},
})
vi.stubGlobal('window', {
  addEventListener: (t: string, f: () => void) => listeners.set(`win:${t}`, f),
  removeEventListener: () => {},
})

/** Responses the test releases by hand, keyed by strm. */
const held = new Map<string, (body: unknown) => void>()
vi.stubGlobal('fetch', (url: string) => {
  const strm = new URL(url, 'http://x').searchParams.get('strm')!
  return new Promise(resolve => {
    held.set(strm, body => resolve({ ok: true, json: async () => body }))
  })
})

const seatBody = (strm: string, enrolled: number) => ({
  fetchedAt: '2026-11-10T12:00:00Z',
  seats: { 1801: { classNbr: 1801, strm, enrolled } },
})

async function render(hook: typeof import('@/hooks/use-seats').useLiveSeats, term: string) {
  cursor = 0
  const out = hook(term, [1801])
  const run = pending
  pending = []
  for (const f of run) f()
  return out
}
const flush = () => new Promise(r => setTimeout(r, 0))

describe('useLiveSeats', () => {
  beforeEach(() => {
    state.length = 0
    refs.length = 0
    effects.length = 0
    pending = []
    held.clear()
    listeners.clear()
  })

  it('ignores a focus refresh for the old term that lands after a term switch', async () => {
    const { useLiveSeats } = await import('@/hooks/use-seats')
    vi.spyOn(Date, 'now').mockReturnValue(0)
    await render(useLiveSeats, 'Autumn 2026')
    held.get('1272')!(seatBody('1272', 10))
    await flush()

    // Tab regains focus long after: a refresh for Autumn starts and hangs.
    vi.spyOn(Date, 'now').mockReturnValue(60_000)
    listeners.get('win:focus')!()

    // Student switches to Winter, which loads first.
    await render(useLiveSeats, 'Winter 2027')
    held.get('1274')!(seatBody('1274', 3))
    await flush()

    // Now the old Autumn refresh lands.
    held.get('1272')!(seatBody('1272', 99))
    await flush()

    const out = await render(useLiveSeats, 'Winter 2027')
    expect((out.seats.get(1801) as unknown as { strm: string }).strm).toBe('1274')
    expect((out.seats.get(1801) as unknown as { enrolled: number }).enrolled).toBe(3)
  })

  it('still applies a focus refresh when nothing changed', async () => {
    const { useLiveSeats } = await import('@/hooks/use-seats')
    vi.spyOn(Date, 'now').mockReturnValue(0)
    await render(useLiveSeats, 'Autumn 2026')
    held.get('1272')!(seatBody('1272', 10))
    await flush()

    vi.spyOn(Date, 'now').mockReturnValue(60_000)
    listeners.get('win:focus')!()
    held.get('1272')!(seatBody('1272', 12))
    await flush()

    const out = await render(useLiveSeats, 'Autumn 2026')
    expect((out.seats.get(1801) as unknown as { enrolled: number }).enrolled).toBe(12)
  })
})
