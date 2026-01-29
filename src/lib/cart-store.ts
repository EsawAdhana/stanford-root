import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Course } from '@/types/course'
import { makeMeetingKey } from '@/lib/schedule-utils'

export type CartItem = Course & {
  selectedTerm?: string
  selectedSectionId?: number
}

type CartStore = {
  items: CartItem[]
  addItem: (course: Course, term?: string, sectionId?: number, selectedUnits?: number) => void
  removeItem: (courseId: string) => void
  hasItem: (courseId: string) => boolean
  getItem: (courseId: string) => CartItem | undefined
  toggleOptionalMeeting: (courseId: string, day: string, startTime: string, endTime: string) => void
}

export const useCartStore = create<CartStore>()(
  persist(
    (set, get) => ({
      items: [],
      addItem: (course, term, sectionId, selectedUnits) => {
        const currentItems = get().items
        const existingIndex = currentItems.findIndex(c => c.id === course.id)

        const courseWithTerm: CartItem = {
          ...course,
          selectedTerm: term || course.selectedTerm || (course.terms ? course.terms[0] : course.term),
          selectedSectionId: sectionId,
          selectedUnits: selectedUnits !== undefined ? selectedUnits : course.selectedUnits
        }

        if (existingIndex >= 0) {
          const newItems = [...currentItems]
          newItems[existingIndex] = { ...newItems[existingIndex], ...courseWithTerm }
          set({ items: newItems })
          return
        }

        set(state => ({ items: [...state.items, courseWithTerm] }))
      },
      removeItem: (courseId) => {
        set(state => ({ items: state.items.filter(c => c.id !== courseId) }))
      },
      hasItem: (courseId) => {
        return get().items.some(c => c.id === courseId)
      },
      getItem: (courseId) => {
        return get().items.find(c => c.id === courseId)
      },
      toggleOptionalMeeting: (courseId, day, startTime, endTime) => {
        const currentItems = get().items
        const courseIndex = currentItems.findIndex(c => c.id === courseId)
        if (courseIndex < 0) return

        const course = currentItems[courseIndex]
        const meetingKey = makeMeetingKey(day, startTime, endTime)
        const optionalMeetings = course.optionalMeetings ? [...course.optionalMeetings] : []
        const keyIndex = optionalMeetings.indexOf(meetingKey)

        if (keyIndex >= 0) {
          optionalMeetings.splice(keyIndex, 1)
        } else {
          optionalMeetings.push(meetingKey)
        }

        const newItems = [...currentItems]
        newItems[courseIndex] = {
          ...course,
          optionalMeetings: optionalMeetings.length > 0 ? optionalMeetings : undefined
        }

        set({ items: newItems })
      }
    }),
    {
      name: 'navigator-cart',
      version: 1
    }
  )
)
