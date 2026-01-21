import { create } from 'zustand'
import type { Course } from '@/types/course'

type CourseStore = {
  courses: Course[]
  isLoading: boolean
  hasLoaded: boolean
  fetchCourses: () => Promise<void>
}

export const useCourseStore = create<CourseStore>((set, get) => ({
  courses: [],
  isLoading: false,
  hasLoaded: false,
  fetchCourses: async () => {
    const { isLoading, hasLoaded } = get()
    if (isLoading || hasLoaded) return

    set({ isLoading: true })
    try {
      const basePath = (process.env.NEXT_PUBLIC_BASE_PATH || '').replace(/\/$/, '')
      const urls = [
        `${basePath}/data/fall.json`,
        `${basePath}/data/winter.json`,
        `${basePath}/data/spring.json`,
        `${basePath}/data/summer.json`
      ]

      const results = await Promise.allSettled(
        urls.map(url => fetch(url, { cache: 'no-store' }))
      )

      const responses = results
        .filter(r => r.status === 'fulfilled')
        // @ts-ignore
        .map(r => r.value)
        .filter(res => res && res.ok)

      // Back-compat: if split files aren't present yet, fall back to legacy file
      if (responses.length === 0) {
        const res = await fetch(`${basePath}/data/courses.json`, { cache: 'no-store' })
        if (!res.ok) throw new Error(`Failed to fetch courses: ${res.status}`)
        const data = await res.json()
        const courses = Array.isArray(data) ? data : (data?.courses ?? [])
        set({ courses, hasLoaded: true })
        return
      }

      const payloads = await Promise.all(
        responses.map(async res => {
          const data = await res.json()
          return Array.isArray(data) ? data : (data?.courses ?? [])
        })
      )

      const merged = new Map()
      for (const list of payloads) {
        for (const c of list) {
          if (!c || !c.id) continue
          const existing = merged.get(c.id)
          if (!existing) {
            merged.set(c.id, c)
            continue
          }

          const terms = Array.from(new Set([...(existing.terms || []), ...(c.terms || [])]))
          const sections = [...(existing.sections || []), ...(c.sections || [])]

          merged.set(c.id, {
            ...existing,
            terms,
            sections
          })
        }
      }

      set({ courses: Array.from(merged.values()), hasLoaded: true })
    } catch (err) {
      // keep app usable even if data fetch fails
      console.error(err)
      set({ courses: [], hasLoaded: true })
    } finally {
      set({ isLoading: false })
    }
  }
}))
