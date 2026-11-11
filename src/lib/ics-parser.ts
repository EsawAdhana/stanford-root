import { Course, Section } from '@/types/course'
import { getCurrentTerm } from '@/lib/terms'
import { v4 as uuidv4 } from 'uuid'

interface SimpleEvent {
    summary: string
    location: string
    start: Date
    end: Date
}

function parseICSDate(icsDate: string): Date | null {
    // Format: 20230926T133000 or 20230926T133000Z
    if (!icsDate) return null

    const matches = icsDate.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?/)
    if (!matches) return null

    const [, year, month, day, hour, min, sec, isUtc] = matches

    if (isUtc) {
        return new Date(Date.UTC(
            parseInt(year),
            parseInt(month) - 1,
            parseInt(day),
            parseInt(hour),
            parseInt(min),
            parseInt(sec)
        ))
    }

    // Month is 0-indexed in JS Date
    return new Date(
        parseInt(year),
        parseInt(month) - 1,
        parseInt(day),
        parseInt(hour),
        parseInt(min),
        parseInt(sec)
    )
}

/** Reverses RFC 5545 text escaping applied on export (\\ \; \, \n). */
function unescapeICS(s: string): string {
    return s.replace(/\\([\\;,nN])/g, (_, ch) => (ch === 'n' || ch === 'N' ? '\n' : ch))
}

function getDayStr(date: Date): string {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    return days[date.getDay()]
}

/** Stable non-negative 31-bit hash, so re-imports key the same Section classId. */
function hashToInt(str: string): number {
    let h = 0
    for (let i = 0; i < str.length; i++) {
        h = (Math.imul(h, 31) + str.charCodeAt(i)) | 0
    }
    return Math.abs(h)
}

function formatTime(date: Date): string {
    let hours = date.getHours()
    const minutes = date.getMinutes()
    const ampm = hours >= 12 ? 'PM' : 'AM'

    hours = hours % 12
    hours = hours ? hours : 12 // the hour '0' should be '12'

    const minStr = minutes.toString().padStart(2, '0')
    return `${hours}:${minStr} ${ampm}`
}

/**
 * The import's toast. Events matched to a catalog class are classes; the rest
 * (office hours, a club meeting, a class the catalog lacks) are other events.
 */
export function importSummary(classes: number, others: number): string {
    const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
    if (classes === 0) return `Imported ${plural(others, 'event', 'events')}.`
    if (others === 0) return `Imported ${plural(classes, 'class', 'classes')}.`
    return `Imported ${plural(classes, 'class', 'classes')} and ${plural(others, 'other event', 'other events')}.`
}

export function parseICS(icsContent: string): Course[] {
    // RFC 5545 line unfolding: a CRLF/LF/CR followed by a space or tab is a
    // continuation of the previous line, not a new one.
    const unfolded = icsContent.replace(/(\r\n|\n|\r)[ \t]/g, '')
    const lines = unfolded.split(/\r\n|\n|\r/)
    const events: SimpleEvent[] = []

    let inEvent = false
    let currentEvent: Partial<SimpleEvent> = {}

    // Calendar-level term (our export writes "X-WR-CALNAME:Stanford Schedule - Spring 2026").
    // When present, use it for every event instead of inferring the term from each
    // event's date. This makes export→import round-trips land in the exact same term and
    // prevents a single class from being split across two quarters when its meeting days
    // straddle a month boundary at the approximate term-start anchor.
    let calendarTerm: string | null = null

    for (const line of lines) {
        if (!calendarTerm && line.startsWith('X-WR-CALNAME')) {
            const m = line.match(/\b(Winter|Spring|Summer|Autumn|Fall)\s+(\d{4})\b/i)
            if (m) {
                const season = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase()
                calendarTerm = `${season === 'Fall' ? 'Autumn' : season} ${m[2]}`
            }
        }

        if (line.startsWith('BEGIN:VEVENT')) {
            inEvent = true
            currentEvent = {}
            continue
        }

        if (line.startsWith('END:VEVENT')) {
            inEvent = false
            if (currentEvent.summary && currentEvent.start && currentEvent.end) {
                events.push(currentEvent as SimpleEvent)
            }
            continue
        }

        if (!inEvent) continue

        if (line.startsWith('SUMMARY:')) {
            currentEvent.summary = unescapeICS(line.substring(8).trim()) // Remove 'SUMMARY:'
        } else if (line.startsWith('LOCATION:')) {
            currentEvent.location = unescapeICS(line.substring(9).trim())
        } else if (line.startsWith('DTSTART')) {
            const value = line.slice(line.indexOf(':') + 1)
            currentEvent.start = parseICSDate(value) || undefined
        } else if (line.startsWith('DTEND')) {
            const value = line.slice(line.indexOf(':') + 1)
            currentEvent.end = parseICSDate(value) || undefined
        }
    }

    // Group events by Summary + Term to create courses
    const grouped: Record<string, SimpleEvent[]> = {}

    for (const ev of events) {
        const term = calendarTerm ?? getCurrentTerm(ev.start)
        const key = `${ev.summary}|${term}`
        if (!grouped[key]) grouped[key] = []
        grouped[key].push(ev)
    }

    const courses: Course[] = []

    for (const [key, groupEvents] of Object.entries(grouped)) {
        // term never contains '|'; summaries can, so split on the last separator.
        const sepIdx = key.lastIndexOf('|')
        const summary = key.slice(0, sepIdx)
        const term = key.slice(sepIdx + 1)

        // We need to consolidate meeting times.
        // An ICS might have 30 events for "CS 106A" (Mon, Wed, Fri for 10 weeks).
        // We want to turn this into ONE Section with meetings "Mon/Wed/Fri 10:00 AM - 11:30 AM".

        // 1. Group by "Time Range + Location" to find the days
        const meetingsMap: Record<string, Set<string>> = {} // "10:00 AM-11:30 AM|Nvidia Aud" -> Set("Mon", "Wed")

        for (const ev of groupEvents) {
            const startStr = formatTime(ev.start)
            const endStr = formatTime(ev.end)
            const timeRange = `${startStr}-${endStr}`
            const loc = ev.location || 'TBA'
            const meetKey = `${timeRange}|${loc}`

            if (!meetingsMap[meetKey]) meetingsMap[meetKey] = new Set()
            meetingsMap[meetKey].add(getDayStr(ev.start))
        }

        const meetings = Object.entries(meetingsMap).map(([meetKey, daysSet]) => {
            // timeRange has no '|'; location might, so split on the first separator.
            const sep = meetKey.indexOf('|')
            const timeRange = meetKey.slice(0, sep)
            const location = meetKey.slice(sep + 1)
            const [start, end] = timeRange.split('-')
            // Custom sort for days
            const dayOrder = { 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6, 'Sun': 7 }
            const days = Array.from(daysSet).sort((a, b) => (dayOrder[a as keyof typeof dayOrder] || 99) - (dayOrder[b as keyof typeof dayOrder] || 99))

            return {
                days: days.join('/'), // stored as "Mon/Wed" in our Section model usually, but parsedMeetingTimes handles various formats.
                time: `${start} - ${end}`,
                location,
                instructors: []
            }
        })

        // Construct the Course object
        // Summary is often "CS 106A: Programming Methodology" or just "CS 106A"
        // We'll try to split if there's a colon, or just use it as is.
        // Not a class code ("Office hours", "Gym"): the event's own name is what
        // the calendar card shows, since cards read subject + code.
        let subject = summary
        let code = ''
        const title = summary

        // Heuristic: specific parsing for "Subject Code" format if possible
        // e.g. "CS 106A" -> Subject="CS", Code="106A"
        // Also handle "MS&E 273" -> Subject="MS&E", Code="273"
        // And "CS146J" (no space, common in some exports)
        // Regex: 
        // Group 1 (Subject): [A-Z&]+ (Letters and ampersand)
        // Space: \s* (Optional)
        // Group 2 (Code): \d+[A-Z]* (Numbers followed by optional letters)
        const codeMatch = summary.match(/^([A-Z&]+)\s*(\d+[A-Z]*)/)
        if (codeMatch) {
            subject = codeMatch[1]
            code = codeMatch[2]

            // If the summary was just "CS146J", title "CS146J" is fine.
            // If "CS146J (LEC)", we might want to cleanup title?
            // For now, keep original summary as title unless we find a real course.
        }

        const section: Section = {
            term,
            classId: hashToInt(`${subject} ${code} ${term}`), // Stable ID for keying
            sectionNumber: '01',
            component: 'LEC',
            units: 0, // Unknown
            grading: 'Letter',
            classLevel: 'UG',
            instructionalMode: 'In Person',
            status: 'Open',
            enrolled: 0,
            capacity: 0,
            waitlist: 0,
            waitlistMax: 0,
            startDate: '',
            endDate: '',
            meetings,
            gers: []
        }

        courses.push({
            id: uuidv4(),
            subject,
            code,
            title,
            description: 'Imported from .ics file',
            units: '0',
            grading: 'Letter',
            instructors: [],
            terms: [term],
            sections: [section],
            selectedTerm: term,
            selectedSectionIds: [section.classId]
        })
    }

    return courses
}
