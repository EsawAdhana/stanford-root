'use client';

import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';

const CalendarView = dynamic(
  () => import('@/components/calendar-view').then(m => ({ default: m.CalendarView })),
  { ssr: false }
);
import { Button } from '@/components/ui/button';
import { ArrowDownUp, Download, LogOut, Upload } from 'lucide-react';
import Link from 'next/link';
import { StanfordLoginButton } from '@/components/stanford-login-button';
import { useSearchParams } from 'next/navigation';
import { useCartStore } from '@/lib/cart-store';
import { useCourseStore } from '@/lib/store';
import { useAuthStore } from '@/lib/auth-store';
import { useEvaluationStore } from '@/lib/evaluation-store';
import { aggregateMetrics } from '@/components/course-evaluations';
import { Logo } from '@/components/logo';
import { ThemeToggle } from '@/components/theme-toggle';
import { SchedulePageShell } from '@/components/schedule-page-shell';
import { ScheduleTimesNotice } from '@/components/schedule-times-notice';
import { ScheduleSourceNotice } from '@/components/schedule-source-notice';
import { parseMeetingTimes, timeToMinutes, parseDays } from '@/lib/schedule-utils';
import { getDefaultTerm, getApproxTermStart } from '@/lib/terms';
import { useAvailableTerms } from '@/hooks/use-selected-terms';
import { cn, parseUnitsOptions } from '@/lib/utils';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { parseICS } from '@/lib/ics-parser';
import { track } from '@/lib/analytics';
import { toast } from 'sonner';
import { useEnsureCatalog } from '@/hooks/use-catalog';
import { compareTerms } from '@/lib/terms'

const IGNORED_OVERLOADS_KEY = 'stanford-root:ignored-overloads'

function ScheduleContent() {
  const items = useCartStore(s => s.items)
  const courses = useCourseStore(s => s.courses)
  const hasLoaded = useCourseStore(s => s.hasLoaded)
  const user = useAuthStore(s => s.user)
  const isLoading = useAuthStore(s => s.isLoading)
  const signOut = useAuthStore(s => s.signOut)
  // term -> unit total at the moment the warning was dismissed. Persisted so one X
  // sticks across reloads; a different unit total means the schedule changed, so warn again.
  const [ignoredOverloads, setIgnoredOverloads] = useState<Record<string, number>>({})

  useEffect(() => {
    try {
      const raw = localStorage.getItem(IGNORED_OVERLOADS_KEY)
      if (raw) setIgnoredOverloads(JSON.parse(raw))
    } catch {
      // corrupt or unavailable storage: fall back to showing the warning
    }
  }, [])

  // Eagerly fetch sections for cart items instead of waiting for the full Phase 2 catalog fetch
  useEffect(() => {
    if (!hasLoaded) return
    const { enrichedCourseIds, fetchCourseDetails } = useCourseStore.getState()
    const ids = items.map(item => item.id).filter(id => !enrichedCourseIds.has(id))
    if (ids.length > 0) fetchCourseDetails(ids)
  }, [items, hasLoaded])
  const searchParams = useSearchParams()

  const backHref = useMemo(() => {
    const params = new URLSearchParams(searchParams.toString())
    params.delete('courseId')
    const qs = params.toString()
    return qs ? `/?${qs}` : '/'
  }, [searchParams])

  const QUARTERS = ['Winter', 'Spring', 'Summer', 'Autumn']

  const availableTerms = useAvailableTerms()
  const [currentTerm, setCurrentTerm] = useState(getDefaultTerm())
  const userPickedTermRef = useRef(false)

  // Once the catalog loads, land on the same default term as Browse (the most
  // recent Autumn during the summer gap) so courses added from that preview
  // show up here — unless the user has already navigated to another term.
  useEffect(() => {
    if (userPickedTermRef.current || availableTerms.length === 0) return
    setCurrentTerm(getDefaultTerm(availableTerms))
  }, [availableTerms])

  // Terms the arrows may reach: what the catalog offers, plus whatever term the
  // user's own schedule sits in so a saved term is never unreachable. Without
  // this the arrows stepped by pure date arithmetic and walked forever — seven
  // clicks from Autumn 2026 reached Summer 2028, an empty grid, with the arrow
  // still enabled. Each of those clicks only changed the term label, which is
  // why they showed up as dead clicks on /schedule.
  const navTerms = useMemo(() => {
    const set = new Set<string>(availableTerms)
    for (const item of items) {
      if (item.selectedTerm) set.add(item.selectedTerm)
    }
    if (currentTerm) set.add(currentTerm)
    return [...set].sort(compareTerms)
  }, [availableTerms, items, currentTerm])

  const termIndex = navTerms.indexOf(currentTerm)
  const canPrevTerm = termIndex > 0
  const canNextTerm = termIndex >= 0 && termIndex < navTerms.length - 1

  const stepTerm = (delta: 1 | -1) => {
    const i = navTerms.indexOf(currentTerm)
    // Catalog not loaded yet: fall back to date arithmetic so the arrows still
    // work rather than freezing on first paint.
    if (i === -1 || navTerms.length <= 1) {
      userPickedTermRef.current = true
      setCurrentTerm(prev => {
        const [q, yStr] = prev.split(' ')
        const year = parseInt(yStr)
        const qIdx = QUARTERS.indexOf(q)
        if (delta === 1) return qIdx === 3 ? `Winter ${year + 1}` : `${QUARTERS[qIdx + 1]} ${year}`
        return qIdx === 0 ? `Autumn ${year - 1}` : `${QUARTERS[qIdx - 1]} ${year}`
      })
      return
    }
    const target = navTerms[i + delta]
    if (!target) return
    userPickedTermRef.current = true
    setCurrentTerm(target)
  }

  const nextTerm = () => stepTerm(1)
  const prevTerm = () => stepTerm(-1)

  const courseMap = useMemo(() => new Map(courses.map(c => [c.id, c])), [courses])

  // Merge cart items with full course data (cart may have light data without sections)
  const currentTermCourses = useMemo(() => {
    const filtered = items.filter(c =>
      c.selectedTerm ? c.selectedTerm === currentTerm :
        (c.terms && currentTerm && c.terms.includes(currentTerm))
    )
    return filtered.map(item => {
      const fullCourse = courseMap.get(item.id)
      if (fullCourse?.sections && fullCourse.sections.length > 0) {
        return { ...fullCourse, ...item, sections: fullCourse.sections }
      }
      return item
    })
  }, [items, currentTerm, courseMap])

  const { totalUnitsMin, totalUnitsMax } = useMemo(() => {
    let totalUnitsMin = 0
    let totalUnitsMax = 0

    currentTermCourses.forEach(c => {
      if (c.selectedUnits !== undefined && !isNaN(c.selectedUnits)) {
        totalUnitsMin += c.selectedUnits
        totalUnitsMax += c.selectedUnits
        return
      }

      // Units belong to the course, not to each picked section: ExploreCourses
      // leaves DIS rows blank, so read them off the first picked section that
      // has them rather than summing across LEC + DIS.
      if (c.selectedSectionIds?.length && c.sections) {
        const picked = c.sections.filter(s => c.selectedSectionIds!.includes(s.classId))
        const withUnits = picked
          .map(s => parseUnitsOptions(s.units))
          .find(opts => opts.length > 0 && Math.max(0, ...opts) > 0)
        if (withUnits) {
          totalUnitsMin += withUnits[0]
          totalUnitsMax += withUnits[withUnits.length - 1]
          return
        }
      }

      if (c.units) {
        const opts = parseUnitsOptions(c.units)
        if (opts.length > 0) {
          totalUnitsMin += opts[0]
          totalUnitsMax += opts[opts.length - 1]
        }
      }
    })

    return { totalUnitsMin, totalUnitsMax }
  }, [currentTermCourses])

  const isOverload = totalUnitsMax > 20
  const isIgnored = ignoredOverloads[currentTerm] === totalUnitsMax

  const fetchBulkEvaluations = useEvaluationStore(s => s.fetchBulkEvaluations)
  const getEvaluations = useEvaluationStore(s => s.getEvaluations)
  const loadingCourses = useEvaluationStore(s => s.loadingCourses)
  const evaluations = useEvaluationStore(s => s.evaluations)
  useEffect(() => {
    const ids = currentTermCourses.map(c => c.id)
    if (user && ids.length > 0) fetchBulkEvaluations(ids)
  }, [currentTermCourses, fetchBulkEvaluations, user])

  const EXPECTED_HOURS_CACHE_KEY = 'expected-hours-cache'
  const EXPECTED_HOURS_TTL = 1000 * 60 * 30 // 30 min

  const { expectedHoursPerWeek, expectedHoursLoading, computedHours } = useMemo(() => {
    let total = 0
    let withData = 0
    let loading = false
    for (const c of currentTermCourses) {
      if (loadingCourses[c.id]) loading = true
      const evals = getEvaluations(c.id)
      const metrics = aggregateMetrics(evals)
      if (metrics.hours !== undefined && !Number.isNaN(metrics.hours)) {
        total += metrics.hours
        withData++
      } else if (!loadingCourses[c.id]) {
        // Fallback: estimate hours as units * 3 when no eval data
        const effectiveUnits = c.selectedUnits
          ?? (() => {
            const opts = parseUnitsOptions(c.units ?? '')
            return opts.length > 0 ? opts[Math.floor(opts.length / 2)] : 0
          })()
        total += effectiveUnits * 3
        withData++
      }
    }
    const computed = withData > 0 ? total : null

    // Read cached value when still loading, to avoid a flash (read-only — write is in an effect below)
    let displayValue = computed
    if (loading && computed == null && typeof window !== 'undefined') {
      try {
        const cacheKey = `expected-hours-${currentTerm}-${currentTermCourses.map(c => c.id).sort().join(',')}`
        const raw = sessionStorage.getItem(EXPECTED_HOURS_CACHE_KEY)
        const data: Record<string, { total: number; ts: number }> = raw ? JSON.parse(raw) : {}
        const cached = data[cacheKey]
        if (cached && Date.now() - cached.ts < EXPECTED_HOURS_TTL) {
          displayValue = cached.total
        }
      } catch { /* ignore */ }
    }

    return {
      expectedHoursPerWeek: displayValue ?? computed,
      expectedHoursLoading: loading && displayValue == null,
      computedHours: computed,
    }
  }, [currentTermCourses, loadingCourses, evaluations, getEvaluations, currentTerm])

  // Persist the computed value outside of render (no side effects inside useMemo)
  useEffect(() => {
    if (typeof window === 'undefined' || currentTermCourses.length === 0 || computedHours == null) return
    const cacheKey = `expected-hours-${currentTerm}-${currentTermCourses.map(c => c.id).sort().join(',')}`
    try {
      const raw = sessionStorage.getItem(EXPECTED_HOURS_CACHE_KEY)
      const data: Record<string, { total: number; ts: number }> = raw ? JSON.parse(raw) : {}
      data[cacheKey] = { total: computedHours, ts: Date.now() }
      sessionStorage.setItem(EXPECTED_HOURS_CACHE_KEY, JSON.stringify(data))
    } catch { /* ignore */ }
  }, [computedHours, currentTerm, currentTermCourses])

  const handleExportICS = () => {
    // RFC 5545 text escaping for SUMMARY/DESCRIPTION/LOCATION values.
    const escapeICS = (s: string) =>
      (s || '')
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\r?\n/g, '\\n')

    const exportEvents = currentTermCourses.flatMap(course => {
      const meetings = parseMeetingTimes(course, currentTerm)
      return meetings.flatMap(m => {
        if (!m.startTime || !m.endTime) return []
        return (m.days || []).map(day => ({
          courseId: course.id,
          courseCode: `${course.subject} ${course.code}`,
          day,
          location: m.location || '',
          start: timeToMinutes(m.startTime),
          end: timeToMinutes(m.endTime)
        }))
      })
    })

    let icsContent = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Stanford Root//Course Schedule//EN
CALSCALE:GREGORIAN
METHOD:PUBLISH
X-WR-CALNAME:Stanford Schedule - ${currentTerm}
X-WR-TIMEZONE:America/Los_Angeles
BEGIN:VTIMEZONE
TZID:America/Los_Angeles
X-LIC-LOCATION:America/Los_Angeles
BEGIN:DAYLIGHT
TZOFFSETFROM:-0800
TZOFFSETTO:-0700
TZNAME:PDT
DTSTART:19700308T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:-0700
TZOFFSETTO:-0800
TZNAME:PST
DTSTART:19701101T020000
RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU
END:STANDARD
END:VTIMEZONE
`

    // Approximate first instructional day for the term (year-agnostic; covers
    // all four quarters and rolls over automatically).
    const termStartDate = getApproxTermStart(currentTerm)

    exportEvents.forEach(event => {
      // JS getDay() semantics, so Sunday is 0 — hence the explicit undefined
      // check below. Guarding on falsiness dropped every Sunday meeting.
      const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
      const targetDay = dayMap[event.day]
      if (targetDay === undefined) return

      const startDate = new Date(termStartDate)
      const currentDay = startDate.getDay()
      let daysToAdd = targetDay - currentDay
      if (daysToAdd < 0) daysToAdd += 7
      startDate.setDate(startDate.getDate() + daysToAdd)

      const year = startDate.getFullYear()
      const month = (startDate.getMonth() + 1).toString().padStart(2, '0')
      const date = startDate.getDate().toString().padStart(2, '0')

      const formatTime = (minutes: number) => {
        const h = Math.floor(minutes / 60).toString().padStart(2, '0')
        const m = (minutes % 60).toString().padStart(2, '0')
        return `${h}${m}00`
      }

      const dtStart = `${year}${month}${date}T${formatTime(event.start)}`
      const dtEnd = `${year}${month}${date}T${formatTime(event.end)}`

      icsContent += `BEGIN:VEVENT
SUMMARY:${escapeICS(event.courseCode)}
DESCRIPTION:${escapeICS(`${event.courseCode} - ${event.location}`)}
LOCATION:${escapeICS(event.location)}
DTSTART;TZID=America/Los_Angeles:${dtStart}
DTEND;TZID=America/Los_Angeles:${dtEnd}
RRULE:FREQ=WEEKLY;COUNT=10
UID:${event.courseId}-${event.day}-${dtStart}@root.stanford.edu
END:VEVENT
`
    })

    icsContent += 'END:VCALENDAR'

    const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' })
    const link = document.createElement('a')
    link.href = window.URL.createObjectURL(blob)
    link.setAttribute('download', `stanford_schedule_${currentTerm.replace(' ', '_')}.ics`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    track('ics_exported', { courses: currentTermCourses.length })
  }

  // --- ICS Import Logic ---
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleImportClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      const text = await file.text()
      const importedCourses = parseICS(text)

      if (importedCourses.length === 0) {
        toast.error('No events found in this ICS file.')
        return
      }

      // Ensure catalog is loaded before processing
      const { hasLoaded, fetchCourses } = useCourseStore.getState()
      if (!hasLoaded) {
        await fetchCourses()
      }
      // Re-get courses after potential fetch
      const catalog = useCourseStore.getState().courses

      let count = 0
      let enrichedCount = 0
      const { addItem } = useCartStore.getState()

      importedCourses.forEach(imported => {
        // 1. Try to find the real course in our catalog
        // We match on Subject + Code (e.g. "CS" "106A")

        // Note: our catalog subjects are uppercase, imported should be too from regex
        const realCourse = catalog.find(c =>
          c.subject === imported.subject &&
          c.code === imported.code
        )

        if (realCourse) {
          // 2. We found a real course! Now try to match the specific section.
          // The imported course has a 'mock' section at index 0 with the time info.
          const importedSection = imported.sections?.[0]
          const importedMeeting = importedSection?.meetings?.[0] // Assuming one meeting pattern for simplicity

          let bestSectionId = realCourse.sections?.[0]?.classId // Default to first section

          if (importedMeeting && realCourse.sections) {
            const impDays = parseDays(importedMeeting.days || '').join(',')
            const impTimeParts = (importedMeeting.time || '').split(/\s*[-–]\s*/)
            const impStart = timeToMinutes(impTimeParts[0] || '')
            const impEnd = timeToMinutes(impTimeParts[1] || '')

            const match = realCourse.sections.find(sec => {
              return sec.meetings?.some(m => {
                const catDays = parseDays(m.days || '').join(',')
                if (catDays !== impDays) return false
                const catTimeParts = (m.time || '').split(/\s*[-–]\s*/)
                const catStart = timeToMinutes(catTimeParts[0] || '')
                const catEnd = timeToMinutes(catTimeParts[1] || '')
                return catStart === impStart && catEnd === impEnd
              })
            })

            if (match) {
              bestSectionId = match.classId
            }
          }

          // Create an enriched course object
          // We clone the real course but set the selected parameters
          const enriched = {
            ...realCourse,
            selectedTerm: imported.selectedTerm ?? imported.terms?.[0],
            selectedSectionIds: bestSectionId !== undefined ? [bestSectionId] : undefined
          }
          addItem(enriched)
          enrichedCount++
        } else {
          // 3. Fallback: use the raw imported course
          addItem(imported)
        }
        count++
      })

      track('ics_imported', { count, enriched: enrichedCount })

      if (enrichedCount > 0) {
        toast.success(`Imported ${count} courses (${enrichedCount} matched to catalog).`)
      } else {
        toast.success(`Imported ${count} courses.`)
      }

    } catch (err) {
      console.error('Failed to parse ICS', err)
      toast.error('Failed to parse ICS file.')
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  return (
    <div className="flex flex-col h-screen bg-background">
      <ScheduleSourceNotice />
      <ScheduleTimesNotice />
      {/* Header */}
      <header className="flex-none h-16 md:h-16 h-auto md:py-0 py-2 border-b bg-card">
        <div className="h-full w-full max-w-[100rem] mx-auto px-4 md:px-6 flex items-center justify-between">
          <div className="flex items-center">
            <Link href={backHref} className="flex items-center gap-2 px-2 py-1 -ml-2 rounded-lg hover:bg-secondary/50 transition-colors group">
              <Logo className="h-8 w-8 md:h-10 md:w-10" />
              <h1 className="font-display text-2xl md:text-3xl tracking-tight text-foreground select-none">
                Stanford Root
              </h1>
            </Link>
          </div>
          <div className="flex items-center gap-3 ml-auto">
            <ThemeToggle />
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground hover:text-foreground">
                  <ArrowDownUp className="h-4 w-4" />
                  Transfer
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-64 p-2">
                <div className="grid gap-1">
                  <button
                    onClick={handleExportICS}
                    disabled={currentTermCourses.length === 0}
                    className="flex flex-col gap-1 p-2 text-left rounded-md hover:bg-accent transition-colors disabled:opacity-50 disabled:pointer-events-none group"
                  >
                    <div className="flex items-center gap-2 font-medium text-sm">
                      <Download className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                      Export Schedule
                    </div>
                    <span className="text-xs text-muted-foreground pl-6">
                      Download your schedule as an .ics file for Google Calendar or Outlook.
                    </span>
                  </button>

                  <div className="h-px bg-border/50 my-1" />

                  <button
                    onClick={handleImportClick}
                    className="flex flex-col gap-1 p-2 text-left rounded-md hover:bg-accent transition-colors group"
                  >
                    <div className="flex items-center gap-2 font-medium text-sm">
                      <Upload className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                      Import Schedule
                    </div>
                    <span className="text-xs text-muted-foreground pl-6">
                      Upload an .ics file to add classes from another calendar (or OnCourse).
                    </span>
                  </button>
                </div>
              </PopoverContent>
            </Popover>

            <input
              type="file"
              ref={fileInputRef}
              className="hidden"
              accept=".ics,.ical"
              onChange={handleFileChange}
            />

            {!user && !isLoading && (
              <StanfordLoginButton
                source="header"
                size="default"
                signingInLabel="Signing in…"
                className="rounded-lg h-9 px-4 text-sm font-medium gap-2"
              >
                Log in
              </StanfordLoginButton>
            )}

            {user && (
              <Popover>
                <PopoverTrigger asChild>
                  <button aria-label="Account menu" className="outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-full transition-transform active:scale-95">
                    {user.user_metadata?.avatar_url ? (
                      <img
                        src={user.user_metadata.avatar_url}
                        alt=""
                        className="h-8 w-8 rounded-full ring-2 ring-border/60 ring-offset-1 ring-offset-background hover:ring-primary/40 transition-all"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary ring-2 ring-border/60 ring-offset-1 ring-offset-background hover:ring-primary/40 transition-all">
                        {(user.email || '?')[0].toUpperCase()}
                      </div>
                    )}
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-48 p-1" align="end" sideOffset={8}>
                  <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground border-b border-border/40 mb-1">
                    {user.email}
                  </div>
                  <button
                    onClick={signOut}
                    className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-sm transition-colors"
                  >
                    <LogOut className="h-4 w-4" />
                    Sign out
                  </button>
                </PopoverContent>
              </Popover>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-auto px-4 md:px-6 pt-[max(1rem,env(safe-area-inset-top,1rem))] md:pt-[max(1.5rem,env(safe-area-inset-top,1.25rem))] pb-[max(4rem,env(safe-area-inset-bottom,1rem))] md:pb-[max(5rem,env(safe-area-inset-bottom,1.25rem))]">
        <div className="min-h-full w-full max-w-[95rem] mx-auto flex flex-col">
          <CalendarView
            currentTerm={currentTerm}
            onPrevTerm={prevTerm}
            onNextTerm={nextTerm}
            canPrevTerm={canPrevTerm}
            canNextTerm={canNextTerm}
            totalUnitsMin={totalUnitsMin}
            totalUnitsMax={totalUnitsMax}
            isOverload={isOverload}
            isIgnored={Boolean(isIgnored)}
            onIgnoreOverload={() => setIgnoredOverloads(prev => {
              const next = { ...prev, [currentTerm]: totalUnitsMax }
              try {
                localStorage.setItem(IGNORED_OVERLOADS_KEY, JSON.stringify(next))
              } catch {
                // storage unavailable: dismissal still holds for this session
              }
              return next
            })}
            expectedHoursPerWeek={expectedHoursPerWeek}
            expectedHoursLoading={expectedHoursLoading}
          />
        </div>
      </main>
    </div>
  );
}

export default function SchedulePage() {
    useEnsureCatalog();
  return (
    <Suspense fallback={<SchedulePageShell />}>
      <ScheduleContent />
    </Suspense>
  );
}
