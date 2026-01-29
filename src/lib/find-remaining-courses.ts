import type { ParsedAudit, RemainingCourse } from '@/types/degree-audit'
import type { Course } from '@/types/course'

interface FindRemainingOptions {
  // Optional override from scraped worker data: "CS106B" -> ["Autumn 2025", "Spring 2026"]
  termsByCourseCode?: Map<string, string[]>
}

/**
 * Extracts courses that are still needed based on the audit.
 * This is a simplified version - in reality, you'd need to match against
 * requirement definitions. For now, we'll identify courses mentioned in
 * requirements that aren't marked as completed.
 */
export function findRemainingCourses (
  audit: ParsedAudit,
  allCourses: Course[],
  options: FindRemainingOptions = {}
): RemainingCourse[] {
  // Build a set of completed course codes (normalized)
  const completedCodes = new Set<string>()
  for (const section of audit.sections) {
    for (const course of section.courses) {
      // Only count courses with passing grades or in progress
      if (course.grade && course.grade !== 'NC' && course.grade !== 'F') {
        completedCodes.add(normalizeCourseCode(course.code))
      }
    }
  }

  // Build a map of course code -> Course from allCourses
  const courseMap = new Map<string, Course>()
  for (const course of allCourses) {
    const normalized = normalizeCourseCode(`${course.subject} ${course.code}`)
    if (!courseMap.has(normalized)) {
      courseMap.set(normalized, course)
    }
  }

  // Find courses mentioned in requirements that aren't completed
  const remaining: RemainingCourse[] = []
  const seen = new Set<string>()

  for (const section of audit.sections) {
    for (const course of section.courses) {
      const normalized = normalizeCourseCode(course.code)
      
      // If not completed and we haven't seen it yet
      if (!completedCodes.has(normalized) && !seen.has(normalized)) {
        const fullCourse = courseMap.get(normalized)
        
        if (fullCourse) {
          const workerTerms = options.termsByCourseCode?.get(normalized) || []
          const catalogTerms = fullCourse.terms || []
          const quartersOffered = uniqStrings([...workerTerms, ...catalogTerms])
          
          remaining.push({
            code: course.code,
            title: fullCourse.title || course.title,
            requirementCategory: course.requirementCategory || section.name,
            quartersOffered
          })
          
          seen.add(normalized)
        }
      }
    }
  }

  return remaining
}

/**
 * Normalize course code for comparison (e.g., "CS 106B" -> "CS106B")
 */
function normalizeCourseCode (code: string): string {
  return code.replace(/\s+/g, '').toUpperCase()
}

function uniqStrings (arr: string[]): string[] {
  return Array.from(new Set((arr || []).filter(Boolean)))
}
