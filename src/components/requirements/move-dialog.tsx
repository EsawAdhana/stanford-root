'use client'

import { useMemo, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { courseInPool, forEachApplied, type AuditCourse } from '@/lib/requirements/audit'
import { countsTowardDegree } from '@/lib/requirements/student-courses'
import { useDegreeStore } from '@/lib/requirements/degree-store'
import type { RuleNode } from '@/lib/requirements/types'
import { compareCourseTerms } from '@/lib/requirements/student-courses'
import { shortTerm, useAudit } from './audit-context'

/**
 * MAP's "Move Classes": put one of your courses into a requirement. Courses on
 * the requirement's list come first; anything else needs an approved
 * exception, and is marked as one. Free-text requirements take any course
 * (MAP's bucket moves).
 */
export function MoveDialog({ target, onClose }: { target: { program: string; node: string } | null; onClose: () => void }) {
  const ctx = useAudit()
  const pin = useDegreeStore(s => s.pin)
  const [showAll, setShowAll] = useState(false)
  const program = target ? [...ctx.result.programs, ...ctx.result.generalEducation].find(p => p.code === target.program) : undefined
  const node = useMemo(() => {
    if (!program || !target) return undefined
    let found: RuleNode | undefined
    const walk = (n: RuleNode) => { if (n.id === target.node) found = n; n.children?.forEach(walk) }
    program.data.blocks.forEach(b => b.rules.forEach(walk))
    return found
  }, [program, target])

  const { listed, other, placement } = useMemo(() => {
    const placement = new Map<string, string>()
    if (program) forEachApplied(program, (a, n) => { if (!placement.has(a.courseId)) placement.set(a.courseId, n.node.name ?? 'a requirement') })
    const listed: AuditCourse[] = []
    const other: AuditCourse[] = []
    if (!node) return { listed, other, placement }
    const courses = [...ctx.result.courses.values()]
      .filter(c => countsTowardDegree(c.status))
      .sort((a, b) => compareCourseTerms(a.course.term, b.course.term) || a.course.code.localeCompare(b.course.code))
    for (const c of courses) (node.t === 'text' || isListed(node, c) ? listed : other).push(c)
    // Courses the program does not use yet first: moving one that is in use
    // takes it out of another requirement.
    const unusedFirst = (a: AuditCourse, b: AuditCourse) => Number(placement.has(a.course.id)) - Number(placement.has(b.course.id))
    listed.sort(unusedFirst)
    other.sort(unusedFirst)
    return { listed, other, placement }
  }, [ctx.result.courses, node, program])

  const move = (c: AuditCourse) => {
    if (!target) return
    pin(c.course.id, target.program, target.node)
    onClose()
  }

  return (
    <Dialog open={Boolean(target && node)} onOpenChange={o => { if (!o) { onClose(); setShowAll(false) } }}>
      <DialogContent className="max-w-lg gap-3">
        <DialogHeader>
          <DialogTitle>Move a class into {node?.name ?? 'this requirement'}</DialogTitle>
          <DialogDescription>
            {program?.data.name}. The audit keeps your move and re-arranges everything else around it.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[55vh] overflow-y-auto">
          {listed.length === 0 && <p className="py-3 text-sm text-muted-foreground">None of your courses are on this requirement&apos;s list.</p>}
          <CourseList courses={listed} placement={placement} onMove={move} />
          {other.length > 0 && node?.t !== 'text' && (
            <div className="mt-3 border-t border-border/60 pt-3">
              <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setShowAll(v => !v)}>
                {showAll ? 'Hide' : 'Show'} {other.length} courses not on the list (only with an approved exception)
              </button>
              {showAll && <CourseList courses={other} placement={placement} onMove={move} />}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function CourseList({ courses, placement, onMove }: { courses: AuditCourse[]; placement: Map<string, string>; onMove: (c: AuditCourse) => void }) {
  return (
    <ul className="divide-y divide-border/50">
      {courses.map(c => (
        <li key={c.course.id} className="flex items-center gap-3 py-2 text-sm">
          <div className="min-w-0 flex-1">
            <div><span className="font-medium">{c.course.code}</span> <span className="text-muted-foreground">{shortTerm(c.course.term)}</span></div>
            <div className="truncate text-xs text-muted-foreground">
              {placement.has(c.course.id) ? `Now in ${placement.get(c.course.id)}` : 'Not used in this program'}
            </div>
          </div>
          <button className="shrink-0 rounded-md border px-2.5 py-1 text-xs hover:bg-accent" onClick={() => onMove(c)}>Move here</button>
        </li>
      ))}
    </ul>
  )
}

function isListed(node: RuleNode, c: AuditCourse): boolean {
  if (node.match) {
    const info = c.info
    if (!info) return false
    if (node.match.way) return info.ways.includes(node.match.way)
    if (node.match.tag) return info.tags.includes(node.match.tag)
    return false
  }
  return Boolean(node.items?.some(item => item.some(code => c.codes.has(code)))) || Boolean(node.pool && courseInPool(node.pool, c.codes, c.info, c.course.code))
}
