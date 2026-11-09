'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TimeGrid, blockStyle, gridRange } from '@/components/time-grid';
import { getCalendarColorClasses, layoutDayEvents } from '@/lib/calendar-utils';
import { cn } from '@/lib/utils';
import {
  clashSignature,
  examDays,
  examLoad,
  examSlotFor,
  formatExamColumn,
  formatExamDate,
  formatExamStart,
  formatExamTime,
  hasFinalExamSchedule,
  type ExamClash,
  type ExamEntry,
  type ExamLoad,
  type ExamSlot,
} from '@/lib/final-exams';
import type { Course } from '@/types/course';

export type TermExams = {
  byCourse: Map<string, ExamSlot>
  entries: ExamEntry[]
  load: ExamLoad
}

/** Exam slots for the courses on one term's calendar, or null when the term has no published schedule. */
export function useTermExams(courses: Course[], term: string): TermExams | null {
  return useMemo(() => {
    if (!hasFinalExamSchedule(term)) return null
    const byCourse = new Map<string, ExamSlot>()
    const entries: ExamEntry[] = []
    for (const course of courses) {
      const slot = examSlotFor(course, term)
      if (!slot) continue
      byCourse.set(course.id, slot)
      if (slot.kind === 'slot') entries.push({ courseId: course.id, label: `${course.subject} ${course.code}`, exam: slot })
    }
    return { byCourse, entries, load: examLoad(entries) }
  }, [courses, term])
}

/** "CS 161 and CS 229", "CS 161, CS 229, and MATH 51" */
function joinLabels(labels: string[]): string {
  if (labels.length <= 2) return labels.join(' and ')
  return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`
}

/** Course ids that share an exam slot with another course, mapped to the courses they clash with. */
export function clashPartners(clashes: ExamClash[]): Map<string, string[]> {
  const partners = new Map<string, string[]>()
  for (const clash of clashes) {
    for (const entry of clash.entries) {
      partners.set(entry.courseId, clash.entries.filter(e => e !== entry).map(e => e.label))
    }
  }
  return partners
}

type ExamBlock = { id: string; courseId: string; label: string; date: string; start: number; end: number; group: boolean }

export function FinalsGrid({ term, exams, onOpenCourse }: {
  term: string
  exams: TermExams
  onOpenCourse: (courseId: string) => void
}) {
  const days = examDays(term)
  const partners = useMemo(() => clashPartners(exams.load.clashes), [exams])
  const blocks = useMemo<ExamBlock[]>(() => exams.entries.map(e => ({
    id: `${e.courseId}-exam`,
    courseId: e.courseId,
    label: e.label,
    date: e.exam.date,
    start: e.exam.start,
    end: e.exam.end,
    group: e.exam.group,
  })), [exams])
  const { startMinutes, endMinutes } = gridRange(blocks)
  const byDay = useMemo(() => {
    const out: Record<string, Array<ExamBlock & { colIndex: number; colCount: number }>> = {}
    for (const day of days) out[day] = layoutDayEvents(blocks.filter(b => b.date === day))
    return out
  }, [blocks, days])

  return (
    <TimeGrid
      columns={days.map(d => ({ key: d, label: formatExamColumn(d) }))}
      startMinutes={startMinutes}
      endMinutes={endMinutes}
      renderColumn={day => (byDay[day] ?? []).map(block => {
        const clashWith = partners.get(block.courseId)
        return (
          <div
            key={block.id}
            onClick={() => onOpenCourse(block.courseId)}
            className={cn(
              'group absolute rounded-md border px-1 sm:px-2 py-0.5 sm:py-1 text-left shadow-sm hover:shadow transition-shadow overflow-hidden cursor-pointer z-20',
              getCalendarColorClasses(block.courseId),
              clashWith && 'border-2 border-destructive ring-2 ring-destructive/40',
            )}
            style={blockStyle(block, startMinutes)}
          >
            <div className="pl-0.5">
              <div className="text-3xs sm:text-2xs font-semibold leading-tight truncate">{block.label}</div>
              <div className="text-4xs sm:text-3xs opacity-80 max-sm:leading-tight sm:truncate"><ExamTime start={block.start} end={block.end} /></div>
              <div className={cn('text-4xs sm:text-3xs truncate hidden sm:block', clashWith ? 'font-semibold text-destructive' : 'opacity-80')}>
                {clashWith ? `Clash with ${joinLabels(clashWith)}` : block.group ? 'Group exam' : 'Exam slot'}
              </div>
            </div>
          </div>
        )
      })}
    />
  )
}

/**
 * "3:30-6:30 PM", allowed to break after the dash. A phone's finals column is about
 * 46px wide, too narrow for the whole range, and line breaking never splits "-6" on
 * its own, so without the hint the end of the slot was cut off.
 */
function ExamTime({ start, end }: { start: number; end: number }) {
  const text = formatExamTime(start, end)
  const dash = text.indexOf('-')
  if (dash < 0) return <>{text}</>
  return <>{text.slice(0, dash + 1)}<wbr />{text.slice(dash + 1)}</>
}

/** What a course card says about its final in finals week. */
export function ExamSlotLine({ slot, pending, clashWith }: { slot?: ExamSlot; pending: boolean; clashWith?: string[] }) {
  if (!slot) {
    return pending ? <div className="animate-pulse">Finding the exam slot…</div> : null
  }
  if (slot.kind === 'no-time') {
    return <div className="italic">{pending ? 'Finding the exam slot…' : 'No meeting time, so no exam slot'}</div>
  }
  if (slot.kind === 'off-grid') {
    return <div className="italic">Not on the Registrar&apos;s exam grid. Check with the instructor.</div>
  }
  const when = `${formatExamDate(slot.date)}, ${formatExamTime(slot.start, slot.end)}`
  return (
    <div className={cn(clashWith && 'font-semibold text-destructive')}>
      {slot.group ? 'Group exam' : 'Exam slot'}: {when}
      {clashWith ? `, same slot as ${joinLabels(clashWith)}` : ''}
    </div>
  )
}

const DISMISSED_CLASHES_KEY = 'stanford-root:dismissed-exam-clashes'

/**
 * Dismissal for the clash warning, per term. Keyed by the clashes themselves,
 * so a new clash brings the warning back after an older one was dismissed.
 */
function useClashDismissal(term: string, signature: string) {
  const [dismissed, setDismissed] = useState<Record<string, string>>({})
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DISMISSED_CLASHES_KEY)
      if (raw) setDismissed(JSON.parse(raw))
    } catch {
      // unavailable or corrupt storage: show the warning
    }
  }, [])
  const isDismissed = signature !== '' && dismissed[term] === signature
  const dismiss = () => setDismissed(prev => {
    const next = { ...prev, [term]: signature }
    try {
      localStorage.setItem(DISMISSED_CLASHES_KEY, JSON.stringify(next))
    } catch {
      // the dismissal still holds for this visit
    }
    return next
  })
  return { isDismissed, dismiss }
}

const COUNT_WORDS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six']

/** The big warning for two finals in one slot, on the class view and finals week alike. */
export function ExamClashBanner({ term, clashes, onShowFinals }: {
  term: string
  clashes: ExamClash[]
  /** Offered from the class view, where the clash is not on screen. */
  onShowFinals?: () => void
}) {
  const { isDismissed, dismiss } = useClashDismissal(term, clashSignature(clashes))
  if (clashes.length === 0 || isDismissed) return null

  return (
    <div role="alert" className="rounded-xl border-2 border-destructive bg-destructive/10 p-4 text-destructive shrink-0">
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-base font-semibold leading-tight">
            {clashes.length === 1
              ? `${COUNT_WORDS[clashes[0].entries.length] ?? clashes[0].entries.length} of your finals are at the same time`
              : `Your finals clash in ${clashes.length} exam slots`}
          </p>
          <ul className="mt-2 space-y-1 text-sm">
            {clashes.map(clash => (
              <li key={`${clash.date}-${clash.start}`}>
                <span className="font-semibold">{joinLabels(clash.entries.map(e => e.label))}</span>
                {' '}{clash.entries.length === 2 ? 'both have' : 'all have'} the {formatExamDate(clash.date)}, {formatExamTime(clash.start, clash.end)} exam slot.
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs opacity-90">
            Stanford asks you to sort out exam conflicts with the instructors before the Preliminary Study List deadline.
            A class that ends in a project still holds its slot.
          </p>
          {onShowFinals && (
            <Button
              variant="outline"
              size="sm"
              onClick={onShowFinals}
              className="mt-3 border-destructive/50 bg-transparent text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              See finals week
            </Button>
          )}
        </div>
        <button
          type="button"
          aria-label="Dismiss exam clash warning"
          onClick={dismiss}
          className="rounded p-1 hover:bg-destructive/10 transition-colors shrink-0"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

/** The softer note for a day with three or more exams. */
export function HeavyExamDayNotice({ heavyDays }: { heavyDays: ExamLoad['heavyDays'] }) {
  if (heavyDays.length === 0) return null
  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-950 dark:text-amber-50 shrink-0 space-y-1">
      {heavyDays.map(day => (
        <p key={day.date}>
          <span className="font-semibold">{day.entries.length} exam slots on {formatExamDate(day.date)}.</span>{' '}
          {joinLabels(day.entries.map(e => `${e.label} at ${formatExamStart(e.exam.start)}`))}.
        </p>
      ))}
    </div>
  )
}
