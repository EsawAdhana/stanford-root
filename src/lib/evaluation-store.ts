import { create } from 'zustand'
import { supabase } from '@/lib/supabase'
import type { CourseEvaluation } from '@/types/course'

type EvaluationStore = {
  evaluations: Record<string, CourseEvaluation[]>
  loadingCourses: Record<string, boolean>
  errorCourses: Record<string, boolean>
  fetchCourseEvaluations: (courseId: string) => Promise<void>
  getEvaluations: (courseId: string) => CourseEvaluation[]
  isLoadingCourse: (courseId: string) => boolean
  hasErrorForCourse: (courseId: string) => boolean
}

export const useEvaluationStore = create<EvaluationStore>((set, get) => ({
  evaluations: {},
  loadingCourses: {},
  errorCourses: {},

  fetchCourseEvaluations: async (courseId) => {
    const { evaluations, loadingCourses } = get()

    // Already cached or currently loading
    if (evaluations[courseId] || loadingCourses[courseId]) return

    set(state => ({
      loadingCourses: { ...state.loadingCourses, [courseId]: true },
      errorCourses: { ...state.errorCourses, [courseId]: false }
    }))

    try {
      const { data, error } = await supabase
        .from('evaluations')
        .select('term, instructor, course_code, respondents, questions, comments')
        .eq('course_id', courseId)

      if (error) throw error

      // Map snake_case DB columns back to camelCase for the frontend
      const mapped: CourseEvaluation[] = (data || []).map(row => ({
        // Clean term: "Spring 2024Computer Science" -> "Spring 2024"
        term: row.term.replace(/(\d{4})\D.*$/, '$1'),
        instructor: row.instructor,
        courseCode: row.course_code,
        respondents: row.respondents,
        questions: row.questions,
        comments: row.comments
      }))

      set(state => ({
        evaluations: { ...state.evaluations, [courseId]: mapped },
        loadingCourses: { ...state.loadingCourses, [courseId]: false }
      }))
    } catch (err) {
      console.error(`Failed to load evaluations for ${courseId}:`, err)
      set(state => ({
        evaluations: { ...state.evaluations, [courseId]: [] },
        loadingCourses: { ...state.loadingCourses, [courseId]: false },
        errorCourses: { ...state.errorCourses, [courseId]: true }
      }))
    }
  },

  getEvaluations: (courseId) => {
    const { evaluations } = get()
    return evaluations[courseId] || []
  },

  isLoadingCourse: (courseId) => {
    const { loadingCourses } = get()
    return !!loadingCourses[courseId]
  },

  hasErrorForCourse: (courseId) => {
    const { errorCourses } = get()
    return !!errorCourses[courseId]
  }
}))
