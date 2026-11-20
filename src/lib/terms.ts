/**
 * Single source of truth for Stanford term handling.
 *
 * Term display strings are "Season YYYY" (e.g. "Autumn 2026", "Winter 2027").
 * Stanford's academic year runs Autumn -> Winter -> Spring -> Summer. The
 * display year is the calendar year the quarter occurs in, so chronological
 * order within a calendar year is Winter < Spring < Summer < Autumn.
 */

const SEASON_ORDER: Record<string, number> = {
  Winter: 0,
  Spring: 1,
  Summer: 2,
  Autumn: 3,
  Fall: 3,
}

export interface ParsedTerm {
  season: string
  year: number
}

export function parseTerm(term: string): ParsedTerm {
  const parts = (term || '').trim().split(/\s+/)
  const season = parts[0] || ''
  const year = parseInt(parts[parts.length - 1], 10)
  return { season, year: Number.isNaN(year) ? 0 : year }
}

/** Chronological sort key: year then season-within-calendar-year. */
function termSortKey(term: string): number {
  const { season, year } = parseTerm(term)
  const s = SEASON_ORDER[season] ?? 0
  return year * 10 + s
}

/** compareTerms(a, b) < 0 when `a` is chronologically earlier than `b`. */
export function compareTerms(a: string, b: string): number {
  return termSortKey(a) - termSortKey(b)
}

/**
 * The Stanford term currently in session for a given date. Calendar-month
 * based, so it rolls over automatically every year with no hardcoded dates.
 */
export function getCurrentTerm(now: Date = new Date()): string {
  const m = now.getMonth() // 0-11
  const y = now.getFullYear()
  if (m <= 2) return `Winter ${y}` // Jan-Mar
  if (m <= 5) return `Spring ${y}` // Apr-Jun
  if (m <= 7) return `Summer ${y}` // Jul-Aug
  return `Autumn ${y}` // Sep-Dec
}

/**
 * The quarter students are planning, set by hand once enrollment for the next
 * quarter opens and nobody is looking at the one in session any more. The app
 * opens on it instead of the calendar quarter until the calendar passes it, so
 * it never needs clearing: once Spring 2027 starts it is in the past and ignored.
 */
export const PLANNING_TERM = 'Winter 2027'

/**
 * The term to default UI to. PLANNING_TERM wins while it is current or ahead
 * and has data. Otherwise it prefers the in-session term when it has data, with
 * two exceptions that both land users on the most recent Autumn term:
 *   - Summer: nobody enrolls over summer; students are planning the upcoming
 *     autumn, whose catalog isn't published until August. Last year's autumn is
 *     the best available preview.
 *   - Rollover gap: the in-session term simply isn't in the catalog yet.
 * Falls back to the in-session term (if present) then the latest available term,
 * so the app never lands users on an empty term.
 */
export function getDefaultTerm(availableTerms?: string[], now: Date = new Date()): string {
  const current = getCurrentTerm(now)
  const planning = compareTerms(PLANNING_TERM, current) >= 0 ? PLANNING_TERM : null
  if (availableTerms && availableTerms.length > 0) {
    if (planning && availableTerms.includes(planning)) return planning
    const { season } = parseTerm(current)
    if (season !== 'Summer' && availableTerms.includes(current)) return current
    const autumns = availableTerms.filter(t => {
      const s = parseTerm(t).season
      return s === 'Autumn' || s === 'Fall'
    })
    if (autumns.length > 0) {
      return [...autumns].sort(compareTerms)[autumns.length - 1]
    }
    if (availableTerms.includes(current)) return current
    return [...availableTerms].sort(compareTerms)[availableTerms.length - 1]
  }
  return planning ?? current
}

/**
 * Whether a term is in the future relative to now (syllabi / details may not be
 * published yet). Used to relax syllabus validation and voting.
 */
export function isFutureTerm(term: string, now: Date = new Date()): boolean {
  return compareTerms(term, getCurrentTerm(now)) > 0
}

/**
 * Approximate first instructional day for a term, for anchoring exported ICS
 * calendar events. Dates are intentionally rough and year-agnostic; refine
 * against the official Stanford academic calendar if exact dates matter.
 */
export function getApproxTermStart(term: string): Date {
  const { season, year } = parseTerm(term)
  switch (season) {
    case 'Autumn':
    case 'Fall':
      return new Date(year, 8, 22) // ~Sep 22
    case 'Winter':
      return new Date(year, 0, 5) // ~Jan 5
    case 'Spring':
      return new Date(year, 2, 30) // ~Mar 30
    case 'Summer':
      return new Date(year, 5, 22) // ~Jun 22
    default:
      return new Date()
  }
}

/**
 * Weekdays in a term with no classes, from the Registrar's 2026-27 academic
 * calendar (studentservices.stanford.edu, "Stanford Academic Calendar
 * 2026-2027", read 2026-11-11). The catalog's section dates are only a first
 * and last day, so an exported calendar needs these to skip Thanksgiving week
 * and the Monday holidays. `except` lists subjects that still meet that day.
 * Add each year's dates when its calendar is published; a term missing here
 * exports with no days skipped.
 */
export const NO_CLASS_DAYS: Record<string, { date: string; name: string; except?: string[] }[]> = {
  'Autumn 2026': [
    { date: '2026-09-21', name: 'Yom Kippur' },
    { date: '2026-11-03', name: 'Democracy Day' },
    { date: '2026-11-23', name: 'Thanksgiving Recess' },
    { date: '2026-11-24', name: 'Thanksgiving Recess' },
    { date: '2026-11-25', name: 'Thanksgiving Recess' },
    { date: '2026-11-26', name: 'Thanksgiving Recess' },
    { date: '2026-11-27', name: 'Thanksgiving Recess' },
  ],
  'Winter 2027': [
    { date: '2027-01-18', name: 'Martin Luther King, Jr., Day' },
    { date: '2027-02-15', name: "Presidents' Day", except: ['LAW'] },
  ],
  'Spring 2027': [
    { date: '2027-05-31', name: 'Memorial Day' },
    { date: '2027-06-03', name: 'Day before finals' },
  ],
  'Summer 2027': [
    { date: '2027-07-05', name: 'Independence Day holiday' },
  ],
}

/**
 * Season codes used by Stanford's own syllabus service
 * (syllabus.stanford.edu): Autumn -> F, Winter -> W, Spring -> Sp, Summer -> Su.
 * Autumn is "F" (Fall) there even though the registrar says Autumn everywhere else.
 */
const SEASON_TO_CODE: Record<string, string> = {
  Autumn: 'F',
  Fall: 'F',
  Winter: 'W',
  Spring: 'Sp',
  Summer: 'Su',
}

const CODE_TO_SEASON: Record<string, string> = {
  F: 'Autumn',
  W: 'Winter',
  Sp: 'Spring',
  Su: 'Summer',
}

/** "Winter 2026" -> "W26". Empty string when the term isn't parseable. */
export function termToCode(term: string): string {
  const { season, year } = parseTerm(term)
  const seasonCode = SEASON_TO_CODE[season]
  if (!seasonCode || !year) return ''
  return `${seasonCode}${String(year).slice(-2)}`
}

/** "W26" -> "Winter 2026". Empty string when the code isn't parseable. */
export function codeToTerm(code: string): string {
  const m = /^(Sp|Su|W|F)(\d{2})$/.exec((code || '').trim())
  if (!m) return ''
  return `${CODE_TO_SEASON[m[1]]} 20${m[2]}`
}
