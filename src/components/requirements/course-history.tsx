'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { forEachApplied, type AuditCourse } from '@/lib/requirements/audit'
import { rootCourseId } from '@/lib/requirements/course-index'
import { useDegreeStore } from '@/lib/requirements/degree-store'
import { academicYear, compareCourseTerms } from '@/lib/requirements/student-courses'
import { compareTerms, getCurrentTerm } from '@/lib/terms'
import { cn } from '@/lib/utils'
import { courseStatusTone } from './status'
import { useAudit } from './audit-context'

const GRADES = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-', 'CR', 'S', 'NP', 'NC', 'W']
const GE_SHORT: Record<string, string> = { 'GE-COLLEGE': 'COLLEGE', 'GE-WAYS': 'Ways', 'GE-WRITING': 'Writing', 'GE-LANGUAGE': 'Language' }
const STATUS_TEXT: Record<string, string> = { completed: 'Completed', 'in-progress': 'In progress', planned: 'Planned', failed: 'Not passed', withdrawn: 'Withdrawn' }

/**
 * Stanford's quarter load rules for undergraduates: at most 20 units, and at
 * least 12 to be enrolled full time. Only the second is worth saying about
 * terms still ahead; a past light quarter is history.
 */
function loadNote(term: string, units: number): string | null {
  const m = /^(Autumn|Winter|Spring|Summer) \d{4}$/.exec(term)
  if (!m || m[1] === 'Summer') return null
  if (units > 20) return 'over the 20-unit maximum'
  if (units > 0 && units < 12 && compareTerms(term, getCurrentTerm()) >= 0) return 'under 12 units, below full time'
  return null
}

/**
 * Every course the audit sees, quarter by quarter: My Academic Path's class
 * history, with the plan ahead in the same list.
 */
export function CourseHistory({ onAdd, onImport }: { onAdd: (term?: string) => void; onImport: () => void }) {
  const ctx = useAudit()
  const useSchedule = useDegreeStore(s => s.useSchedule)
  const setUseSchedule = useDegreeStore(s => s.setUseSchedule)
  const removeCourse = useDegreeStore(s => s.removeCourse)
  const updateCourse = useDegreeStore(s => s.updateCourse)
  const showCareer = ctx.result.programs.some(p => p.data.kind === 'grad') && ctx.result.programs.some(p => p.data.kind !== 'grad')

  const usedIn = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const r of [...ctx.result.programs, ...ctx.result.generalEducation]) {
      if (r.choice.exploring) continue
      const label = r.isGeneralEducation ? GE_SHORT[r.code] ?? r.data.name : r.data.code
      forEachApplied(r, a => {
        const list = map.get(a.courseId) ?? []
        if (!list.includes(label)) list.push(label)
        map.set(a.courseId, list)
      })
    }
    return map
  }, [ctx.result])

  const groups = useMemo(() => {
    const byTerm = new Map<string, AuditCourse[]>()
    for (const c of ctx.result.courses.values()) {
      const list = byTerm.get(c.course.term) ?? []
      list.push(c)
      byTerm.set(c.course.term, list)
    }
    return [...byTerm.entries()]
      .sort(([a], [b]) => compareCourseTerms(a, b))
      .map(([term, list]) => ({ term, list: list.sort((a, b) => a.course.code.localeCompare(b.course.code, undefined, { numeric: true })) }))
  }, [ctx.result.courses])

  const units = ctx.result.undergradUnits

  if (groups.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center">
        <p className="font-medium">No courses yet</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
          Import your unofficial transcript, add courses by hand, or put classes on your schedule. The audit updates as you go.
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <Button onClick={onImport}>Import transcript</Button>
          <Button variant="outline" onClick={() => onAdd()}>Add a course</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <label className="flex cursor-pointer items-center gap-2 text-muted-foreground">
          <input type="checkbox" className="accent-[hsl(var(--primary))]" checked={useSchedule} onChange={e => setUseSchedule(e.target.checked)} />
          Count the classes on my <Link href="/schedule" className="underline hover:text-foreground">schedule</Link>
        </label>
        {units && (
          <span className="text-muted-foreground">
            {units.completed} units completed, {units.inProgress} in progress, {units.planned} planned
          </span>
        )}
      </div>

      {groups.map(({ term, list }, i) => {
        const year = academicYear(term)
        const prevYear = i > 0 ? academicYear(groups[i - 1].term) : null
        const termUnits = list.reduce((s, c) => s + c.units, 0)
        return (
          <section key={term}>
            {year && year !== prevYear && <h3 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{year}</h3>}
            <div className="rounded-xl border border-border/60 bg-card">
              <div className="flex items-center justify-between border-b border-border/60 px-4 py-2">
                <h4 className="text-sm font-semibold">{term}</h4>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  {loadNote(term, termUnits) && <span className="text-amber-700 dark:text-amber-400">{loadNote(term, termUnits)}</span>}
                  <span className="tabular-nums">{termUnits} units</span>
                  <button className="text-primary hover:underline" onClick={() => onAdd(term)}>Add</button>
                </div>
              </div>
              <ul className="divide-y divide-border/50">
                {list.map(c => {
                  const editable = c.course.source !== 'schedule'
                  const where = usedIn.get(c.course.id)
                  const catalogId = rootCourseId(c.course.code)
                  return (
                    <li key={c.course.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm">
                      <span className={cn('h-2 w-2 shrink-0 rounded-full border', courseStatusTone(c.status))} aria-hidden />
                      <span className="w-24 shrink-0 font-medium">
                        {ctx.catalog.has(catalogId)
                          ? <Link href={`/${encodeURIComponent(catalogId)}`} className="hover:text-primary hover:underline">{c.course.code}</Link>
                          : c.course.code}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-muted-foreground">{c.info?.title ?? c.course.title ?? ''}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {where?.length ? `Counts for ${where.join(', ')}` : 'Not applied'}
                      </span>
                      {editable ? (
                        <>
                          <input
                            aria-label="Units"
                            defaultValue={c.units}
                            inputMode="decimal"
                            className="h-7 w-12 rounded border border-input bg-background px-1.5 text-right text-xs tabular-nums"
                            onBlur={e => {
                              const u = Number(e.target.value)
                              if (Number.isFinite(u) && u >= 0 && u !== c.units) updateCourse(c.course.id, { units: u })
                            }}
                          />
                          <Select value={c.course.grade || 'none'} onValueChange={v => updateCourse(c.course.id, { grade: v === 'none' ? undefined : v })}>
                            <SelectTrigger className="h-7 w-[5.5rem] text-xs" aria-label="Grade"><SelectValue /></SelectTrigger>
                            <SelectContent className="max-h-72">
                              <SelectItem value="none" className="text-xs">No grade</SelectItem>
                              {GRADES.map(g => <SelectItem key={g} value={g} className="text-xs">{g}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          {showCareer && (
                            <button
                              className="w-10 shrink-0 text-xs text-muted-foreground hover:text-foreground"
                              title="Which record the course is on"
                              onClick={() => updateCourse(c.course.id, { career: c.career === 'GR' ? 'UG' : 'GR' })}
                            >
                              {c.career === 'GR' ? 'Grad' : 'Ugrad'}
                            </button>
                          )}
                          <button className="shrink-0 text-xs text-muted-foreground hover:text-red-600" onClick={() => removeCourse(c.course.id)}>Remove</button>
                        </>
                      ) : (
                        <span className="shrink-0 text-xs text-muted-foreground">{c.units} units · {STATUS_TEXT[c.status]} · on your schedule</span>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          </section>
        )
      })}
    </div>
  )
}
