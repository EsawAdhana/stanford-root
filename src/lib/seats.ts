import type { CombinedSeats } from '@/types/course'

/**
 * Live enrollment ("seats") for a section, read from Stanford Navigator on
 * demand. The daily catalog dump carries a snapshot; during enrollment week
 * that snapshot is hours stale, so the course page overlays fresh numbers for
 * the sections a student is actually looking at.
 *
 * Fetch-on-view, never a sweep. Polling all 20,283 sections of a term every
 * five minutes is 68 req/s sustained against a university endpoint; one fetch
 * per opened course page is ~900-2,700 requests a day and looks like what it
 * is, a student reading a course page.
 */

export interface LiveSeat {
  classNbr: number
  enrolled: number
  capacity: number
  waitlist: number
  waitlistMax: number
  /** e.g. "Open", "Closed", "Wait List" — Navigator's own wording. */
  status: string
  /** Shared seats when the section is cross-listed; see Section.combined. */
  combined?: CombinedSeats
}

export interface SeatsResponse {
  /** Keyed by classNbr as a string, because JSON object keys are strings. */
  seats: Record<string, LiveSeat>
  /** ISO timestamp of the oldest reading in this payload. */
  fetchedAt: string | null
  /** True when upstream is paused/erroring and these are cached or partial. */
  degraded: boolean
}

/**
 * PeopleSoft term code. Verified against Navigator's `strm` facet:
 * Autumn 2024 -> 1252, Autumn 2025 -> 1262, Winter 2026 -> 1264,
 * Spring 2026 -> 1266, Summer 2026 -> 1268, Autumn 2026 -> 1272.
 *
 * Shape is 1 + (last two digits of the academic year's END) + quarter code.
 * Autumn's academic year ends the following calendar year; the other three
 * quarters fall in the year the academic year ends.
 */
const QUARTER_CODE: Record<string, number> = {
  Autumn: 2,
  Fall: 2,
  Winter: 4,
  Spring: 6,
  Summer: 8,
}

export function strmForTerm(term: string): number | null {
  const parts = (term || '').trim().split(/\s+/)
  const season = parts[0] || ''
  const year = parseInt(parts[parts.length - 1], 10)
  const quarter = QUARTER_CODE[season]
  if (!quarter || !Number.isFinite(year)) return null
  // Reject anything outside the plausible catalog window rather than compute a
  // term code for "Autumn 12" and send a garbage request upstream.
  if (year < 2000 || year > 2100) return null
  const acadYearEnd = quarter === 2 ? year + 1 : year
  return 1000 + (acadYearEnd % 100) * 10 + quarter
}

export const NAVIGATOR_ORIGIN = 'https://navigator.stanford.edu'

/**
 * Navigator class-detail URL. Public, no auth, no CORS headers (server-only).
 *
 * `NAVIGATOR_BASE_URL` points this at a stand-in during local testing. Autumn
 * enrollment does not open until 2026-09-02, so until then every real class
 * reads 0 enrolled and the interesting states — filling up, waitlisted, closed,
 * upstream throttling — cannot be exercised against the real endpoint.
 * Unset in every deployed environment, so production always reads Navigator.
 */
export function navigatorClassUrl(strm: number, classNbr: number): string {
  const base = (process.env.NAVIGATOR_BASE_URL || NAVIGATOR_ORIGIN).replace(/\/+$/, '')
  return `${base}/api/classes/${strm}/${classNbr}`
}

function asCount(value: unknown): number {
  const n = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

/**
 * Read the seat fields out of a Navigator class record. Returns null for
 * anything that isn't one (an error body, an HTML page, a class that carries no
 * enrollment fields at all) so a bad reading falls back to the dump instead of
 * rendering 0 / 0.
 */
export function parseNavigatorSeat(json: unknown): LiveSeat | null {
  if (!json || typeof json !== 'object') return null
  const r = json as Record<string, unknown>
  const classNbr = asCount(r.classNbr)
  if (!classNbr) return null
  const hasEnrollment =
    r.sectionTotalEnrollment !== undefined || r.sectionCapacityEnrollment !== undefined
  if (!hasEnrollment) return null
  const status =
    (typeof r.sectionEnrollmentStatusDescr === 'string' && r.sectionEnrollmentStatusDescr) ||
    (typeof r.sectionClassStatusDescr === 'string' && r.sectionClassStatusDescr) ||
    ''
  const combined = combinedSeatsFor(r.combinedSections, classNbr)
  return {
    classNbr,
    enrolled: asCount(r.sectionTotalEnrollment),
    capacity: asCount(r.sectionCapacityEnrollment),
    waitlist: asCount(r.sectionTotalWaitlist),
    waitlistMax: asCount(r.sectionCapacityWaitlist),
    status,
    ...(combined ? { combined } : {}),
  }
}

/**
 * The shared seats of the combined section this class belongs to. Kept in sync
 * with combinedSeatsFrom in scripts/navigator-catalog.mjs: a group of one, or
 * one with no cap, is not a cross-listed meeting and carries nothing.
 */
function combinedSeatsFor(groups: unknown, classNbr: number): CombinedSeats | null {
  if (!Array.isArray(groups)) return null
  for (const group of groups) {
    if (!group || typeof group !== 'object') continue
    const g = group as Record<string, unknown>
    const members = Array.isArray(g.sections) ? (g.sections as Record<string, unknown>[]) : []
    const capacity = asCount(g.combinedEnrlCap)
    if (members.length < 2 || capacity <= 0) continue
    if (!members.some(m => asCount(m?.cmbndclassClassNbr) === classNbr)) continue
    return {
      enrolled: asCount(g.combinedEnrlTot),
      capacity,
      waitlist: asCount(g.combinedWaitTot),
      waitlistMax: asCount(g.combinedWaitCap),
    }
  }
  return null
}

/** Most requests are one course's sections; the cap stops a crafted URL fanning out. */
export const MAX_CLASS_NBRS_PER_REQUEST = 24

/** Parse and de-duplicate a `classNbr=1,2,3` query parameter. */
export function parseClassNbrParam(raw: string | null): number[] {
  if (!raw) return []
  const out: number[] = []
  const seen = new Set<number>()
  for (const part of raw.split(',')) {
    const n = parseInt(part.trim(), 10)
    if (!Number.isFinite(n) || n <= 0 || seen.has(n)) continue
    seen.add(n)
    out.push(n)
    if (out.length >= MAX_CLASS_NBRS_PER_REQUEST) break
  }
  return out
}

/**
 * What an upstream HTTP status means for a seat read. Extracted so the rule can
 * be tested: it has been wrong twice. Navigator answers 500 for a classNbr that
 * does not exist in the term, so "5xx" alone cannot mean "upstream is down" —
 * otherwise one stale catalog row, or one crafted URL of invented class
 * numbers, silently turns live seats off for every visitor.
 */
export type UpstreamVerdict =
  /** Body should be parsed. */
  | 'ok'
  /** No reading for this class; keep the daily snapshot, do not re-ask for a while. */
  | 'miss'
  /** Rate limited or forbidden — stop asking entirely for a cooling-off period. */
  | 'throttled'
  /** A class that used to read cleanly is now failing; counts toward an outage. */
  | 'failure'

export function classifyUpstreamStatus(status: number, knownGood: boolean): UpstreamVerdict {
  if (status === 429 || status === 403) return 'throttled'
  if (status >= 500) return knownGood ? 'failure' : 'miss'
  if (status < 200 || status >= 300) return 'miss'
  return 'ok'
}
