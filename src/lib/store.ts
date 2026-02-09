import { create } from 'zustand'
import { supabase } from '@/lib/supabase'
import type { Course } from '@/types/course'

type CourseStore = {
  courses: Course[]
  isLoading: boolean
  hasLoaded: boolean
  fetchCourses: () => Promise<void>
}

// Supabase defaults to 1000 rows — paginate to get all
async function fetchAllCourses () {
  const allRows: any[] = []
  const pageSize = 1000
  let from = 0

  while (true) {
    const { data, error } = await supabase
      .from('courses')
      .select('course_id, quarter, subject, code, title, description, units, grading, instructors, terms, dept, sections')
      .range(from, from + pageSize - 1)

    if (error) throw error
    if (!data || data.length === 0) break

    allRows.push(...data)
    if (data.length < pageSize) break
    from += pageSize
  }

  return allRows
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
      const rows = await fetchAllCourses()

      // Merge courses across quarters (same logic as before)
      const merged = new Map<string, Course>()

      for (const row of rows) {
        const course: Course = {
          id: row.course_id,
          subject: row.subject,
          code: row.code,
          title: row.title,
          description: row.description,
          units: row.units,
          grading: row.grading,
          instructors: row.instructors || [],
          terms: row.terms || [],
          dept: row.dept || undefined,
          sections: row.sections || []
        }

        const existing = merged.get(course.id)
        if (!existing) {
          merged.set(course.id, course)
          continue
        }

        // Combine terms and sections from different quarters
        const terms = Array.from(new Set([...(existing.terms || []), ...(course.terms || [])]))
        const sections = [...(existing.sections || []), ...(course.sections || [])]

        merged.set(course.id, {
          ...existing,
          terms,
          sections
        })
      }

      set({ courses: Array.from(merged.values()), hasLoaded: true })
    } catch (err) {
      console.error('Failed to fetch courses:', err)
      set({ courses: [], hasLoaded: true })
    } finally {
      set({ isLoading: false })
    }
  }
}))
