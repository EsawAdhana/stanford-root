import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Course } from '@/types/course'

/**
 * Two tabs, signed out, editing the same schedule. Each tab is its own copy of
 * the cart store over one shared localStorage, and a write in one tab fires a
 * `storage` event in the other, as browsers do (never in the writing tab).
 *
 * The failure this pins down: tab 1 adds MATH 51, tab 2 adds PSYCH 1, back in
 * tab 1 adding CS 103 wrote tab 1's older copy over storage and PSYCH 1 was gone.
 */

const auth = { user: null as { id: string } | null, isLoading: false }
vi.mock('@/lib/auth-store', () => ({ useAuthStore: { getState: () => auth } }))

const A = 'Autumn 2026'
const W = 'Winter 2027'
const course = (id: string): Course =>
  ({ id, subject: id.replace(/\d.*/, ''), code: id.replace(/^[A-Z&]+/, ''), title: id, terms: [A, W], units: '3-5', grading: 'Letter', sections: [] }) as unknown as Course
const CATALOG = ['MATH51', 'PSYCH1', 'CS103', 'CS161', 'CS229'].map(course)

type Tab = {
  window: EventTarget
  cart: typeof import('@/lib/cart-store').useCartStore
}

let backing: Map<string, string>
let tabs: Tab[]

function storageFor(self: () => Tab) {
  return {
    getItem: (key: string) => backing.get(key) ?? null,
    setItem: (key: string, value: string) => {
      const old = backing.get(key) ?? null
      if (old === value) return
      backing.set(key, value)
      // Delivered later, and only to the other tabs.
      for (const tab of tabs) {
        if (tab === self()) continue
        setTimeout(() => {
          const event = Object.assign(new Event('storage'), { key, oldValue: old, newValue: value })
          tab.window.dispatchEvent(event)
        }, 0)
      }
    },
    removeItem: (key: string) => { backing.delete(key) },
  }
}

async function openTab(): Promise<Tab> {
  vi.resetModules()
  const tab = { window: new EventTarget() } as Tab
  const g = globalThis as Record<string, unknown>
  g.window = tab.window
  g.localStorage = storageFor(() => tab)
  const { useCartStore } = await import('@/lib/cart-store')
  const { useCourseStore } = await import('@/lib/store')
  useCourseStore.setState({ courses: CATALOG as never, hasLoaded: true, hasEnriched: true })
  tab.cart = useCartStore
  tabs.push(tab)
  return tab
}

/** Lets the storage events land, as they would before the student's next click. */
const settle = () => new Promise(r => setTimeout(r, 20))

function saved() {
  return JSON.parse(backing.get('navigator-cart') ?? '{}').state as {
    items: { id: string; selectedTerm?: string }[]
    plans: Record<string, { order: string[]; active: string; parked: Record<string, { id: string }[]> }>
  }
}

const savedIds = () => saved().items.map(i => i.id).sort()

beforeEach(() => {
  backing = new Map()
  tabs = []
  auth.user = null
  auth.isLoading = false
})

describe('signed-out schedule in two tabs', () => {
  it('keeps the class the other tab added', async () => {
    const one = await openTab()
    const two = await openTab()

    one.cart.getState().addItem(course('MATH51'), A)
    await settle()
    two.cart.getState().addItem(course('PSYCH1'), A)
    await settle()
    one.cart.getState().addItem(course('CS103'), A)
    await settle()

    expect(savedIds()).toEqual(['CS103', 'MATH51', 'PSYCH1'])
    // Both tabs show all three, with full course data, not bare ids.
    for (const tab of [one, two]) {
      const items = tab.cart.getState().items
      expect(items.map(i => i.id).sort()).toEqual(['CS103', 'MATH51', 'PSYCH1'])
      expect(items.every(i => i.title === i.id)).toBe(true)
    }
  })

  it('keeps a removal made in the other tab', async () => {
    const one = await openTab()
    const two = await openTab()
    one.cart.getState().addItem(course('MATH51'), A)
    one.cart.getState().addItem(course('PSYCH1'), A)
    await settle()
    two.cart.getState().removeItem('PSYCH1', A)
    await settle()
    one.cart.getState().addItem(course('CS103'), A)
    await settle()
    expect(savedIds()).toEqual(['CS103', 'MATH51'])
  })

  it('keeps the other tab\'s plan edit when a plan is deleted here', async () => {
    const one = await openTab()
    const two = await openTab()
    one.cart.getState().addItem(course('MATH51'), W)
    one.cart.getState().createPlan(W) // B
    one.cart.getState().createPlan(W) // C
    await settle()

    // Tab 2 opens Plan B and adds a class to it.
    two.cart.getState().switchPlan(W, 'B')
    two.cart.getState().addItem(course('CS229'), W)
    await settle()

    // Tab 1 deletes Plan C, which it had on screen before tab 2's edit.
    one.cart.getState().deletePlan(W, 'C')
    await settle()

    const state = saved()
    expect(state.plans[W].order).toEqual(['A', 'B'])
    expect(state.plans[W].active).toBe('B')
    expect(state.items.map(i => i.id).sort()).toEqual(['CS229', 'MATH51'])
    expect(state.plans[W].parked.A.map(i => i.id)).toEqual(['MATH51'])
    expect(two.cart.getState().plans).toEqual(one.cart.getState().plans)
  })

  it('leaves a signed-in tab to the saved row', async () => {
    // Signing out in one tab empties its cart before Supabase tells the others.
    // A signed-in tab adopting that would push an empty schedule over the row.
    const one = await openTab()
    const two = await openTab()
    one.cart.getState().addItem(course('MATH51'), A)
    await settle()
    expect(two.cart.getState().items.map(i => i.id)).toEqual(['MATH51'])

    auth.user = { id: 'u1' }
    one.cart.getState().clearCart()
    await settle()
    expect(two.cart.getState().items.map(i => i.id)).toEqual(['MATH51'])
  })

  it('waits while sign-in is still being checked', async () => {
    const one = await openTab()
    const two = await openTab()
    auth.isLoading = true
    one.cart.getState().addItem(course('MATH51'), A)
    await settle()
    expect(two.cart.getState().items).toEqual([])
  })
})
