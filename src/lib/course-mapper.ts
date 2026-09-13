import type { Course } from '@/types/course'
import { isWimCourse } from '@/lib/wim-courses'
import { isLanguageCourse } from '@/lib/language-courses'
import { normalizeCatalogDescription, normalizeCatalogTitle } from '@/lib/utils'

/**
 * Map a raw Supabase course row (merged via mergeCourseRows) to a Course,
 * injecting the WIM and Language GERs. Shared by the client store and the
 * server-rendered course page so both produce identical Course objects.
 */
export function rowToCourse(row: any): Course {
  const isWim = isWimCourse(row.subject, row.code)
  const sections = row.sections || []

  // Inject WIM GER if applicable
  if (isWim) {
    sections.forEach((s: any) => {
      if (!s.gers) s.gers = []
      if (!s.gers.includes('Writing in the Major (WIM)')) {
        s.gers.push('Writing in the Major (WIM)')
      }
    })
  }

  // Inject Language GER if description/subject indicates a language course
  if (isLanguageCourse(row.description || '', row.subject)) {
    sections.forEach((s: any) => {
      if (!s.gers) s.gers = []
      if (!s.gers.includes('Language')) {
        s.gers.push('Language')
      }
    })
  }

  return {
    id: row.course_id,
    subject: row.subject,
    code: row.code,
    title: normalizeCatalogTitle(row.title),
    description: normalizeCatalogDescription(row.description),
    units: row.units,
    grading: row.grading || '',
    instructors: row.instructors || [],
    terms: row.terms || [],
    sections: sections,
    hours: row.hours != null ? Number(row.hours) : undefined,
    quality: row.quality != null ? Number(row.quality) : undefined,
    qualityPct: row.quality_pct != null ? Number(row.quality_pct) : undefined,
    rankScope: row.rank_scope != null ? String(row.rank_scope) : undefined,
    qualityN: row.quality_n != null ? Number(row.quality_n) : undefined,
    ratingBreakdown: row.rating_breakdown ?? undefined,
    crossListWith: Array.isArray(row.cross_list_with) ? row.cross_list_with : undefined,
    isNew: typeof row.isNew === 'boolean' ? row.isNew : undefined,
  }
}
