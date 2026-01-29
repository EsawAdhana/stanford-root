'use client'

import { RemainingCourse } from '@/types/degree-audit'
import { cn } from '@/lib/utils'
import { Calendar, BookOpen } from 'lucide-react'

interface RemainingCoursesListProps {
  courses: RemainingCourse[]
}

export function RemainingCoursesList ({ courses }: RemainingCoursesListProps) {
  if (courses.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p className="text-lg font-medium mb-2">All requirements complete!</p>
        <p className="text-sm">No remaining courses found.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-4">
        <BookOpen className="h-5 w-5 text-primary" />
        <h2 className="text-xl font-semibold">
          Remaining Courses ({courses.length})
        </h2>
      </div>

      <div className="space-y-3">
        {courses.map((course, index) => (
          <div
            key={`${course.code}-${index}`}
            className="border border-border rounded-lg p-4 hover:bg-secondary/50 transition-colors"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-semibold text-foreground">{course.code}</h3>
                  {course.requirementCategory && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                      {course.requirementCategory}
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground mb-3">
                  {course.title}
                </p>

                {course.quartersOffered.length > 0 ? (
                  <div className="flex items-center gap-2 flex-wrap">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    <div className="flex items-center gap-2 flex-wrap">
                      {course.quartersOffered.map((quarter, qIndex) => (
                        <span
                          key={qIndex}
                          className="text-xs px-2 py-1 rounded-md bg-secondary text-foreground border border-border"
                        >
                          {quarter}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground italic">
                    Quarter information not available
                  </p>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
