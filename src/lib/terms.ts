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
 * The term to default UI to. Prefers the in-session term when it has data, with
 * two exceptions that both land users on the most recent Autumn term:
 *   - Summer: nobody enrolls over summer; students are planning the upcoming
 *     autumn, whose catalog isn't published until August. Last year's autumn is
 *     the best available preview.
 *   - Rollover gap: the in-session term simply isn't in the catalog yet.
 * Falls back to the in-session term (if present) then the latest available term,
 * so the app never lands users on an empty term.
 */
export function getDefaultTerm(availableTerms?: string[]): string {
  const current = getCurrentTerm()
  if (availableTerms && availableTerms.length > 0) {
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
  return current
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
