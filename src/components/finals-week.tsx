'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { TimeGrid, blockStyle, gridRange } from '@/components/time-grid';
import { getCalendarColorClasses, layoutDayEvents } from '@/lib/calendar-utils';
import { cn } from '@/lib/utils';
import {
  clashTitle,
  examDays,
  examLoad,
  examSlotFor,
  formatExamColumn,
  formatExamDate,
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

type ExamBlock = { id: string; courseId: string; label: string; date: string; start: number; end: number }

export function FinalsGrid({ term, exams, onOpenCourse }: {
  term: string
  exams: TermExams
  onOpenCourse: (courseId: string) => void
}) {
  const days = examDays(term)
  const blocks = useMemo<ExamBlock[]>(() => exams.entries.map(e => ({
    id: `${e.courseId}-exam`,
    courseId: e.courseId,
    label: e.label,
    date: e.exam.date,
    start: e.exam.start,
    end: e.exam.end,
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
      renderColumn={day => (byDay[day] ?? []).map(block => (
        <div
          key={block.id}
          onClick={() => onOpenCourse(block.courseId)}
          className={cn(
            'group absolute rounded-md border px-1 sm:px-2 py-0.5 sm:py-1 text-left shadow-sm hover:shadow transition-shadow overflow-hidden cursor-pointer z-20',
            getCalendarColorClasses(block.courseId),
          )}
          style={blockStyle(block, startMinutes)}
        >
          {/* Course and time only. A block is three hours tall, so both wrap
              rather than cut off when two finals share a column. */}
          <div className="pl-0.5">
            <div className="text-3xs sm:text-2xs font-semibold leading-tight break-words">{block.label}</div>
            <div className="text-4xs sm:text-3xs opacity-80 leading-tight"><ExamTime start={block.start} end={block.end} /></div>
          </div>
        </div>
      ))}
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

/**
 * A course card's line when its class times could not be loaded, after the
 * store's own retries. Try again sits on the card, which opens the course when
 * clicked, so it keeps the click to itself.
 */
export function LoadFailedLine({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <div>
      Couldn&apos;t load {what}.{' '}
      <Button
        type="button"
        variant="link"
        className="h-auto p-0 text-xs"
        onClick={e => { e.stopPropagation(); onRetry() }}
      >
        Try again
      </Button>
    </div>
  )
}

/** What a course card says about its final in finals week. */
export function ExamSlotLine({ slot, pending, failed = false, onRetry }: {
  slot?: ExamSlot
  pending: boolean
  /** Its class times failed to load, so the slot cannot be worked out. */
  failed?: boolean
  onRetry?: () => void
}) {
  // A group exam needs no class times, so it shows even when they failed.
  if (failed && slot?.kind !== 'slot' && onRetry) {
    return <LoadFailedLine what="the exam slot" onRetry={onRetry} />
  }
  if (!slot) {
    return pending ? <div className="animate-pulse">Finding the exam slot…</div> : null
  }
  if (slot.kind === 'no-time') {
    return <div className="italic">{pending ? 'Finding the exam slot…' : 'No meeting time, so no exam slot'}</div>
  }
  if (slot.kind === 'off-grid') {
    return <div className="italic">Not on the Registrar&apos;s exam grid. Check with the instructor.</div>
  }
  if (slot.kind === 'pick-lecture') {
    return <div className="italic">The exam slot depends on your lecture. Pick one to see it.</div>
  }
  return (
    <div>
      {slot.group ? 'Group exam' : 'Exam slot'}: {formatExamDate(slot.date)}, {formatExamTime(slot.start, slot.end)}
    </div>
  )
}

/**
 * The hazard sign in the top-right corner of a class card whose final shares its
 * slot with another's: hovering it (or tapping, on a phone) says which finals
 * overlap and what Stanford asks, and Ignore clears the sign for that overlap.
 */
export function ExamClashHazard({ clash, onIgnore }: { clash: ExamClash; onIgnore: () => void }) {
  const [open, setOpen] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // 'hover': shown while the mouse is over the sign or the box, and it doesn't
  // move focus. 'pinned': opened by a click, tap or key, and stays until closed.
  const mode = useRef<'hover' | 'pinned'>('pinned')
  useEffect(() => () => clearTimeout(closeTimer.current), [])

  // A short grace period lets the mouse cross from the sign into the box.
  const hover = (entering: boolean) => (e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse') return
    clearTimeout(closeTimer.current)
    if (entering && !open) {
      mode.current = 'hover'
      setOpen(true)
    } else if (!entering && mode.current === 'hover') {
      closeTimer.current = setTimeout(() => setOpen(false), 150)
    }
  }
  // Clicking a sign that hovering already opened keeps the box open instead of
  // toggling it shut (a tap fires both on a touch laptop).
  const pinOnClick = (e: React.MouseEvent) => {
    if (open && mode.current === 'hover') {
      e.preventDefault()
      mode.current = 'pinned'
    }
  }
  const onOpenChange = (next: boolean) => {
    if (next) mode.current = 'pinned'
    setOpen(next)
  }
  const keepFocus = (e: Event) => {
    if (mode.current === 'hover') e.preventDefault()
  }

  const title = clashTitle([clash])

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={title}
          onPointerEnter={hover(true)}
          onPointerLeave={hover(false)}
          onClick={e => {
            // The sign sits on the class card, which opens the course when clicked.
            e.stopPropagation()
            pinOnClick(e)
          }}
          // The same 28px box as the card's remove button beside it.
          className="h-7 w-7 text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          <AlertTriangle className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="end"
        sideOffset={4}
        collisionPadding={8}
        className="w-72 p-3"
        onPointerEnter={hover(true)}
        onPointerLeave={hover(false)}
        onOpenAutoFocus={keepFocus}
        onCloseAutoFocus={keepFocus}
        // React passes events up through the portal to the block, which would open the course.
        onClick={e => e.stopPropagation()}
      >
        <p className="text-sm font-semibold text-destructive">{title}</p>
        <p className="mt-1 text-xs">
          {joinLabels(clash.entries.map(e => e.label))}: {formatExamDate(clash.date)}, {formatExamTime(clash.start, clash.end)}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Stanford asks you to sort out exam conflicts with the instructors before the Preliminary Study List deadline.
        </p>
        <div className="mt-2 flex justify-end">
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => { setOpen(false); onIgnore() }}>
            Ignore
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
