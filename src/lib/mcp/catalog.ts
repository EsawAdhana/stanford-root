import type { Course, Section } from '@/types/course'
import { getAllCoursesFromDump } from '@/lib/catalog-dump'
import { getCrossListPrimaryMap, normalizeCourseId, parseUnitsOptions, resolveToCanonicalPrimary } from '@/lib/utils'
import { displayedStatus, hasSeat } from '@/lib/seats'
import { pickSectionsForTerm } from '@/lib/schedule-utils'
import { TextIndex } from './text'
import { label, slotsOf } from './meetings'

/**
 * The catalog as the browser sees it, built once per server instance from the
 * same dump and the same mappers the site uses.
 */
export type Catalog = {
  courses: Course[]
  byId: Map<string, Course>
  primaryMap: Map<string, string>
  /** canonical id -> every listing id of that class, canonical first */
  groups: Map<string, string[]>
  subjects: Set<string>
  index: TextIndex
}

let catalog: Promise<Catalog> | null = null

export function getCatalog(): Promise<Catalog> {
  if (!catalog) {
    catalog = (async () => {
      const courses = await getAllCoursesFromDump()
      const byId = new Map(courses.map(c => [c.id, c]))
      const primaryMap = getCrossListPrimaryMap(courses) as Map<string, string>
      const groups = new Map<string, string[]>()
      for (const c of courses) {
        const root = canonicalOf(c.id, primaryMap)
        const list = groups.get(root) ?? []
        list.push(c.id)
        groups.set(root, list)
      }
      for (const [root, ids] of groups) groups.set(root, [root, ...ids.filter(i => i !== root).sort()])
      const docs = new Map<string, [string, string]>()
      for (const c of courses) docs.set(c.id, [`${c.title} ${c.subject} ${c.code} ${c.id} ${(c.instructors ?? []).join(' ')}`, c.description ?? ''])
      return { courses, byId, primaryMap, groups, subjects: new Set(courses.map(c => c.subject.toUpperCase())), index: new TextIndex(docs) }
    })().catch(err => {
      catalog = null
      throw err
    })
  }
  return catalog
}


export function canonicalOf(id: string, primaryMap: Map<string, string>): string {
  return resolveToCanonicalPrimary(normalizeCourseId(id), primaryMap)
}

export function groupOf(cat: Catalog, id: string): string[] {
  return cat.groups.get(canonicalOf(id, cat.primaryMap)) ?? [id]
}

export function findCourse(cat: Catalog, raw: string): Course | undefined {
  return cat.byId.get(normalizeCourseId(raw).replace(/[^A-Z0-9&]/g, ''))
}

export function code(c: Course): string {
  return `${c.subject} ${c.code}`.trim()
}

export function sectionsIn(c: Course, term?: string | null): Section[] {
  return (c.sections ?? []).filter(s => !term || s.term === term)
}

const COMPONENT_RANK: Record<string, number> = {
  LEC: 0, SEM: 1, LNG: 2, COL: 2, CAS: 2, ISF: 2, ISS: 2, WKS: 3, PRA: 3, ACT: 4,
  LAB: 5, LBS: 5, DIS: 6, TUT: 6, ITR: 6, RES: 7, CLK: 8, CLN: 8, 'T/D': 9, INS: 9,
}
export const componentRank = (s: Section) => COMPONENT_RANK[s.component] ?? 4
export const sectionNumber = (s: Section) => {
  const n = parseInt(String(s.sectionNumber ?? '').replace(/\D/g, ''), 10)
  return Number.isNaN(n) ? Number.MAX_SAFE_INTEGER : n
}

/** The section the calendar draws for a course with no pick: the site's own stand-in. */
export function standIn(c: Course, term: string): Section | undefined {
  return pickSectionsForTerm({ ...c, selectedSectionIds: [] }, term)[0]
}

export function byComponent(sections: Section[]): Map<string, Section[]> {
  const m = new Map<string, Section[]>()
  for (const s of sections) m.set(s.component, [...(m.get(s.component) ?? []), s])
  return m
}

/** course-filter.ts's "Hide closed & waitlisted" test for one section. */
export function enrollable(s: Section): boolean {
  return s.status?.toLowerCase() === 'open' && hasSeat(s) && (!s.combined || hasSeat(s.combined))
}

/** 'open', 'waitlist' or 'full' for a quarter: open when every component has an enrollable section. */
export function availability(sections: Section[]): 'open' | 'waitlist' | 'full' | null {
  if (!sections.length) return null
  if ([...byComponent(sections).values()].every(g => g.some(enrollable))) return 'open'
  return sections.some(s => displayedStatus(s.status, s, s.combined).toLowerCase().includes('wait')) ? 'waitlist' : 'full'
}

export function meetingLabels(s: Pick<Section, 'meetings'>): string[] {
  return slotsOf(s).map(label)
}

export function unitOptions(c: Course, term?: string | null): number[] {
  const opts = new Set<number>()
  for (const s of sectionsIn(c, term)) for (const u of parseUnitsOptions(s.units)) opts.add(u)
  return opts.size ? [...opts].sort((a, b) => a - b) : parseUnitsOptions(c.units)
}

const GERS = ['WAY-A-II', 'WAY-AQR', 'WAY-CE', 'WAY-EDP', 'WAY-ER', 'WAY-FR', 'WAY-SI', 'WAY-SMA', 'College', 'Language', 'Writing 1', 'Writing 2', 'Writing in the Major (WIM)'] as const
export { GERS }

export function gersOf(c: Course, term?: string | null): string[] {
  const found = new Set(sectionsIn(c, term).flatMap(s => s.gers ?? []))
  return GERS.filter(g => found.has(g))
}

const SEASON: Record<string, number> = { Winter: 0, Spring: 1, Summer: 2, Autumn: 3 }
export function termKey(term: string): number {
  const [season, year] = (term ?? '').split(' ')
  return Number(year) * 10 + (SEASON[season] ?? -1)
}

export const rating = (v: number | undefined | null) => (typeof v === 'number' ? Math.round(v * 100) / 100 : null)

/** One search result: the fields an agent needs to pick, not the raw row. */
export function summarize(c: Course, cat: Catalog, term: string | null, snippetText: string | null) {
  const terms = c.terms ?? []
  const shownTerm = term ?? terms.slice().sort((a, b) => termKey(a) - termKey(b))[0] ?? null
  const secs = shownTerm ? sectionsIn(c, shownTerm) : []
  const main = shownTerm ? standIn(c, shownTerm)?.component : undefined
  const meets: string[] = []
  for (const s of secs.filter(x => x.component === main).sort((a, b) => sectionNumber(a) - sectionNumber(b))) {
    for (const l of meetingLabels(s)) if (!meets.includes(`${main} ${l}`)) meets.push(`${main} ${l}`)
  }
  return {
    course_id: c.id,
    code: code(c),
    title: c.title,
    units: c.units,
    terms,
    instructors: (c.instructors ?? []).slice(0, 3),
    rating: rating(c.quality),
    rating_percentile: c.qualityPct ?? null,
    percentile_among: c.rankScope ?? null,
    rated_by: c.qualityN ?? null,
    hours_per_week: c.hours ?? null,
    gers: gersOf(c, term),
    meets: meets.length > 3 ? [...meets.slice(0, 3), `+${meets.length - 3} more`] : meets,
    meets_term: shownTerm,
    availability: shownTerm ? availability(secs) : null,
    cross_listed_as: groupOf(cat, c.id).filter(i => i !== c.id),
    snippet: snippetText,
  }
}
