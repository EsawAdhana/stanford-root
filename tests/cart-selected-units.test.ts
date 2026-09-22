import { describe, it, expect, beforeEach } from 'vitest'
import { useCartStore } from '@/lib/cart-store'
import { useCourseStore } from '@/lib/store'
import type { Course } from '@/types/course'

const TERM = 'Winter 2027'

function course(id: string, title: string, units = '4-5'): Course {
  return {
    id,
    subject: id.replace(/\d.*$/, ''),
    code: id.replace(/^\D+/, ''),
    title,
    description: '',
    units,
    grading: 'Letter (ABCD/NP)',
    instructors: [],
    terms: [TERM],
    sections: [],
  }
}

// COMM 172 and COMM 272 are one class under two codes; the catalog names the
// cross-listing in the title, which is how the grouping finds it.
const COMM172 = course('COMM172', 'Media Psychology (COMM 272)')
const COMM272 = course('COMM272', 'Media Psychology (COMM 172)')

beforeEach(() => {
  useCartStore.setState({ items: [] })
  useCourseStore.setState({ courses: [COMM172, COMM272] })
})

describe('setSelectedUnits', () => {
  it('sets units on a course already on the schedule', () => {
    useCartStore.getState().addItem(COMM272, TERM)
    useCartStore.getState().setSelectedUnits('COMM272', 4)

    expect(useCartStore.getState().items[0].selectedUnits).toBe(4)
  })

  it('clears a pick, which addItem cannot express', () => {
    // The chips toggle: clicking the lit one computes `undefined`. addItem reads
    // undefined as "leave it alone", so before this action the pick came back on
    // the next render and the term's unit total never moved.
    useCartStore.getState().addItem(COMM272, TERM, undefined, 4)
    expect(useCartStore.getState().items[0].selectedUnits).toBe(4)

    useCartStore.getState().addItem(COMM272, TERM, undefined, undefined)
    expect(useCartStore.getState().items[0].selectedUnits).toBe(4)

    useCartStore.getState().setSelectedUnits('COMM272', undefined)
    expect(useCartStore.getState().items[0].selectedUnits).toBeUndefined()
  })

  it('leaves the listing, term and section picks alone', () => {
    useCartStore.getState().addItem({ ...COMM272, color: '#a78bfa' }, TERM)
    useCartStore.setState({
      items: useCartStore.getState().items.map(i => ({ ...i, selectedSectionIds: [12515] })),
    })

    useCartStore.getState().setSelectedUnits('COMM272', 5)
    const [item] = useCartStore.getState().items

    expect(item.id).toBe('COMM272')
    expect(item.selectedTerm).toBe(TERM)
    expect(item.selectedSectionIds).toEqual([12515])
    expect(item.color).toBe('#a78bfa')
    expect(useCartStore.getState().items).toHaveLength(1)
  })

  it('does not swap a cross-listed class onto the other listing', () => {
    // The COMM 172 page writes units for a schedule that holds COMM 272. Routing
    // that through addItem with this page's course would have handed addItem
    // COMM172, whose cross-list dedupe then drops COMM272 — renaming the block on
    // the student's calendar as a side effect of picking a unit count.
    useCartStore.getState().addItem(COMM272, TERM)
    useCartStore.getState().setSelectedUnits('COMM272', 4)

    expect(useCartStore.getState().items.map(i => i.id)).toEqual(['COMM272'])
  })

  it('is a no-op for a course that is not on the schedule', () => {
    useCartStore.getState().addItem(COMM272, TERM)
    useCartStore.getState().setSelectedUnits('COMM172', 5)

    expect(useCartStore.getState().items.map(i => `${i.id}=${i.selectedUnits}`)).toEqual(['COMM272=undefined'])
  })
})
