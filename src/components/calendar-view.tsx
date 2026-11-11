'use client';

import React, { useMemo, useState, useRef, useEffect } from 'react';
import { useCourseStore } from '@/lib/store';
import { useCartStore } from '@/lib/cart-store';
import { useAuthStore } from '@/lib/auth-store';
import { promptLoginToSyncOnce } from '@/lib/login-nudge';
import { track } from '@/lib/analytics';
import { isMeetingOptional, parseMeetingTimes, timeToMinutes, stripSeconds, scheduledCrossListMember, isScheduledForTerm } from '@/lib/schedule-utils';
import { cn, unitsLabel, decodeHtmlEntities, getCrossListPrimaryMap } from '@/lib/utils';
import { ChevronLeft, ChevronRight, Trash2, EyeOff, Eye, Calendar, Search, AlertTriangle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useRouter } from 'next/navigation';
import { startNavProgress } from '@/components/nav-progress';
import { searchCourses } from '@/lib/search-utils';
import { compareCourseCodes } from '@/lib/utils';
import { ALL_DAYS, visibleDays, getCalendarColorClasses, layoutDayEvents, type CalendarDay } from '@/lib/calendar-utils';
import { useFindShortcut } from '@/hooks/use-find-shortcut';
import { TimeGrid, blockStyle, gridRange } from '@/components/time-grid';
import { ExamClashHazard, ExamSlotLine, FinalsGrid, LoadFailedLine, useTermExams } from '@/components/finals-week';
import { clashSignature, type ExamClash } from '@/lib/final-exams';
import { ignoreExamClash, useIgnoredClashStore } from '@/lib/ignored-clashes';
import type { CartItem } from '@/lib/cart-store';

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
  /** Omit both to drop the term arrows, as a shared link does. */
  onPrevTerm?: () => void
  onNextTerm?: () => void
  /** False at the edge of the terms we have data for; the arrow disables. */
  canPrevTerm?: boolean
  canNextTerm?: boolean
  totalUnitsMax: number
  isOverload: boolean
  isIgnored: boolean
  onIgnoreOverload: () => void
  /** Courses to draw instead of the user's own schedule (a shared link). */
  items?: CartItem[]
  /** No search, no removing, no meeting toggles, no warnings: someone else's schedule. */
  readOnly?: boolean
  /** Rendered above the calendar card, such as the plan tabs. */
  aboveCalendar?: React.ReactNode
  /** The units and hours table above the class list. */
  stats: React.ReactNode
}

type ScheduleView = 'classes' | 'finals'

export function CalendarView({ currentTerm, onPrevTerm, onNextTerm, canPrevTerm = true, canNextTerm = true, totalUnitsMax, isOverload, isIgnored, onIgnoreOverload, items: itemsOverride, readOnly = false, aboveCalendar, stats }: CalendarViewProps) {
  const cartItems = useCartStore(s => s.items)
  const items = itemsOverride ?? cartItems
  const addItem = useCartStore(s => s.addItem)
  const removeItem = useCartStore(s => s.removeItem)
  const toggleOptionalMeeting = useCartStore(s => s.toggleOptionalMeeting)
  const courses = useCourseStore(state => state.courses)
  const isLoading = useCourseStore(state => state.isLoading)
  const enrichedCourseIds = useCourseStore(state => state.enrichedCourseIds)
  const hasEnriched = useCourseStore(state => state.hasEnriched)
  const failedDetailIds = useCourseStore(state => state.failedDetailIds)
  const router = useRouter()
  const openCourse = (courseId: string) => { startNavProgress(); router.push(`/${encodeURIComponent(courseId)}`); }

  const [searchQuery, setSearchQuery] = useState('')
  const [isSearchFocused, setIsSearchFocused] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Ctrl-F on the schedule means "find me a class to add", not "find text on
  // this grid" — the grid only holds what is already scheduled. This view is
  // only ever mounted on /schedule, so the shortcut needs no route check.
  useFindShortcut(searchInputRef)

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
    const filtered = items.filter(c => currentTerm && isScheduledForTerm(c, currentTerm))
    return filtered.map(item => {
      const fullCourse = courseMap.get(item.id)
      if (fullCourse?.sections && fullCourse.sections.length > 0) {
        return { ...fullCourse, ...item, sections: fullCourse.sections } as typeof item
      }
      return item
    })
  }, [items, currentTerm, courseMap])

  // Cross-list groups, so a class already on the schedule under one listing is not
  // offered again under another. Searching "COMM 172" matches COMM 272 on its title.
  const primaryMap = useMemo(() => getCrossListPrimaryMap(courses), [courses])

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

  // Expand the calendar if classes fall outside 8am-8pm, but never shrink smaller than it
  const { startMinutes, endMinutes } = useMemo(() => gridRange(calendarEvents), [calendarEvents])

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

  // Finals week is one toggle away for any term whose exam schedule is published.
  const exams = useTermExams(currentTermCourses, currentTerm)
  const [view, setView] = useState<ScheduleView>('classes')
  const showFinals = view === 'finals' && exams !== null

  // A class whose final shares its slot with another's gets a hazard sign on its
  // card in the list, on both views, until the student ignores that overlap.
  // Ignores sync to the account (lib/ignored-clashes), so they hold on every device.
  const ignoredSignatures = useIgnoredClashStore(s => s.byTerm[currentTerm])
  const clashOf = useMemo(() => {
    const ignored = new Set(ignoredSignatures ?? [])
    const byCourse = new Map<string, ExamClash>()
    for (const clash of exams?.load.clashes ?? []) {
      if (ignored.has(clashSignature([clash]))) continue
      for (const entry of clash.entries) byCourse.set(entry.courseId, clash)
    }
    return byCourse
  }, [exams, ignoredSignatures])
  const ignoreClash = (clash: ExamClash) => {
    void ignoreExamClash(useAuthStore.getState().user?.id ?? null, currentTerm, clashSignature([clash]))
  }

  const openFinals = () => {
    setView('finals')
    track('finals_week_viewed', { term: currentTerm, clashes: exams?.load.clashes.length ?? 0 })
  }

  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex flex-col relative">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6 items-start">
          <div className="flex flex-col gap-2 w-full min-w-0">
            {aboveCalendar}
            <div className="rounded-xl border bg-card overflow-hidden flex flex-col shrink-0">
              <div className="grid grid-cols-[40px_1fr_40px] items-center border-b bg-card/80 backdrop-blur supports-[backdrop-filter]:bg-card/60 px-2 py-2">
                {onPrevTerm ? (
                  <Button variant="ghost" size="icon" onClick={onPrevTerm} disabled={!canPrevTerm} aria-label="Previous term">
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                ) : <span />}
                <div className="text-center">
                  <div className="font-semibold text-base">{currentTerm}</div>
                  {exams && (
                    <Tabs
                      value={showFinals ? 'finals' : 'classes'}
                      onValueChange={value => (value === 'finals' ? openFinals() : setView('classes'))}
                      className="mt-1.5"
                    >
                      <TabsList className="h-8">
                        <TabsTrigger value="classes" className="px-3 py-1 text-xs">Classes</TabsTrigger>
                        <TabsTrigger value="finals" className="px-3 py-1 text-xs">Finals week</TabsTrigger>
                      </TabsList>
                    </Tabs>
                  )}
                </div>
                {onNextTerm ? (
                  <Button variant="ghost" size="icon" onClick={onNextTerm} disabled={!canNextTerm} aria-label="Next term">
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                ) : <span />}
              </div>
              {showFinals && exams ? (
                <FinalsGrid term={currentTerm} exams={exams} onOpenCourse={openCourse} />
              ) : (
                <TimeGrid
                  columns={columns}
                  startMinutes={startMinutes}
                  endMinutes={endMinutes}
                  renderColumn={key => eventsByDay[key as CalendarDay].map(ev => (
                    <div
                      key={ev.id}
                      onClick={() => openCourse(ev.courseId)}
                      className={cn(
                        'group absolute rounded-md border px-1 sm:px-2 py-0.5 sm:py-1 text-left shadow-sm hover:shadow transition-shadow overflow-hidden cursor-pointer z-20',
                        getCalendarColorClasses(ev.courseId, ev.color),
                        ev.isOptional && 'opacity-55 border-dashed grayscale'
                      )}
                      style={blockStyle(ev, startMinutes)}
                    >
                      {!readOnly && (
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
                      )}
                      <div className="pl-0.5">
                        <div className="text-[10px] sm:text-[11px] font-semibold leading-tight truncate">
                          {ev.courseCode}
                        </div>
                        <div className="text-[9px] sm:text-[10px] opacity-80 truncate hidden sm:block">
                          {ev.location || 'TBA'}
                        </div>
                      </div>
                    </div>
                  ))}
                />
              )}
            </div>
          </div>

          <div className="flex flex-col gap-3 w-full">

            {/* Local Search Input for Calendar */}
            {!readOnly && (
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
                      const scheduled = scheduledCrossListMember(course.id, currentTermCourses, primaryMap);
                      const isAdded = Boolean(scheduled);
                      // Name the listing that blocks it, so "Added" next to a course the
                      // student never added reads as the cross-listing it is.
                      const addedLabel = !scheduled || scheduled.id === course.id
                        ? 'Added'
                        : `Added as ${scheduled.subject} ${scheduled.code}`;
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
                            <span className="text-[10px] font-medium text-muted-foreground px-1.5 py-0.5 border rounded-sm bg-muted/30 shrink-0">{addedLabel}</span>
                          )}
                        </div>
                      )
                    })
                  )}
                </div>
              )}
            </div>
            )}

            {!readOnly && isOverload && !isIgnored && (
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

            {stats}
            {currentTermCourses.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground border-2 border-dashed rounded-xl bg-muted/20">
                <Calendar className="h-10 w-10 mb-3 opacity-20" />
                <p className="font-medium text-sm">No classes yet</p>
                {!readOnly && (
                  <p className="text-xs mt-1 max-w-[200px]">
                    Search for courses to add them to your {currentTerm} schedule.
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {currentTermCourses.map(course => {
                  const meetings = parseMeetingTimes(course, currentTerm);
                  const lines = meetings.map(formatMeetingLine).filter(Boolean) as string[];
                  // Sections arrive after the light catalog. Until then a course has
                  // no meetings to read, which is not the same as having none. Once the
                  // full catalog is in, or its own fetch failed, it is no longer waiting.
                  const sectionsUnknown = !course.sections?.length && !enrichedCourseIds.has(course.id) && !hasEnriched;
                  const sectionsFailed = sectionsUnknown && failedDetailIds.has(course.id);
                  const sectionsPending = sectionsUnknown && !sectionsFailed;
                  const retrySections = () => void useCourseStore.getState().fetchCourseDetails([course.id]);
                  const clash = clashOf.get(course.id);
                  return (
                    <div
                      key={course.id}
                      className="p-3 border rounded-lg bg-card hover:bg-accent/50 transition-colors group cursor-pointer"
                      onClick={() => openCourse(course.id)}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{course.subject} {course.code}</div>
                          <div className="text-xs text-muted-foreground truncate">{decodeHtmlEntities(course.title)}</div>
                        </div>
                        {!readOnly && (
                          <div className="flex items-center shrink-0">
                            <Button
                              variant="ghost" size="icon"
                              aria-label={`Remove ${course.subject} ${course.code} from schedule`}
                              className="h-7 w-7 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
                              onClick={(e) => { e.stopPropagation(); removeItem(course.id); }}
                            >
                              <Trash2 size={14} />
                            </Button>
                            {/* In the card's top-right corner, past the remove button. */}
                            {clash && <ExamClashHazard clash={clash} onIgnore={() => ignoreClash(clash)} />}
                          </div>
                        )}
                      </div>
                      <div className="mt-2 text-xs text-muted-foreground space-y-1">
                        {showFinals && exams ? (
                          <ExamSlotLine slot={exams.byCourse.get(course.id)} pending={sectionsPending} failed={sectionsFailed} onRetry={retrySections} />
                        ) : lines.length === 0 ? (
                          sectionsFailed
                            ? <LoadFailedLine what="class times" onRetry={retrySections} />
                            : <div className="italic">Time TBA · not shown on calendar</div>
                        ) : lines.map((line, i) => <div key={i}>{line}</div>)}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {showFinals && (
              <p className="text-xs text-muted-foreground px-1">
                Exam slots follow the Registrar&apos;s{' '}
                <a
                  href="https://studentservices.stanford.edu/my-academics/evaluations-exams-grades/final-exam-schedule"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  final exam schedule
                </a>
                . Note that not every class uses its final exam slot, so check the class website or syllabus.
              </p>
            )}
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
