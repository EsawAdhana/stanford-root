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
  /** Classes past the first MAX_SHARED_COURSES, which are not read. */
  overLimit: number
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
  const tokens = raw.split(',')
  const overLimit = tokens.slice(MAX_SHARED_COURSES).filter(t => t.trim()).length
  for (const token of tokens.slice(0, MAX_SHARED_COURSES)) {
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
  return entries.length > 0 ? { term, entries, skipped, overLimit } : null
}

type CatalogCourse = { id: string; subject: string; code: string; sections?: { term: string; classId: number }[] }

/**
 * Picked sections the catalog no longer has, per course. A class shows the
 * picks that remain, or with none left the course's default section, so the
 * page says which. Only courses whose sections are loaded (`hasSections`) are
 * judged: before that every pick would look missing.
 */
export function missingSections(
  shared: SharedSchedule,
  courses: CatalogCourse[],
  hasSections: (id: string) => boolean,
): { code: string; missing: number; noneLeft: boolean }[] {
  const byId = new Map(courses.map(c => [c.id, c]))
  return shared.entries.flatMap(entry => {
    const course = byId.get(entry.id)
    if (!course || !entry.selectedSectionIds?.length || !hasSections(entry.id)) return []
    const known = new Set((course.sections ?? []).filter(s => s.term === shared.term).map(s => s.classId))
    const missing = entry.selectedSectionIds.filter(id => !known.has(id)).length
    if (missing === 0) return []
    return [{ code: `${course.subject} ${course.code}`, missing, noneLeft: missing === entry.selectedSectionIds.length }]
  })
}

/** The notice above a shared schedule: what in the link is not shown as it was shared. Empty when all of it is. */
export function shareLinkNotice(
  counts: { unfound: number; overLimit: number },
  missing: { code: string; missing: number; noneLeft: boolean }[],
): string {
  const lines: string[] = []
  const { unfound, overLimit } = counts
  if (unfound > 0) {
    lines.push(unfound === 1
      ? "1 class in this link couldn't be found in the catalog, so it isn't shown."
      : `${unfound} classes in this link couldn't be found in the catalog, so they aren't shown.`)
  }
  if (overLimit > 0) {
    lines.push(`A shared schedule shows up to ${MAX_SHARED_COURSES} classes, so the last ${overLimit === 1 ? 'class' : `${overLimit} classes`} in this link ${overLimit === 1 ? "isn't" : "aren't"} shown.`)
  }
  for (const m of missing) {
    const sections = m.missing === 1 ? '1 section in this link no longer exists' : `${m.missing} sections in this link no longer exist`
    lines.push(m.noneLeft
      ? `${sections}, so ${m.code} shows its default section instead.`
      : `${sections}, so ${m.code} is shown without ${m.missing === 1 ? 'it' : 'them'}.`)
  }
  return lines.join(' ')
}

/** "CS224N" -> "CS 224N", for link previews that have no catalog to look a course up in. */
export function displayCode(id: string): string {
  const match = /^([A-Z&]+)(\d.*)$/.exec(id)
  return match ? `${match[1]} ${match[2]}` : id
}
