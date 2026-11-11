import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Course } from '@/types/course'

/**
 * A class sits on one term at a time. Adding MATH 51 to Winter after Autumn
 * takes it off Autumn, which used to happen with no word, so Autumn just
 * showed "No classes yet". The move stays; the student is told.
 */

const toast = vi.fn()
vi.mock('sonner', () => ({ toast: (...args: unknown[]) => toast(...args) }))

const { useCartStore } = await import('@/lib/cart-store')

const A = 'Autumn 2026'
const W = 'Winter 2027'
const course = (id: string): Course =>
  ({ id, subject: id.replace(/\d.*/, ''), code: id.replace(/^[A-Z&]+/, ''), title: id, terms: [A, W], units: '5', grading: 'Letter', sections: [] }) as unknown as Course

beforeEach(() => {
  toast.mockClear()
  useCartStore.setState({ items: [], plans: {}, unresolved: [] })
})

describe('adding a class to a second term', () => {
  it('moves it and says so', async () => {
    const { addItem } = useCartStore.getState()
    addItem(course('MATH51'), A)
    addItem(course('MATH51'), W)
    await vi.waitFor(() => expect(toast).toHaveBeenCalled())
    expect(toast).toHaveBeenCalledTimes(1)
    expect(toast).toHaveBeenCalledWith('MATH 51 moved from Autumn 2026 to Winter 2027.')
    expect(useCartStore.getState().items.map(i => [i.id, i.selectedTerm])).toEqual([['MATH51', W]])
  })

  it('says nothing for a first add or a change within the same term', async () => {
    const { addItem } = useCartStore.getState()
    addItem(course('MATH51'), A)
    addItem(course('MATH51'), A, undefined, 5)
    addItem(course('CS103'), W)
    await new Promise(r => setTimeout(r, 50))
    expect(toast).not.toHaveBeenCalled()
  })

  it('says nothing for an entry that had no term (an .ics import shown in every term)', async () => {
    useCartStore.setState({ items: [{ ...course('MATH51'), selectedTerm: undefined }] })
    useCartStore.getState().addItem(course('MATH51'), W)
    await new Promise(r => setTimeout(r, 50))
    expect(toast).not.toHaveBeenCalled()
  })
})
