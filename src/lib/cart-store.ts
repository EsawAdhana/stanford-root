import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { toast } from 'sonner'
import type { Course } from '@/types/course'
import { dedupeCrossListedItems, makeMeetingKey, mergeSectionSelection } from '@/lib/schedule-utils'
import { getCrossListGroupIds } from '@/lib/cross-list.mjs'
import { useCourseStore } from '@/lib/store'
import { setCartHydrated } from '@/lib/cart-hydration'
import { nextPlanLabel, readPlans, readSavedItems, termSnapshot, toSavedItem, type PlansByTerm, type SavedItem } from '@/lib/schedule-plans'

export type CartItem = Course & {
  selectedTerm?: string
  selectedSectionIds?: number[]
}

type CartStore = {
  /** The schedule on screen: for a term with plans, its active plan. */
  items: CartItem[]
  /** The plans not on screen, per term (see schedule-plans). Changes with `items` in one set, so a push never sees half a switch. */
  plans: PlansByTerm
  /**
   * Saved entries the catalog cannot draw (a course that dropped out of it).
   * They are not on the calendar, but they are still part of the schedule: the
   * sync pushes them back with `items`, and a plan switch carries a term's
   * entries with the plan they belong to. Changes with `items` and `plans` in one
   * set, so a push never sees half a switch.
   */
  unresolved: SavedItem[]
  /** Starts the next plan for a term as a copy of the current one and switches to it. Returns its label. */
  createPlan: (term: string) => string
  /** Puts a parked plan on screen. Returns classes it took from another term's schedule. */
  switchPlan: (term: string, label: string) => CartItem[]
  /** Drops a plan and its classes. Deleting the active plan switches to its neighbour first. */
  deletePlan: (term: string, label: string) => void
  addItem: (course: Course, term?: string, sectionId?: number, selectedUnits?: number) => void
  removeSection: (courseId: string, sectionId: number) => void
  setSelectedUnits: (courseId: string, units: number | undefined) => void
  removeItem: (courseId: string) => void
  hasItem: (courseId: string) => boolean
  getItem: (courseId: string) => CartItem | undefined
  toggleOptionalMeeting: (courseId: string, day: string, startTime: string, endTime: string) => void
  clearCart: () => void
}

/**
 * Whether a parked plan can be brought on screen. It is rebuilt from the
 * catalog, so before the catalog has courses (still loading, or failed to load)
 * every class would drop out, and the plan's saved list would be gone with it.
 */
function catalogReady(): boolean {
  return useCourseStore.getState().courses.length > 0
}

/**
 * Full course data for saved entries. An entry the catalog no longer has cannot
 * be drawn, so it comes back in `unresolved` instead, to be kept rather than lost.
 */
function hydrateSaved(saved: SavedItem[]): { items: CartItem[]; unresolved: SavedItem[] } {
  const byId = new Map(useCourseStore.getState().courses.map(c => [c.id, c]))
  const items: CartItem[] = []
  const unresolved: SavedItem[] = []
  for (const s of saved) {
    const course = byId.get(s.id)
    if (!course) {
      unresolved.push(s)
      continue
    }
    items.push({
      ...course,
      selectedTerm: s.selectedTerm,
      selectedSectionIds: s.selectedSectionIds,
      selectedUnits: s.selectedUnits,
      color: s.color,
      optionalMeetings: s.optionalMeetings,
    })
  }
  return { items, unresolved }
}

/**
 * Everything one term's plan holds: the classes on screen plus that term's
 * entries the catalog could not draw. Those belong to the plan on screen, so
 * parking it parks them too, or they would follow whichever plan is open.
 */
function planSnapshot(items: CartItem[], unresolved: SavedItem[], term: string): SavedItem[] {
  const snapshot = termSnapshot(items, term)
  const ids = new Set(snapshot.map(i => i.id))
  return [...snapshot, ...termSnapshot(unresolved, term).filter(i => !ids.has(i.id))]
}

/**
 * `unresolved` with one term's entries replaced by an incoming plan's. Like
 * `withTermItems`, an entry for the same course under another term gives way:
 * the schedule holds one entry per course.
 */
function withTermUnresolved(unresolved: SavedItem[], term: string, incoming: SavedItem[]): SavedItem[] {
  const incomingIds = new Set(incoming.map(i => i.id))
  return [...unresolved.filter(i => i.selectedTerm !== term && !incomingIds.has(i.id)), ...incoming.map(toSavedItem)]
}

/**
 * `items` with one term's entries replaced by a plan's. A class in that plan
 * that sits on another term's schedule moves to this term, as adding it would:
 * the cart holds one entry per course.
 */
function withTermItems(items: CartItem[], term: string, incoming: CartItem[]) {
  const incomingIds = new Set(incoming.map(i => i.id))
  const others = items.filter(i => i.selectedTerm !== term)
  return {
    items: [...others.filter(i => !incomingIds.has(i.id)), ...incoming],
    moved: others.filter(i => incomingIds.has(i.id)),
  }
}

/**
 * Saved metadata with full course data put back: from the class this tab
 * already holds when there is one (it may carry richer data than the catalog
 * has yet), else from the catalog, else left as metadata for hydrateLocalCart.
 */
function withCourseData(saved: CartItem[], held: CartItem[]): CartItem[] {
  const heldById = new Map(held.map(i => [i.id, i]))
  const catalog = new Map(useCourseStore.getState().courses.map(c => [c.id, c]))
  return saved.map(item => {
    const heldCourse = heldById.get(item.id)
    // A held class may itself still be metadata only (before hydrateLocalCart).
    const course = heldCourse?.title ? heldCourse : catalog.get(item.id)
    if (!course) return item
    return {
      ...course,
      selectedTerm: item.selectedTerm,
      selectedSectionIds: item.selectedSectionIds,
      selectedUnits: item.selectedUnits,
      color: item.color,
      optionalMeetings: item.optionalMeetings,
    }
  })
}

export const useCartStore = create<CartStore>()(
  persist(
    (set, get) => ({
      items: [],
      plans: {},
      unresolved: [],
      createPlan: (term) => {
        // The new plan is a copy, so the term's undrawable entries stay with it as well.
        const { items, plans, unresolved } = get()
        const current = plans[term] ?? { order: ['A'], active: 'A', parked: {} }
        const label = nextPlanLabel(current.order)
        set({
          plans: {
            ...plans,
            [term]: {
              order: [...current.order, label],
              active: label,
              parked: { ...current.parked, [current.active]: planSnapshot(items, unresolved, term) },
            },
          },
        })
        return label
      },
      switchPlan: (term, label) => {
        const { items, plans, unresolved } = get()
        const current = plans[term]
        if (!current || label === current.active || !current.order.includes(label) || !catalogReady()) return []
        const incoming = hydrateSaved(current.parked[label] ?? [])
        const { items: nextItems, moved } = withTermItems(items, term, incoming.items)
        const parked = { ...current.parked, [current.active]: planSnapshot(items, unresolved, term) }
        delete parked[label]
        set({
          items: nextItems,
          plans: { ...plans, [term]: { ...current, active: label, parked } },
          unresolved: withTermUnresolved(unresolved, term, incoming.unresolved),
        })
        return moved
      },
      deletePlan: (term, label) => {
        const { items, plans, unresolved } = get()
        const current = plans[term]
        if (!current || !current.order.includes(label) || current.order.length < 2) return
        // Deleting the plan on screen brings its neighbour up from the catalog.
        if (label === current.active && !catalogReady()) return
        const order = current.order.filter(l => l !== label)
        const parked = { ...current.parked }
        delete parked[label]
        let nextItems = items
        let nextUnresolved = unresolved
        let active = current.active
        if (label === current.active) {
          const index = current.order.indexOf(label)
          active = current.order[index - 1] ?? current.order[index + 1]
          // The deleted plan's undrawable entries go with it; the neighbour brings its own.
          const incoming = hydrateSaved(current.parked[active] ?? [])
          nextItems = withTermItems(items, term, incoming.items).items
          nextUnresolved = withTermUnresolved(unresolved, term, incoming.unresolved)
          delete parked[active]
        }
        const nextPlans = { ...plans }
        // One plan left is just the schedule again.
        if (order.length < 2) delete nextPlans[term]
        else nextPlans[term] = { order, active, parked }
        set({ items: nextItems, plans: nextPlans, unresolved: nextUnresolved })
      },
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
          // A class sits on one term at a time, so adding it to another term takes
          // it off the first. Say so: otherwise the first term just looks emptied.
          if (existing?.selectedTerm && resolvedTerm && existing.selectedTerm !== resolvedTerm) {
            toast(`${course.subject} ${course.code} moved from ${existing.selectedTerm} to ${resolvedTerm}.`)
          }
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
      // Sign-out: another person's plans must not stay behind on a shared machine.
      clearCart: () => set({ items: [], plans: {}, unresolved: [] })
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
        plans: state.plans,
        unresolved: state.unresolved,
      }),
      // Plans read back from storage get the same shape check as plans read from the saved row.
      // Classes come back as saved metadata only. Ones this tab already shows, or
      // the catalog has, get their course data straight back, so reading another
      // tab's write (see adoptOtherTabWrite) never leaves title-less blocks.
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<CartStore>
        const items = Array.isArray(saved.items) ? withCourseData(saved.items, current.items) : current.items
        return { ...current, ...saved, items, plans: readPlans(saved.plans), unresolved: readSavedItems(saved.unresolved) }
      },
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

/**
 * Another tab saved the schedule. Each tab writes its whole schedule on every
 * change, so a tab holding an older copy wrote it over the other tab's edit on
 * its next change: add MATH 51 here, PSYCH 1 in a second tab, then CS 103 here,
 * and PSYCH 1 was gone. Reading the other tab's write as it lands, the way a
 * reload would, means this tab's next write starts from it.
 *
 * Signed out only. A signed-in tab gets the other tab's edits from the saved
 * row (it pulls on focus), and reading local storage there would be unsafe:
 * signing out in one tab empties the cart before Supabase tells the other tabs,
 * and a signed-in tab adopting that empty cart would push it over the saved
 * schedule. The same holds while this tab is still checking who is signed in.
 */
export async function adoptOtherTabWrite(): Promise<void> {
  // Imported here, not at the top: auth-store imports this module.
  const { useAuthStore } = await import('@/lib/auth-store')
  const auth = useAuthStore.getState()
  if (auth.user || auth.isLoading) return
  await useCartStore.persist.rehydrate()
  reattachOnEnrichment()
}

/**
 * The catalog's first load is light (no sections or times). Classes that came
 * from another tab before the full catalog loaded get its data when it does,
 * as hydrateLocalCart does for the classes a tab opens with.
 */
let waitingForEnrichment = false
function reattachOnEnrichment(): void {
  if (waitingForEnrichment || useCourseStore.getState().hasEnriched) return
  waitingForEnrichment = true
  const stop = useCourseStore.subscribe(state => {
    if (!state.hasEnriched) return
    stop()
    waitingForEnrichment = false
    useCartStore.setState({ items: withCourseData(useCartStore.getState().items, []) })
  })
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (event: StorageEvent) => {
    // A null key is localStorage.clear() in another tab.
    if (event.key !== null && event.key !== 'navigator-cart') return
    void adoptOtherTabWrite()
  })
}
