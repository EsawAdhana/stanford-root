import { create } from 'zustand'
import type { Course } from '@/types/course'
import { fetchCatalogJson } from './catalog-fetch'
import { rowToCourse } from '@/lib/course-mapper'

type CourseStore = {
  courses: Course[]
  isLoading: boolean
  hasLoaded: boolean
  isEnriching: boolean
  hasEnriched: boolean
  enrichedCourseIds: Set<string>
  catalogError: boolean
  failedDetailIds: Set<string>
  fetchCourses: () => Promise<void>
  fetchCourseDetail: (courseId: string) => Promise<void>
  fetchCourseDetails: (courseIds: string[]) => Promise<void>
}

// Bump on ANY change to the cached Course shape. The cache is the whole catalog
// and survives 24h, so a new field (isNew, added for the "new courses only"
// filter) reaches nobody with a warm cache until this number changes — that
// shipped once as a filter that matched zero courses for every returning visitor.
//
// Bump it for a change to the cached *values* too, not just the field list: v14
// is the ExploreCourses -> Navigator switch, which reshaped every meeting day
// ("\n\tMon\n\tWed" -> "Monday, Wednesday") and time ("1:30:00 PM-2:50:00 PM"
// -> "1:30 PM - 2:50 PM"), and is what makes weekend sections visible at all.
export const CACHE_VERSION = 19
const CACHE_TTL = 1000 * 60 * 30 // 30 minutes
const STALE_MAX_AGE = 1000 * 60 * 60 * 24 // 24 hours
const IDB_DB = 'root-cache'
const IDB_STORE = 'courses'
const IDB_KEY = 'catalog'

// Clean up old sessionStorage cache to free space
if (typeof window !== 'undefined') {
  try { sessionStorage.removeItem('root-courses-cache') } catch { /* ignore */ }
}

function openIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/**
 * `isNew` is computed by dump-catalog.mjs; it is not a column on `courses`, so
 * an enrichment fetch that falls through to Supabase (the batch route always
 * does) comes back without it. Carry it over from the entry being replaced, or
 * putting a new course in the cart would drop it out of the "new courses" filter
 * for the rest of the session.
 */
function withDumpOnlyFields(enriched: Course, previous: Course | undefined): Course {
  if (previous?.isNew === undefined || enriched.isNew !== undefined) return enriched
  return { ...enriched, isNew: previous.isNew }
}

type CacheEntry = { data: Course[]; ts: number }

/**
 * Single IndexedDB read for the catalog cache. Returns null when missing,
 * version-mismatched, or older than 24h. Callers decide fresh vs stale from
 * `ts` (fresh = within CACHE_TTL: skip network; stale = render immediately
 * and revalidate in the background).
 */
async function readCacheEntry(): Promise<CacheEntry | null> {
  try {
    const db = await openIDB()
    return new Promise((resolve) => {
      const req = db.transaction(IDB_STORE).objectStore(IDB_STORE).get(IDB_KEY)
      req.onsuccess = () => {
        const entry = req.result
        if (!entry || entry.v !== CACHE_VERSION) return resolve(null)
        if (Date.now() - entry.ts > STALE_MAX_AGE) return resolve(null)
        resolve({ data: entry.data, ts: entry.ts })
      }
      req.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}

async function writeCache(courses: Course[]) {
  try {
    const db = await openIDB()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite')
      tx.objectStore(IDB_STORE).put({ v: CACHE_VERSION, ts: Date.now(), data: courses }, IDB_KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch {
    // IndexedDB unavailable — ignore
  }
}

/** Light catalog rows omit description and sections; full rows include at least one. */
export function hasFullCourseData(course: Course): boolean {
  return Boolean(course.description?.trim()) || (course.sections?.length ?? 0) > 0
}

/**
 * Memoized id -> Course map for a given courses array (keyed by array identity,
 * which only changes when the catalog is replaced). Use instead of
 * `courses.find(...)` in hot paths — the catalog has ~9k entries.
 */
const coursesByIdCache = new WeakMap<Course[], Map<string, Course>>()
export function getCoursesById(courses: Course[]): Map<string, Course> {
  let map = coursesByIdCache.get(courses)
  if (!map) {
    map = new Map(courses.map(c => [c.id, c]))
    coursesByIdCache.set(courses, map)
  }
  return map
}

let fetchCoursesInFlight: Promise<void> | null = null

function enrichedIdsFromCourses(courses: Course[]): Set<string> {
  return new Set(courses.filter(hasFullCourseData).map(c => c.id))
}

export const useCourseStore = create<CourseStore>((set, get) => ({
  courses: [],
  isLoading: false,
  hasLoaded: false,
  isEnriching: false,
  hasEnriched: false,
  enrichedCourseIds: new Set(),
  catalogError: false,
  failedDetailIds: new Set(),

  fetchCourses: async () => {
    if (fetchCoursesInFlight) return fetchCoursesInFlight

    fetchCoursesInFlight = (async () => {
    const { isLoading, hasLoaded } = get()
    if (isLoading) return

    // Show cached data immediately (fresh or stale). A fresh cache (< TTL)
    // skips the network entirely; a stale one revalidates in the background.
    const entry = await readCacheEntry()
    if (entry) {
      set({
        courses: entry.data,
        hasLoaded: true,
        hasEnriched: true,
        isLoading: false,
        catalogError: false,
        enrichedCourseIds: enrichedIdsFromCourses(entry.data),
      })
      if (Date.now() - entry.ts <= CACHE_TTL) return
      // Stale: fall through to fetch fresh in background
    } else if (hasLoaded && !get().catalogError) {
      return
    } else {
      set({ isLoading: true })
    }

    try {
      // ── Phase 1: light data (card-level only) — small + fast, renders the list ──
      // Skip when stale full data is already on screen, so a background revalidate
      // doesn't momentarily downgrade visible courses (sections/descriptions) to light.
      if (!entry) {
        const lightRows: any[] = await fetchCatalogJson('/api/courses')
        const lightCourses = lightRows.map(rowToCourse)

        set({
          courses: lightCourses,
          hasLoaded: true,
          isLoading: false,
          isEnriching: true,
          hasEnriched: false,
          catalogError: false,
        })
      }

      // ── Phase 2: full data with sections + description — enrich in background ──
      const fullRows: any[] = await fetchCatalogJson('/api/courses?full=1')
      const fullCourses = fullRows.map(rowToCourse)

      await writeCache(fullCourses)
      set({
        courses: fullCourses,
        hasLoaded: true,
        isLoading: false,
        isEnriching: false,
        hasEnriched: true,
        catalogError: false,
        enrichedCourseIds: new Set(fullCourses.map(c => c.id)),
      })
    } catch (err) {
      console.error('Failed to fetch courses:', err)
      // Preserve stale data on error — don't overwrite with empty array
      const { courses } = get()
      if (courses.length === 0) {
        set({ hasLoaded: true, isLoading: false, isEnriching: false, catalogError: true })
      } else {
        set({ isLoading: false, isEnriching: false })
      }
    }
    })().finally(() => { fetchCoursesInFlight = null })

    return fetchCoursesInFlight
  },

  fetchCourseDetails: async (courseIds: string[]) => {
    const { courses, enrichedCourseIds } = get()
    const byId = getCoursesById(courses)
    const toFetch = courseIds.filter(id => {
      if (enrichedCourseIds.has(id)) return false
      const existing = byId.get(id)
      return !existing || !hasFullCourseData(existing)
    })
    if (toFetch.length === 0) {
      const locallyEnriched = courseIds.filter(id => {
        const existing = byId.get(id)
        return existing && hasFullCourseData(existing) && !enrichedCourseIds.has(id)
      })
      if (locallyEnriched.length > 0) {
        set(state => ({
          enrichedCourseIds: new Set([...state.enrichedCourseIds, ...locallyEnriched]),
        }))
      }
      return
    }

    try {
      const res = await fetch('/api/courses/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: toFetch }),
      })
      if (!res.ok) throw new Error(`API error: ${res.status}`)
      const rows: any[] = await res.json()
      const enriched = rows.map(rowToCourse)

      set(state => {
        const courseMap = new Map(state.courses.map(c => [c.id, c]))
        for (const c of enriched) courseMap.set(c.id, withDumpOnlyFields(c, courseMap.get(c.id)))
        return {
          courses: Array.from(courseMap.values()),
          enrichedCourseIds: new Set([...state.enrichedCourseIds, ...enriched.map(c => c.id)]),
        }
      })
    } catch (err) {
      console.error('Failed to batch fetch course details:', err)
    }
  },

  fetchCourseDetail: async (courseId: string) => {
    if (get().enrichedCourseIds.has(courseId)) return
    const existing = getCoursesById(get().courses).get(courseId)
    if (existing && hasFullCourseData(existing)) {
      set(state => ({
        enrichedCourseIds: new Set([...state.enrichedCourseIds, courseId]),
      }))
      return
    }

    try {
      const res = await fetch(`/api/courses/${encodeURIComponent(courseId)}`)
      if (!res.ok) throw new Error(`API error: ${res.status}`)
      const row: any = await res.json()
      const enriched = rowToCourse(row)

      // Use functional set to read fresh state — parallel calls would otherwise
      // each overwrite with their own stale snapshot of courses/enrichedCourseIds
      set(state => {
        const failedDetailIds = new Set(state.failedDetailIds)
        failedDetailIds.delete(courseId)
        return {
          courses: state.courses.map(c => c.id === courseId ? withDumpOnlyFields(enriched, c) : c),
          enrichedCourseIds: new Set([...state.enrichedCourseIds, courseId]),
          failedDetailIds,
        }
      })
    } catch (err) {
      console.error(`Failed to fetch detail for ${courseId}:`, err)
      set(state => ({
        failedDetailIds: new Set([...state.failedDetailIds, courseId]),
      }))
    }
  },
}))

// Deliberately NOT fetched at import time: the root layout imports this store,
// so an import-time fetch downloaded the whole catalog on every page including
// the landing page. Screens that show courses call `useEnsureCatalog()`.
