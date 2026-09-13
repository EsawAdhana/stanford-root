import type { Course, Section } from '@/types/course'
import { getCrossListPrimaryMap, normalizeCourseId, resolveToCanonicalPrimary } from '@/lib/cross-list.mjs'

type ParsedMeeting = {
  days: string[]
  startTime: string
  endTime: string
  location?: string
}

const DAY_ORDER: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7
}

function uniq(arr: string[]) {
  return Array.from(new Set(arr))
}

function normalizeDayToken(token: string) {
  const t = token.trim().toLowerCase()
  if (!t) return ''

  // Common Stanford-ish variants
  if (t === 'm' || t.startsWith('mon')) return 'Mon'
  if (t === 't' || t === 'tu' || t.startsWith('tue')) return 'Tue'
  if (t === 'w' || t.startsWith('wed')) return 'Wed'
  if (t === 'r' || t === 'th' || t.startsWith('thu')) return 'Thu'
  if (t === 'f' || t.startsWith('fri')) return 'Fri'
  // Weekend classes are rare (39 sections in Autumn 2026) but real: labs,
  // Human Biology field work, some CSRE and CHPR seminars. Without these two
  // the day list came back empty and the class disappeared from the schedule.
  if (t === 'sa' || t.startsWith('sat')) return 'Sat'
  if (t === 'su' || t.startsWith('sun')) return 'Sun'
  return ''
}

export function parseDays(daysStr: string) {
  if (!daysStr) return []
  const raw = daysStr.trim()
  if (!raw || raw.toLowerCase().includes('tba')) return []

  // Handle compact patterns like "MWF", "TTh", "TuTh"
  const compact = raw.replace(/\s+/g, '')
  const compactMatches = compact.match(/(Mon|Tue|Wed|Thu|Fri|Tu|Th|Su|Sa|M|T|W|R|F)+/gi)
  if (compactMatches && compactMatches.length === 1 && compactMatches[0] === compact) {
    const chars: string[] = []
    let i = 0
    while (i < compact.length) {
      const next2 = compact.slice(i, i + 2).toLowerCase()
      const next3 = compact.slice(i, i + 3).toLowerCase()

      if (next2 === 'tu') { chars.push('Tu'); i += 2; continue }
      if (next2 === 'th') { chars.push('Th'); i += 2; continue }
      // Sat/Sun before the single-character fallthrough, which would otherwise
      // read "Sat" as S-a-t and resolve the trailing "t" to Tuesday.
      if (next3 === 'sat') { chars.push('Sat'); i += 3; continue }
      if (next3 === 'sun') { chars.push('Sun'); i += 3; continue }
      if (next2 === 'sa') { chars.push('Sa'); i += 2; continue }
      if (next2 === 'su') { chars.push('Su'); i += 2; continue }
      if (next3 === 'mon') { chars.push('Mon'); i += 3; continue }
      if (next3 === 'tue') { chars.push('Tue'); i += 3; continue }
      if (next3 === 'wed') { chars.push('Wed'); i += 3; continue }
      if (next3 === 'thu') { chars.push('Thu'); i += 3; continue }
      if (next3 === 'fri') { chars.push('Fri'); i += 3; continue }

      chars.push(compact[i])
      i += 1
    }

    const normalized = chars.map(normalizeDayToken).filter(Boolean)
    return uniq(normalized).filter(d => d in DAY_ORDER).sort((a, b) => DAY_ORDER[a] - DAY_ORDER[b])
  }

  // Fallback: split tokens
  const tokens = raw.split(/[,\s/]+/g).filter(Boolean)
  const normalized = tokens.map(normalizeDayToken).filter(Boolean)
  return uniq(normalized).filter(d => d in DAY_ORDER).sort((a, b) => DAY_ORDER[a] - DAY_ORDER[b])
}

function parseTimePiece(piece: string, fallbackMeridiem?: 'AM' | 'PM') {
  let p = piece.trim()
  if (!p) return ''

  const m = p.match(/\b(AM|PM)\b/i)
  const hasMeridiem = Boolean(m)
  if (!hasMeridiem && fallbackMeridiem) {
    p = `${p} ${fallbackMeridiem}`
  }
  return p
}

/** Parse a time range string. Supports hyphen, en dash, em dash, and minus (scraped data varies). */
export function parseTimeRange(timeStr: string) {
  if (!timeStr) return null
  const raw = timeStr.trim()
  if (!raw || raw.toLowerCase().includes('tba')) return null

  // Split on hyphen/en/em dash or unicode minus (e.g. "10:30 AM – 12:20 PM")
  const parts = raw.split(/\s*[-–—−]\s*/).map(s => s.trim()).filter(Boolean)
  if (parts.length === 0) return null
  if (parts.length === 1) {
    const start = parts[0]
    return { startTime: start, endTime: '' }
  }

  const startRaw = parts[0]
  const endRaw = parts[1]

  const startMeridiem = startRaw.match(/\b(AM|PM)\b/i)?.[1]?.toUpperCase() as 'AM' | 'PM' | undefined
  const endMeridiem = endRaw.match(/\b(AM|PM)\b/i)?.[1]?.toUpperCase() as 'AM' | 'PM' | undefined

  const startTime = parseTimePiece(startRaw, endMeridiem)
  const endTime = parseTimePiece(endRaw, startMeridiem)

  return { startTime, endTime }
}

export function timeToMinutes(timeStr: string) {
  if (!timeStr) return 0
  const t = timeStr.trim()
  if (!t) return 0

  // "13:30" or "9:30 AM" or "9 AM"
  const mer = t.match(/\b(AM|PM)\b/i)?.[1]?.toUpperCase() as 'AM' | 'PM' | undefined
  const cleaned = t.replace(/\b(AM|PM)\b/i, '').trim()

  const [hStr, mStr] = cleaned.split(':')
  let hours = parseInt(hStr, 10)
  const minutes = mStr ? parseInt(mStr, 10) : 0
  if (isNaN(hours) || isNaN(minutes)) return 0

  if (mer) {
    if (mer === 'PM' && hours < 12) hours += 12
    if (mer === 'AM' && hours === 12) hours = 0
  }

  return hours * 60 + minutes
}

export function formatMinutes(minutes: number) {
  const h24 = Math.floor(minutes / 60)
  const m = minutes % 60
  const mer = h24 >= 12 ? 'PM' : 'AM'
  const h12 = ((h24 + 11) % 12) + 1
  return `${h12}:${m.toString().padStart(2, '0')} ${mer}`
}

/**
 * Drops the seconds ExploreCourses puts on every time ("2:30:00 PM" →
 * "2:30 PM"). Only the seconds group is matched, so on-the-hour times keep
 * their minutes — stripping every ":00" turned "3:00:00 PM" into "3 PM".
 */
export function stripSeconds(time: string) {
  return (time || '').replace(/(\d{1,2}:\d{2}):\d{2}/g, '$1')
}

/**
 * How "primary" a component is — lower sorts first. Secondary components
 * (discussion, lab, clinic) hang off a primary one, so they are never the right
 * stand-in for a course the user has not picked a section from yet.
 * ExploreCourses publishes no primary/secondary flag, so this table is it.
 */
const COMPONENT_RANK: Record<string, number> = {
  LEC: 0, SEM: 1,
  LNG: 2, COL: 2, CAS: 2, ISF: 2, ISS: 2,
  WKS: 3, PRA: 3,
  ACT: 4,
  LAB: 5, LBS: 5,
  DIS: 6, TUT: 6, ITR: 6,
  RES: 7,
  CLK: 8, CLN: 8,
  'T/D': 9, INS: 9,
}
const UNKNOWN_COMPONENT_RANK = 4

/** True when a section has a meeting the calendar can actually place. */
function isRenderable(section: Section) {
  return getParsedSectionMeetings(section).some(m => m.days.length > 0)
}

function sectionNumberValue(section: Section) {
  const n = parseInt(String(section.sectionNumber ?? '').replace(/\D/g, ''), 10)
  return Number.isNaN(n) ? Number.MAX_SAFE_INTEGER : n
}

/**
 * The one section to stand in for a course with no pick yet. Sections arrive in
 * whatever order ExploreCourses returns them, which for CS106A is 60
 * discussions ahead of the single lecture — picking index 0 put a random
 * discussion on the calendar and left the lecture off entirely.
 *
 * Ties break on section number rather than source order: MATH 51 has five
 * lectures and the dump's ordering shifts between refreshes, so source order
 * would quietly change the time shown from one night to the next.
 */
function standInSection(sectionsForTerm: Section[]): Section {
  return sectionsForTerm.reduce((best, candidate) => {
    const bestRank = COMPONENT_RANK[best.component] ?? UNKNOWN_COMPONENT_RANK
    const rank = COMPONENT_RANK[candidate.component] ?? UNKNOWN_COMPONENT_RANK
    if (rank !== bestRank) return rank < bestRank ? candidate : best

    // Same component: something that will actually draw beats a section
    // carrying no time at all.
    const bestDraws = isRenderable(best)
    const candidateDraws = isRenderable(candidate)
    if (bestDraws !== candidateDraws) return candidateDraws ? candidate : best

    return sectionNumberValue(candidate) < sectionNumberValue(best) ? candidate : best
  })
}

/**
 * Sections the user attends for a term. Courses like ESF13 (SEM + DIS) or
 * CS106A (LEC + DIS) meet as several sections at once, so this returns all of
 * the user's picks rather than a single one.
 */
export function pickSectionsForTerm(course: Course, term?: string): Section[] {
  const sections = course.sections || []
  if (sections.length === 0) return []

  const sectionsForTerm = term ? sections.filter(s => s.term === term) : sections
  if (sectionsForTerm.length === 0) return []

  const selectedIds = course.selectedSectionIds
  if (selectedIds && selectedIds.length > 0) {
    const selected = sectionsForTerm.filter(s => selectedIds.includes(s.classId))
    if (selected.length > 0) return selected
  }

  // No pick yet (e.g. quick-add from the schedule search, which passes no
  // section): stand in with the primary component, or CS106A would drop 60
  // discussions onto the calendar at once.
  return [standInSection(sectionsForTerm)]
}

/**
 * True when the stand-in section for an unpicked course differs from the one
 * the old index-0 fallback showed — i.e. this course's time visibly moved on
 * saved calendars when the primary-component fix shipped. Drives the one-off
 * notice on the schedule page, so only people whose calendar actually changed
 * are told about it.
 */
export function standInSectionChanged(course: Course, term?: string): boolean {
  if (course.selectedSectionIds?.length) return false

  const sections = course.sections || []
  const sectionsForTerm = term ? sections.filter(s => s.term === term) : sections
  if (sectionsForTerm.length < 2) return false

  return standInSection(sectionsForTerm).classId !== sectionsForTerm[0].classId
}

/**
 * Adds a section to a selection, dropping any existing pick that shares its
 * component and term.
 *
 * Sections sharing a component are alternatives, never companions: a class that
 * meets at several times lists those slots in one section's `meetings`, so two
 * DIS rows always mean two competing options. Different components are additive.
 * ExploreCourses publishes no required/optional flag, so this makes no claim
 * about which components a student must attend.
 */
export function mergeSectionSelection(selectedIds: number[], sectionId: number, sections: Section[]): number[] {
  const added = sections.find(s => s.classId === sectionId)
  if (!added) {
    return selectedIds.includes(sectionId) ? selectedIds : [...selectedIds, sectionId]
  }

  const kept = selectedIds.filter(id => {
    if (id === sectionId) return false
    const existing = sections.find(s => s.classId === id)
    if (!existing) return true
    return !(existing.component === added.component && existing.term === added.term)
  })

  return [...kept, sectionId]
}

/** Components offered in a term that the user has not picked a section from. */
export function unpickedComponents(sections: Section[], selectedIds: number[]): string[] {
  const components = Array.from(new Set(sections.map(s => s.component).filter(Boolean)))
  return components.filter(component =>
    !sections.some(s => s.component === component && selectedIds.includes(s.classId))
  )
}

export function makeMeetingKey(day: string, startTime: string, endTime: string) {
  return `${day}|${startTime}|${endTime}`
}

export function isMeetingOptional(course: Course, day: string, startTime: string, endTime: string) {
  const key = makeMeetingKey(day, startTime, endTime)
  return Boolean(course.optionalMeetings?.includes(key))
}

export type ParsedSectionMeeting = {
  days: string[]
  startTime: string
  endTime: string
  startMinutes: number
  endMinutes: number
}

// Parsed meeting times per section object, memoized by section identity.
// Section objects are stable for the lifetime of a catalog load, and the
// filter pipeline re-visits every section on each filter change — parsing the
// day/time strings once instead of per pass is a large win (~95k sections).
const parsedSectionMeetingsCache = new WeakMap<object, ParsedSectionMeeting[]>()

/**
 * Meetings with a parseable start time for a section (days may be empty, e.g.
 * TBA days with a known time — callers that need days filter on days.length).
 * Time strings are exactly what parseTimeRange returns, so keys built from
 * them (e.g. optional-meeting keys) match the unmemoized parse.
 */
export function getParsedSectionMeetings(
  section: { meetings?: { days?: string; time?: string }[] }
): ParsedSectionMeeting[] {
  const cached = parsedSectionMeetingsCache.get(section)
  if (cached) return cached

  const parsed: ParsedSectionMeeting[] = (section.meetings || []).flatMap(m => {
    const range = parseTimeRange(m.time || '')
    if (!range?.startTime) return []
    return [{
      days: parseDays(m.days || ''),
      startTime: range.startTime,
      endTime: range.endTime,
      startMinutes: timeToMinutes(range.startTime),
      endMinutes: range.endTime ? timeToMinutes(range.endTime) : 0,
    }]
  })
  parsedSectionMeetingsCache.set(section, parsed)
  return parsed
}

export function parseMeetingTimes(course: Course, term?: string): ParsedMeeting[] {
  const parsed: ParsedMeeting[] = []

  for (const section of pickSectionsForTerm(course, term)) {
    for (const m of section.meetings || []) {
      const days = parseDays(m.days || '')
      const range = parseTimeRange(m.time || '')
      if (!range?.startTime) continue

      parsed.push({
        days,
        startTime: range.startTime,
        endTime: range.endTime,
        location: m.location
      })
    }
  }

  return parsed
}


/**
 * The listing of `courseId`'s class that is already on the schedule, if any.
 *
 * A cross-listed class has one meeting but several catalog ids, and the schedule
 * search matches on title text -- searching "COMM 172" turns up COMM 272, whose
 * title is "Media Psychology (COMM 172)". Comparing ids alone let both listings
 * onto the same calendar: two blocks in the same slot, and the term's units
 * counted twice (COMM 172 + COMM 272 read as 8-10 units for one 4-5 unit class).
 *
 * Returns the scheduled listing rather than a boolean so the caller can name it
 * ("Added as COMM 172") instead of claiming the course itself is on the schedule.
 */
export function scheduledCrossListMember<T extends { id: string }>(
  courseId: string,
  scheduled: T[],
  primaryMap: Map<string, string>,
): T | undefined {
  const canonical = resolveToCanonicalPrimary(normalizeCourseId(courseId), primaryMap)
  return scheduled.find(c => resolveToCanonicalPrimary(normalizeCourseId(c.id), primaryMap) === canonical)
}

/**
 * Collapse a schedule to one listing per cross-listed class per term, keeping the
 * first occurrence.
 *
 * `addItem` enforces this as things are added, but the sync path writes the cart with
 * `setState` -- a pull hydrates the server's list wholesale, and a merge concatenates
 * server-only items onto the local ones. A schedule built on a phone as CS 238 and on a
 * laptop as AA 228 would otherwise land both listings on one calendar. First wins so the
 * merge keeps the local item, matching the rest of that path.
 */
export function dedupeCrossListedItems<T extends { id: string; selectedTerm?: string; terms?: string[] }>(
  items: T[],
  courses: { id: string; title: string }[],
): T[] {
  if (items.length < 2) return items
  const primaryMap = getCrossListPrimaryMap(courses)
  const seen = new Set<string>()
  const kept: T[] = []
  for (const item of items) {
    const canonical = resolveToCanonicalPrimary(normalizeCourseId(item.id), primaryMap)
    const key = `${canonical}|${item.selectedTerm ?? item.terms?.[0] ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    kept.push(item)
  }
  return kept
}
