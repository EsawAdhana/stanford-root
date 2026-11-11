import { create } from 'zustand'
import type { ClassYearBreakdown, CourseEvaluation } from '@/types/course'

/** Normalizes an instructor name for de-dup: case-insensitive and order-independent
 *  so "Dan Jurafsky" and "Jurafsky, Dan" collapse to the same key. */
function normalizeInstructor(name: string): string {
  return (name || '')
    .toLowerCase()
    .replace(/[.,]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ')
}

const EVAL_CACHE_KEY = 'evaluations-cache'
const EVAL_CACHE_TTL = 1000 * 60 * 30 // 30 min

// Course IDs with an in-flight bulk fetch — dedupes concurrent/overlapping callers
// (e.g. the detail page plus its two CourseEvaluations children mounting together).
const bulkInFlight = new Set<string>()
const classYearsInFlight = new Set<string>()

function readEvalCache(): Record<string, CourseEvaluation[]> | null {
  try {
    const raw = sessionStorage.getItem(EVAL_CACHE_KEY)
    if (!raw) return null
    const { ts, data } = JSON.parse(raw)
    if (Date.now() - ts > EVAL_CACHE_TTL) return null
    return data
  } catch {
    return null
  }
}

function writeEvalCache(data: Record<string, CourseEvaluation[]>) {
  try {
    sessionStorage.setItem(EVAL_CACHE_KEY, JSON.stringify({ ts: Date.now(), data }))
  } catch {
    // sessionStorage full — skip
  }
}

type EvaluationStore = {
  evaluations: Record<string, CourseEvaluation[]>
  /**
   * Carta class-level breakdowns, keyed by course ID. A `null` value means the fetch
   * came back with nothing for that course -- Carta covers 85% of our catalog and
   * suppresses anything under ~15 students -- and is what stops it being re-requested
   * on every mount.
   */
  classYears: Record<string, ClassYearBreakdown | null>
  loadingCourses: Record<string, boolean>
  errorCourses: Record<string, boolean>
  isBulkLoading: boolean
  fetchBulkEvaluations: (courseIds: string[]) => Promise<void>
  fetchBulkClassYears: (courseIds: string[]) => Promise<void>
  /** Class-year counts summed across a cross-list group, or null if none of them have any. */
  getMergedClassYears: (courseIds: string[]) => ClassYearBreakdown | null
  getEvaluations: (courseId: string) => CourseEvaluation[]
  /** Merged evaluations from all course IDs (e.g. cross-listed CS 24, LINGUIST 35). Deduplicated by term+instructor. */
  getMergedEvaluations: (courseIds: string[]) => CourseEvaluation[]
  isLoadingCourse: (courseId: string) => boolean
  hasErrorForCourse: (courseId: string) => boolean
  /** Clears all loaded evaluations and the cache (e.g. on sign-out, since
   *  evaluation data is Stanford-login-only). */
  clearAll: () => void
}

export const useEvaluationStore = create<EvaluationStore>((set, get) => ({
  evaluations: {},
  classYears: {},
  loadingCourses: {},
  errorCourses: {},
  isBulkLoading: false,

  fetchBulkEvaluations: async (courseIds) => {
    let { evaluations } = get()
    // Hydrate from cache first (instant on refresh) — only set when it adds new keys
    const cached = readEvalCache()
    if (cached) {
      const addsNewKeys = Object.keys(cached).some(id => !(id in evaluations))
      evaluations = { ...cached, ...evaluations }
      if (addsNewKeys) set(state => ({ ...state, evaluations: { ...cached, ...state.evaluations } }))
    }

    const toFetch = courseIds.filter(id => !evaluations[id] && !bulkInFlight.has(id))
    if (toFetch.length === 0) return
    for (const id of toFetch) bulkInFlight.add(id)

    set(state => {
      const loadingCourses = { ...state.loadingCourses }
      for (const id of toFetch) loadingCourses[id] = true
      return { ...state, isBulkLoading: true, loadingCourses }
    })

    const clearLoadingFlags = (loadingCourses: Record<string, boolean>) => {
      const next = { ...loadingCourses }
      for (const id of toFetch) delete next[id]
      return next
    }


    try {
      const res = await fetch('/api/evaluations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseIds: toFetch })
      })
      if (res.status === 401) {
        // Evaluations are Stanford-login-only, so show no data (not an error).
        // Leave the courses unloaded rather than storing [], which would read as
        // "no evaluations exist", get cached by the next successful fetch, and
        // stop the course refetching once the student is signed in.
        set(state => ({
          isBulkLoading: false,
          loadingCourses: clearLoadingFlags(state.loadingCourses),
        }))
        return
      }
      if (!res.ok) throw new Error(`API error: ${res.status}`)
      const raw: unknown = await res.json()
      const byCourse: Record<string, CourseEvaluation[]> = {}
      if (raw && typeof raw === 'object') {
        for (const [courseId, evals] of Object.entries(raw as Record<string, unknown>)) {
          byCourse[courseId] = Array.isArray(evals) ? (evals as CourseEvaluation[]) : []
        }
      }


      const fetched: Record<string, CourseEvaluation[]> = {}
      for (const [courseId, evals] of Object.entries(byCourse)) {
        fetched[courseId] = evals || []
      }
      for (const id of toFetch) {
        if (!(id in fetched)) fetched[id] = []
      }

      set(state => {
        const merged = { ...state.evaluations, ...fetched }
        writeEvalCache(merged)
        const errors = { ...state.errorCourses }
        for (const id of Object.keys(fetched)) delete errors[id]
        return {
          evaluations: merged,
          errorCourses: errors,
          isBulkLoading: false,
          loadingCourses: clearLoadingFlags(state.loadingCourses),
        }
      })
    } catch (err) {
      console.error('Failed to bulk load evaluations:', err)
      // Mark the failure without storing []. An empty list here would be cached
      // by the next successful fetch, so after a reload the course would skip
      // refetching and show "No evaluations on record" instead of retrying.
      set(state => {
        const errors = { ...state.errorCourses }
        for (const id of toFetch) errors[id] = true
        return {
          errorCourses: errors,
          isBulkLoading: false,
          loadingCourses: clearLoadingFlags(state.loadingCourses),
        }
      })
    } finally {
      for (const id of toFetch) bulkInFlight.delete(id)
    }
  },

  fetchBulkClassYears: async (courseIds) => {
    const { classYears } = get()
    const toFetch = courseIds.filter(id => !(id in classYears) && !classYearsInFlight.has(id))
    if (toFetch.length === 0) return
    for (const id of toFetch) classYearsInFlight.add(id)

    try {
      const res = await fetch('/api/class-years', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseIds: toFetch })
      })
      // 401 is the logged-out case, not a failure: record "no data" so the chart
      // simply does not render, the same way the evaluation fetch does.
      const raw: unknown = res.ok ? await res.json() : {}
      const fetched: Record<string, ClassYearBreakdown | null> = {}
      for (const id of toFetch) fetched[id] = null
      if (raw && typeof raw === 'object') {
        for (const [courseId, value] of Object.entries(raw as Record<string, unknown>)) {
          const row = value as ClassYearBreakdown | null
          fetched[courseId] = row && typeof row.total === 'number' && row.total > 0 ? row : null
        }
      }
      set(state => ({ ...state, classYears: { ...state.classYears, ...fetched } }))
    } catch (err) {
      console.error('Failed to load class-year breakdowns:', err)
      set(state => {
        const updated = { ...state.classYears }
        for (const id of toFetch) if (!(id in updated)) updated[id] = null
        return { ...state, classYears: updated }
      })
    } finally {
      for (const id of toFetch) classYearsInFlight.delete(id)
    }
  },

  getMergedClassYears: (courseIds) => {
    const { classYears } = get()
    // Carta reports the whole cross-listed class under EVERY one of its codes, so the
    // rows for AA 228 and CS 238 are byte-identical 971-student copies of each other.
    // Summing them showed 1,942. De-dupe on the distribution itself, then add what is
    // left: paired listings like AFRICAAM 47 / AFRICAAM 147 really are different
    // populations (30 and 49 students), and those still have to add up.
    const seen = new Set<string>()
    const levels: Record<string, number> = {}
    let total = 0
    let found = false
    for (const id of courseIds) {
      const row = classYears[id]
      if (!row) continue
      const signature = `${row.total}|${JSON.stringify(row.levels)}`
      if (seen.has(signature)) continue
      seen.add(signature)
      found = true
      for (const [level, count] of Object.entries(row.levels || {})) {
        levels[level] = (levels[level] || 0) + count
      }
      total += row.total
    }
    return found ? { levels, total } : null
  },

  getEvaluations: (courseId) => {
    const { evaluations } = get()
    return evaluations[courseId] || []
  },

  getMergedEvaluations: (courseIds) => {
    const { evaluations } = get()
    const seen = new Set<string>()
    const merged: CourseEvaluation[] = []
    for (const id of courseIds) {
      const evals = evaluations[id] || []
      for (const ev of evals) {
        // courseCode is what separates a real duplicate from a second section.
        //
        // A cross-listed class files ONE report verbatim under each of its codes, and
        // every copy carries the same slash-joined courseCode ("Sp24-MATH-51-01/..."),
        // so those still collapse. But a course commonly runs several sections in one
        // term under the SAME instructor, and those are different students -- keying on
        // term+instructor alone dropped all but one of them, hiding 21,824 responses
        // across the catalog and making these breakdowns disagree with the headline
        // rating (MATH 51 showed 1,406 of its 2,468 ratings).
        const key = `${ev.courseCode}|${ev.term}|${normalizeInstructor(ev.instructor)}`
        if (!seen.has(key)) {
          seen.add(key)
          merged.push(ev)
        }
      }
    }
    return merged
  },

  isLoadingCourse: (courseId) => {
    const { loadingCourses } = get()
    return !!loadingCourses[courseId]
  },

  hasErrorForCourse: (courseId) => {
    const { errorCourses } = get()
    return !!errorCourses[courseId]
  },

  clearAll: () => {
    try { sessionStorage.removeItem(EVAL_CACHE_KEY) } catch { /* ignore */ }
    set({ evaluations: {}, classYears: {}, loadingCourses: {}, errorCourses: {}, isBulkLoading: false })
  }
}))
