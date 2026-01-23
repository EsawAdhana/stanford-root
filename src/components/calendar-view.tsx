'use client';

import React, { useMemo, useState } from 'react';
import { useCartStore } from '@/lib/cart-store';
import { isMeetingOptional, parseMeetingTimes, timeToMinutes } from '@/lib/schedule-utils';
import { cn } from '@/lib/utils';
import { ChevronLeft, ChevronRight, Trash2, EyeOff, Eye, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CourseDetail } from '@/components/course-detail';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

type CalendarEvent = {
  id: string
  courseId: string
  courseCode: string
  title: string
  day: 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri'
  startTime: string
  endTime: string
  start: number
  end: number
  location?: string
  isOptional: boolean
}

type LaidOutEvent = CalendarEvent & {
  colIndex: number
  colCount: number
}

type CalendarViewProps = {
  currentTerm: string
  onPrevTerm: () => void
  onNextTerm: () => void
  totalUnitsMin: number
  totalUnitsMax: number
  isOverload: boolean
  onIgnoreOverload: () => void
}

const DAYS: Array<{ key: CalendarEvent['day'], label: string }> = [
  { key: 'Mon', label: 'Mon' },
  { key: 'Tue', label: 'Tue' },
  { key: 'Wed', label: 'Wed' },
  { key: 'Thu', label: 'Thu' },
  { key: 'Fri', label: 'Fri' }
]

const HOUR_HEIGHT = 52
const DEFAULT_START_MINUTES = 9 * 60
const DEFAULT_END_MINUTES = 17 * 60

function clamp (value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function hashString (str: string) {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}

function getEventColorClasses (seed: string) {
  const palette = [
    'bg-sky-500/15 border-sky-500/40 text-sky-950 dark:text-sky-50',
    'bg-emerald-500/15 border-emerald-500/40 text-emerald-950 dark:text-emerald-50',
    'bg-violet-500/15 border-violet-500/40 text-violet-950 dark:text-violet-50',
    'bg-amber-500/15 border-amber-500/40 text-amber-950 dark:text-amber-50',
    'bg-rose-500/15 border-rose-500/40 text-rose-950 dark:text-rose-50',
    'bg-teal-500/15 border-teal-500/40 text-teal-950 dark:text-teal-50'
  ]

  return palette[hashString(seed) % palette.length]
}

function layoutDayEvents (events: CalendarEvent[]) {
  const sorted = [...events].sort((a, b) => (a.start - b.start) || (b.end - a.end))
  const laidOut: LaidOutEvent[] = []

  let active: Array<LaidOutEvent> = []
  let currentGroup: Array<LaidOutEvent> = []

  const finishGroup = () => {
    if (currentGroup.length === 0) return
    const maxCol = currentGroup.reduce((m, e) => Math.max(m, e.colIndex), 0)
    const colCount = maxCol + 1
    currentGroup.forEach(e => { e.colCount = colCount })
    currentGroup = []
  }

  for (const ev of sorted) {
    // purge ended events
    active = active.filter(a => a.end > ev.start)

    if (active.length === 0) {
      finishGroup()
    }

    const used = new Set(active.map(a => a.colIndex))
    let colIndex = 0
    while (used.has(colIndex)) colIndex++

    const placed: LaidOutEvent = { ...ev, colIndex, colCount: 1 }
    active.push(placed)
    currentGroup.push(placed)
    laidOut.push(placed)
  }

  finishGroup()
  return laidOut
}

export function CalendarView ({ currentTerm, onPrevTerm, onNextTerm, totalUnitsMin, totalUnitsMax, isOverload, onIgnoreOverload }: CalendarViewProps) {
  const { items, removeItem, toggleOptionalMeeting } = useCartStore()
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null)

  const currentTermCourses = items.filter(c =>
    c.selectedTerm ? c.selectedTerm === currentTerm :
    ((c.terms && currentTerm && c.terms.includes(currentTerm)) || c.term === currentTerm)
  )

  const formatMeetingLine = (meeting: { days: string[], startTime: string, endTime: string, location?: string }) => {
    const days = (meeting.days || []).join('/')
    const time = meeting.endTime ? `${meeting.startTime} - ${meeting.endTime}` : meeting.startTime
    const location = meeting.location && meeting.location !== 'TBA' ? ` • ${meeting.location}` : ''
    if (!days && !time) return null
    if (!days) return `${time}${location}`
    return `${days} ${time}${location}`
  }

  const calendarEvents = useMemo(() => {
    const events: CalendarEvent[] = []

    currentTermCourses.forEach(course => {
      const meetings = parseMeetingTimes(course, currentTerm)
      meetings.forEach(m => {
        if (!m.startTime || !m.endTime) return
        const start = timeToMinutes(m.startTime)
        const end = timeToMinutes(m.endTime)
        if (!start || !end || end <= start) return

        ;(m.days || []).forEach(day => {
          if (!DAYS.some(d => d.key === day)) return
          const optional = isMeetingOptional(course, day, m.startTime, m.endTime)
          events.push({
            id: `${course.id}-${day}-${start}-${end}`,
            courseId: course.id,
            courseCode: `${course.subject} ${course.code}`,
            title: course.title,
            day: day as CalendarEvent['day'],
            startTime: m.startTime,
            endTime: m.endTime,
            start,
            end,
            location: m.location || ''
            ,
            isOptional: optional
          })
        })
      })
    })

    return events
  }, [currentTermCourses, currentTerm])

  const suggestedRange = useMemo(() => {
    let startMinutes = DEFAULT_START_MINUTES
    let endMinutes = DEFAULT_END_MINUTES

    if (calendarEvents.length > 0) {
      const minStart = calendarEvents.reduce((m, e) => Math.min(m, e.start), Infinity)
      const maxEnd = calendarEvents.reduce((m, e) => Math.max(m, e.end), 0)

      if (minStart < startMinutes) startMinutes = Math.floor(minStart / 60) * 60
      if (maxEnd > endMinutes) endMinutes = Math.ceil(maxEnd / 60) * 60
    }

    startMinutes = clamp(startMinutes, 0, 23 * 60)
    endMinutes = clamp(endMinutes, startMinutes + 60, 24 * 60)

    return { startMinutes, endMinutes }
  }, [calendarEvents])

  const startMinutes = suggestedRange.startMinutes
  const endMinutes = suggestedRange.endMinutes
  const hours = useMemo(() => {
    return Array.from(
      { length: (endMinutes - startMinutes) / 60 + 1 },
      (_, i) => (startMinutes / 60) + i
    )
  }, [startMinutes, endMinutes])

  const eventsByDay = useMemo(() => {
    const byDay: Record<CalendarEvent['day'], LaidOutEvent[]> = {
      Mon: [],
      Tue: [],
      Wed: [],
      Thu: [],
      Fri: []
    }

    DAYS.forEach(({ key }) => {
      // IMPORTANT: keep async/optional meetings in layout so overlaps stay stable
      const dayEvents = calendarEvents.filter(e => e.day === key)
      byDay[key] = layoutDayEvents(dayEvents)
    })

    return byDay
  }, [calendarEvents])

  return (
    <div className="flex flex-col min-h-0 relative">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6 min-h-0">
            {/* Calendar */}
            <div className="rounded-xl border bg-card overflow-hidden min-h-[520px] flex flex-col">
                <div className="grid grid-cols-[40px_1fr_40px] items-center border-b bg-card/80 backdrop-blur supports-[backdrop-filter]:bg-card/60 px-2 py-2">
                    <Button variant="ghost" size="icon" onClick={onPrevTerm} aria-label="Previous term">
                        <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <div className="text-center font-semibold text-base">
                        {currentTerm}
                    </div>
                    <Button variant="ghost" size="icon" onClick={onNextTerm} aria-label="Next term">
                        <ChevronRight className="h-4 w-4" />
                    </Button>
                </div>
                <div className="grid grid-cols-[72px_repeat(5,1fr)] border-b bg-card/80 backdrop-blur supports-[backdrop-filter]:bg-card/60">
                    <div className="p-3 text-xs font-semibold text-muted-foreground border-r" />
                    {DAYS.map(d => (
                        <div key={d.key} className="p-3 text-xs font-semibold text-muted-foreground border-r last:border-r-0 text-center">
                            {d.label}
                        </div>
                    ))}
                </div>

                {calendarEvents.length === 0 ? (
                    <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
                        Add classes to see your Monday–Friday calendar.
                    </div>
                ) : (
                    <div
                        className="grid grid-cols-[72px_repeat(5,1fr)]"
                        style={{ height: ((endMinutes - startMinutes) / 60) * HOUR_HEIGHT }}
                    >
                            {/* Time rail */}
                            <div className="relative border-r bg-background/50">
                                {hours.map((h, idx) => (
                                    <div
                                        key={h}
                                        className="absolute left-0 right-0"
                                        style={{ top: idx * HOUR_HEIGHT }}
                                    >
                                        <div className="absolute left-0 right-0 border-t border-border/40" />
                                        <div
                                          className={cn(
                                            'absolute left-0 top-0 px-2 text-[10px] text-muted-foreground bg-background/50 whitespace-nowrap',
                                            idx === 0 && 'translate-y-0 mt-1',
                                            idx === hours.length - 1 && '-translate-y-full -mt-1',
                                            idx !== 0 && idx !== hours.length - 1 && '-translate-y-1/2'
                                          )}
                                        >
                                            {`${((h + 11) % 12) + 1}${h >= 12 ? 'PM' : 'AM'}`}
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {/* Day columns */}
                            {DAYS.map(({ key }) => (
                                <div key={key} className="relative border-r last:border-r-0 bg-background/30">
                                    {hours.map((_, idx) => (
                                        <div
                                            key={idx}
                                            className="absolute left-0 right-0 border-t border-border/40"
                                            style={{ top: idx * HOUR_HEIGHT }}
                                        />
                                    ))}

                                    {eventsByDay[key].map(ev => {
                                        const top = ((ev.start - startMinutes) / 60) * HOUR_HEIGHT
                                        const height = Math.max(18, ((ev.end - ev.start) / 60) * HOUR_HEIGHT)
                                        const colWidth = 100 / ev.colCount
                                        const leftPct = ev.colIndex * colWidth
                                        const gutter = 2

                                        return (
                                            <div
                                                key={ev.id}
                                                onClick={() => setSelectedCourseId(ev.courseId)}
                                                className={cn(
                                                    'group absolute rounded-md border px-2 py-1 text-left shadow-sm hover:shadow transition-shadow overflow-hidden cursor-pointer z-20',
                                                    getEventColorClasses(ev.courseId),
                                                    ev.isOptional && 'opacity-55 border-dashed grayscale'
                                                )}
                                                style={{
                                                    top,
                                                    height,
                                                    left: `calc(${leftPct}% + ${gutter}px)`,
                                                    width: `calc(${colWidth}% - ${gutter * 2}px)`
                                                }}
                                                title={`${ev.courseCode}${ev.isOptional ? ' • async' : ''} • ${ev.location || 'TBA'}`}
                                            >
                                                <button
                                                  type="button"
                                                  className="absolute right-1 top-1 opacity-0 group-hover:opacity-100 transition-opacity rounded p-1 hover:bg-black/5 dark:hover:bg-white/10"
                                                  onClick={(e) => {
                                                    e.stopPropagation()
                                                    toggleOptionalMeeting(ev.courseId, ev.day, ev.startTime, ev.endTime)
                                                  }}
                                                  aria-label={ev.isOptional ? 'Unmark async' : 'Mark async'}
                                                  title={ev.isOptional ? 'Unmark async' : 'Mark async'}
                                                >
                                                  {ev.isOptional ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                                                </button>
                                                <div className="text-[11px] font-semibold leading-tight truncate">
                                                    {ev.courseCode}
                                                </div>
                                                <div className="text-[10px] opacity-80 truncate">
                                                    {ev.location || 'TBA'}
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            ))}
                        </div>
                )}
            </div>

            {/* Selected classes list */}
            <div className="space-y-2 min-h-0">
                <div className="flex items-center justify-between gap-2 mb-2">
                    <h3 className="font-semibold text-sm">Classes in {currentTerm}</h3>
                    {isOverload ? (
                        <Popover>
                            <PopoverTrigger asChild>
                                <div className={cn(
                                    'flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium border transition-colors cursor-pointer',
                                    'bg-destructive/10 text-destructive border-destructive/20 hover:bg-destructive/20'
                                )}>
                                    <AlertCircle className="h-4 w-4" />
                                    <span>
                                        {totalUnitsMin === totalUnitsMax ? totalUnitsMin : `${totalUnitsMin}-${totalUnitsMax}`} {totalUnitsMin === 1 && totalUnitsMax === 1 ? 'Unit' : 'Units'}
                                    </span>
                                </div>
                            </PopoverTrigger>
                            <PopoverContent className="w-80">
                                <div className="space-y-3">
                                    <div className="space-y-1">
                                        <h4 className="font-medium text-destructive flex items-center gap-2">
                                            <AlertCircle className="h-4 w-4" />
                                            Unit Limit Exceeded
                                        </h4>
                                        <p className="text-sm text-muted-foreground">
                                            You are exceeding the typical 20 unit limit for {currentTerm}.
                                        </p>
                                    </div>
                                    <div className="flex justify-end">
                                        <Button
                                            variant="secondary"
                                            size="sm"
                                            onClick={onIgnoreOverload}
                                        >
                                            Ignore
                                        </Button>
                                    </div>
                                </div>
                            </PopoverContent>
                        </Popover>
                    ) : (
                        <div className={cn(
                            'flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium border transition-colors',
                            'bg-background text-foreground border-border'
                        )}>
                            <span>
                                {totalUnitsMin === totalUnitsMax ? totalUnitsMin : `${totalUnitsMin}-${totalUnitsMax}`} Units
                            </span>
                        </div>
                    )}
                </div>
                {currentTermCourses.length === 0 ? (
                    <div className="text-center text-muted-foreground text-sm">No classes this term.</div>
                ) : (
                    <div className="space-y-2">
                        {currentTermCourses.map(course => {
                            const meetings = parseMeetingTimes(course, currentTerm);
                            const lines = meetings.map(formatMeetingLine).filter(Boolean) as string[];
                            return (
                                <div
                                    key={course.id}
                                    className="p-3 border rounded-lg bg-card hover:bg-accent/50 transition-colors group cursor-pointer"
                                    onClick={() => setSelectedCourseId(course.id)}
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="flex-1 min-w-0">
                                            <div className="font-medium truncate">{course.subject} {course.code}</div>
                                            <div className="text-xs text-muted-foreground truncate">{course.title}</div>
                                        </div>
                                        <Button 
                                            variant="ghost" 
                                            size="icon" 
                                            className="h-7 w-7 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                                            onClick={(e) => { e.stopPropagation(); removeItem(course.id); }}
                                            aria-label={`Remove ${course.subject} ${course.code}`}
                                        >
                                            <Trash2 size={14} />
                                        </Button>
                                    </div>
                                    <div className="mt-2 text-xs text-muted-foreground space-y-1">
                                        {lines.length === 0 ? (
                                            <div>Time TBA</div>
                                        ) : (
                                            lines.map((line, i) => <div key={i}>{line}</div>)
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>

        {selectedCourseId && (
            <CourseDetail 
                courseId={selectedCourseId} 
                onClose={() => setSelectedCourseId(null)} 
                closeOnRemove={true}
            />
        )}
    </div>
  );
}
