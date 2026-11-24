import ids from './repeatable-courses.json'

/**
 * Courses Stanford marks repeatable for credit: ExploreCourses' `repeatable`
 * flag, refreshed by scripts/scrape-sections.mjs. The file is only ever added
 * to. A course dropped from it would collapse a schedule that already holds it
 * in two quarters.
 */
const REPEATABLE: ReadonlySet<string> = new Set(ids)

/** Whether a course can be planned in several quarters. Anything else sits in one at a time. */
export function isRepeatableCourse(courseId: string): boolean {
  return REPEATABLE.has(courseId)
}

type SavedEntry = { id: string; selectedTerm?: string }

/** What makes two saved entries the same one: the course, and for a repeatable course its quarter too. */
export function entryKey(entry: SavedEntry): string {
  return isRepeatableCourse(entry.id) ? `${entry.id}|${entry.selectedTerm ?? ''}` : entry.id
}

/**
 * The saved entry that adding `courseId` to `term` changes, if any: the one in
 * that quarter, one saved without a quarter, or, unless the course is
 * repeatable, the one in another quarter (which moves).
 */
export function entryForAdd<T extends SavedEntry>(items: T[], courseId: string, term: string | undefined): T | undefined {
  const saved = items.filter(i => i.id === courseId)
  return saved.find(i => i.selectedTerm === term)
    ?? saved.find(i => !i.selectedTerm)
    ?? (isRepeatableCourse(courseId) ? undefined : saved[0])
}
