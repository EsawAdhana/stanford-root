'use client';

import React, { Suspense, useMemo, useState } from 'react';
import { CalendarView } from '@/components/calendar-view';
import { Button } from '@/components/ui/button';
import { AlertCircle, CalendarDays, ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCartStore } from '@/lib/cart-store';
import { parseMeetingTimes, timeToMinutes } from '@/lib/schedule-utils';
import { cn } from '@/lib/utils';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

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
PRODID:-//Revised Navigator//Stanford Course Schedule//EN
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
UID:${event.courseId}-${event.day}-${dtStart}@navigator.stanford.edu
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

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Header */}
      <header className="flex-none h-16 border-b bg-card">
        <div className="h-full w-full max-w-7xl mx-auto px-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
              <Link href={backHref}>
                  <Button variant="ghost" size="sm" className="gap-2">
                      <ChevronLeft className="h-4 w-4" />
                      Back to Courses
                  </Button>
              </Link>
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={handleExportICS}
              disabled={currentTermCourses.length === 0}
              title={currentTermCourses.length === 0 ? 'Add classes to export' : 'Export schedule as .ics'}
            >
              <CalendarDays className="h-4 w-4" />
              Export .ics
            </Button>

            {isOverload && !isIgnored ? (
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
                        Unit Overload
                      </h4>
                      <p className="text-sm text-muted-foreground">
                        You are exceeding the typical 20 unit limit for {currentTerm}.
                      </p>
                    </div>
                    <div className="flex justify-end">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setIgnoredOverloads(prev => ({ ...prev, [currentTerm]: true }))}
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
                'bg-secondary text-secondary-foreground border-transparent'
              )}>
                <span>
                  {totalUnitsMin === totalUnitsMax ? totalUnitsMin : `${totalUnitsMin}-${totalUnitsMax}`} Units
                </span>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-auto p-6">
        <div className="min-h-full w-full max-w-7xl mx-auto flex flex-col">
            <CalendarView currentTerm={currentTerm} onPrevTerm={prevTerm} onNextTerm={nextTerm} />
        </div>
      </main>
    </div>
  );
}

export default function SchedulePage() {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center">Loading...</div>}>
      <ScheduleContent />
    </Suspense>
  );
}
