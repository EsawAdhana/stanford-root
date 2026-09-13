import type { CourseEvaluation } from '@/types/course'

/**
 * Per-course evaluation cache, shared by every request an instance serves.
 *
 * Reading one course's evaluations costs ~550KB out of Postgres -- CS106B is 13
 * rows and 556KB, CS229 is 589KB -- because each row carries its free-text
 * comments. The browser caches its own copy, but that is per student, so once the
 * quarter started every one of them paid for CS106B separately and this endpoint
 * became the largest single source of database egress.
 *
 * Safe to share because the bytes do not depend on who asked: evaluations are the
 * same for every student, the auth gate runs before any of this, and the rows only
 * change when scrape-evaluations runs -- which the nightly refresh does not do.
 *
 * Split out from the route so the merge and eviction can be tested without
 * standing up Supabase, the same way planClamp is split out of ChipRows.
 */

/**
 * Evaluations change only when the scraper runs, so this is bounded by staleness
 * we would not notice rather than by correctness. An hour still collapses the
 * hundreds of views one popular course gets in a day into a single read.
 */
export const CACHE_TTL_MS = 60 * 60_000

/**
 * ~550KB of JSON per course, so this holds the instance to roughly 35MB of
 * evaluations. The tail of 8,630 courses would not fit and does not need to:
 * requests concentrate on the courses students are shopping, and evicting the
 * least recently used one keeps exactly those.
 */
export const CACHE_MAX_COURSES = 64

type Entry = { at: number; evals: CourseEvaluation[] }

const cache = new Map<string, Entry>()

/** Cached evaluations for one course, or null when absent or past the TTL. */
export function readCachedEvaluations(
  courseId: string,
  now: number = Date.now(),
): CourseEvaluation[] | null {
  const hit = cache.get(courseId)
  if (!hit) return null
  if (now - hit.at >= CACHE_TTL_MS) {
    cache.delete(courseId)
    return null
  }
  // Re-insert so Map order is least-recently-used first, which is what the
  // eviction below walks.
  cache.delete(courseId)
  cache.set(courseId, hit)
  return hit.evals
}

/**
 * Cache one course's evaluations, evicting the least recently used once full.
 *
 * An empty array is cached too. "This course has no evaluations" is a fact worth
 * remembering -- most of the catalog is unrated, and without it every view of an
 * unrated course re-queries for nothing.
 */
export function writeCachedEvaluations(
  courseId: string,
  evals: CourseEvaluation[],
  now: number = Date.now(),
): void {
  cache.delete(courseId)
  cache.set(courseId, { at: now, evals })
  while (cache.size > CACHE_MAX_COURSES) {
    const oldest = cache.keys().next()
    if (oldest.done) break
    cache.delete(oldest.value)
  }
}

/** Test seam: drop everything. Not called in the request path. */
export function clearEvaluationCache(): void {
  cache.clear()
}

/** Test seam: how many courses are held right now. */
export function evaluationCacheSize(): number {
  return cache.size
}
