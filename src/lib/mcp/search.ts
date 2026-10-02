import type { Course, Section } from '@/types/course'
import { filterCourses, type CourseFilterCriteria } from '@/lib/course-filter'
import { hoursPerUnit, parseUnitsOptions } from '@/lib/utils'
import { type Catalog, byComponent, code, enrollable, findCourse, groupOf, sectionsIn, termKey } from './catalog'
import { type Slot, overlaps, slotsOf } from './meetings'
import { terms as textTerms } from './text'

/**
 * search_courses. The site's filters run through the site's own
 * filterCourses (src/lib/course-filter.ts), so "WAY-FR", "Graduate", "units"
 * or "Hide closed & waitlisted" mean exactly what they mean on stanfordroot.com.
 * On top of it: free-text relevance over descriptions, days, time windows and
 * fits-my-schedule (every meeting, per component, rather than the site's
 * "some meeting starts in range"), rating, workload, grading, instructor.
 */
export type SearchInput = {
  query?: string
  term?: string
  subjects?: string[]
  exclude_subjects?: string[]
  schools?: string[]
  gers?: string[]
  gers_match: 'any' | 'all'
  levels?: string[]
  formats?: string[]
  units_min?: number
  units_max?: number
  days_only?: string[]
  avoid_days?: string[]
  earliest_start?: number
  latest_end?: number
  open_seats_only: boolean
  new_only: boolean
  instructor?: string
  exclude_words?: string[]
  exclude_course_ids?: string[]
  min_rating?: number
  min_rated_by?: number
  max_hours_per_week?: number
  grading?: string[]
  sort: 'relevance' | 'rating' | 'hours_per_week' | 'hours_per_unit' | 'units' | 'code'
  order?: 'asc' | 'desc'
}

export type Busy = Map<string, { group: Set<string>; slots: Slot[] }[]>

type Fit = { daysOnly?: Set<string>; avoidDays?: Set<string>; earliest?: number; latest?: number; busy: Slot[] }
const fitActive = (f: Fit) => !!(f.daysOnly || f.avoidDays || f.earliest !== undefined || f.latest !== undefined || f.busy.length)

function sectionFits(s: Section, f: Fit): boolean {
  return slotsOf(s).every(sl =>
    (!f.daysOnly || sl.days.every(d => f.daysOnly!.has(d))) &&
    (!f.avoidDays || !sl.days.some(d => f.avoidDays!.has(d))) &&
    (f.earliest === undefined || sl.start >= f.earliest) &&
    (f.latest === undefined || sl.end <= f.latest) &&
    !f.busy.some(b => overlaps(sl, b)))
}

/** A class fits a quarter when one fitting section of every timed component exists. */
function termFits(sections: Section[], f: Fit): boolean {
  const timed = [...byComponent(sections).values()].map(g => g.filter(s => slotsOf(s).length)).filter(g => g.length)
  if (!timed.length) return false
  return timed.every(g => g.some(s => sectionFits(s, f)))
}

function codeMatch(cat: Catalog, text: string): Map<string, number> | null {
  const raw = text.trim().toLowerCase()
  let subj: string
  let rest: string
  const m = raw.match(/^([a-z&]+)\s*(\d[\da-z]*)?$/)
  if (m) {
    subj = m[1].toUpperCase()
    rest = m[2] ?? ''
  } else {
    const tokens = raw.split(/\s+/)
    if (tokens.length < 2) return null
    subj = tokens[0].toUpperCase()
    rest = tokens.slice(1).join(' ')
  }
  if (!cat.subjects.has(subj)) return null
  const restId = rest.replace(/\s/g, '').toUpperCase()
  const out = new Map<string, number>()
  for (const c of cat.courses) {
    if (c.subject.toUpperCase() !== subj) continue
    const cc = c.code.toUpperCase()
    const s = !rest ? 50 : cc === restId ? 100 : cc.startsWith(restId) ? 80 : cc.includes(restId) ? 60 : c.title.toLowerCase().includes(rest.toLowerCase()) ? 40 : 0
    if (s) out.set(c.id, s)
  }
  return out.size ? out : null
}

export function search(cat: Catalog, q: SearchInput, busy: Busy): { hits: { course: Course; shown: string; snippetWords: string[] }[]; note: string | null } {
  const criteria: CourseFilterCriteria = {
    excludedWords: (q.exclude_words ?? []).map(w => w.toLowerCase()),
    selectedDepts: (q.subjects ?? []).map(s => s.toUpperCase()),
    selectedTerms: q.term ? [q.term] : [],
    selectedFormats: q.formats ?? [],
    selectedLevels: q.levels ?? [],
    selectedGers: q.gers ?? [],
    selectedSchools: q.schools ?? [],
    unitMin: 1,
    unitMax: 5,
    timeMin: 420,
    timeMax: 1320,
    hideConflicts: false,
    hideUnavailable: q.open_seats_only,
    hideStudyAbroad: false,
    newOnly: q.new_only,
  }
  let rows = filterCourses(cat.courses, criteria, cat.primaryMap, [])

  const listings = (c: Course) => groupOf(cat, c.id).map(id => cat.byId.get(id)).filter((x): x is Course => !!x)
  const any = (c: Course, pred: (l: Course) => boolean) => listings(c).some(pred)
  const fit: Fit = {
    daysOnly: q.days_only?.length ? new Set(q.days_only) : undefined,
    avoidDays: q.avoid_days?.length ? new Set(q.avoid_days) : undefined,
    earliest: q.earliest_start,
    latest: q.latest_end,
    busy: [],
  }
  const excludeIds = new Set((q.exclude_course_ids ?? []).map(i => i.toUpperCase().replace(/\s/g, '')))
  rows = rows.filter(c => {
    if (groupOf(cat, c.id).some(id => excludeIds.has(id))) return false
    if (q.exclude_subjects?.length && any(c, l => q.exclude_subjects!.map(s => s.toUpperCase()).includes(l.subject.toUpperCase()))) return false
    if (q.gers_match === 'all' && q.gers?.length && !any(c, l => q.gers!.every(g => (l.sections ?? []).some(s => (s.gers ?? []).includes(g))))) return false
    if (q.units_min !== undefined || q.units_max !== undefined) {
      const ok = any(c, l => {
        const opts = new Set<number>()
        for (const s of sectionsIn(l, q.term)) for (const u of parseUnitsOptions(s.units)) opts.add(u)
        const list = opts.size ? [...opts] : parseUnitsOptions(l.units)
        return list.some(u => (q.units_min === undefined || u >= q.units_min) && (q.units_max === undefined || u <= q.units_max))
      })
      if (!ok) return false
    }
    if (q.min_rating !== undefined && !((c.quality ?? -1) >= q.min_rating)) return false
    if (q.min_rated_by !== undefined && (c.qualityN ?? 0) < q.min_rated_by) return false
    if (q.max_hours_per_week !== undefined && !(typeof c.hours === 'number' && c.hours <= q.max_hours_per_week)) return false
    if (q.grading?.length && !q.grading.includes(c.grading)) return false
    if (q.instructor && !any(c, l => (l.instructors ?? []).some(n => n.toLowerCase().includes(q.instructor!.toLowerCase())))) return false
    if (fitActive(fit) || busy.size) {
      const ok = any(c, l => {
        const termsToTry = q.term ? [q.term] : (l.terms ?? [])
        return termsToTry.some(t => {
          const secs = sectionsIn(l, t)
          const group = new Set(groupOf(cat, l.id))
          const blocked = (busy.get(t) ?? []).filter(b => ![...b.group].some(id => group.has(id))).flatMap(b => b.slots)
          const f = { ...fit, busy: blocked }
          return secs.length ? termFits(secs, f) : !fitActive(f)
        })
      })
      if (!ok) return false
    }
    return true
  })

  let note: string | null = null
  const scores = new Map<string, number>()
  const matched = new Map<string, string>()
  let words: string[] = []
  if (q.query?.trim()) {
    const byCode = codeMatch(cat, q.query)
    if (byCode) {
      for (const [id, s] of byCode) {
        const root = groupOf(cat, id)[0]
        if (s > (scores.get(root) ?? -1)) {
          scores.set(root, s)
          matched.set(root, id)
        }
      }
    } else {
      words = textTerms(q.query)
      const relevance = (requireAll: boolean) => {
        const out = new Map<string, number>()
        for (const c of rows) {
          let best = 0
          for (const id of groupOf(cat, c.id)) {
            if (requireAll && !cat.index.matchesAll(id, words)) continue
            best = Math.max(best, cat.index.score(id, words))
          }
          // A small pull toward classes many students rated, so "machine learning" leads with CS 229.
          if (best > 0) out.set(c.id, best + 0.35 * Math.log10(1 + (c.qualityN ?? 0)))
        }
        return out
      }
      let r = relevance(true)
      if (!r.size && words.length > 1) {
        r = relevance(false)
        note = 'No course matched every word, so these match some of them.'
      }
      for (const [k, v] of r) scores.set(k, v)
    }
    rows = rows.filter(c => scores.has(c.id))
  }

  const wanted = new Set((q.subjects ?? []).map(s => s.toUpperCase()))
  const hits = rows.map(c => ({
    course: c,
    shown: matched.get(c.id) ?? groupOf(cat, c.id).find(id => wanted.has(cat.byId.get(id)?.subject.toUpperCase() ?? '')) ?? c.id,
    snippetWords: words,
    score: scores.get(c.id) ?? 0,
  }))
  sortHits(hits, q)
  return { hits, note }
}

function sortHits(hits: { course: Course; score: number }[], q: SearchInput) {
  const byCode = (a: Course, b: Course) => a.subject.localeCompare(b.subject) || codeNum(a.code) - codeNum(b.code) || a.code.localeCompare(b.code)
  let sort = q.sort
  if (sort === 'relevance' && !q.query?.trim()) sort = 'code'
  if (sort === 'relevance') {
    hits.sort((a, b) => b.score - a.score || byCode(a.course, b.course))
    return
  }
  if (sort === 'code') {
    hits.sort((a, b) => byCode(a.course, b.course) * (q.order === 'desc' ? -1 : 1))
    return
  }
  const value = (c: Course): number | undefined => {
    if (sort === 'rating') return c.quality
    if (sort === 'hours_per_week') return c.hours
    if (sort === 'hours_per_unit') return hoursPerUnit(c.hours, c.units)
    const u = parseUnitsOptions(c.units)
    return u.length ? Math.min(...u) : undefined
  }
  const desc = (q.order ?? (sort === 'rating' ? 'desc' : 'asc')) === 'desc'
  hits.sort((a, b) => {
    const va = value(a.course)
    const vb = value(b.course)
    if (va === undefined && vb === undefined) return byCode(a.course, b.course)
    if (va === undefined) return 1
    if (vb === undefined) return -1
    return (desc ? vb - va : va - vb) || byCode(a.course, b.course)
  })
}

function codeNum(c: string): number {
  const m = c.match(/^(\d+)/)
  return m ? Number(m[1]) : 1e9
}

export { findCourse, code, enrollable, termKey }
