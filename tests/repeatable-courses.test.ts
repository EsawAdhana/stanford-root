import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Course, Section } from '@/types/course'

/**
 * A course Stanford marks repeatable (MUSIC 181 Jazz Combos) can be planned in
 * several quarters. Adding it to Winter used to take it off Autumn, so a student
 * with 14 Autumn units dropped to 13 the moment they planned Winter.
 */

const toast = vi.fn()
vi.mock('@/lib/supabase', () => ({ supabase: {} }))
vi.mock('@/lib/analytics', () => ({ track: vi.fn(), trackOnce: vi.fn() }))
vi.mock('sonner', () => ({ toast: (...args: unknown[]) => toast(...args) }))

const { useCartStore } = await import('@/lib/cart-store')
const { useCourseStore } = await import('@/lib/store')
const { mergeSchedules, mergeScheduleDocs } = await import('@/lib/schedule-sync')
const { isRepeatableCourse, entryKey } = await import('@/lib/repeatable-courses')
const { termUnitRange } = await import('@/lib/schedule-totals')
const { isScheduledForTerm } = await import('@/lib/schedule-utils')

const A = 'Autumn 2026'
const W = 'Winter 2027'
const S = 'Spring 2027'
const sec = (classId: number, term: string, component = 'LEC', units = '1') =>
  ({ classId, term, component, units, sectionNumber: '1', meetings: [] }) as unknown as Section
const course = (id: string, units: string, sections: Section[]): Course => ({
  id, subject: id.replace(/\d.*/, ''), code: id.replace(/^[A-Z&]+/, ''), title: id, terms: [A, W, S], units, grading: 'Letter', sections,
}) as unknown as Course

const JAZZ = course('MUSIC181', '1', [sec(7322, A), sec(7485, W), sec(7348, S)])
const MATH = course('MATH51', '5', [sec(100, A, 'LEC', '5'), sec(200, W, 'LEC', '5')])
const VARIABLE = course('CS199', '1-6', [sec(300, A, 'INS', '1-6'), sec(301, W, 'INS', '1-6')])

const saved = () => useCartStore.getState().items.map(i => [i.id, i.selectedTerm, i.selectedSectionIds])
const units = (term: string) => termUnitRange(useCartStore.getState().items.filter(i => isScheduledForTerm(i, term)), term).max

beforeEach(() => {
  toast.mockClear()
  useCartStore.setState({ items: [], plans: {}, unresolved: [] })
  useCourseStore.setState({ courses: [JAZZ, MATH, VARIABLE] })
})

describe('which courses are repeatable', () => {
  it('follows the catalog', () => {
    expect(['MUSIC181', 'CS199', 'CS195', 'MS&E149'].map(isRepeatableCourse)).toEqual([true, true, true, true])
    expect(['MATH51', 'CS106B', 'CS161', 'ECON1', 'NOTACOURSE', ''].map(isRepeatableCourse)).toEqual([false, false, false, false, false, false])
  })

  it('keys one entry per quarter only for those', () => {
    expect(entryKey({ id: 'MUSIC181', selectedTerm: A })).not.toBe(entryKey({ id: 'MUSIC181', selectedTerm: W }))
    expect(entryKey({ id: 'MATH51', selectedTerm: A })).toBe(entryKey({ id: 'MATH51', selectedTerm: W }))
  })
})

describe('planning it in a second quarter', () => {
  it('keeps the first quarter, and both totals', async () => {
    const { addItem } = useCartStore.getState()
    addItem(JAZZ, A, 7322)
    addItem(MATH, A, 100)
    expect(units(A)).toBe(6)
    addItem(JAZZ, W, 7485)
    expect(saved()).toEqual([['MUSIC181', A, [7322]], ['MATH51', A, [100]], ['MUSIC181', W, [7485]]])
    expect([units(A), units(W)]).toEqual([6, 1])
    await new Promise(r => setTimeout(r, 50))
    expect(toast).not.toHaveBeenCalled()
  })

  it('adds a third, and does not double a quarter it is already in', () => {
    const { addItem } = useCartStore.getState()
    addItem(JAZZ, A, 7322)
    addItem(JAZZ, W, 7485)
    addItem(JAZZ, S, 7348)
    addItem(JAZZ, W, 7485)
    addItem(JAZZ, A)
    expect(saved()).toEqual([['MUSIC181', A, [7322]], ['MUSIC181', W, [7485]], ['MUSIC181', S, [7348]]])
  })

  it('starts the second quarter with its own units and skipped meetings', () => {
    const { addItem, setSelectedUnits, toggleOptionalMeeting } = useCartStore.getState()
    addItem(VARIABLE, A, 300, 3)
    toggleOptionalMeeting('CS199', 'Mon', '9:00 AM', '9:50 AM', A)
    addItem(VARIABLE, W, 301)
    const [a, w] = useCartStore.getState().items
    expect([a.selectedUnits, w.selectedUnits, w.optionalMeetings]).toEqual([3, undefined, undefined])
    setSelectedUnits('CS199', 5, W)
    expect(useCartStore.getState().items.map(i => i.selectedUnits)).toEqual([3, 5])
  })

  it('gives a termless entry the quarter instead of adding beside it', () => {
    useCartStore.setState({ items: [{ ...JAZZ, selectedTerm: undefined }] })
    useCartStore.getState().addItem(JAZZ, W, 7485)
    expect(saved()).toEqual([['MUSIC181', W, [7485]]])
  })

  it('still moves a course that is not repeatable', () => {
    const { addItem } = useCartStore.getState()
    addItem(MATH, A, 100)
    addItem(MATH, W, 200)
    expect(saved()).toEqual([['MATH51', W, [200]]])
  })
})

describe('changing one quarter', () => {
  beforeEach(() => {
    const { addItem } = useCartStore.getState()
    addItem(JAZZ, A, 7322)
    addItem(JAZZ, W, 7485)
  })

  it('removes only that quarter', () => {
    useCartStore.getState().removeItem('MUSIC181', W)
    expect(saved()).toEqual([['MUSIC181', A, [7322]]])
  })

  it('removes only that quarter when its last section goes', () => {
    useCartStore.getState().removeSection('MUSIC181', 7485, W)
    expect(saved()).toEqual([['MUSIC181', A, [7322]]])
  })

  it('marks only that quarter\'s meeting optional', () => {
    useCartStore.getState().toggleOptionalMeeting('MUSIC181', 'Mon', '9:00 AM', '9:50 AM', W)
    expect(useCartStore.getState().items.map(i => i.optionalMeetings?.length ?? 0)).toEqual([0, 1])
  })

  it('reaches the second quarter\'s section even when both quarters reuse a class number', () => {
    const reused = course('MUSIC171', '1', [sec(9, A), sec(9, W)])
    useCourseStore.setState({ courses: [reused] })
    useCartStore.setState({ items: [] })
    useCartStore.getState().addItem(reused, A, 9)
    useCartStore.getState().addItem(reused, W, 9)
    useCartStore.getState().removeSection('MUSIC171', 9, W)
    expect(saved()).toEqual([['MUSIC171', A, [9]]])
  })

  it('finds a termless entry from any quarter it shows in', () => {
    useCartStore.setState({ items: [{ ...JAZZ, selectedTerm: undefined }] })
    useCartStore.getState().removeItem('MUSIC181', W)
    expect(saved()).toEqual([])
  })
})

describe('plans', () => {
  it('bring a repeatable course up without taking it off another quarter', () => {
    const { addItem, createPlan, switchPlan, removeItem } = useCartStore.getState()
    addItem(JAZZ, W, 7485)
    createPlan(W)
    removeItem('MUSIC181', W)
    addItem(JAZZ, A, 7322)
    expect(switchPlan(W, 'A')).toEqual([])
    expect(saved()).toEqual([['MUSIC181', A, [7322]], ['MUSIC181', W, [7485]]])
    switchPlan(W, 'B')
    expect(saved()).toEqual([['MUSIC181', A, [7322]]])
  })

  it('still move a course that is not repeatable', () => {
    const { addItem, createPlan, switchPlan, removeItem } = useCartStore.getState()
    addItem(MATH, W, 200)
    createPlan(W)
    removeItem('MATH51', W)
    addItem(MATH, A, 100)
    expect(switchPlan(W, 'A').map(i => i.id)).toEqual(['MATH51'])
    expect(saved()).toEqual([['MATH51', W, [200]]])
  })
})

describe('merging devices', () => {
  const jA = { id: 'MUSIC181', selectedTerm: A, selectedSectionIds: [7322] }
  const jW = { id: 'MUSIC181', selectedTerm: W, selectedSectionIds: [7485] }
  const mA = { id: 'MATH51', selectedTerm: A }
  const mW = { id: 'MATH51', selectedTerm: W }
  const doc = (schedule: object[]) => ({ schedule, plans: {} }) as Parameters<typeof mergeScheduleDocs>[1]

  it('keeps both quarters when they agree', () => {
    expect(mergeSchedules([jA, jW], [jA, jW], [jA, jW])).toEqual([jA, jW])
    expect(mergeScheduleDocs(doc([jA, jW]), doc([jA, jW]), doc([jA, jW])).schedule).toEqual([jA, jW])
  })

  it('keeps a quarter each device added', () => {
    expect(mergeSchedules([], [jA], [jW])).toEqual([jW, jA])
    expect(mergeScheduleDocs(doc([]), doc([jA]), doc([jW])).schedule).toEqual([jW, jA])
    expect(mergeScheduleDocs(null, doc([jA]), doc([jW])).schedule).toEqual([jW, jA])
  })

  it('takes the second quarter the MCP added', () => {
    expect(mergeScheduleDocs(doc([jA]), doc([jA]), doc([jA, jW])).schedule).toEqual([jA, jW])
  })

  it('removes only the quarter removed, from either side', () => {
    expect(mergeSchedules([jA, jW], [jA], [jA, jW])).toEqual([jA])
    expect(mergeSchedules([jA, jW], [jA, jW], [jW])).toEqual([jW])
  })

  it('takes each side\'s change to its own quarter', () => {
    const a2 = { ...jA, selectedUnits: 2 }
    const w3 = { ...jW, selectedUnits: 3 }
    expect(mergeSchedules([jA, jW], [a2, jW], [jA, w3])).toEqual([a2, w3])
  })

  it('still holds one entry for a course that is not repeatable', () => {
    expect(mergeScheduleDocs(doc([mA]), doc([mW]), doc([mA])).schedule).toEqual([mW])
    expect(mergeScheduleDocs(doc([]), doc([mA]), doc([mW])).schedule).toHaveLength(1)
  })

  it('keeps both when one quarter has plans', () => {
    const plans = { [W]: { order: ['A', 'B'], active: 'B', parked: { A: [jW] } } }
    const both = { schedule: [jA, jW], plans } as Parameters<typeof mergeScheduleDocs>[1]
    expect(mergeScheduleDocs(both, both, both)).toEqual(both)
  })
})
