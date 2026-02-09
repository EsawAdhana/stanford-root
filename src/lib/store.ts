import { create } from 'zustand'
import type { Course } from '@/types/course'

type CourseStore = {
  courses: Course[]
  isLoading: boolean
  hasLoaded: boolean
  isEnriching: boolean
  hasEnriched: boolean
  fetchCourses: () => Promise<void>
}

const CACHE_KEY = 'root-courses-cache'
const CACHE_VERSION = 4
const CACHE_TTL = 1000 * 60 * 30 // 30 minutes

function readCache (): Course[] | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const { v, ts, data } = JSON.parse(raw)
    if (v !== CACHE_VERSION) return null
    if (Date.now() - ts > CACHE_TTL) return null
    return data
  } catch {
    return null
  }
}

function writeCache (courses: Course[]) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({
      v: CACHE_VERSION,
      ts: Date.now(),
      data: courses
    }))
  } catch {
    // sessionStorage full or unavailable — ignore
  }
}

function rowToCourse (row: any): Course {
  return {
    id: row.course_id,
    subject: row.subject,
    code: row.code,
    title: row.title,
    description: row.description || '',
    units: row.units,
    grading: row.grading || '',
    instructors: row.instructors || [],
    terms: row.terms || [],
    dept: row.dept || undefined,
    sections: row.sections || []
  }
}

export const useCourseStore = create<CourseStore>((set, get) => ({
  courses: [],
  isLoading: false,
  hasLoaded: false,
  isEnriching: false,
  hasEnriched: false,

  fetchCourses: async () => {
    const { isLoading, hasLoaded } = get()
    if (isLoading || hasLoaded) return

    set({ isLoading: true })

    try {
      // ── Cache hit: instant ──
      const cached = readCache()
      if (cached) {
        set({ courses: cached, hasLoaded: true, hasEnriched: true, isLoading: false })
        return
      }

      // ── Phase 1: fetch card-level data via API route (single request, gzipped) ──
      const lightRes = await fetch('/api/courses')
      if (!lightRes.ok) throw new Error(`API error: ${lightRes.status}`)
      const lightRows: any[] = await lightRes.json()
      const lightCourses = lightRows.map(rowToCourse)

      set({ courses: lightCourses, hasLoaded: true, isLoading: false, isEnriching: true })

      // ── Phase 2: fetch full data (with sections) in background ──
      try {
        const fullRes = await fetch('/api/courses?full=1')
        if (!fullRes.ok) throw new Error(`API error: ${fullRes.status}`)
        const fullRows: any[] = await fullRes.json()
        const fullCourses = fullRows.map(rowToCourse)

        writeCache(fullCourses)
        set({ courses: fullCourses, isEnriching: false, hasEnriched: true })
      } catch (err) {
        console.error('Failed to enrich courses:', err)
        // Still cache the light data so we don't refetch next time
        writeCache(lightCourses)
        set({ isEnriching: false, hasEnriched: true })
      }
    } catch (err) {
      console.error('Failed to fetch courses:', err)
      set({ courses: [], hasLoaded: true, isLoading: false })
    }
  }
}))
