import { create } from 'zustand'

/**
 * Saved schedule entries the catalog can no longer resolve.
 *
 * `hydrateItems` drops any saved course that is not in the catalog, and the
 * shortened cart is then pushed back to `user_schedules` — so a course leaving
 * the catalog used to erase it from people's saved schedules for good. Parking
 * the entries here instead keeps them in the pushed payload, so they come back
 * on their own if the course returns, and gives the schedule page something to
 * tell the user about.
 */
export type UnresolvedScheduleItem = {
  id: string
  selectedTerm?: string
}

type UnresolvedState = {
  items: UnresolvedScheduleItem[]
  set: (items: UnresolvedScheduleItem[]) => void
  clear: () => void
}

export const useUnresolvedSchedule = create<UnresolvedState>((set) => ({
  items: [],
  set: (items) => set({ items }),
  clear: () => set({ items: [] }),
}))

type CatalogCourse = {
  id: string
  terms?: string[]
  sections?: { classId: number; term?: string }[]
}

type SavedItem = {
  id: string
  subject?: string
  code?: string
  selectedSectionIds?: number[]
  selectedTerm?: string
}

/** "CS224U" -> "CS 224U", so the notice reads like a course code. */
export function courseLabel(id: string): string {
  const match = id.match(/^([A-Z&]+)(.+)$/)
  return match ? `${match[1]} ${match[2]}` : id
}

/**
 * What the switch from ExploreCourses to Navigator did to one saved schedule.
 *
 * `missing` — the catalog has no offering for the course. Three ways to land
 * here: the sync could not hydrate it (signed in, so it arrives via
 * `unresolved`), it is in a locally persisted cart with nothing behind it
 * (signed out), or the schedule page re-fetched the row straight from the
 * database, where a dropped course still exists with its terms cleared. That
 * last one looks present but has nothing to put on a calendar.
 *
 * `movedSections` — the course survived but the exact section the user picked
 * is gone, which is what a renumbered or withdrawn class looks like.
 */
export function findAffectedSchedule(
  items: SavedItem[],
  courses: CatalogCourse[],
  unresolved: UnresolvedScheduleItem[],
): { missing: string[]; movedSections: string[] } {
  const byId = new Map(courses.map(course => [course.id, course]))

  const missingIds = new Set(unresolved.map(item => item.id))
  for (const item of items) {
    const full = byId.get(item.id)
    // An empty `terms` means the catalog kept the row but nothing is scheduled.
    // Sections are absent during the light phase, so they cannot be the test.
    if (!full || full.terms?.length === 0) missingIds.add(item.id)
  }

  const movedSections = new Set<string>()
  for (const item of items) {
    const picked = item.selectedSectionIds ?? []
    if (!picked.length) continue
    if (missingIds.has(item.id)) continue
    const full = byId.get(item.id)
    // No sections yet means the catalog has not been enriched, not a change.
    if (!full?.sections?.length) continue
    // Only the entry's term: a class number is reused across terms, so a pick
    // that moved in Winter could otherwise match an Autumn section.
    const live = new Set(
      full.sections
        .filter(section => !item.selectedTerm || !section.term || section.term === item.selectedTerm)
        .map(section => section.classId)
    )
    if (picked.some(classId => !live.has(classId))) {
      movedSections.add(item.subject && item.code ? `${item.subject} ${item.code}` : courseLabel(item.id))
    }
  }

  return {
    missing: [...missingIds].map(courseLabel).sort(),
    movedSections: [...movedSections].sort(),
  }
}
