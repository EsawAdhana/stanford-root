'use client';

import React, { Suspense, useMemo, useState } from 'react';
import { CalendarView } from '@/components/calendar-view';
import { Button } from '@/components/ui/button';
import { AlertCircle, CalendarDays, ChevronLeft, ChevronRight, ChevronDown, Download, Upload } from 'lucide-react';
import NextImage from 'next/image';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCartStore } from '@/lib/cart-store';
import { useCourseStore } from '@/lib/store';
import { AuthGate } from '@/components/auth-gate';
import { Logo } from '@/components/logo';
import { parseMeetingTimes, timeToMinutes } from '@/lib/schedule-utils';
import { cn } from '@/lib/utils';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { parseICS } from '@/lib/ics-parser';
import { useRef } from 'react';
import { toast } from 'sonner';

function ScheduleContent() {
  const { items } = useCartStore()
  const [ignoredOverloads, setIgnoredOverloads] = useState<Record<string, boolean>>({})
  const searchParams = useSearchParams()

  const backHref = useMemo(() => {
    const params = new URLSearchParams(searchParams.toString())
    params.delete('courseId')
    const qs = params.toString()
    return qs ? `/?${qs}` : '/'
  }, [searchParams])

  const QUARTERS = ['Winter', 'Spring', 'Summer', 'Autumn']

  const [currentTerm, setCurrentTerm] = useState(() => {
    const now = new Date()
    const year = now.getFullYear()
    const month = now.getMonth()
    const day = now.getDate()

    // > Feb 24 (Spring Planning): Show Spring {year}
    // > Nov 25 (Winter Planning): Show Winter {year+1}
    // Else: Autumn {year}
    if (month > 1 || (month === 1 && day >= 25)) return `Spring ${year}`
    if (month > 10 || (month === 10 && day >= 25)) return `Winter ${year + 1}`
    if (month < 1 || (month === 1 && day < 25)) return `Winter ${year}`
    return `Autumn ${year}`
  })

  const nextTerm = () => {
    setCurrentTerm(prev => {
      const [q, yStr] = prev.split(' ')
      const year = parseInt(yStr)
      const qIdx = QUARTERS.indexOf(q)
      if (qIdx === 3) return `Winter ${year + 1}`
      return `${QUARTERS[qIdx + 1]} ${year}`
    })
  }

  const prevTerm = () => {
    setCurrentTerm(prev => {
      const [q, yStr] = prev.split(' ')
      const year = parseInt(yStr)
      const qIdx = QUARTERS.indexOf(q)
      if (qIdx === 0) return `Autumn ${year - 1}`
      return `${QUARTERS[qIdx - 1]} ${year}`
    })
  }

  const currentTermCourses = useMemo(() => {
    return items.filter(c =>
      c.selectedTerm ? c.selectedTerm === currentTerm :
        ((c.terms && currentTerm && c.terms.includes(currentTerm)) || c.term === currentTerm)
    )
  }, [items, currentTerm])

  const { totalUnitsMin, totalUnitsMax } = useMemo(() => {
    let totalUnitsMin = 0
    let totalUnitsMax = 0

    currentTermCourses.forEach(c => {
      if (c.selectedUnits !== undefined && !isNaN(c.selectedUnits)) {
        totalUnitsMin += c.selectedUnits
        totalUnitsMax += c.selectedUnits
        return
      }

      if (c.selectedSectionId && c.sections) {
        const section = c.sections.find(s => s.classId === c.selectedSectionId)
        if (section) {
          const u = typeof section.units === 'string' ? parseFloat(section.units) : section.units
          if (!isNaN(u)) {
            totalUnitsMin += u
            totalUnitsMax += u
            return
          }
        }
      }

      if (c.units) {
        const parts = c.units.split('-').map(s => parseFloat(s.trim()))
        if (parts.length > 0 && !isNaN(parts[0])) {
          totalUnitsMin += parts[0]
          totalUnitsMax += parts.length > 1 && !isNaN(parts[1]) ? parts[1] : parts[0]
        }
      }
    })

    return { totalUnitsMin, totalUnitsMax }
  }, [currentTermCourses])

  const isOverload = totalUnitsMax > 20
  const isIgnored = ignoredOverloads[currentTerm]

  const handleExportICS = () => {
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

    exportEvents.forEach(event => {
      // Rough term anchor dates
      let termStartDate = new Date()
      if (currentTerm === 'Autumn 2025') termStartDate = new Date(2025, 8, 22)
      else if (currentTerm === 'Winter 2026') termStartDate = new Date(2026, 0, 5)
      else if (currentTerm === 'Spring 2026') termStartDate = new Date(2026, 2, 30)

      const dayMap: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5 }
      const targetDay = dayMap[event.day]
      if (!targetDay) return

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
SUMMARY:${event.courseCode}
DESCRIPTION:${event.courseCode} - ${event.location}
LOCATION:${event.location}
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
            // Try to find a section that has a meeting with overlapping/same time
            // A strict equality match on "days" and "start time" is a good heuristic.
            // importedMeeting.time is "10:30 AM - 11:50 AM"
            // importedMeeting.days is "Tue/Thu"

            const match = realCourse.sections.find(sec => {
              return sec.meetings?.some(m => {
                // Check if days overlap or match
                // This is a bit fuzzy because formats might differ slightly
                // But let's check exact string match for time range first if format aligns

                // Let's rely on our parsed meeting utils if possible, 
                // but `sec.meetings` is raw data.

                // Simple check: does the meeting text contain the start time?
                // or better, check strict eq if format is standard.
                return (m.days === importedMeeting.days && m.time === importedMeeting.time)
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
            id: imported.id, // Keep the UUID generated by import so it's unique-ish? Or use real ID?
            // Using real ID might de-dupe against existing cart items better.
            // Let's use real ID but maybe modify it if we want to allow duplicates?
            // Standard behavior: use real ID.
            selectedTerm: imported.term,
            selectedSectionId: bestSectionId
          }
          addItem(enriched)
          enrichedCount++
        } else {
          // 3. Fallback: use the raw imported course
          addItem(imported)
        }
        count++
      })

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
      {/* Header */}
      <header className="flex-none h-16 md:h-16 h-auto md:py-0 py-2 border-b bg-card">
        <div className="h-full w-full max-w-[100rem] mx-auto px-4 md:px-6 flex items-center justify-between">
          <div className="flex items-center">
            <Link href={backHref} className="flex items-center gap-2 px-2 py-1 -ml-2 rounded-lg hover:bg-secondary/50 transition-colors group">
              <Logo className="h-8 w-8 md:h-10 md:w-10" />
              <h1 className="text-xl md:text-2xl tracking-tight font-[family-name:var(--font-outfit)] font-bold text-primary select-none transition-colors duration-300 group-hover:text-cardinal-red">
                Stanford Root
              </h1>
            </Link>
          </div>
          <div className="flex items-center gap-3 ml-auto">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground hover:text-foreground">
                  <NextImage src="/icon.png" alt="" width={16} height={16} className="h-4 w-4 opacity-70" />
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
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-auto p-4 md:p-6">
        <div className="min-h-full w-full max-w-[95rem] mx-auto flex flex-col">
          <CalendarView
            currentTerm={currentTerm}
            onPrevTerm={prevTerm}
            onNextTerm={nextTerm}
            totalUnitsMin={totalUnitsMin}
            totalUnitsMax={totalUnitsMax}
            isOverload={isOverload && !isIgnored}
            onIgnoreOverload={() => setIgnoredOverloads(prev => ({ ...prev, [currentTerm]: true }))}
          />
        </div>
      </main>
    </div>
  );
}

export default function SchedulePage() {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center">Loading...</div>}>
      <AuthGate>
        <ScheduleContent />
      </AuthGate>
    </Suspense>
  );
}
