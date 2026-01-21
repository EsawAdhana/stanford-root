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
      const res = await fetch('/data/courses.json', { cache: 'no-store' })
      if (!res.ok) throw new Error(`Failed to fetch courses: ${res.status}`)

      const data = await res.json()
      const courses = Array.isArray(data) ? data : (data?.courses ?? [])
      set({ courses, hasLoaded: true })
    } catch (err) {
      // keep app usable even if data fetch fails
      console.error(err)
      set({ courses: [], hasLoaded: true })
    } finally {
      set({ isLoading: false })
    }
  }
}))
