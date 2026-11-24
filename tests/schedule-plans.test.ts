import { beforeEach, describe, expect, it } from 'vitest'
import { useCartStore } from '@/lib/cart-store'
import { useCourseStore } from '@/lib/store'
import {
  nextPlanLabel,
  planLabel,
  plansSignature,
  readPlans,
  readSavedItems,
  termSnapshot,
  type PlansByTerm,
  type SavedItem,
} from '@/lib/schedule-plans'
import type { Course } from '@/types/course'

const W = 'Winter 2027'
const S = 'Spring 2027'

const course = (id: string, terms = [W, S]): Course =>
  ({ id, subject: id.replace(/\d.*/, ''), code: id.replace(/^[A-Z&]+/, ''), title: id, terms, units: '3-4', grading: 'Letter', sections: [] }) as unknown as Course

const CATALOG = ['CS229', 'CS161', 'CS255', 'CS224N', 'CS107', 'MATH51'].map(id => course(id))

describe('plan labels', () => {
  it('runs A to Z and then AA, with no limit', () => {
    expect([0, 1, 25, 26, 27, 701, 702].map(planLabel)).toEqual(['A', 'B', 'Z', 'AA', 'AB', 'ZZ', 'AAA'])
  })

  it('never reuses a deleted plan\'s letter', () => {
    expect(nextPlanLabel(['A'])).toBe('B')
    expect(nextPlanLabel(['A', 'C'])).toBe('D')
    expect(nextPlanLabel(['A', 'Z'])).toBe('AA')
  })
})

describe('termSnapshot', () => {
  it('takes only the entries saved under that term', () => {
    const items: SavedItem[] = [
      { id: 'CS229', selectedTerm: W, selectedSectionIds: [1] },
      { id: 'CS107', selectedTerm: S },
      { id: 'ICS1' }, // an .ics import with no term shows in every term, so it is in no plan
    ]
    expect(termSnapshot(items, W)).toEqual([{ id: 'CS229', selectedTerm: W, selectedSectionIds: [1] }])
  })
})

describe('plansSignature', () => {
  const plans = (parkedOrder: string[]): PlansByTerm => ({
    [W]: { order: ['A', 'B'], active: 'B', parked: { A: parkedOrder.map(id => ({ id, selectedTerm: W })) } },
  })

  it('does not care what order the classes are stored in', () => {
    expect(plansSignature(plans(['CS161', 'CS229']))).toBe(plansSignature(plans(['CS229', 'CS161'])))
  })

  it('changes when a parked plan changes', () => {
    expect(plansSignature(plans(['CS161']))).not.toBe(plansSignature(plans(['CS255'])))
    expect(plansSignature({})).toBe('')
  })
})

describe('readPlans keeps only well-formed plans', () => {
  it('drops entries that would break the page', () => {
    const raw = {
      [W]: { order: ['A', 'B'], active: 'B', parked: { A: [{ id: 'CS161' }, { nope: 1 }, null] } },
      'Spring 2027': { order: ['A'], active: 'A', parked: {} }, // one plan is not plans
      'Summer 2027': { order: ['A', 'B'], active: 'C', parked: {} }, // active not in order
      'Autumn 2026': { order: ['a', '<b>'], active: 'a', parked: {} }, // labels are capitals
      junk: 'string',
    }
    expect(readPlans(raw)).toEqual({ [W]: { order: ['A', 'B'], active: 'B', parked: { A: [{ id: 'CS161', selectedTerm: W }] } } })
  })

  it('reads null, arrays, and garbage as no plans', () => {
    expect(readPlans(null)).toEqual({})
    expect(readPlans([1, 2])).toEqual({})
    expect(readPlans('x')).toEqual({})
  })

  it('fills in a parked plan the row is missing', () => {
    expect(readPlans({ [W]: { order: ['A', 'B'], active: 'A' } })).toEqual({ [W]: { order: ['A', 'B'], active: 'A', parked: { B: [] } } })
  })
})

describe('the cart store\'s plans', () => {
  const ids = () => useCartStore.getState().items.map(i => `${i.id}/${i.selectedTerm}`).sort()
  const add = (id: string, term = W) => useCartStore.getState().addItem(CATALOG.find(c => c.id === id)!, term)

  beforeEach(() => {
    useCourseStore.setState({ courses: CATALOG })
    useCartStore.setState({ items: [], plans: {}, unresolved: [] })
    add('CS229'); add('CS161'); add('CS107', S)
  })

  it('starts a new plan as a copy and switches to it', () => {
    const label = useCartStore.getState().createPlan(W)
    expect(label).toBe('B')
    const plans = useCartStore.getState().plans[W]
    expect(plans.order).toEqual(['A', 'B'])
    expect(plans.active).toBe('B')
    expect(plans.parked.A.map(i => i.id)).toEqual(['CS229', 'CS161'])
    expect(ids()).toEqual(['CS107/Spring 2027', 'CS161/Winter 2027', 'CS229/Winter 2027'])
  })

  it('edits only the active plan, then swaps plans whole', () => {
    const store = useCartStore.getState()
    store.createPlan(W)
    store.removeItem('CS161', W)
    add('CS255')
    expect(ids()).toEqual(['CS107/Spring 2027', 'CS229/Winter 2027', 'CS255/Winter 2027'])

    useCartStore.getState().switchPlan(W, 'A')
    expect(ids()).toEqual(['CS107/Spring 2027', 'CS161/Winter 2027', 'CS229/Winter 2027'])
    expect(useCartStore.getState().plans[W].parked.B.map(i => i.id)).toEqual(['CS229', 'CS255'])

    useCartStore.getState().switchPlan(W, 'B')
    expect(ids()).toEqual(['CS107/Spring 2027', 'CS229/Winter 2027', 'CS255/Winter 2027'])
  })

  it('leaves other terms alone', () => {
    useCartStore.getState().createPlan(W)
    useCartStore.getState().removeItem('CS229', W)
    useCartStore.getState().switchPlan(W, 'A')
    expect(ids()).toContain('CS107/Spring 2027')
  })

  it('moves a class off another term when the incoming plan has it, and says so', () => {
    useCartStore.getState().createPlan(W)
    add('CS224N')
    useCartStore.getState().switchPlan(W, 'A')
    // CS 224N now goes on Spring while Plan B (Winter) still has it.
    add('CS224N', S)
    const moved = useCartStore.getState().switchPlan(W, 'B')
    expect(moved.map(i => `${i.id}/${i.selectedTerm}`)).toEqual(['CS224N/Spring 2027'])
    expect(ids().filter(id => id.startsWith('CS224N'))).toEqual(['CS224N/Winter 2027'])
  })

  it('ignores a switch to the active plan or a missing one', () => {
    useCartStore.getState().createPlan(W)
    const before = useCartStore.getState()
    expect(useCartStore.getState().switchPlan(W, 'B')).toEqual([])
    expect(useCartStore.getState().switchPlan(W, 'Q')).toEqual([])
    expect(useCartStore.getState().switchPlan(S, 'A')).toEqual([])
    expect(useCartStore.getState().items).toBe(before.items)
  })

  it('deleting the active plan puts its neighbour on screen', () => {
    useCartStore.getState().createPlan(W)
    add('CS255')
    useCartStore.getState().createPlan(W) // C, a copy of B
    useCartStore.getState().deletePlan(W, 'C')
    expect(useCartStore.getState().plans[W].active).toBe('B')
    expect(ids()).toEqual(['CS107/Spring 2027', 'CS161/Winter 2027', 'CS229/Winter 2027', 'CS255/Winter 2027'])
    expect(useCartStore.getState().plans[W].order).toEqual(['A', 'B'])
  })

  it('deleting a parked plan only drops it, and one plan left is a plain schedule', () => {
    useCartStore.getState().createPlan(W)
    useCartStore.getState().removeItem('CS161', W)
    useCartStore.getState().deletePlan(W, 'A')
    expect(useCartStore.getState().plans[W]).toBeUndefined()
    expect(ids()).toEqual(['CS107/Spring 2027', 'CS229/Winter 2027'])
  })

  it('will not delete the only plan', () => {
    useCartStore.getState().deletePlan(W, 'A')
    expect(ids()).toHaveLength(3)
  })

  it('clears plans with the cart, so they do not outlive a sign-out', () => {
    useCartStore.getState().createPlan(W)
    useCartStore.getState().clearCart()
    expect(useCartStore.getState().plans).toEqual({})
  })

  it('will not switch plans before the catalog has courses, so a parked plan is not emptied', () => {
    useCartStore.getState().createPlan(W)
    add('CS255')
    useCourseStore.setState({ courses: [] }) // still loading, or failed to load
    expect(useCartStore.getState().switchPlan(W, 'A')).toEqual([])
    expect(useCartStore.getState().plans[W].active).toBe('B')
    expect(useCartStore.getState().plans[W].parked.A.map(i => i.id)).toEqual(['CS229', 'CS161'])
    expect(ids()).toEqual(['CS107/Spring 2027', 'CS161/Winter 2027', 'CS229/Winter 2027', 'CS255/Winter 2027'])

    useCourseStore.setState({ courses: CATALOG })
    useCartStore.getState().switchPlan(W, 'A')
    expect(ids()).toEqual(['CS107/Spring 2027', 'CS161/Winter 2027', 'CS229/Winter 2027'])
  })

  it('will not delete the plan on screen before the catalog has courses, but can drop a parked one', () => {
    useCartStore.getState().createPlan(W)
    useCartStore.getState().createPlan(W) // C
    useCourseStore.setState({ courses: [] })
    useCartStore.getState().deletePlan(W, 'C')
    expect(useCartStore.getState().plans[W].order).toEqual(['A', 'B', 'C'])
    useCartStore.getState().deletePlan(W, 'A')
    expect(useCartStore.getState().plans[W].order).toEqual(['B', 'C'])
    expect(useCartStore.getState().plans[W].active).toBe('C')
  })

  describe('a class that dropped out of the catalog', () => {
    const unresolvedIds = () => useCartStore.getState().unresolved.map(i => `${i.id}/${i.selectedTerm}`).sort()
    const parkedIds = (label: string) => (useCartStore.getState().plans[W].parked[label] ?? []).map(i => i.id).sort()
    const withoutCS161 = () => useCourseStore.setState({ courses: CATALOG.filter(c => c.id !== 'CS161') })

    it('is not drawn when its plan comes on screen, but stays in the plan', () => {
      useCartStore.getState().createPlan(W)
      useCartStore.getState().removeItem('CS161', W)
      withoutCS161()
      useCartStore.getState().switchPlan(W, 'A')
      expect(ids()).toEqual(['CS107/Spring 2027', 'CS229/Winter 2027'])
      expect(unresolvedIds()).toEqual(['CS161/Winter 2027'])

      // Plan A goes back to the shelf with it, and Plan B does not pick it up.
      useCartStore.getState().switchPlan(W, 'B')
      expect(parkedIds('A')).toEqual(['CS161', 'CS229'])
      expect(unresolvedIds()).toEqual([])

      // Back in the catalog, it draws again.
      useCourseStore.setState({ courses: CATALOG })
      useCartStore.getState().switchPlan(W, 'A')
      expect(ids()).toEqual(['CS107/Spring 2027', 'CS161/Winter 2027', 'CS229/Winter 2027'])
    })

    it('keeps every saved field', () => {
      useCartStore.getState().createPlan(W)
      const plans = useCartStore.getState().plans
      const saved = { id: 'CS161', selectedTerm: W, selectedSectionIds: [4021, 4022], selectedUnits: 4, color: 'blue', optionalMeetings: ['Fri|9:30|10:20'] }
      useCartStore.setState({ plans: { ...plans, [W]: { ...plans[W], parked: { A: [saved] } } } })
      withoutCS161()
      useCartStore.getState().switchPlan(W, 'A')
      expect(useCartStore.getState().unresolved).toEqual([saved])
    })

    it('parks with the plan it was saved in, instead of following the open plan', () => {
      // A signed-in pull put the open plan's dropped class in `unresolved`.
      useCartStore.getState().createPlan(W)
      useCartStore.setState({ unresolved: [{ id: 'CS999', selectedTerm: W }, { id: 'CS998', selectedTerm: S }] })
      useCartStore.getState().switchPlan(W, 'A')
      expect(parkedIds('B')).toEqual(['CS161', 'CS229', 'CS999'])
      // Another term's entry belongs to no Winter plan and stays put.
      expect(unresolvedIds()).toEqual(['CS998/Spring 2027'])
    })

    it('is copied into a new plan along with the drawn classes', () => {
      useCartStore.setState({ unresolved: [{ id: 'CS999', selectedTerm: W }] })
      useCartStore.getState().createPlan(W)
      expect(parkedIds('A')).toEqual(['CS161', 'CS229', 'CS999'])
      expect(unresolvedIds()).toEqual(['CS999/Winter 2027'])
    })

    it('goes with its plan when that plan is deleted, and the neighbour brings its own', () => {
      useCartStore.getState().createPlan(W)
      useCartStore.getState().removeItem('CS161', W)
      withoutCS161()
      useCartStore.setState({ unresolved: [{ id: 'CS999', selectedTerm: W }] }) // Plan B's
      useCartStore.getState().deletePlan(W, 'B')
      expect(ids()).toEqual(['CS107/Spring 2027', 'CS229/Winter 2027'])
      expect(unresolvedIds()).toEqual(['CS161/Winter 2027'])
    })

    it('gives way to the same course coming in under another term', () => {
      useCartStore.getState().createPlan(W)
      useCartStore.getState().removeItem('CS161', W)
      withoutCS161()
      useCartStore.setState({ unresolved: [{ id: 'CS161', selectedTerm: S }] })
      useCartStore.getState().switchPlan(W, 'A')
      expect(unresolvedIds()).toEqual(['CS161/Winter 2027'])
    })

    it('is cleared with the cart at sign-out', () => {
      useCartStore.setState({ unresolved: [{ id: 'CS999', selectedTerm: W }] })
      useCartStore.getState().clearCart()
      expect(useCartStore.getState().unresolved).toEqual([])
    })
  })
})

describe('readSavedItems', () => {
  it('keeps well-formed entries and drops the rest', () => {
    expect(readSavedItems([{ id: 'CS161', selectedTerm: W, selectedUnits: 4 }, { id: '' }, null, 'CS229', { selectedTerm: W }]))
      .toEqual([{ id: 'CS161', selectedTerm: W, selectedUnits: 4 }])
    expect(readSavedItems(undefined)).toEqual([])
    expect(readSavedItems({ id: 'CS161' })).toEqual([])
  })
})
