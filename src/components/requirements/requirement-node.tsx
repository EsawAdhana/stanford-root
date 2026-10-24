'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import type { NodeResult } from '@/lib/requirements/audit'
import { courseInPool, nodeKey } from '@/lib/requirements/audit'
import { rootCourseId } from '@/lib/requirements/course-index'
import { useDegreeStore } from '@/lib/requirements/degree-store'
import { WAY_NAMES } from '@/lib/requirements/general-education'
import type { RuleNode } from '@/lib/requirements/types'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { CourseChip } from './course-chip'
import { StatusMark, StatusText } from './status'
import { shortTerm, useAudit, type AuditContextValue } from './audit-context'

function ruleTitle(n: RuleNode): string {
  if (n.name) return n.name
  if (n.t === 'courses') return n.mode === 'all' ? 'Required courses' : 'Courses'
  return 'Requirement'
}

const plural = (n: number, word: string) => `${word}${n === 1 ? '' : 's'}`

/** "1 of 2 courses", or "3 courses, 2 needed" once a rule has more than it asks for. */
function amount(have: number, need: number, word: string): string {
  if (have > need) return `${have} ${plural(have, word)}, ${need} needed`
  return `${have} of ${need} ${plural(need, word)}`
}

const MANUAL_LABEL: Record<NonNullable<RuleNode['manual']>, string> = {
  approval: 'Needs department approval',
  milestone: 'Program milestone',
  exam: 'Exam',
  thesis: 'Thesis or dissertation',
  gpa: 'GPA requirement',
  residency: 'Residency requirement',
  other: 'Check with your department',
}

/** What the rule asks of each course: "3+ units each · letter grade · at most 1 creative writing workshop". */
function conditions(n: RuleNode): string {
  const parts: string[] = []
  if (n.minUnitsEach) parts.push(`${n.minUnitsEach}+ units each`)
  if (n.letter) parts.push('letter grade')
  if (n.minGrade) parts.push(`${n.minGrade} or better`)
  for (const l of n.limits ?? []) {
    if (l.max !== undefined) parts.push(`${l.label}: at most ${l.max}`)
    if (l.maxUnits !== undefined) parts.push(`${l.label}: at most ${l.maxUnits} units`)
  }
  return parts.length ? ` · ${parts.join(' · ')}` : ''
}

function summary(r: NodeResult): string | null {
  const n = r.node
  if (r.status === 'info' || r.status === 'inactive') return null
  if (n.t === 'text') {
    const label = n.manual ? MANUAL_LABEL[n.manual] : 'Set in the Bulletin text'
    if (r.applied.length) {
      if (n.units) return `${amount(r.have.units, n.units, 'unit')} moved here`
      return n.n ? amount(r.applied.length, n.n, 'course') : `${r.applied.length} moved here`
    }
    if (n.units) return `${n.units} units, ${label.toLowerCase()}`
    if (n.n) return `${n.n} ${plural(n.n, 'course')}, ${label.toLowerCase()}`
    return label
  }
  const choices = n.children?.length ?? 0
  if (n.t === 'any' && choices > 1) return 'Choose one'
  if (n.t === 'some' && choices > (n.n ?? 1)) return `Choose ${n.n} of ${choices}`
  if (n.t !== 'courses') return r.floor ? amount(r.floor.have, r.floor.need, 'unit') : null
  const units = r.need?.units && n.mode !== 'units' ? ` · ${amount(r.have.units, r.need.units, 'unit')}` : ''
  const extra = conditions(n)
  if (n.optional) return r.applied.length ? `${r.applied.length} applied, optional` : 'Optional'
  switch (n.mode) {
    case 'all': return `${amount(r.have.courses, n.items?.length ?? 0, 'course')}${units}${extra}`
    case 'atLeast': return `${amount(r.have.courses, n.n ?? 1, 'course')}${units}${extra}`
    case 'units': return `${amount(r.have.units, n.units ?? 0, 'unit')}${extra}`
    default:
      if (n.n) return `${amount(r.have.courses, n.n, 'course')}${extra}`
      if (n.units) return `${amount(r.have.units, n.units, 'unit')}${extra}`
      return (r.applied.length ? `${r.applied.length} ${plural(r.applied.length, 'course')}` : 'At least one course') + extra
  }
}

export function RequirementNode({ result, program, depth = 0 }: { result: NodeResult; program: string; depth?: number }) {
  const n = result.node
  const [open, setOpen] = useState(result.status !== 'complete' && result.status !== 'info')
  const [showText, setShowText] = useState(false)
  const ctx = useAudit()
  const setDone = useDegreeStore(s => s.setDone)
  const setPath = useDegreeStore(s => s.setPath)
  const key = nodeKey(program, n.id)
  const hasChildren = Boolean(result.children?.length)
  const isChoice = (n.t === 'any' || n.t === 'some') && (n.children?.length ?? 0) > 1
  const text = [n.desc, n.notes].filter(Boolean).join('\n\n')
  const sum = summary(result)

  if (result.status === 'info') {
    if (!text) return null
    return (
      <div className={cn('py-2 text-sm', depth > 0 && 'pl-6')}>
        <button className="flex items-center gap-1 text-muted-foreground hover:text-foreground" onClick={() => setShowText(v => !v)}>
          <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', showText && 'rotate-90')} />
          {ruleTitle(n)}
        </button>
        {showText && <BulletinText text={text} />}
      </div>
    )
  }

  const active = result.children?.filter(c => c.status !== 'inactive') ?? []
  const unused = result.children?.filter(c => c.status === 'inactive') ?? []

  return (
    <div className={cn('py-2', depth > 0 && 'pl-6')}>
      <div className="flex items-start gap-2">
        <button
          onClick={() => setOpen(v => !v)}
          className="mt-0.5 flex min-w-0 flex-1 items-start gap-2 text-left"
          aria-expanded={open}
        >
          <StatusMark status={result.status} className="mt-0.5" />
          <span className="min-w-0 flex-1">
            <span className="font-medium">{ruleTitle(n)}</span>
            {sum && <span className="ml-2 text-xs text-muted-foreground">{sum}</span>}
            {result.floor && n.t !== 'courses' && n.t !== 'text' && !sum?.includes('unit') && (
              <span className="ml-2 text-xs text-muted-foreground">{amount(result.floor.have, result.floor.need, 'unit')}</span>
            )}
            {result.doneByStudent && <span className="ml-2 text-xs text-muted-foreground">marked met by you</span>}
          </span>
        </button>
        <StatusText status={result.status} className="mt-0.5 hidden shrink-0 sm:inline" />
      </div>

      {open && (
        <div className="ml-6 mt-1.5 space-y-2">
          {isChoice && n.t === 'any' && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>Path</span>
              <Select
                value={result.chosen?.[0]}
                onValueChange={v => setPath(key, v)}
              >
                <SelectTrigger className="h-8 w-auto max-w-[22rem] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {n.children!.map(c => (
                    <SelectItem key={c.id} value={c.id} className="text-xs">{ruleTitle(c)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {result.auto ? <span>picked for you</span> : (
                <button className="underline hover:text-foreground" onClick={() => setPath(key, undefined)}>let the audit pick</button>
              )}
            </div>
          )}

          {n.t === 'courses' && n.mode === 'all' && !n.optional ? (
            <ItemChecklist result={result} program={program} />
          ) : result.applied.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {result.applied.map(a => <CourseChip key={a.courseId} applied={a} program={program} node={n} />)}
            </div>
          ) : null}

          {result.belowGrade?.length ? (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              {result.belowGrade.map(id => ctx.result.courses.get(id)?.course.code ?? id).join(', ')} {result.belowGrade.length === 1 ? 'was' : 'were'} moved here but {result.belowGrade.length === 1 ? 'does' : 'do'} not count: the grade or units do not meet this requirement{gradeRule(n, program, ctx)}. If your department approved it anyway, mark the requirement as met.
            </p>
          ) : null}

          {n.t === 'courses' && n.mode === 'atLeast' && (n.n ?? 0) > (n.items?.length ?? 0) && !n.match && (
            <p className="text-xs text-muted-foreground">The Bulletin lists fewer courses here than it asks for. Move in the course your department approved.</p>
          )}

          {(n.t === 'courses' || n.t === 'text') && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
              <button className="text-primary hover:underline" onClick={() => ctx.openMove(program, n.id)}>Move a class here</button>
              {n.t === 'courses' && result.status !== 'complete' && !n.optional && <OptionsToggle result={result} />}
              {text && <button className="text-muted-foreground hover:text-foreground" onClick={() => setShowText(v => !v)}>{showText ? 'Hide' : 'Bulletin text'}</button>}
              {(result.doneByStudent || ((n.t === 'text' || result.status === 'incomplete') && result.status !== 'complete')) && (
                <button className="text-muted-foreground hover:text-foreground" onClick={() => setDone(key, !result.doneByStudent)}>
                  {result.doneByStudent ? 'Unmark' : 'Mark as met'}
                </button>
              )}
            </div>
          )}
          {hasChildren && text && (
            <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setShowText(v => !v)}>{showText ? 'Hide' : 'Bulletin text'}</button>
          )}
          {showText && <BulletinText text={text} />}

          {hasChildren && (
            <div className="-ml-6">
              {active.map(c => <RequirementNode key={c.node.id} result={c} program={program} depth={depth + 1} />)}
              {unused.length > 0 && n.t === 'some' && (
                <p className="pl-6 pt-1 text-xs text-muted-foreground">
                  Not used for your best path: {unused.map(c => ruleTitle(c.node)).join(', ')}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function BulletinText({ text }: { text: string }) {
  return (
    <div className="max-w-prose whitespace-pre-line rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
      {text}
    </div>
  )
}

/** "Complete all of" rules: each listed course, met or not, the way a program sheet reads. */
function ItemChecklist({ result, program }: { result: NodeResult; program: string }) {
  const ctx = useAudit()
  const items = result.node.items ?? []
  const byItem = new Map<number, typeof result.applied[number]>()
  for (const a of result.applied) {
    const c = ctx.result.courses.get(a.courseId)
    if (!c) continue
    const i = items.findIndex((item, idx) => !byItem.has(idx) && item.some(code => c.codes.has(code)))
    byItem.set(i >= 0 ? i : items.findIndex((_, idx) => !byItem.has(idx)), a)
  }
  return (
    <ul className="space-y-1 text-sm">
      {items.map((item, i) => {
        const applied = byItem.get(i)
        const c = applied ? ctx.result.courses.get(applied.courseId) : undefined
        return (
          <li key={i} className="flex flex-wrap items-center gap-2">
            <StatusMark status={!c ? 'incomplete' : c.status === 'completed' ? 'complete' : c.status === 'in-progress' ? 'in-progress' : 'planned'} />
            <span className={cn(!c && 'text-muted-foreground')}>
              {item.map((code, j) => (
                <span key={code}>
                  {j > 0 && <span className="text-muted-foreground"> or </span>}
                  <CourseLink code={code} />
                </span>
              ))}
            </span>
            {applied && <CourseChip applied={applied} program={program} node={result.node} />}
          </li>
        )
      })}
    </ul>
  )
}

function CourseLink({ code }: { code: string }) {
  const ctx = useAudit()
  const id = rootCourseId(code)
  const title = ctx.courseIndex.get(code)?.title
  if (!ctx.catalog.has(id)) return <span title={title}>{code}</span>
  return (
    <Link href={`/${encodeURIComponent(id)}`} title={title} className="hover:text-primary hover:underline">
      {code}
    </Link>
  )
}

function OptionsToggle({ result }: { result: NodeResult }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button className="text-muted-foreground hover:text-foreground" onClick={() => setOpen(v => !v)}>
        {open ? 'Hide options' : 'Courses that count'}
      </button>
      {open && <div className="basis-full"><Options result={result} /></div>}
    </>
  )
}

/**
 * Courses that would count here, offered ones first: this year's terms and
 * ratings come from Stanford Root's catalog.
 */
function Options({ result }: { result: NodeResult }) {
  const ctx = useAudit()
  const [all, setAll] = useState(false)
  const n = result.node
  const options = useMemo(() => {
    const taken = new Set<string>()
    for (const c of ctx.result.courses.values()) for (const code of c.codes) taken.add(code)
    let codes: string[]
    if (n.match?.way) {
      const way = n.match.way
      codes = [...ctx.catalog.values()]
        .map(c => `${c.subject} ${c.code}`)
        .filter(code => {
          const info = ctx.courseIndex.get(code)
          return info && info.ways.includes(way) && !info.tags.includes('GR') && info.max >= (n.match?.minUnits ?? 0)
        })
    } else if (n.match?.tag) {
      const tag = n.match.tag
      codes = [...ctx.catalog.values()].map(c => `${c.subject} ${c.code}`).filter(code => ctx.courseIndex.get(code)?.tags.includes(tag))
    } else {
      codes = [...new Set((n.items ?? []).flat())]
      if (n.pool) {
        // A pool is a whole department: what it offers this year is what helps.
        const pool = n.pool
        for (const c of ctx.catalog.values()) {
          const code = `${c.subject} ${c.code}`
          if (courseInPool(pool, [code], ctx.courseIndex.get(code))) codes.push(code)
        }
      }
    }
    return codes
      .filter(code => !taken.has(code))
      .map(code => {
        const course = ctx.catalog.get(rootCourseId(code))
        return { code, title: course?.title ?? ctx.courseIndex.get(code)?.title ?? '', terms: course?.terms ?? [], quality: course?.quality, hours: course?.hours }
      })
      .sort((a, b) => Number(b.terms.length > 0) - Number(a.terms.length > 0) || (b.quality ?? 0) - (a.quality ?? 0) || a.code.localeCompare(b.code, undefined, { numeric: true }))
  }, [ctx, n])

  if (options.length === 0) return <p className="py-1 text-xs text-muted-foreground">No other listed courses.</p>
  const shown = all ? options : options.slice(0, 8)
  const offered = options.filter(o => o.terms.length).length
  return (
    <div className="mt-1 rounded-md border border-border/60">
      <div className="border-b border-border/60 px-3 py-1.5 text-xs text-muted-foreground">
        {offered} of {options.length} offered in 2026-27{n.match?.way ? ` · Way-${n.match.way}: ${WAY_NAMES[n.match.way]}` : ''} · rating out of 5
      </div>
      <ul className="divide-y divide-border/50">
        {shown.map(o => (
          <li key={o.code} className="flex items-baseline gap-3 px-3 py-1.5 text-xs">
            <span className="w-24 shrink-0 font-medium"><CourseLink code={o.code} /></span>
            <span className="min-w-0 flex-1 truncate">{o.title}</span>
            <span className="hidden shrink-0 text-muted-foreground sm:inline">
              {o.terms.length ? o.terms.map(shortTerm).join(', ') : 'Not offered this year'}
            </span>
            {o.quality != null && <span className="shrink-0 tabular-nums text-muted-foreground">{o.quality.toFixed(1)}</span>}
          </li>
        ))}
      </ul>
      {options.length > 8 && (
        <button className="w-full border-t border-border/60 px-3 py-1.5 text-left text-xs text-primary hover:underline" onClick={() => setAll(v => !v)}>
          {all ? 'Show fewer' : `Show all ${options.length}`}
        </button>
      )}
    </div>
  )
}

/** " (letter grade, C or better)": the grading a rule asks for, its own or its program's. */
function gradeRule(n: RuleNode, program: string, ctx: AuditContextValue): string {
  const data = ctx.programs.get(program)
  const letter = n.letter || data?.letterGrade
  const min = n.minGrade ?? data?.minGrade
  const parts = [letter && 'letter grade', min && `${min} or better`, n.minUnitsEach && `at least ${n.minUnitsEach} units`].filter(Boolean)
  return parts.length ? ` (${parts.join(', ')})` : ''
}
