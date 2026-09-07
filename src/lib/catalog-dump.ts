import { readFile } from 'fs/promises'
import type { Course } from '@/types/course'
import { rowToCourse } from '@/lib/course-mapper'
import { compareTerms, getDefaultTerm } from '@/lib/terms'
import {
  aggregateCrossListMetrics,
  compareCourseCodes,
  decodeHtmlEntities,
  getCrossListPrimaryMap,
  normalizeCourseId,
  parseUnitsOptions,
  resolveToCanonicalPrimary,
  unitsLabel,
} from '@/lib/utils'
import { filterCourses, filterCoursesForFacets } from '@/lib/course-filter'
import { mergeCourseRows } from '@/lib/supabase-admin'
import {
  buildInstructorDirectory,
  hasFullFirstName,
  instructorInitialSlug,
  instructorSlug,
  parseInstructorDump,
  parseInstructorName,
  type InstructorDirectory,
  type InstructorDump,
} from '@/lib/instructors'
import { serverCatalogPath, publicCatalogPath } from '@/lib/catalog-paths'

type DumpRow = Record<string, unknown> & { course_id?: string; id?: string; subject?: string }

let fullById: Map<string, Course> | null = null
let fullLoad: Promise<Map<string, Course>> | null = null
let lightRows: DumpRow[] | null = null
let lightLoad: Promise<DumpRow[]> | null = null
let directory: InstructorDirectory | null = null
let directoryLoad: Promise<InstructorDirectory> | null = null
let instructorDump: InstructorDump | null = null
let instructorDumpLoad: Promise<InstructorDump> | null = null

async function loadFullById(): Promise<Map<string, Course>> {
  if (fullById) return fullById
  if (!fullLoad) {
    fullLoad = (async () => {
      const raw = await readFile(serverCatalogPath('full.json'), 'utf8')
      const rows = JSON.parse(raw) as DumpRow[]
      const map = new Map<string, Course>()
      for (const row of mergeCourseRows(rows)) {
        const course = rowToCourse(row)
        map.set(course.id, course)
      }
      fullById = map
      return map
    })().finally(() => { fullLoad = null })
  }
  return fullLoad
}

async function loadLightRows(): Promise<DumpRow[]> {
  if (lightRows) return lightRows
  if (!lightLoad) {
    lightLoad = (async () => {
      const raw = await readFile(serverCatalogPath('light.json'), 'utf8')
      lightRows = JSON.parse(raw) as DumpRow[]
      return lightRows
    })().finally(() => { lightLoad = null })
  }
  return lightLoad
}

/** Instant course lookup from the prebuilt dump (no Supabase). */
export async function getCourseFromDump(courseId: string): Promise<Course | null> {
  try {
    const map = await loadFullById()
    return map.get(courseId) ?? null
  } catch {
    return null
  }
}

export type DumpDeptCourse = {
  id: string
  subject: string
  code: string
  title: string
  units: string | null
  quality: number | null
  hours: number | null
}

function isGradeable(grading: unknown): boolean {
  const g = String(grading || '').trim()
  return Boolean(g) && g !== 'TBD'
}

async function loadInstructorDump(): Promise<InstructorDump> {
  if (instructorDump) return instructorDump
  if (!instructorDumpLoad) {
    instructorDumpLoad = (async () => {
      try {
        const raw = await readFile(publicCatalogPath('instructors.json'), 'utf8')
        instructorDump = parseInstructorDump(JSON.parse(raw))
      } catch {
        instructorDump = { names: [], courseLinks: {} }
      }
      return instructorDump
    })().finally(() => { instructorDumpLoad = null })
  }
  return instructorDumpLoad
}

/** The full instructor name directory (catalog + evaluation spellings). */
export async function getInstructorDirectory(): Promise<InstructorDirectory> {
  if (directory) return directory
  if (!directoryLoad) {
    directoryLoad = (async () => {
      const dump = await loadInstructorDump()
      const names = dump.names.slice()
      const rows = await loadLightRows().catch(() => [] as DumpRow[])
      for (const row of rows) {
        for (const name of (row.instructors as string[] | undefined) || []) names.push(name)
      }
      directory = buildInstructorDirectory(names)
      return directory
    })().finally(() => { directoryLoad = null })
  }
  return directoryLoad
}

/** initialSlug → named slug for one course, when evaluation history uniquely picks a person. */
export async function getCourseInstructorLinks(courseId: string): Promise<Record<string, string>> {
  const dump = await loadInstructorDump()
  return dump.courseLinks[courseId] ?? {}
}

export type DumpInstructorCourse = {
  id: string
  subject: string
  code: string
  title: string
  terms: string[]
  quality: number | null
  hours: number | null
}

/**
 * Upcoming catalog listings for one person. Prefer an exact full-name slug
 * match; fall back to surname+initial only when the catalog row is still
 * abbreviated and this person is the unique named match for that initial.
 */
export async function getInstructorCoursesFromDump(entry: {
  slug: string
  initialSlug: string
}): Promise<DumpInstructorCourse[]> {
  try {
    const dir = await getInstructorDirectory()
    const soleForInitial = (dir.namedByInitialSlug.get(entry.initialSlug)?.length ?? 0) === 1
    const rows = await loadLightRows()
    const out: DumpInstructorCourse[] = []
    for (const row of rows) {
      const instructors = (row.instructors as string[] | undefined) || []
      if (instructors.length === 0 || !isGradeable(row.grading)) continue
      const id = String(row.course_id || row.id || '')
      if (!id) continue

      const matches = instructors.some(raw => {
        if (instructorSlug(raw) === entry.slug) return true
        // Leftover "Last, F." rows: only attach when nobody else shares the initial.
        if (!hasFullFirstName(parseInstructorName(raw).first)) {
          return soleForInitial && instructorInitialSlug(raw) === entry.initialSlug
        }
        return false
      })
      if (!matches) continue

      out.push({
        id,
        subject: String(row.subject || ''),
        code: String(row.code || ''),
        title: String(row.title || ''),
        terms: ((row.terms as string[] | undefined) || []).slice(),
        quality: row.quality != null && row.quality !== '' ? Number(row.quality) : null,
        hours: row.hours != null && row.hours !== '' ? Number(row.hours) : null,
      })
    }
    return out
  } catch {
    return []
  }
}

/** Light dump rows for one department (dept pages + SEO related links). */
export async function getDepartmentFromDump(subject: string): Promise<DumpDeptCourse[]> {
  try {
    const rows = await loadLightRows()
    const byId = new Map<string, DumpDeptCourse>()
    for (const r of rows) {
      if (r.subject !== subject || !isGradeable(r.grading)) continue
      const id = String(r.course_id || r.id || '')
      if (!id || byId.has(id)) continue
      byId.set(id, {
        id,
        subject: String(r.subject || ''),
        code: String(r.code || ''),
        title: String(r.title || ''),
        units: r.units != null && String(r.units).trim() ? String(r.units) : null,
        quality: r.quality != null && r.quality !== '' ? Number(r.quality) : null,
        hours: r.hours != null && r.hours !== '' ? Number(r.hours) : null,
      })
    }
    return Array.from(byId.values())
  } catch {
    return []
  }
}

/**
 * Every course id in the dump, for `generateStaticParams`.
 *
 * Without it these pages render per request: the response carried
 * `cache-control: private, no-cache, no-store` with no `x-nextjs-cache` header
 * and `x-vercel-cache: MISS` on repeat hits of the same URL, so each view paid a
 * fresh render — and on a cold instance, a 34MB `full.json` read and parse
 * (measured 70ms + 124ms locally) before it could answer. Real users saw TTFB
 * p75 1006ms on the course pages and 1720ms on `/instructors/[slug]`.
 */
export async function getAllCourseIdsFromDump(): Promise<string[]> {
  const map = await loadFullById()
  return [...map.keys()]
}

let idByNormalized: Map<string, string> | null = null

/**
 * The exact catalog id for a loosely-typed one, so `/cs106a` and `/CS%20106A`
 * can 308 to `/CS106A` from the server instead of rendering and then bouncing
 * from the client. Returns null when nothing in the catalog matches.
 */
export async function resolveCourseIdFromDump(raw: string): Promise<string | null> {
  try {
    if (!idByNormalized) {
      const rows = await loadLightRows()
      const map = new Map<string, string>()
      for (const row of rows) {
        const id = String(row.course_id || row.id || '')
        if (!id) continue
        const norm = normalizeCourseId(id)
        // First writer wins; ids differing only by normalization are the same course.
        if (!map.has(norm)) map.set(norm, id)
      }
      idByNormalized = map
    }
    return idByNormalized.get(normalizeCourseId(raw)) ?? null
  } catch {
    return null
  }
}

/**
 * Every subject in the dump, for `generateStaticParams`. Subjects and course
 * ids share the one `/[code]` segment, and no subject is also a course id, so
 * the two lists can simply be concatenated.
 */
export async function getAllSubjectsFromDump(): Promise<string[]> {
  const rows = await loadLightRows()
  const subjects = new Set<string>()
  for (const row of rows) {
    if (!isGradeable(row.grading)) continue
    const subject = String(row.subject || '')
    if (subject) subjects.add(subject)
  }
  return [...subjects].sort()
}

/** Every instructor slug in the dump, for `generateStaticParams`. */
export async function getAllInstructorSlugsFromDump(): Promise<string[]> {
  const dir = await getInstructorDirectory()
  return [...dir.bySlug.keys()]
}

export type ShareCardCourse = {
  /** "AA 100" */
  code: string
  title: string
  /** "3 Units", the wording a course card uses. */
  units: string
  /** "2.7 hrs/unit", or null when the class has no evaluated hours. */
  hours: string | null
  /** "4.3", or null when it has no evaluations. */
  rating: string | null
  instructor: string
  /** "Autumn", the card's season-only form. */
  terms: string
}

export type DefaultCatalogView = {
  /** The term the catalog opens on. */
  term: string
  /** Classes in that view, the figure the results bar prints. */
  total: number
  /** Per-term counts, in the order the sidebar lists them. */
  termCounts: { term: string; count: number }[]
  /** The first classes in the view, in the order the list shows them. */
  courses: ShareCardCourse[]
  /** Letters the A-Z scrubber offers, "#" first. */
  letters: string[]
}

/** Exactly the filters /browse starts with, from use-filtered-courses.ts. */
const DEFAULT_CRITERIA = {
  excludedWords: [] as string[],
  selectedDepts: [] as string[],
  selectedFormats: [] as string[],
  selectedLevels: [] as string[],
  selectedGers: [] as string[],
  selectedSchools: [] as string[],
  unitMin: 1,
  unitMax: 5,
  timeMin: 420,
  timeMax: 1320,
  hideConflicts: true,
  hideUnavailable: true,
  hideStudyAbroad: true,
  newOnly: false,
}

/**
 * The catalog exactly as it opens, for the share card.
 *
 * The card draws the real interface, so every figure on it has to be the one a
 * visitor will actually see. That rules out counting the dump: the light dump
 * says 3,968 classes in Autumn 2026 where the app says 2,969, because the app
 * hides closed, conflicting and study-abroad sections first. So this runs the
 * same filterCourses the browse view runs, over the same dump, and sorts with
 * the same comparator. Build time only, and the image is static, so the cost is
 * one pass per deploy.
 */
export async function getDefaultViewFromDump(limit = 4): Promise<DefaultCatalogView | null> {
  try {
    const courses = [...(await loadFullById()).values()]
    if (courses.length === 0) return null

    const available = [...new Set(courses.flatMap(c => c.terms ?? []))].filter(Boolean)
    const term = getDefaultTerm(available)
    const criteria = { ...DEFAULT_CRITERIA, selectedTerms: [term] }
    const primaryMap = getCrossListPrimaryMap(courses)

    const inView = filterCourses(courses, criteria, primaryMap, [])
    if (inView.length === 0) return null

    const sorted = [...inView].sort(
      (a, b) =>
        (a.subject ?? '').localeCompare(b.subject ?? '') ||
        compareCourseCodes(a.code ?? '', b.code ?? '')
    )

    // Same facet pass the sidebar counts with: every filter except the term.
    const perTerm = new Map<string, number>()
    for (const course of filterCoursesForFacets(courses, criteria, primaryMap, []).terms) {
      for (const t of course.terms ?? []) perTerm.set(t, (perTerm.get(t) ?? 0) + 1)
    }

    // Pooled across each cross-list group, so the numbers match the real card.
    const metrics = crossListMetrics(courses, primaryMap)

    const letters = [...new Set(sorted.map(c => {
      const first = (c.subject ?? '').charAt(0).toUpperCase()
      return /[A-Z]/.test(first) ? first : '#'
    }))].sort((a, b) => (a === '#' ? -1 : b === '#' ? 1 : a.localeCompare(b)))

    return {
      term,
      total: inView.length,
      termCounts: [...perTerm]
        .sort(([a], [b]) => compareTerms(a, b))
        .map(([t, count]) => ({ term: t, count })),
      letters,
      courses: sorted.slice(0, limit).map(course => {
        const m = metrics.get(course.id)
        const opts = parseUnitsOptions(course.units ?? '')
        const shown = opts.length === 1 ? opts[0] : (course.units ?? '')
        return {
          code: `${course.subject} ${course.code}`,
          title: decodeHtmlEntities(course.title ?? ''),
          units: opts.length === 0
            ? '\u2014'
            : `${shown} ${capitalize(unitsLabel(shown))}`,
          hours: m?.hrsPerUnit == null ? null : `${m.hrsPerUnit.toFixed(1)} hrs/unit`,
          rating: m?.quality == null ? null : m.quality.toFixed(1),
          instructor: course.instructors?.length
            ? decodeHtmlEntities(course.instructors[0])
            : 'Unknown Instructor',
          terms: shareCardTerms(course.terms ?? []),
        }
      }),
    }
  } catch {
    return null
  }
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1)
}

/** courseId -> figures pooled over its cross-list group, as the browse list does. */
function crossListMetrics(courses: Course[], primaryMap: Map<string, string>) {
  const groups = new Map<string, Course[]>()
  for (const course of courses) {
    const canonical = resolveToCanonicalPrimary(normalizeCourseId(course.id), primaryMap)
    const group = groups.get(canonical)
    if (group) group.push(course)
    else groups.set(canonical, [course])
  }
  const out = new Map<string, ReturnType<typeof aggregateCrossListMetrics>>()
  for (const [, members] of groups) {
    const pooled = aggregateCrossListMetrics(
      members.map(c => ({ hours: c.hours, quality: c.quality, units: c.units }))
    )
    for (const member of members) out.set(member.id, pooled)
  }
  return out
}

/** Season-only term list, the same compaction a real course card uses. */
function shareCardTerms(terms: string[]): string {
  const unique = [...new Set(terms)].sort(compareTerms)
  const seasons = unique.map(t => t.split(' ')[0])
  const repeats = new Set(seasons).size !== seasons.length
  if (!repeats) return [...new Set(seasons)].join(', ')
  return unique
    .map(t => {
      const [season, year] = t.split(' ')
      return year ? `${season} '${year.slice(-2)}` : season
    })
    .join(', ')
}

export type CatalogScope = {
  /** Every term the dump covers, earliest first. */
  terms: string[]
  /** Distinct gradeable courses. */
  courseCount: number
}

/**
 * How big the catalog is, for the share card, which states the size rather than
 * listing it. That card renders at build time, so this walks the light dump
 * once per build and not once per view.
 *
 * Returns null when the dump is unreadable. Callers drop the figures rather
 * than print a zero, because "0 classes" is worse than saying nothing.
 */
export async function getCatalogScopeFromDump(): Promise<CatalogScope | null> {
  try {
    const rows = await loadLightRows()
    const courses = new Set<string>()
    const terms = new Set<string>()

    for (const row of rows) {
      if (!isGradeable(row.grading)) continue
      const id = String(row.course_id || row.id || '')
      if (!id) continue
      courses.add(id)
      for (const term of (row.terms as string[] | undefined) || []) {
        if (term) terms.add(term)
      }
    }

    if (courses.size === 0) return null

    return { terms: [...terms].sort(compareTerms), courseCount: courses.size }
  } catch {
    return null
  }
}
