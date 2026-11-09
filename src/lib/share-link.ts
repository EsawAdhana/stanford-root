import { codeToTerm, termToCode } from '@/lib/terms'

/**
 * A read-only share link carries the schedule itself, so viewing one needs no
 * account, no database row, and nothing to revoke: /s?t=W27&c=CS229.6454,CS161.1933~4
 *
 * Each course is its catalog id, then the class numbers the sharer picked
 * (dash-separated, after a dot), then any unit pick (after a tilde). Catalog ids
 * are capitals, digits and "&" (MS&E), so none of . - ~ , can collide with one.
 * The link is a snapshot: changing the schedule later does not change it.
 */

export type SharedEntry = {
  id: string
  selectedSectionIds?: number[]
  selectedUnits?: number
}

export type SharedSchedule = {
  term: string
  entries: SharedEntry[]
  /** Tokens that did not parse, so the page can say part of the link was unreadable. */
  skipped: number
}

/** Generous for any real schedule, and it keeps a crafted link from making the page do unbounded work. */
export const MAX_SHARED_COURSES = 40
const MAX_PARAM_LENGTH = 2000

const TOKEN = /^([A-Z0-9&]{2,24})(?:\.(\d{1,7}(?:-\d{1,7}){0,11}))?(?:~(\d{1,2}))?$/

function encodeEntry(entry: SharedEntry): string {
  let token = encodeURIComponent(entry.id)
  if (entry.selectedSectionIds?.length) token += `.${entry.selectedSectionIds.join('-')}`
  if (entry.selectedUnits !== undefined && Number.isInteger(entry.selectedUnits)) token += `~${entry.selectedUnits}`
  return token
}

/** The path and query of a share link for one term's courses, or null when the term cannot be encoded. */
export function shareLinkPath(term: string, entries: SharedEntry[]): string | null {
  const code = termToCode(term)
  if (!code || entries.length === 0) return null
  return `/s?t=${code}&c=${entries.slice(0, MAX_SHARED_COURSES).map(encodeEntry).join(',')}`
}

/** Reads a share link's query. Null when it names no term or no readable course. */
export function readShareLink(params: { get(name: string): string | null }): SharedSchedule | null {
  const term = codeToTerm(params.get('t') ?? '')
  const raw = params.get('c') ?? ''
  if (!term || !raw || raw.length > MAX_PARAM_LENGTH) return null

  const entries: SharedEntry[] = []
  const seen = new Set<string>()
  let skipped = 0
  for (const token of raw.split(',').slice(0, MAX_SHARED_COURSES)) {
    const match = TOKEN.exec(token.trim())
    if (!match) {
      if (token.trim()) skipped++
      continue
    }
    const [, id, sections, units] = match
    if (seen.has(id)) continue
    seen.add(id)
    entries.push({
      id,
      ...(sections ? { selectedSectionIds: sections.split('-').map(Number) } : {}),
      ...(units ? { selectedUnits: Number(units) } : {}),
    })
  }
  return entries.length > 0 ? { term, entries, skipped } : null
}

/** "CS224N" -> "CS 224N", for link previews that have no catalog to look a course up in. */
export function displayCode(id: string): string {
  const match = /^([A-Z&]+)(\d.*)$/.exec(id)
  return match ? `${match[1]} ${match[2]}` : id
}
