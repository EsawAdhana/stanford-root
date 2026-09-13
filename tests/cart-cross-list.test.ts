import { beforeEach, describe, expect, it } from 'vitest'
import { repairCrossListedCart, useCartStore } from '@/lib/cart-store'
import { useCourseStore } from '@/lib/store'
import type { Course } from '@/types/course'
import type { CartItem } from '@/lib/cart-store'
import { filterCourses } from '@/lib/course-filter'
import { dedupeCrossListedItems } from '@/lib/schedule-utils'
import { getCrossListPrimaryMap } from '@/lib/utils'

/** COMM 172 / COMM 272 are one Winter class; CS 106A is unrelated. */
const course = (id: string, subject: string, code: string, title: string, terms = ['Winter 2027']): Course =>
  ({ id, subject, code, title, terms, units: '4-5', grading: 'Letter (ABCD/NP)', sections: [] }) as unknown as Course

const COMM172 = course('COMM172', 'COMM', '172', 'Media Psychology (COMM 272)')
const COMM272 = course('COMM272', 'COMM', '272', 'Media Psychology (COMM 172)')
const CS106A = course('CS106A', 'CS', '106A', 'Programming Methodology')
const COMM172_SPRING = course('COMM172', 'COMM', '172', 'Media Psychology (COMM 272)', ['Spring 2027'])

beforeEach(() => {
  useCourseStore.setState({ courses: [COMM172, COMM272, CS106A] })
  useCartStore.setState({ items: [] })
})

const ids = () => useCartStore.getState().items.map(i => `${i.id}/${i.selectedTerm}`)

describe('cart keeps one listing per cross-listed class per term', () => {
  it('replaces the sibling instead of stacking a second block', () => {
    useCartStore.getState().addItem(COMM172, 'Winter 2027')
    useCartStore.getState().addItem(COMM272, 'Winter 2027')
    expect(ids()).toEqual(['COMM272/Winter 2027'])
  })

  it('works in the other direction too', () => {
    useCartStore.getState().addItem(COMM272, 'Winter 2027')
    useCartStore.getState().addItem(COMM172, 'Winter 2027')
    expect(ids()).toEqual(['COMM172/Winter 2027'])
  })

  it('keeps the colour the calendar was already drawing', () => {
    useCartStore.getState().addItem({ ...COMM172, color: 'blue' } as Course, 'Winter 2027')
    useCartStore.getState().addItem(COMM272, 'Winter 2027')
    expect(useCartStore.getState().items[0].color).toBe('blue')
  })

  it('leaves the same class in a different term alone', () => {
    useCartStore.getState().addItem(COMM272, 'Winter 2027')
    useCartStore.getState().addItem(COMM172_SPRING, 'Spring 2027')
    expect(ids().sort()).toEqual(['COMM172/Spring 2027', 'COMM272/Winter 2027'])
  })

  it('does not touch an unrelated course', () => {
    useCartStore.getState().addItem(CS106A, 'Winter 2027')
    useCartStore.getState().addItem(COMM172, 'Winter 2027')
    expect(ids().sort()).toEqual(['CS106A/Winter 2027', 'COMM172/Winter 2027'].sort())
  })

  it('re-adding the same listing still updates in place, and clears a stale sibling', () => {
    useCartStore.getState().addItem(COMM272, 'Winter 2027')
    useCartStore.setState({ items: [...useCartStore.getState().items, { ...COMM172, selectedTerm: 'Winter 2027' }] })
    useCartStore.getState().addItem(COMM172, 'Winter 2027', undefined, 5)
    expect(ids()).toEqual(['COMM172/Winter 2027'])
    expect(useCartStore.getState().items[0].selectedUnits).toBe(5)
  })

  it('falls back to plain id matching when the catalog has not loaded', () => {
    useCourseStore.setState({ courses: [] })
    useCartStore.getState().addItem(COMM172, 'Winter 2027')
    useCartStore.getState().addItem(COMM272, 'Winter 2027')
    expect(ids().sort()).toEqual(['COMM172/Winter 2027', 'COMM272/Winter 2027'].sort())
  })
})

describe('hide-conflicts does not treat a class as clashing with its own other listing', () => {
  const meeting = { days: 'Tuesday, Thursday', time: '12:00 PM – 1:20 PM', location: 'TBA' }
  const withSection = (c: Course, classId: number): Course =>
    ({ ...c, sections: [{ term: 'Winter 2027', classId, sectionNumber: '1', component: 'LEC', status: 'Open', meetings: [meeting] }] }) as unknown as Course

  const A = withSection(COMM172, 12292)
  const B = withSection(COMM272, 12515)
  const catalog = [A, B, CS106A]
  const primaryMap = getCrossListPrimaryMap(catalog)
  const criteria = {
    excludedWords: [], selectedDepts: [], selectedTerms: ['Winter 2027'], selectedFormats: [],
    selectedLevels: [], selectedGers: [], selectedSchools: [], unitMin: 0, unitMax: 30,
    timeMin: 0, timeMax: 1440, hideConflicts: true, hideUnavailable: false,
    hideStudyAbroad: false, newOnly: false,
  }

  it('keeps the canonical listing visible when its sibling is the scheduled one', () => {
    const cart = [{ ...B, selectedTerm: 'Winter 2027' }] as unknown as CartItem[]
    const visible = filterCourses(catalog, criteria, primaryMap, cart).map(c => c.id)
    expect(visible).toContain('COMM172')
  })

  it('still hides a genuinely clashing course', () => {
    const clash = withSection(CS106A, 999)
    const cart = [{ ...clash, selectedTerm: 'Winter 2027' }] as unknown as CartItem[]
    const visible = filterCourses([A, B, clash], criteria, primaryMap, cart).map(c => c.id)
    expect(visible).not.toContain('COMM172')
    expect(visible).toContain('CS106A')
  })
})

describe('dedupeCrossListedItems — the sync path writes items without addItem', () => {
  const catalog = [COMM172, COMM272, CS106A]
  const item = (id: string, term?: string) => ({ id, selectedTerm: term, terms: ['Winter 2027'] })

  it('keeps the first listing when a pull and a local cart disagree on the code', () => {
    const merged = dedupeCrossListedItems(
      [item('COMM172', 'Winter 2027'), item('COMM272', 'Winter 2027')],
      catalog,
    )
    expect(merged.map(i => i.id)).toEqual(['COMM172'])
  })

  it('keeps both when they are different terms', () => {
    const merged = dedupeCrossListedItems(
      [item('COMM172', 'Winter 2027'), item('COMM272', 'Spring 2027')],
      catalog,
    )
    expect(merged.map(i => i.id)).toEqual(['COMM172', 'COMM272'])
  })

  it('leaves unrelated courses alone', () => {
    const merged = dedupeCrossListedItems([item('COMM172', 'Winter 2027'), item('CS106A', 'Winter 2027')], catalog)
    expect(merged).toHaveLength(2)
  })

  it('is a no-op on a single item', () => {
    const one = [item('COMM272', 'Winter 2027')]
    expect(dedupeCrossListedItems(one, catalog)).toBe(one)
  })
})

describe('a cart written before the catalog loaded is repaired once it does', () => {
  it('collapses the duplicate listing', () => {
    useCourseStore.setState({ courses: [] })
    useCartStore.setState({ items: [] })
    // Added with no catalog in memory: addItem cannot see the group, so both land.
    useCartStore.getState().addItem(COMM172, 'Winter 2027')
    useCartStore.getState().addItem(COMM272, 'Winter 2027')
    expect(useCartStore.getState().items).toHaveLength(2)

    repairCrossListedCart([COMM172, COMM272, CS106A])
    expect(useCartStore.getState().items.map(i => i.id)).toEqual(['COMM172'])
  })

  it('leaves a clean cart untouched', () => {
    useCartStore.setState({ items: [] })
    useCartStore.getState().addItem(COMM172, 'Winter 2027')
    const before = useCartStore.getState().items
    repairCrossListedCart([COMM172, COMM272, CS106A])
    expect(useCartStore.getState().items).toBe(before)
  })
})
