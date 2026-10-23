'use client'

import { useEffect, useMemo, useState } from 'react'
import { useCartStore, type CartItem } from '@/lib/cart-store'
import { normalizeCode } from '@/lib/requirements/course-index'
import type { CourseIndex } from '@/lib/requirements/course-index'
import { loadCourseIndex, loadProgram, loadProgramIndex } from '@/lib/requirements/data'
import { useDegreeStore } from '@/lib/requirements/degree-store'
import { runAudit, type AuditResult } from '@/lib/requirements/audit'
import type { ProgramData, ProgramIndex, StudentCourse } from '@/lib/requirements/types'
import { parseUnitsOptions } from '@/lib/utils'

export type DegreeAudit =
  | { state: 'loading' }
  | { state: 'error'; message: string; retry: () => void }
  | {
      state: 'ready'
      programIndex: ProgramIndex
      courseIndex: CourseIndex
      programs: Map<string, ProgramData>
      result: AuditResult
      /** Every attempt the audit saw: recorded courses plus the schedule's. */
      courses: StudentCourse[]
    }

/**
 * Schedule courses as planned attempts. Units are the student's pick on the
 * schedule, else the most the course allows (a 3-5 unit CS course is taken
 * for 5 by undergraduates).
 */
export function scheduleCourses(items: CartItem[], recorded: StudentCourse[]): StudentCourse[] {
  const taken = new Set(recorded.map(c => `${normalizeCode(c.code)}|${c.term}`))
  const out: StudentCourse[] = []
  for (const item of items) {
    if (!item.selectedTerm) continue
    const code = normalizeCode(item.subject && item.code ? `${item.subject} ${item.code}` : item.id)
    if (taken.has(`${code}|${item.selectedTerm}`)) continue
    const options = parseUnitsOptions(item.units ?? '')
    out.push({
      id: `schedule:${item.id}:${item.selectedTerm}`,
      code,
      term: item.selectedTerm,
      units: item.selectedUnits ?? options[options.length - 1] ?? 0,
      title: item.title,
      source: 'schedule',
    })
  }
  return out
}

export function useDegreeAudit(): DegreeAudit {
  const programs = useDegreeStore(s => s.programs)
  const recorded = useDegreeStore(s => s.courses)
  const overrides = useDegreeStore(s => s.overrides)
  const useSchedule = useDegreeStore(s => s.useSchedule)
  const generalEducation = useDegreeStore(s => s.generalEducation)
  const cart = useCartStore(s => s.items)

  const [programIndex, setProgramIndex] = useState<ProgramIndex | null>(null)
  const [courseIndex, setCourseIndex] = useState<CourseIndex | null>(null)
  const [loaded, setLoaded] = useState<Map<string, ProgramData>>(new Map())
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    setError(null)
    loadProgramIndex()
      .then(index => {
        if (cancelled) return
        setProgramIndex(index)
        return loadCourseIndex(index.version).then(ci => { if (!cancelled) setCourseIndex(ci) })
      })
      .catch(err => { if (!cancelled) setError(String(err?.message ?? err)) })
    return () => { cancelled = true }
  }, [attempt])

  const codes = programs.map(p => p.code).join(',')
  useEffect(() => {
    if (!programIndex) return
    let cancelled = false
    const wanted = codes ? codes.split(',') : []
    const known = new Set(programIndex.programs.map(p => p.code))
    Promise.all(wanted.filter(c => known.has(c)).map(c => loadProgram(c, programIndex.version).then(d => [c, d] as const)))
      .then(entries => { if (!cancelled) setLoaded(new Map(entries)) })
      .catch(err => { if (!cancelled) setError(String(err?.message ?? err)) })
    return () => { cancelled = true }
  }, [codes, programIndex])

  const courses = useMemo(
    () => (useSchedule ? [...recorded, ...scheduleCourses(cart, recorded)] : recorded),
    [recorded, cart, useSchedule],
  )

  const result = useMemo(() => {
    if (!courseIndex) return null
    const ready = programs.filter(p => loaded.has(p.code))
    // Hold the previous audit until every program file is in, so adding a
    // program does not briefly show the others recomputed without it.
    if (ready.length !== programs.filter(p => programIndex?.programs.some(x => x.code === p.code)).length) return null
    const hasUndergrad = ready.some(p => {
      const k = loaded.get(p.code)!.kind
      return k === 'major' || k === 'minor' || k === 'honors'
    })
    return runAudit({
      programs: ready.map(choice => ({ data: loaded.get(choice.code)!, choice })),
      courses,
      index: courseIndex,
      overrides,
      generalEducation: generalEducation && (hasUndergrad || ready.length === 0),
    })
  }, [courseIndex, programs, loaded, courses, overrides, generalEducation, programIndex])

  const [last, setLast] = useState<AuditResult | null>(null)
  useEffect(() => { if (result) setLast(result) }, [result])

  if (error) return { state: 'error', message: error, retry: () => setAttempt(a => a + 1) }
  const shown = result ?? last
  if (!programIndex || !courseIndex || !shown) return { state: 'loading' }
  return { state: 'ready', programIndex, courseIndex, programs: loaded, result: shown, courses }
}
