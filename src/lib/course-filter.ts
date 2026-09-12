import type { Course } from '@/types/course'
import type { CartItem } from '@/lib/cart-store'
import { getSchoolFromSubject, formatLevel, parseUnitsOptions, normalizeCourseId, resolveToCanonicalPrimary } from '@/lib/utils'
import { parseMeetingTimes, timeToMinutes, isMeetingOptional, getParsedSectionMeetings } from '@/lib/schedule-utils'

export type CourseFilterCriteria = {
  excludedWords: string[]
  selectedDepts: string[]
  selectedTerms: string[]
  selectedFormats: string[]
  selectedLevels: string[]
  selectedGers: string[]
  selectedSchools: string[]
  unitMin: number
  unitMax: number
  timeMin: number
  timeMax: number
  hideConflicts: boolean
  hideUnavailable: boolean
  hideStudyAbroad: boolean
  newOnly: boolean
}

/** When computing facet counts, the facet whose own filter should be omitted. */
export type FacetKey = 'exclude' | 'depts' | 'terms' | 'formats' | 'levels' | 'gers' | 'schools' | 'units' | 'times'

/** The facet dimensions the sidebar shows counts for. */
export type CountedFacetKey = 'depts' | 'terms' | 'formats' | 'levels' | 'gers' | 'schools'
export const COUNTED_FACET_KEYS: CountedFacetKey[] = ['depts', 'terms', 'formats', 'levels', 'gers', 'schools']

type Meeting = { days: string[]; startTime: string; endTime: string; startMinutes: number; endMinutes: number }

function hasOverlap(m1: Meeting, m2: Meeting, cartItem?: CartItem): boolean {
  let commonDays = m1.days.filter(d => m2.days.includes(d))
  if (cartItem) {
    commonDays = commonDays.filter(day => !isMeetingOptional(cartItem, day, m2.startTime, m2.endTime))
  }
  if (commonDays.length === 0) return false
  if (!m1.endTime || !m2.endTime) return false
  return m1.startMinutes < m2.endMinutes && m2.startMinutes < m1.endMinutes
}

/** Section meetings usable for conflict checks (must have days and a start time). */
function conflictMeetings(section: { meetings?: { days?: string; time?: string }[] }): Meeting[] {
  return getParsedSectionMeetings(section).filter(m => m.days.length > 0)
}

type CourseCheck = (c: Course) => boolean

type FilterChecks = {
  exclude: CourseCheck | null
  depts: CourseCheck | null
  terms: CourseCheck | null
  formats: CourseCheck | null
  levels: CourseCheck | null
  gers: CourseCheck | null
  schools: CourseCheck | null
  units: CourseCheck | null
  times: CourseCheck | null
  conflicts: CourseCheck | null
  unavailable: CourseCheck | null
  studyAbroad: CourseCheck | null
  newOnly: CourseCheck | null
}

/**
 * Builds one predicate per filter dimension (null when that filter is
 * inactive). Both the visible-list filter (filterCourses) and the sidebar
 * facet counts (filterCoursesForFacets) are composed from these, so the two
 * can never disagree on semantics.
 */
function buildChecks(criteria: CourseFilterCriteria, cartItems: CartItem[], newCanonicals: Set<string>): FilterChecks {
  const {
    excludedWords, selectedDepts, selectedTerms, selectedFormats, selectedLevels,
    selectedGers, selectedSchools, unitMin, unitMax, timeMin, timeMax,
    hideConflicts, hideUnavailable, hideStudyAbroad, newOnly: showNewOnly,
  } = criteria

  const deptsSet = new Set(selectedDepts ?? [])
  const termsSet = new Set(selectedTerms ?? [])
  const formatsSet = new Set(selectedFormats ?? [])
  const levelsSet = new Set(selectedLevels ?? [])
  const gersSet = new Set(selectedGers ?? [])
  const schoolsSet = new Set(selectedSchools ?? [])
  const hasTermFilter = termsSet.size > 0 && !termsSet.has('any')

  let exclude: CourseCheck | null = null
  if (excludedWords && excludedWords.length > 0) {
    const excludedList = excludedWords.map(w => w.toLowerCase())
    exclude = (c) => {
      const textToCheck = `${c.title} ${c.description} ${c.code}`.toLowerCase()
      return !excludedList.some(word => textToCheck.includes(word))
    }
  }

  const depts: CourseCheck | null = deptsSet.size > 0
    ? (c) => deptsSet.has(c.subject)
    : null

  const terms: CourseCheck | null = hasTermFilter
    ? (c) => {
        if (c.terms) return c.terms.some(t => termsSet.has(t))
        return c.selectedTerm != null && termsSet.has(c.selectedTerm)
      }
    : null

  const formats: CourseCheck | null = formatsSet.size > 0
    ? (c) => {
        if (!c.sections || c.sections.length === 0) return false
        return c.sections.some(s => s.component && formatsSet.has(s.component))
      }
    : null

  const levels: CourseCheck | null = levelsSet.size > 0
    ? (c) => {
        if (c.sections && c.sections.length > 0) {
          const sectionsToCheck = hasTermFilter
            ? c.sections.filter(s => s.term && termsSet.has(s.term))
            : c.sections
          const sectionMatch = sectionsToCheck.length > 0
            ? sectionsToCheck.some(s => s.classLevel && String(s.classLevel).trim() && levelsSet.has(formatLevel(s.classLevel)))
            : false
          if (sectionMatch) return true
        }
        return levelsSet.has(formatLevel(c.code || ''))
      }
    : null

  const gers: CourseCheck | null = gersSet.size > 0
    ? (c) => {
        if (!c.sections || c.sections.length === 0) return false
        return c.sections.some(s => s.gers && s.gers.some(g => gersSet.has(g)))
      }
    : null

  const schools: CourseCheck | null = schoolsSet.size > 0
    ? (c) => schoolsSet.has(getSchoolFromSubject(c.subject))
    : null

  let units: CourseCheck | null = null
  if (unitMin > 1 || unitMax < 5) {
    const min = Math.max(1, unitMin)
    const max = Math.min(5, unitMax)
    const maxOpen = max >= 5
    const checkUnits = (uStr: string | number) => {
      const opts = parseUnitsOptions(uStr)
      if (opts.length === 0) return false
      return opts.some(u => u >= min && (maxOpen ? true : u <= max))
    }
    units = (c) => {
      if (c.sections && c.sections.length > 0) {
        const sectionsToCheck = hasTermFilter
          ? c.sections.filter(s => s.term && termsSet.has(s.term))
          : c.sections
        const sectionMatch = sectionsToCheck.length > 0
          ? sectionsToCheck.some(s => checkUnits(s.units))
          : false
        if (sectionMatch) return true
      }
      return checkUnits(c.units)
    }
  }

  let times: CourseCheck | null = null
  if (timeMin > 420 || timeMax < 1320) {
    const min = Math.max(420, timeMin)
    const max = Math.min(1320, timeMax)
    times = (c) => {
      if (!c.sections || c.sections.length === 0) return true
      const sectionsToCheck = hasTermFilter
        ? c.sections.filter(s => s.term && termsSet.has(s.term))
        : c.sections
      if (sectionsToCheck.length === 0) return true
      return sectionsToCheck.some(s =>
        getParsedSectionMeetings(s).some(m => m.startMinutes >= min && m.startMinutes <= max)
      )
    }
  }

  let conflicts: CourseCheck | null = null
  if (hideConflicts) {
    // Parse each cart item's meetings once, not once per candidate section.
    const cartParsed = cartItems.map(item => ({
      item,
      meetings: parseMeetingTimes(item, item.selectedTerm).map(m => ({
        days: m.days,
        startTime: m.startTime,
        endTime: m.endTime,
        startMinutes: timeToMinutes(m.startTime),
        endMinutes: m.endTime ? timeToMinutes(m.endTime) : 0,
      })),
    }))
    conflicts = (c) => {
      if (!c.sections || c.sections.length === 0) return true
      let sectionsToCheck = c.sections
      // hasTermFilter, not termsSet.size: the "any term" selection is the
      // sentinel ['any'], which no section's term equals, so gating on size
      // emptied sectionsToCheck and passed every course through.
      if (hasTermFilter) {
        sectionsToCheck = sectionsToCheck.filter(s => termsSet.has(s.term))
      }
      if (sectionsToCheck.length === 0) return true
      return sectionsToCheck.some(section => {
        const cartForTerm = cartParsed.filter(cp => cp.item.selectedTerm === section.term)
        if (cartForTerm.length === 0) return true
        const sectionMeetings = conflictMeetings(section)
        if (sectionMeetings.length === 0) return true
        const isOverlapping = cartForTerm.some(cp => {
          if (cp.item.id === c.id) return false
          return cp.meetings.some(cm => sectionMeetings.some(sm => hasOverlap(sm, cm, cp.item)))
        })
        return !isOverlapping
      })
    }
  }

  const unavailable: CourseCheck | null = hideUnavailable
    ? (c) => {
        if (!c.sections || c.sections.length === 0) return true
        let sectionsToCheck = c.sections
        // See the conflicts check: gate on hasTermFilter, not termsSet.size.
        if (hasTermFilter) {
          sectionsToCheck = sectionsToCheck.filter(s => termsSet.has(s.term))
        }
        if (sectionsToCheck.length === 0) return true
        return sectionsToCheck.some(s => s.status?.toLowerCase() === 'open')
      }
    : null

  // Bing Overseas Studies Program courses all use subject codes prefixed with
  // "OSP" (OSPFLOR, OSPMADRD, OSPPARIS, ...). Hidden by default.
  const studyAbroad: CourseCheck | null = hideStudyAbroad
    ? (c) => !(c.subject || '').toUpperCase().startsWith('OSP')
    : null

  // `isNew` is set by the catalog dump: absent from all three prior catalogs and
  // with no evaluations from those years. Only canonical primaries reach these
  // checks, so the group's flag is looked up by canonical id.
  const newOnly: CourseCheck | null = showNewOnly
    ? (c) => newCanonicals.has(normalizeCourseId(c.id))
    : null

  return { exclude, depts, terms, formats, levels, gers, schools, units, times, conflicts, unavailable, studyAbroad, newOnly }
}

/**
 * Canonical ids of cross-list groups that are new as a whole. The dump flags
 * whichever sibling ExploreCourses scheduled, which is not always the sibling
 * browse keeps, so the flag has to survive the cross-list collapse — but one
 * sibling the dump judged as already-offered (isNew === false) rules the whole
 * group out. Adding a fresh code to a course that already ran (a new grad-level
 * cross-listing of AFRICAAM 140, or CS 140M alongside the long-running EE 186)
 * is an existing course, not a new one; taking the group as new whenever any
 * sibling was flagged surfaced 41 already-offered courses out of 812.
 *
 * Siblings the dump could not judge (no sections, so isNew unset) abstain —
 * they must not veto, or a dormant listing would hide a genuinely new course.
 */
const newCanonicalCache = new WeakMap<Course[], Set<string>>()
function getNewCanonicals(courses: Course[], primaryMap: Map<string, string>): Set<string> {
  let result = newCanonicalCache.get(courses)
  if (!result) {
    const withNew = new Set<string>()
    const withExisting = new Set<string>()
    for (const c of courses) {
      if (c.isNew === undefined) continue
      const canonical = resolveToCanonicalPrimary(normalizeCourseId(c.id), primaryMap)
      ;(c.isNew ? withNew : withExisting).add(canonical)
    }
    result = new Set<string>()
    for (const canonical of withNew) {
      if (!withExisting.has(canonical)) result.add(canonical)
    }
    newCanonicalCache.set(courses, result)
  }
  return result
}

// Valid (gradeable) + canonical cross-list primary courses, memoized by
// catalog array identity. This prefix of the pipeline is identical for every
// filter pass, and the canonical resolution is the expensive part.
const validCanonicalCache = new WeakMap<Course[], Course[]>()
function getValidCanonical(courses: Course[], primaryMap: Map<string, string>): Course[] {
  let result = validCanonicalCache.get(courses)
  if (!result) {
    result = courses.filter(c => {
      if (!c.grading || c.grading.trim() === '' || c.grading === 'TBD') return false
      const norm = normalizeCourseId(c.id)
      return resolveToCanonicalPrimary(norm, primaryMap) === norm
    })
    validCanonicalCache.set(courses, result)
  }
  return result
}

/**
 * Single source of truth for course filtering, shared by the visible list
 * (use-filtered-courses) and the sidebar facet counts. Applies every filter
 * EXCEPT the free-text search query, which callers apply themselves (the list
 * has extra cross-list primary-inclusion logic on top of search).
 *
 * `exclude` omits one facet dimension so a facet's own selection doesn't zero
 * out its own counts.
 */
export function filterCourses(
  courses: Course[],
  criteria: CourseFilterCriteria,
  primaryMap: Map<string, string>,
  cartItems: CartItem[],
  exclude?: FacetKey,
): Course[] {
  const k = buildChecks(criteria, cartItems, getNewCanonicals(courses, primaryMap))
  return getValidCanonical(courses, primaryMap).filter(c =>
    (exclude === 'exclude' || !k.exclude || k.exclude(c)) &&
    (exclude === 'depts' || !k.depts || k.depts(c)) &&
    (exclude === 'terms' || !k.terms || k.terms(c)) &&
    (exclude === 'formats' || !k.formats || k.formats(c)) &&
    (exclude === 'levels' || !k.levels || k.levels(c)) &&
    (exclude === 'gers' || !k.gers || k.gers(c)) &&
    (exclude === 'units' || !k.units || k.units(c)) &&
    (exclude === 'times' || !k.times || k.times(c)) &&
    (!k.conflicts || k.conflicts(c)) &&
    (!k.unavailable || k.unavailable(c)) &&
    (!k.studyAbroad || k.studyAbroad(c)) &&
    (!k.newOnly || k.newOnly(c)) &&
    (exclude === 'schools' || !k.schools || k.schools(c))
  )
}

/**
 * Per-facet course lists for the sidebar counts, computed in ONE pass instead
 * of one full filter pass per facet dimension.
 *
 * For facet X the eligible set is "passes every filter except X's own". A
 * course passing all non-facet filters ("rest") either passes all six facet
 * dimensions (counts toward every facet) or fails exactly one (counts only
 * toward the facet it fails) — courses failing two or more count nowhere.
 *
 * Facets with no active selection share the SAME array instance, so callers
 * applying a search query can dedupe by identity.
 */
export function filterCoursesForFacets(
  courses: Course[],
  criteria: CourseFilterCriteria,
  primaryMap: Map<string, string>,
  cartItems: CartItem[],
): Record<CountedFacetKey, Course[]> {
  const k = buildChecks(criteria, cartItems, getNewCanonicals(courses, primaryMap))
  const restChecks = [k.exclude, k.units, k.times, k.conflicts, k.unavailable, k.studyAbroad, k.newOnly]
    .filter((f): f is CourseCheck => f !== null)
  const dims: [CountedFacetKey, CourseCheck | null][] = [
    ['depts', k.depts],
    ['terms', k.terms],
    ['formats', k.formats],
    ['levels', k.levels],
    ['gers', k.gers],
    ['schools', k.schools],
  ]

  const allPass: Course[] = []
  const extras: Record<CountedFacetKey, Course[]> = {
    depts: [], terms: [], formats: [], levels: [], gers: [], schools: [],
  }

  outer:
  for (const c of getValidCanonical(courses, primaryMap)) {
    for (const f of restChecks) {
      if (!f(c)) continue outer
    }
    let failKey: CountedFacetKey | null = null
    for (const [key, fn] of dims) {
      if (fn && !fn(c)) {
        if (failKey !== null) continue outer // failed 2+ dimensions
        failKey = key
      }
    }
    if (failKey === null) allPass.push(c)
    else extras[failKey].push(c)
  }

  const result = {} as Record<CountedFacetKey, Course[]>
  for (const [key] of dims) {
    result[key] = extras[key].length > 0 ? allPass.concat(extras[key]) : allPass
  }
  return result
}
