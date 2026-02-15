'use client';

import React, { useMemo, useState } from 'react';
import { useCartStore } from '@/lib/cart-store';
import { isMeetingOptional, parseMeetingTimes, timeToMinutes } from '@/lib/schedule-utils';
import { cn } from '@/lib/utils';
import { ChevronLeft, ChevronRight, Trash2, EyeOff, Eye, AlertCircle, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useRouter } from 'next/navigation';

const COLORS = {
  sky: 'bg-sky-500/15 border-sky-500/40 text-sky-950 dark:text-sky-50',
  indigo: 'bg-indigo-500/15 border-indigo-500/40 text-indigo-950 dark:text-indigo-50',
  violet: 'bg-violet-500/15 border-violet-500/40 text-violet-950 dark:text-violet-50',
  fuchsia: 'bg-fuchsia-500/15 border-fuchsia-500/40 text-fuchsia-950 dark:text-fuchsia-50',
  rose: 'bg-rose-500/15 border-rose-500/40 text-rose-950 dark:text-rose-50',
  orange: 'bg-orange-500/15 border-orange-500/40 text-orange-950 dark:text-orange-50',
  amber: 'bg-amber-500/15 border-amber-500/40 text-amber-950 dark:text-amber-50',
  emerald: 'bg-emerald-500/15 border-emerald-500/40 text-emerald-950 dark:text-emerald-50',
} as const

type ColorKey = keyof typeof COLORS

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
  color?: string
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
const MOBILE_HOUR_HEIGHT = 42
const DEFAULT_START_MINUTES = 9 * 60
const DEFAULT_END_MINUTES = 17 * 60

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function hashString(str: string) {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}

function getEventColorClasses(seed: string, userColor?: string) {
  if (userColor && userColor in COLORS) {
    return COLORS[userColor as ColorKey]
  }
  const palette = Object.values(COLORS)
  return palette[hashString(seed) % palette.length]
}

function layoutDayEvents(events: CalendarEvent[]) {
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
    active = active.filter(a => a.end > ev.start)
    if (active.length === 0) finishGroup()

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

export function CalendarView({ currentTerm, onPrevTerm, onNextTerm, totalUnitsMin, totalUnitsMax, isOverload, onIgnoreOverload }: CalendarViewProps) {
  const { items, removeItem, toggleOptionalMeeting } = useCartStore()
  const router = useRouter()

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
          ; (m.days || []).forEach(day => {
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
              location: m.location || '',
              isOptional: optional,
              color: course.color
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
    const byDay: Record<CalendarEvent['day'], LaidOutEvent[]> = { Mon: [], Tue: [], Wed: [], Thu: [], Fri: [] }
    DAYS.forEach(({ key }) => {
      const dayEvents = calendarEvents.filter(e => e.day === key)
      byDay[key] = layoutDayEvents(dayEvents)
    })
    return byDay
  }, [calendarEvents])

  return (
    <div className="flex flex-col min-h-0 relative">
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6 min-h-0">
        <div className="flex flex-col min-h-0 gap-2">
          <div className="flex items-center justify-center mb-2 h-9 px-1">
            <h3 className="font-semibold text-base">Calendar</h3>
          </div>
          <div className="rounded-xl border bg-card overflow-hidden flex flex-col flex-1">
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
            <div className="flex-1 w-full overflow-x-auto scrollbar-hide">
              <div className="min-w-0 sm:min-w-[700px]">
                <div className="grid grid-cols-[48px_repeat(5,1fr)] sm:grid-cols-[72px_repeat(5,1fr)] border-b bg-card/80 backdrop-blur supports-[backdrop-filter]:bg-card/60 sticky top-0 z-30">
                  <div className="p-1 px-2 sm:p-3 text-xs font-semibold text-muted-foreground border-r" />
                  {DAYS.map(d => (
                    <div key={d.key} className="p-1.5 sm:p-3 text-[10px] sm:text-xs font-semibold text-muted-foreground border-r last:border-r-0 text-center truncate px-0.5">
                      {d.label}
                    </div>
                  ))}
                </div>
                <div
                  className="calendar-grid grid grid-cols-[48px_repeat(5,1fr)] sm:grid-cols-[72px_repeat(5,1fr)] relative"
                  style={{
                    '--hour-height': `${HOUR_HEIGHT}px`,
                    '--start-minutes': startMinutes,
                  } as any}
                >
                  <style jsx>{`
                  .calendar-grid {
                    --current-hour-height: ${HOUR_HEIGHT}px;
                    height: calc(((${endMinutes} - ${startMinutes}) / 60) * var(--current-hour-height));
                  }
                  @media (max-width: 640px) {
                    .calendar-grid {
                      --current-hour-height: ${MOBILE_HOUR_HEIGHT}px;
                    }
                  }
                `}</style>

                  {/* Time rail */}
                  <div className="relative border-r bg-background/50">
                    {hours.map((h, idx) => (
                      <div
                        key={h}
                        className="absolute left-0 right-0"
                        style={{ top: `calc(${idx} * var(--current-hour-height))` }}
                      >
                        {idx !== hours.length - 1 && (
                          <div className={cn(
                            'absolute left-0 top-0 px-1 sm:px-2 text-[9px] sm:text-[10px] text-muted-foreground bg-background/50 whitespace-nowrap',
                            'translate-y-0 mt-1'
                          )}>
                            {`${((h + 11) % 12) + 1}${h >= 12 ? 'p' : 'a'}`}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Columns */}
                  {DAYS.map(({ key }) => (
                    <div key={key} className="relative border-r last:border-r-0 bg-background/30">
                      {eventsByDay[key].map(ev => {
                        const colWidth = 100 / ev.colCount
                        const leftPct = ev.colIndex * colWidth
                        const gutter = 2
                        const colorClasses = getEventColorClasses(ev.courseId, ev.color)

                        return (
                          <div
                            key={ev.id}
                            onClick={() => router.push(`/courses/${ev.courseId}`)}
                            className={cn(
                              'group absolute rounded-md border px-1 sm:px-2 py-0.5 sm:py-1 text-left shadow-sm hover:shadow transition-shadow overflow-hidden cursor-pointer z-20',
                              colorClasses,
                              ev.isOptional && 'opacity-55 border-dashed grayscale'
                            )}
                            style={{
                              top: `calc((${ev.start} - var(--start-minutes)) / 60 * var(--current-hour-height))`,
                              height: `calc((${ev.end} - ${ev.start}) / 60 * var(--current-hour-height))`,
                              left: `calc(${leftPct}% + ${gutter}px)`,
                              width: `calc(${colWidth}% - ${gutter * 2}px)`,
                              minHeight: '18px'
                            }}
                          >
                            <button
                              type="button"
                              className="absolute right-1 top-1 opacity-0 group-hover:opacity-100 transition-opacity rounded p-1 hover:bg-black/5 dark:hover:bg-white/10 z-20"
                              onClick={(e) => {
                                e.stopPropagation()
                                toggleOptionalMeeting(ev.courseId, ev.day, ev.startTime, ev.endTime)
                              }}
                            >
                              {ev.isOptional ? <Eye className="h-3 w-3 sm:h-3.5 sm:w-3.5" /> : <EyeOff className="h-3 w-3 sm:h-3.5 sm:w-3.5" />}
                            </button>
                            <div className="pl-0.5">
                              <div className="text-[10px] sm:text-[11px] font-semibold leading-tight truncate">
                                {ev.courseCode}
                              </div>
                              <div className="text-[9px] sm:text-[10px] opacity-80 truncate hidden sm:block">
                                {ev.location || 'TBA'}
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  ))}

                  {/* Horizontal Lines Layer - Rendered last to be on top of column backgrounds but below events (events are z-20) */}
                  <div className="absolute inset-0 pointer-events-none">
                    {hours.map((_, idx) => (
                      <div
                        key={idx}
                        className="absolute left-0 right-0 border-t border-border/40"
                        style={{ top: `calc(${idx} * var(--current-hour-height))` }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col min-h-0 gap-2">
          <div className="flex items-center justify-between gap-2 mb-2 h-9">
            <h3 className="font-semibold text-base">Classes {currentTermCourses.length > 0 ? `in ${currentTerm}` : ''}</h3>
            <div className={cn(
              'px-3 py-1.5 rounded-full text-sm font-medium border',
              isOverload ? 'bg-destructive/10 text-destructive border-destructive/20' : 'bg-background text-foreground border-border'
            )}>
              {totalUnitsMin === totalUnitsMax ? totalUnitsMin : `${totalUnitsMin}-${totalUnitsMax}`} Units
            </div>
          </div>
          {currentTermCourses.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center py-12 text-center text-muted-foreground border-2 border-dashed rounded-xl bg-muted/20">
              <Calendar className="h-10 w-10 mb-3 opacity-20" />
              <p className="font-medium text-sm">No classes yet</p>
              <p className="text-xs mt-1 max-w-[200px]">
                Search for courses to add them to your {currentTerm} schedule.
              </p>
            </div>
          ) : (
            <div className="space-y-2 overflow-auto">
              {currentTermCourses.map(course => {
                const meetings = parseMeetingTimes(course, currentTerm);
                const lines = meetings.map(formatMeetingLine).filter(Boolean) as string[];
                return (
                  <div
                    key={course.id}
                    className="p-3 border rounded-lg bg-card hover:bg-accent/50 transition-colors group cursor-pointer"
                    onClick={() => router.push(`/courses/${course.id}`)}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{course.subject} {course.code}</div>
                        <div className="text-xs text-muted-foreground truncate">{course.title}</div>
                      </div>
                      <Button
                        variant="ghost" size="icon"
                        className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => { e.stopPropagation(); removeItem(course.id); }}
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground space-y-1">
                      {lines.length === 0 ? <div>Time TBA</div> : lines.map((line, i) => <div key={i}>{line}</div>)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
