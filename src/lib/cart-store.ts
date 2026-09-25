import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Course } from '@/types/course'
import { dedupeCrossListedItems, makeMeetingKey, mergeSectionSelection } from '@/lib/schedule-utils'
import { getCrossListGroupIds } from '@/lib/cross-list.mjs'
import { useCourseStore } from '@/lib/store'
import { setCartHydrated } from '@/lib/cart-hydration'

export type CartItem = Course & {
  selectedTerm?: string
  selectedSectionIds?: number[]
}

type CartStore = {
  items: CartItem[]
  addItem: (course: Course, term?: string, sectionId?: number, selectedUnits?: number) => void
  removeSection: (courseId: string, sectionId: number) => void
  setSelectedUnits: (courseId: string, units: number | undefined) => void
  removeItem: (courseId: string) => void
  hasItem: (courseId: string) => boolean
  getItem: (courseId: string) => CartItem | undefined
  toggleOptionalMeeting: (courseId: string, day: string, startTime: string, endTime: string) => void
  clearCart: () => void
}

export const useCartStore = create<CartStore>()(
  persist(
    (set, get) => ({
      items: [],
      addItem: (course, term, sectionId, selectedUnits) => {
        const currentItems = get().items
        const existingIndex = currentItems.findIndex(c => c.id === course.id)
        const existing = existingIndex >= 0 ? currentItems[existingIndex] : undefined

        // Preserve existing color if updating same course
        const existingColor = existing?.color

        // Resolve selectedUnits: explicit arg > course > existing item (never overwrite with undefined)
        const resolvedUnits =
          selectedUnits !== undefined
            ? selectedUnits
            : course.selectedUnits !== undefined
              ? course.selectedUnits
              : existing?.selectedUnits

        const resolvedTerm = term || course.selectedTerm || course.terms?.[0]

        // Picks belong to a term, so switching terms starts the selection over.
        const priorIds = existing && existing.selectedTerm === resolvedTerm
          ? (existing.selectedSectionIds ?? [])
          : []

        // Adding a section keeps the user's other components (LEC + DIS) and
        // replaces only a same-component pick. Never overwrite with undefined.
        const resolvedSectionIds =
          sectionId !== undefined
            ? mergeSectionSelection(
                priorIds,
                sectionId,
                // Picks belong to one term, and a class number is reused across terms.
                (course.sections ?? existing?.sections ?? []).filter(s => !resolvedTerm || s.term === resolvedTerm),
              )
            : course.selectedSectionIds?.length
              ? course.selectedSectionIds
              : priorIds.length > 0 ? priorIds : undefined

        const courseWithTerm: CartItem = {
          ...course,
          selectedTerm: resolvedTerm,
          selectedSectionIds: resolvedSectionIds,
          selectedUnits: resolvedUnits,
          color: existingColor || course.color // Keep existing or use provided
        }

        // One listing per class per term. A cross-listed class is one meeting under
        // several catalog ids (COMM 172 / COMM 272), and items reach the cart from three
        // places -- the schedule search, the course page, and an .ics import carrying
        // whichever code the student enrolled under. Without this, two of them stack:
        // two blocks in the same slot and the term's units counted twice. Last write
        // wins, keeping the earlier listing's colour so the calendar doesn't jump.
        const groupIds = getCrossListGroupIds(course.id, useCourseStore.getState().courses)
        const siblingIndex = groupIds.length > 1
          ? currentItems.findIndex(c =>
              c.id !== course.id &&
              groupIds.includes(c.id) &&
              (c.selectedTerm ?? c.terms?.[0]) === resolvedTerm)
          : -1

        if (existingIndex >= 0) {
          const newItems = [...currentItems]
          newItems[existingIndex] = { ...newItems[existingIndex], ...courseWithTerm }
          set({ items: siblingIndex >= 0 ? newItems.filter((_, i) => i !== siblingIndex) : newItems })
          return
        }

        if (siblingIndex >= 0) {
          const newItems = [...currentItems]
          newItems[siblingIndex] = { ...courseWithTerm, color: currentItems[siblingIndex].color || courseWithTerm.color }
          set({ items: newItems })
          return
        }

        set(state => ({ items: [...state.items, courseWithTerm] }))
      },
      /**
       * Set -- or clear -- the units on a course already on the schedule.
       *
       * `addItem` deliberately never overwrites with undefined, because most of
       * its callers pass undefined to mean "leave this alone". That left the
       * units chips unable to express the one thing their own toggle computes:
       * clicking the lit chip cleared the local state and wrote nothing, so the
       * pick came straight back on the next render and the term's total never
       * moved.
       */
      setSelectedUnits: (courseId, units) => {
        set(state => ({
          items: state.items.map(item =>
            item.id === courseId ? { ...item, selectedUnits: units } : item
          ),
        }))
      },
      removeSection: (courseId, sectionId) => {
        const currentItems = get().items
        const index = currentItems.findIndex(c => c.id === courseId)
        if (index < 0) return

        const item = currentItems[index]
        const remaining = (item.selectedSectionIds ?? []).filter(id => id !== sectionId)

        // Dropping the last section means the course is off the schedule.
        if (remaining.length === 0) {
          set({ items: currentItems.filter(c => c.id !== courseId) })
          return
        }

        const newItems = [...currentItems]
        newItems[index] = { ...item, selectedSectionIds: remaining }
        set({ items: newItems })
      },
      removeItem: (courseId) => {
        set(state => ({ items: state.items.filter(c => c.id !== courseId) }))
      },
      hasItem: (courseId) => {
        return get().items.some(c => c.id === courseId)
      },
      getItem: (courseId) => {
        return get().items.find(c => c.id === courseId)
      },
      toggleOptionalMeeting: (courseId, day, startTime, endTime) => {
        const currentItems = get().items
        const courseIndex = currentItems.findIndex(c => c.id === courseId)
        if (courseIndex < 0) return

        const course = currentItems[courseIndex]
        const meetingKey = makeMeetingKey(day, startTime, endTime)
        const optionalMeetings = course.optionalMeetings ? [...course.optionalMeetings] : []
        const keyIndex = optionalMeetings.indexOf(meetingKey)

        if (keyIndex >= 0) {
          optionalMeetings.splice(keyIndex, 1)
        } else {
          optionalMeetings.push(meetingKey)
        }

        const newItems = [...currentItems]
        newItems[courseIndex] = {
          ...course,
          optionalMeetings: optionalMeetings.length > 0 ? optionalMeetings : undefined
        }

        set({ items: newItems })
      },
      clearCart: () => set({ items: [] })
    }),
    {
      name: 'navigator-cart',
      version: 2,
      // v1 stored a single `selectedSectionId` per course.
      migrate: (persisted, version) => {
        if (version >= 2) return persisted as { items: CartItem[] }
        const state = persisted as { items?: (CartItem & { selectedSectionId?: number })[] }
        return {
          ...state,
          items: (state?.items ?? []).map(({ selectedSectionId, ...item }) =>
            selectedSectionId !== undefined
              ? { ...item, selectedSectionIds: [selectedSectionId] }
              : item
          ),
        } as { items: CartItem[] }
      },
      // Persist only schedule metadata — full Course data is re-attached from
      // the catalog on load (see hydrateLocalCart / reHydrateOnEnrichment in
      // schedule-sync). Avoids serializing full course payloads on every set.
      partialize: (state) => ({
        items: state.items.map(i => ({
          id: i.id,
          selectedTerm: i.selectedTerm,
          selectedSectionIds: i.selectedSectionIds,
          selectedUnits: i.selectedUnits,
          color: i.color,
          optionalMeetings: i.optionalMeetings,
        })) as CartItem[],
      }),
      onRehydrateStorage: () => (_state, _err) => {
        setCartHydrated()
      }
    }
  )
)

/**
 * Repair a cart that already holds two listings of one class.
 *
 * `addItem` can only recognise a cross-listing once the catalog is in memory, so an add
 * made during the first load -- or a schedule persisted by a build that predates the
 * check -- can still carry both.
 */
export function repairCrossListedCart(courses: { id: string; title: string }[]): void {
  const { items } = useCartStore.getState()
  const deduped = dedupeCrossListedItems(items, courses)
  if (deduped.length !== items.length) useCartStore.setState({ items: deduped })
}

/** Run that repair once, the first time the catalog is known. */
const stopWatchingCatalog = useCourseStore.subscribe(state => {
  if (state.courses.length === 0) return
  stopWatchingCatalog()
  repairCrossListedCart(state.courses)
})
