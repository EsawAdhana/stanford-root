import type { Course } from '@/types/course'
import { parseDays, parseTimeRange, pickSectionsForTerm, timeToMinutes } from '@/lib/schedule-utils'
import { getApproxTermStart, NO_CLASS_DAYS } from '@/lib/terms'

/**
 * The schedule page's Export: one term's classes as an .ics file, one weekly
 * event per class meeting day.
 *
 * Each event runs from the section's own first meeting (the catalog's
 * `startDate`) to its last day (`endDate`), skipping the term's no-class days.
 * Counting ten weeks from a guessed term start put Autumn 2026 classes on
 * Thanksgiving week and left off the last week of classes, and started Winter
 * 2027 Monday classes a week late. A section without dates falls back to that
 * guess and ten weeks, as before.
 */

const DAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

const VTIMEZONE = `BEGIN:VTIMEZONE
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

/** RFC 5545 text escaping for SUMMARY/DESCRIPTION/LOCATION values. */
function escapeICS(s: string): string {
  return (s || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

/** A calendar date with no time zone, as UTC midnight so arithmetic never crosses a DST change. */
function parseDate(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || '')
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null
}

function compact(d: Date): string {
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`
}

function addDays(d: Date, n: number): Date {
  const next = new Date(d)
  next.setUTCDate(next.getUTCDate() + n)
  return next
}

function formatTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}${String(minutes % 60).padStart(2, '0')}00`
}

type ExportEvent = {
  courseId: string
  subject: string
  courseCode: string
  day: string
  location: string
  start: number
  end: number
  startDate: string
  endDate: string
}

function eventsFor(courses: Course[], term: string): ExportEvent[] {
  return courses.flatMap(course =>
    pickSectionsForTerm(course, term).flatMap(section =>
      (section.meetings || []).flatMap(m => {
        const range = parseTimeRange(m.time || '')
        if (!range?.startTime || !range.endTime) return []
        return parseDays(m.days || '').map(day => ({
          courseId: course.id,
          subject: course.subject,
          courseCode: `${course.subject} ${course.code}`,
          day,
          location: m.location || '',
          start: timeToMinutes(range.startTime),
          end: timeToMinutes(range.endTime),
          startDate: section.startDate,
          endDate: section.endDate,
        }))
      })
    )
  )
}

export function buildScheduleICS(courses: Course[], term: string): string {
  let ics = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Stanford Root//Course Schedule//EN
CALSCALE:GREGORIAN
METHOD:PUBLISH
X-WR-CALNAME:Stanford Schedule - ${term}
X-WR-TIMEZONE:America/Los_Angeles
${VTIMEZONE}`

  const approxStart = getApproxTermStart(term)
  const fallbackStart = new Date(Date.UTC(approxStart.getFullYear(), approxStart.getMonth(), approxStart.getDate()))

  for (const event of eventsFor(courses, term)) {
    // JS getDay() semantics, so Sunday is 0: checked against undefined, since a
    // falsy check once dropped every Sunday meeting.
    const targetDay = DAY_INDEX[event.day]
    if (targetDay === undefined) continue

    const sectionStart = parseDate(event.startDate)
    const sectionEnd = parseDate(event.endDate)
    const dated = Boolean(sectionStart && sectionEnd && sectionEnd >= sectionStart)

    const skipped = new Set(
      (NO_CLASS_DAYS[term] ?? [])
        .filter(d => !d.except?.includes(event.subject))
        .map(d => d.date.replace(/-/g, ''))
    )

    // The first meeting: the first day on or after the start with this weekday
    // that is not a no-class day.
    let first = dated ? sectionStart! : fallbackStart
    first = addDays(first, (targetDay - first.getUTCDay() + 7) % 7)
    if (dated) {
      while (skipped.has(compact(first)) && first <= sectionEnd!) first = addDays(first, 7)
      if (first > sectionEnd!) continue
    }

    const day = compact(first)
    const dtStart = `${day}T${formatTime(event.start)}`
    const dtEnd = `${day}T${formatTime(event.end)}`

    let rule = 'RRULE:FREQ=WEEKLY;COUNT=10'
    const exdates: string[] = []
    if (dated) {
      // UNTIL is in UTC when DTSTART has a zone: the morning after the last day
      // in UTC is still that last day in Pacific time, so its meetings count.
      rule = `RRULE:FREQ=WEEKLY;UNTIL=${compact(addDays(sectionEnd!, 1))}T065959Z`
      for (let d = addDays(first, 7); d <= sectionEnd!; d = addDays(d, 7)) {
        if (skipped.has(compact(d))) exdates.push(`${compact(d)}T${formatTime(event.start)}`)
      }
    }

    ics += `BEGIN:VEVENT
SUMMARY:${escapeICS(event.courseCode)}
DESCRIPTION:${escapeICS(`${event.courseCode} - ${event.location}`)}
LOCATION:${escapeICS(event.location)}
DTSTART;TZID=America/Los_Angeles:${dtStart}
DTEND;TZID=America/Los_Angeles:${dtEnd}
${rule}
${exdates.length ? `EXDATE;TZID=America/Los_Angeles:${exdates.join(',')}\n` : ''}UID:${event.courseId}-${event.day}-${dtStart}@root.stanford.edu
END:VEVENT
`
  }

  return ics + 'END:VCALENDAR'
}
