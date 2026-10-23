'use client'

import { createContext, useContext } from 'react'
import type { AuditCourse, AuditResult } from '@/lib/requirements/audit'
import type { CourseIndex } from '@/lib/requirements/course-index'
import type { ProgramData, ProgramIndex } from '@/lib/requirements/types'
import type { Course } from '@/types/course'

export interface AuditContextValue {
  result: AuditResult
  courseIndex: CourseIndex
  programIndex: ProgramIndex
  programs: Map<string, ProgramData>
  /** Stanford Root's own catalog for this year, by id ("CS106B"): terms offered, ratings. */
  catalog: Map<string, Course>
  /** Open the move dialog for a requirement. */
  openMove: (program: string, nodeId: string) => void
}

export const AuditContext = createContext<AuditContextValue | null>(null)

export function useAudit(): AuditContextValue {
  const value = useContext(AuditContext)
  if (!value) throw new Error('useAudit outside AuditContext')
  return value
}

export function auditCourse(ctx: AuditContextValue, id: string): AuditCourse | undefined {
  return ctx.result.courses.get(id)
}

/** "Autumn 2024" -> "Aut 24"; credit terms stay as they are. */
export function shortTerm(term: string): string {
  const m = /^(Autumn|Winter|Spring|Summer) (\d{4})$/.exec(term)
  if (!m) return term
  return `${m[1].slice(0, 3)} ${m[2].slice(2)}`
}
