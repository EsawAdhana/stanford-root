'use client';

import React, { useMemo, useState, useRef, useEffect } from 'react';
import { useCourseStore } from '@/lib/store';
import { useCartStore } from '@/lib/cart-store';
import { useAuthStore } from '@/lib/auth-store';
import { promptLoginToSyncOnce } from '@/lib/login-nudge';
import { track } from '@/lib/analytics';
import { isMeetingOptional, parseMeetingTimes, timeToMinutes, stripSeconds } from '@/lib/schedule-utils';
import { cn, unitsLabel, decodeHtmlEntities } from '@/lib/utils';
import { ChevronLeft, ChevronRight, Trash2, EyeOff, Eye, Calendar, Search, AlertTriangle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useRouter } from 'next/navigation';
import { startNavProgress } from '@/components/nav-progress';
import { searchCourses } from '@/lib/search-utils';
import { compareCourseCodes } from '@/lib/utils';
import { DAYS, ALL_DAYS, visibleDays, HOUR_HEIGHT, DEFAULT_START_MINUTES, DEFAULT_END_MINUTES, getCalendarColorClasses, layoutDayEvents, type CalendarDay } from '@/lib/calendar-utils';

type CalendarEvent = {
  id: string
  courseId: string
  courseCode: string
  title: string
  day: CalendarDay
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
  /** False at the edge of the terms we have data for; the arrow disables. */
  canPrevTerm?: boolean
  canNextTerm?: boolean
  totalUnitsMin: number
  totalUnitsMax: number
  isOverload: boolean
  isIgnored: boolean
  onIgnoreOverload: () => void
  expectedHoursPerWeek?: number | null
  expectedHoursLoading?: boolean
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export function CalendarView({ currentTerm, onPrevTerm, onNextTerm, canPrevTerm = true, canNextTerm = true, totalUnitsMin, totalUnitsMax, isOverload, isIgnored, onIgnoreOverload, expectedHoursPerWeek, expectedHoursLoading }: CalendarViewProps) {
  const items = useCartStore(s => s.items)
  const addItem = useCartStore(s => s.addItem)
  const removeItem = useCartStore(s => s.removeItem)
  const toggleOptionalMeeting = useCartStore(s => s.toggleOptionalMeeting)
  const courses = useCourseStore(state => state.courses)
  const isLoading = useCourseStore(state => state.isLoading)
  const router = useRouter()

  const [searchQuery, setSearchQuery] = useState('')
  const [isSearchFocused, setIsSearchFocused] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Handle click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        searchInputRef.current &&
        !searchInputRef.current.contains(event.target as Node)
      ) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Merge cart items with full course data from store (cart may have light data without sections)
  const courseMap = useMemo(() => new Map(courses.map(c => [c.id, c])), [courses])

  const currentTermCourses = useMemo(() => {
    const filtered = items.filter(c =>
      c.selectedTerm ? c.selectedTerm === currentTerm :
        (c.terms && currentTerm && c.terms.includes(currentTerm))
    )
    return filtered.map(item => {
      const fullCourse = courseMap.get(item.id)
      if (fullCourse?.sections && fullCourse.sections.length > 0) {
        return { ...fullCourse, ...item, sections: fullCourse.sections } as typeof item
      }
      return item
    })
  }, [items, currentTerm, courseMap])

  // Debounce so we don't scan the full catalog on every keystroke
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearchQuery(searchQuery), 200)
    return () => clearTimeout(t)
  }, [searchQuery])

  const searchResults = useMemo(() => {
    if (!debouncedSearchQuery.trim()) return []
    const results = searchCourses(courses, debouncedSearchQuery)
    return results
      .filter(c => {
        if (c.sections && c.sections.length > 0) {
          return c.sections.some(s => s.term === currentTerm)
        }
        return c.terms?.includes(currentTerm) ?? false
      })
      .sort((a, b) => {
        const subjectCompare = a.subject.localeCompare(b.subject)
        if (subjectCompare !== 0) return subjectCompare
        return compareCourseCodes(a.code, b.code)
      })
  }, [debouncedSearchQuery, courses, currentTerm])

  const formatMeetingLine = (meeting: { days: string[], startTime: string, endTime: string, location?: string }) => {
    const days = (meeting.days || []).join('/')
    const start = stripSeconds(meeting.startTime)
    const end = stripSeconds(meeting.endTime)
    const time = end ? `${start} - ${end}` : start
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
            if (!ALL_DAYS.some(d => d.key === day)) return
            const optional = isMeetingOptional(course, day, m.startTime, m.endTime)
            events.push({
              id: `${course.id}-${day}-${start}-${end}`,
              courseId: course.id,
              courseCode: `${course.subject} ${course.code}`,
              title: decodeHtmlEntities(course.title),
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
    if (calendarEvents.length === 0) {
      return { startMinutes: DEFAULT_START_MINUTES, endMinutes: DEFAULT_END_MINUTES }
    }
    const minStart = calendarEvents.reduce((m, e) => Math.min(m, e.start), Infinity)
    const maxEnd = calendarEvents.reduce((m, e) => Math.max(m, e.end), 0)

    // Expand the calendar if classes fall outside 8am-8pm, but never shrink smaller than it
    let startMinutes = Math.min(DEFAULT_START_MINUTES, Math.floor(minStart / 60) * 60)
    let endMinutes = Math.max(DEFAULT_END_MINUTES, Math.ceil(maxEnd / 60) * 60)
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
    const byDay = {} as Record<CalendarEvent['day'], LaidOutEvent[]>
    ALL_DAYS.forEach(({ key }) => {
      byDay[key] = layoutDayEvents(calendarEvents.filter(e => e.day === key))
    })
    return byDay
  }, [calendarEvents])

  // Weekday columns always; Saturday and Sunday only for a term that has one.
  const columns = useMemo(
    () => visibleDays(calendarEvents.map(e => e.day)),
    [calendarEvents]
  )
  const gridTemplateColumns = `var(--cal-rail) repeat(${columns.length}, minmax(0, 1fr))`

  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex flex-col relative">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6 items-start">
          <div className="flex flex-col gap-2 w-full min-w-0">
            <div className="rounded-xl border bg-card overflow-hidden flex flex-col shrink-0">
              <div className="grid grid-cols-[40px_1fr_40px] items-center border-b bg-card/80 backdrop-blur supports-[backdrop-filter]:bg-card/60 px-2 py-2">
                <Button variant="ghost" size="icon" onClick={onPrevTerm} disabled={!canPrevTerm} aria-label="Previous term">
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <div className="text-center">
                  <div className="font-semibold text-base">{currentTerm}</div>
                </div>
                <Button variant="ghost" size="icon" onClick={onNextTerm} disabled={!canNextTerm} aria-label="Next term">
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
              <div className="w-full overflow-x-auto scrollbar-hide shrink-0">
                <div className="min-w-0 sm:min-w-[700px]">
                  <div className="grid [--cal-rail:48px] sm:[--cal-rail:72px] border-b bg-card/80 backdrop-blur supports-[backdrop-filter]:bg-card/60 sticky top-0 z-30" style={{ gridTemplateColumns }}>
                    <div className="p-1 px-2 sm:p-3 text-xs font-semibold text-muted-foreground border-r" />
                    {columns.map(d => (
                      <div key={d.key} className="p-1.5 sm:p-3 text-[10px] sm:text-xs font-semibold text-muted-foreground border-r last:border-r-0 text-center truncate px-0.5">
                        {d.label}
                      </div>
                    ))}
                  </div>
                  <div
                    className="grid [--cal-rail:48px] sm:[--cal-rail:72px] relative"
                    style={{ gridTemplateColumns, height: `${((endMinutes - startMinutes) / 60) * HOUR_HEIGHT}px` }}
                  >

                    {/* Time rail - left column, labels right-justified in box */}
                    <div className="relative border-r bg-background/50">
                      {hours.map((h, idx) => (
                        <div
                          key={h}
                          className="absolute left-0 right-0"
                          style={{ top: `${idx * HOUR_HEIGHT}px` }}
                        >
                          {idx !== hours.length - 1 && (
                            <div className={cn(
                              'absolute right-0 top-0 pr-1 sm:pr-2 text-right text-[9px] sm:text-[10px] text-muted-foreground bg-background/50 whitespace-nowrap',
                              'translate-y-0 mt-1'
                            )}>
                              {`${((h + 11) % 12) + 1}${h >= 12 ? 'p' : 'a'}`}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* Day columns */}
                    {columns.map(({ key }) => (
                      <div key={key} className="relative border-r last:border-r-0 bg-background/30">
                        {eventsByDay[key].map(ev => {
                          const colWidth = 100 / ev.colCount
                          const leftPct = ev.colIndex * colWidth
                          const gutter = 2
                          const colorClasses = getCalendarColorClasses(ev.courseId, ev.color)

                          return (
                            <div
                              key={ev.id}
                              onClick={() => { startNavProgress(); router.push(`/${encodeURIComponent(ev.courseId)}`); }}
                              className={cn(
                                'group absolute rounded-md border px-1 sm:px-2 py-0.5 sm:py-1 text-left shadow-sm hover:shadow transition-shadow overflow-hidden cursor-pointer z-20',
                                colorClasses,
                                ev.isOptional && 'opacity-55 border-dashed grayscale'
                              )}
                              style={{
                                top: `${((ev.start - startMinutes) / 60) * HOUR_HEIGHT}px`,
                                height: `${((ev.end - ev.start) / 60) * HOUR_HEIGHT}px`,
                                left: `calc(${leftPct}% + ${gutter}px)`,
                                width: `calc(${colWidth}% - ${gutter * 2}px)`,
                                minHeight: '18px'
                              }}
                            >
                              <TooltipProvider delayDuration={500}>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <button
                                      type="button"
                                      className="absolute right-1 top-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity rounded p-1 hover:bg-black/5 dark:hover:bg-white/10 z-20"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        toggleOptionalMeeting(ev.courseId, ev.day, ev.startTime, ev.endTime)
                                      }}
                                    >
                                      {ev.isOptional ? <Eye className="h-3 w-3 sm:h-3.5 sm:w-3.5" /> : <EyeOff className="h-3 w-3 sm:h-3.5 sm:w-3.5" />}
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent side="top">
                                    {ev.isOptional ? 'Ignored for conflict checks — click to include this meeting again' : 'Click to ignore this meeting in conflict checks (it stays dimmed on your schedule)'}
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
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
                          style={{ top: `${idx * HOUR_HEIGHT}px` }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3 w-full">

            {/* Local Search Input for Calendar */}
            <div className="relative shrink-0">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search className="h-4 w-4 text-muted-foreground/60" />
              </div>
              <Input
                ref={searchInputRef}
                placeholder={isLoading ? 'Loading courses...' : `Search to add a class for ${currentTerm}...`}
                className="pl-9 h-10 w-full rounded-xl bg-card border-border/60 shadow-sm focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:border-primary/50"
                value={searchQuery}
                onFocus={() => {
                  setIsSearchFocused(true)
                  if (searchQuery.trim()) setDropdownOpen(true)
                }}
                onBlur={() => setIsSearchFocused(false)}
                onChange={(e) => {
                  setSearchQuery(e.target.value)
                  if (e.target.value.trim()) setDropdownOpen(true)
                  else setDropdownOpen(false)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setDropdownOpen(false)
                    searchInputRef.current?.blur()
                  }
                }}
              />
              {/* Dropdown Results */}
              {dropdownOpen && searchQuery.trim() && (
                <div
                  ref={dropdownRef}
                  className="absolute z-50 top-full left-0 right-0 mt-1.5 max-h-64 overflow-y-auto bg-card border border-border/50 rounded-xl shadow-lg p-1 animate-in fade-in slide-in-from-top-2 duration-200"
                >
                  {searchResults.length === 0 ? (
                    <div className="p-3 text-sm text-center text-muted-foreground">{isLoading ? 'Loading courses...' : `No courses found matching "${searchQuery}"`}</div>
                  ) : (
                    searchResults.map(course => {
                      const isAdded = currentTermCourses.some(c => c.id === course.id);
                      return (
                        <div
                          key={course.id}
                          className={cn(
                            "flex items-center justify-between p-2 rounded-lg cursor-pointer transition-colors",
                            isAdded ? "opacity-50 grayscale cursor-not-allowed" : "hover:bg-accent/50 group"
                          )}
                          onClick={() => {
                            if (isAdded) return;
                            addItem(course, currentTerm);
                            track('course_added_to_schedule', { auth: useAuthStore.getState().user ? 'authed' : 'anonymous', source: 'schedule_search' });
                            promptLoginToSyncOnce();
                            setSearchQuery('');
                            setDropdownOpen(false);
                            searchInputRef.current?.blur();
                          }}
                        >
                          <div className="min-w-0 pr-3">
                            <div className="text-sm font-semibold truncate text-primary">
                              {course.subject} {course.code}
                            </div>
                            <div className="text-xs text-muted-foreground truncate">{decodeHtmlEntities(course.title)}</div>
                          </div>
                          {isAdded && (
                            <span className="text-[10px] font-medium text-muted-foreground px-1.5 py-0.5 border rounded-sm bg-muted/30 shrink-0">Added</span>
                          )}
                        </div>
                      )
                    })
                  )}
                </div>
              )}
            </div>

            {isOverload && !isIgnored && (
              <div className="flex items-start gap-2 rounded-xl border border-destructive/50 bg-destructive/5 p-3 text-destructive shrink-0">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium leading-tight">Over the 20-unit limit</p>
                  <p className="text-xs opacity-80 mt-0.5">
                    {totalUnitsMax} units exceeds Stanford&apos;s standard 20-unit maximum for this term.
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="Dismiss overload warning"
                  onClick={onIgnoreOverload}
                  className="rounded p-1 hover:bg-destructive/10 transition-colors shrink-0"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}

            {/* Metrics Layout */}
            <div className="grid grid-cols-2 gap-3 shrink-0">
              <div className={cn(
                "p-3 rounded-xl border bg-card flex flex-col items-center justify-center transition-colors",
                isOverload && !isIgnored ? "border-destructive/50 bg-destructive/5 text-destructive" : ""
              )}>
                <span className="text-2xl font-semibold leading-none mb-1">
                  {currentTermCourses.length === 0 || (totalUnitsMin === 0 && totalUnitsMax === 0) ? '0' : totalUnitsMin === totalUnitsMax ? totalUnitsMin : `${totalUnitsMin}-${totalUnitsMax}`}
                </span>
                <span className="text-[10px] uppercase font-semibold tracking-wider opacity-60">Units</span>
              </div>
              <div className="p-3 rounded-xl border bg-card flex flex-col items-center justify-center">
                <span className="text-2xl font-semibold leading-none mb-1">
                  {expectedHoursLoading && currentTermCourses.length > 0 && expectedHoursPerWeek == null ? (
                    <span className="animate-pulse">…</span>
                  ) : expectedHoursPerWeek != null ? (
                    `~${expectedHoursPerWeek.toFixed(0)}`
                  ) : (
                    '0'
                  )}
                </span>
                <span className="text-[10px] uppercase font-semibold tracking-wider text-muted-foreground">Hrs / Wk</span>
              </div>
            </div>
            {currentTermCourses.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground border-2 border-dashed rounded-xl bg-muted/20">
                <Calendar className="h-10 w-10 mb-3 opacity-20" />
                <p className="font-medium text-sm">No classes yet</p>
                <p className="text-xs mt-1 max-w-[200px]">
                  Search for courses to add them to your {currentTerm} schedule.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {currentTermCourses.map(course => {
                  const meetings = parseMeetingTimes(course, currentTerm);
                  const lines = meetings.map(formatMeetingLine).filter(Boolean) as string[];
                  return (
                    <div
                      key={course.id}
                      className="p-3 border rounded-lg bg-card hover:bg-accent/50 transition-colors group cursor-pointer"
                      onClick={() => { startNavProgress(); router.push(`/${encodeURIComponent(course.id)}`); }}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{course.subject} {course.code}</div>
                          <div className="text-xs text-muted-foreground truncate">{decodeHtmlEntities(course.title)}</div>
                        </div>
                        <Button
                          variant="ghost" size="icon"
                          aria-label={`Remove ${course.subject} ${course.code} from schedule`}
                          className="h-7 w-7 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
                          onClick={(e) => { e.stopPropagation(); removeItem(course.id); }}
                        >
                          <Trash2 size={14} />
                        </Button>
                      </div>
                      <div className="mt-2 text-xs text-muted-foreground space-y-1">
                        {lines.length === 0 ? <div className="italic">Time TBA · not shown on calendar</div> : lines.map((line, i) => <div key={i}>{line}</div>)}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
