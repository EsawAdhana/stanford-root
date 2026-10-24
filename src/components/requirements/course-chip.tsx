'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { courseInPool, type AppliedCourse } from '@/lib/requirements/audit'
import { rootCourseId } from '@/lib/requirements/course-index'
import { useDegreeStore } from '@/lib/requirements/degree-store'
import type { ProgramData, RuleNode } from '@/lib/requirements/types'
import { cn } from '@/lib/utils'
import { courseStatusTone } from './status'
import { shortTerm, useAudit } from './audit-context'

/**
 * One course applied to a requirement. Clicking it offers MAP's moves:
 * another requirement it is listed for, out of this program, or back to the
 * solver's choice.
 */
export function CourseChip({ applied, program, node }: { applied: AppliedCourse; program: string; node: RuleNode }) {
  const ctx = useAudit()
  const c = ctx.result.courses.get(applied.courseId)
  const pin = useDegreeStore(s => s.pin)
  const unpin = useDegreeStore(s => s.unpin)
  const setExcluded = useDegreeStore(s => s.setExcluded)
  const updateCourse = useDegreeStore(s => s.updateCourse)
  const programResult = [...ctx.result.programs, ...ctx.result.generalEducation].find(p => p.code === program)
  const data = programResult?.data
  const hasGrad = ctx.result.programs.some(p => p.data.kind === 'grad' && !p.choice.exploring)
  const hasUndergrad = ctx.result.programs.some(p => p.data.kind !== 'grad' && p.data.kind !== 'phd-minor')

  const elsewhere = useMemo(() => {
    if (!c || !programResult) return []
    const included = new Set(programResult.blocks.filter(b => b.included).map(b => b.block.id))
    return listedElsewhere(programResult.data, included, node.id, c.codes, c.info?.ways ?? [])
  }, [c, programResult, node.id])
  if (!c) return null
  const catalogId = rootCourseId(c.course.code)
  const inCatalog = ctx.catalog.has(catalogId)
  const grade = c.course.grade?.trim()

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs transition-colors hover:border-foreground/30',
            courseStatusTone(c.status),
          )}
        >
          <span className="font-semibold">{c.course.code}</span>
          <span className="text-muted-foreground">{shortTerm(c.course.term)}</span>
          {applied.units !== c.units && <span className="text-muted-foreground">{applied.units} u</span>}
          {grade && <span className="text-muted-foreground">{grade}</span>}
          {applied.pinned && <span className="font-medium text-foreground/70">{applied.exception ? 'exception' : 'moved'}</span>}
          {applied.shared && <span className="text-muted-foreground">also counted</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0 text-sm">
        <div className="border-b border-border/60 px-3 py-2">
          <div className="font-medium">{c.course.code} {c.info?.title || c.course.title ? `· ${c.info?.title ?? c.course.title}` : ''}</div>
          <div className="text-xs text-muted-foreground">
            {c.course.term} · {c.units} units{grade ? ` · ${grade}` : ''} · {c.status === 'completed' ? 'Completed' : c.status === 'in-progress' ? 'In progress' : 'Planned'}
            {c.course.source === 'schedule' ? ' · from your schedule' : ''}
          </div>
          {applied.units === 0 && c.units > 0 && (
            <div className="mt-1 text-xs text-muted-foreground">Counts at 0 units here: it is on your undergraduate record.</div>
          )}
          {applied.exception && (
            <div className="mt-1 text-xs text-amber-700 dark:text-amber-400">Not on this requirement&apos;s list in the Bulletin. Count it only with an approved exception.</div>
          )}
        </div>
        <div className="grid gap-0.5 p-1">
          {applied.pinned && (
            <MenuButton onClick={() => unpin(c.course.id, program, node.id)}>Undo move (let the audit place it)</MenuButton>
          )}
          {elsewhere.length > 0 && (
            <div className="px-2 pb-1 pt-1.5 text-xs font-medium text-muted-foreground">Move to</div>
          )}
          {elsewhere.slice(0, 8).map(target => (
            <MenuButton key={target.id} onClick={() => pin(c.course.id, program, target.id)}>
              {target.label}
            </MenuButton>
          ))}
          <MenuButton onClick={() => setExcluded(c.course.id, program, true)}>
            Don&apos;t count toward {data?.name ?? program}
          </MenuButton>
          {hasGrad && hasUndergrad && c.course.source !== 'schedule' && c.course.term !== 'Test credit' && c.course.term !== 'Transfer credit' && (
            <MenuButton onClick={() => updateCourse(c.course.id, { career: c.career === 'GR' ? 'UG' : 'GR' })}>
              Move to the {c.career === 'GR' ? 'undergraduate' : 'graduate'} record
            </MenuButton>
          )}
          {inCatalog && (
            <Link href={`/${encodeURIComponent(catalogId)}`} className="rounded px-2 py-1.5 text-left hover:bg-accent">
              Open course page
            </Link>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function MenuButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="rounded px-2 py-1.5 text-left hover:bg-accent">
      {children}
    </button>
  )
}

/**
 * Other requirements in the program's sections in use whose list includes
 * the course, or, for Ways, another Way the course carries.
 */
function listedElsewhere(data: ProgramData, included: Set<string>, nodeId: string, codes: Set<string>, ways: string[]) {
  const out: { id: string; label: string }[] = []
  const walk = (n: RuleNode, path: string[]) => {
    const listed = n.items?.some(item => item.some(code => codes.has(code))) || (n.match?.way && ways.includes(n.match.way)) || (n.pool && courseInPool(n.pool, codes))
    if (n.t === 'courses' && n.id !== nodeId && listed) {
      out.push({ id: n.id, label: n.name ? n.name : path[path.length - 1] || 'Requirement' })
    }
    n.children?.forEach(child => walk(child, n.name ? [...path, n.name] : path))
  }
  for (const b of data.blocks) if (included.has(b.id)) b.rules.forEach(r => walk(r, [b.name]))
  return out
}
