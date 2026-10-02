import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { McpServer, ServerContext } from '@modelcontextprotocol/server'
import type { ScheduleItem } from '@/lib/schedule-sync'
import type { Section } from '@/types/course'
import { getCurrentTerm } from '@/lib/terms'
import { displayedStatus } from '@/lib/seats'
import { formatLevel, normalizeCourseId } from '@/lib/utils'
import { instructorSlug } from '@/lib/instructors'
import { ToolFailure, asTool } from './errors'
import { type Catalog, GERS, availability, byComponent, code, componentRank, findCourse, getCatalog, gersOf, groupOf, meetingLabels, rating, sectionNumber, sectionsIn, standIn, summarize, termKey, unitOptions } from './catalog'
import { type Busy, search } from './search'
import { DAY_ORDER, parseClock, slotKeys, slotsOf } from './meetings'
import { snippet } from './text'
import { type Entry, applyAdd, conflicts, entriesFor, entryOf, entryOut, exportIcs, matchIcs, parseIcs, pickedIds, requiredSlots, sortKeys, unitTotal, unitsLabel } from './schedule'
import { aggregate } from './evals'
import { type Caller, ScheduleConflict, classYears, evaluations, instructorEvaluations, liveSeats, readSchedule, sendFeedback, writeSchedule } from './data'
import { getInstructorDirectory } from '@/lib/catalog-dump'

/** The quarters a student can plan: the current one and the three after it (same as the Python server). */
export function schedulableTerms(now = new Date()): string[] {
  const seasons = ['Winter', 'Spring', 'Summer', 'Autumn']
  const out = [getCurrentTerm(now)]
  while (out.length < 4) {
    const [s, y] = out[out.length - 1].split(' ')
    const i = seasons.indexOf(s)
    out.push(i === 3 ? `Winter ${Number(y) + 1}` : `${seasons[i + 1]} ${y}`)
  }
  return out
}

/** The quarter the site opens on: the current one, except over summer. */
function defaultTerm(now = new Date()): string {
  const t = getCurrentTerm(now)
  return t.startsWith('Summer') ? `Autumn ${t.split(' ')[1]}` : t
}

const TERMS = schedulableTerms()
const Term = z.enum(TERMS as [string, ...string[]])
const Day = z.enum(DAY_ORDER)
const Ger = z.enum(GERS)
const School = z.enum(['Business', 'Education', 'Engineering', 'Humanities & Sciences', 'Law', 'Medicine', 'Sustainability'])
const Component = z.enum(['LEC', 'SEM', 'DIS', 'LAB', 'LBS', 'INS', 'PRA', 'LNG', 'T/D', 'CLK', 'WKS', 'COL', 'CAS', 'ACT', 'ISF', 'CLN', 'RES', 'ISS', 'ITR', 'RSC', 'TUT', 'SIM'])
const Grading = z.enum(['Letter or Credit/No Credit', 'Letter (ABCD/NP)', 'Satisfactory/No Credit'])
const Subject = z.string().regex(/^[A-Za-z&]{2,10}$/)
const ClockTime = z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/)
const CourseId = z.string().min(2).max(32).describe('A course_id, e.g. "CS161" or "MS&E120". Spaces and case are ignored.')
const SECONDARY_SHOWN = 8

export const INSTRUCTIONS = `Stanford Root (stanfordroot.com) is a Stanford course planner. These tools do
what a student does on the site: search and filter courses, check sections and
seats, read reviews and evaluation numbers, and plan their saved schedule. The
schedule is a plan, not enrollment; nothing here enrolls in Axess.

Finding courses: search_courses takes structured filters. Put each part of the
request in its own filter rather than in the query text:
- requirements (WAYS, Writing, Language, WIM) -> gers ("all" to need several)
- department -> subjects / exclude_subjects; school -> schools
- "about X" -> query (matches titles and descriptions); "not X" -> exclude_words
- days and times -> days_only, avoid_days, earliest_start, latest_end
- units, rating ("well liked": sort="rating", optionally min_rated_by), workload
  (max_hours_per_week, sort="hours_per_week"), level, grading, open seats
- avoid_my_schedule_conflicts keeps only classes that fit the saved schedule.
Every result has a course_id; the other tools take it.

Then: get_course for description, sections (section_id), meeting times and
live seats; get_course_reviews for student comments and get_course_evaluations
for the rating and hours numbers; get_instructor for who teaches what.
get_my_schedule shows the calendar (sections, units, overlaps, sections still to
pick); set_meetings_optional marks meetings the user skips. add_to_schedule saves
a course or changes its quarter, sections or units. remove_from_schedule,
import_calendar and send_feedback are two steps: a preview (the default) returns
a confirm_token; show the user and end your turn, then commit with dry_run=false
and the token only after they say yes in a later message, even if they asked for
the change.
export_calendar makes an .ics file of a quarter.

Quarters are spelled "${TERMS[0]}"; valid now: ${TERMS.join(', ')}. Omitted
quarter in add_to_schedule means the current one, and a course not offered then
fails with the quarters it is offered in: ask the user, don't pick.

Errors are JSON: {"error": {"code", "message", "retryable", "hint", "details"}}.
Retry only if retryable is true.`

const RO = { readOnlyHint: true, openWorldHint: true }
const token = (...parts: unknown[]) => createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 12)
const respondents = (raw: string) => raw.match(/\d+ of \d+ responded(?: \([\d.]+%\))?/)?.[0] ?? raw.trim()

function callerOf(ctx: ServerContext): Caller {
  const info = ctx.http?.authInfo
  const extra = (info?.extra ?? {}) as { userId?: string; email?: string }
  if (!info?.token || !extra.userId) throw new ToolFailure('auth_required', 'Not signed in to Stanford Root.', { retryable: false, hint: 'Reconnect Stanford Root in this app.' })
  return { token: info.token, userId: extra.userId, email: extra.email ?? '' }
}

function notFound(cat: Catalog, raw: string): ToolFailure {
  const id = normalizeCourseId(raw).replace(/[^A-Z0-9&]/g, '')
  const prefix = id.match(/^[A-Z&]+/)?.[0] ?? ''
  const pool = cat.courses.filter(c => c.subject.toUpperCase() === prefix).map(c => c.id)
  const near = pool.map(p => [p, similarity(id, p)] as const).filter(([, s]) => s >= 0.6).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([p]) => p)
  return new ToolFailure('course_not_found', `No course '${id}' in this year's catalog; it may not be offered this year.`, {
    retryable: false, hint: 'Use one of details.did_you_mean, or search_courses; do not retry this id.',
    ...(near.length && { details: { did_you_mean: near } }),
  })
}

/** Ratio of matching characters, like Python's difflib, good enough to suggest near course ids. */
function similarity(a: string, b: string): number {
  const m = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0))
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) m[i][j] = a[i - 1] === b[j - 1] ? m[i - 1][j - 1] + 1 : Math.max(m[i - 1][j], m[i][j - 1])
  return (2 * m[a.length][b.length]) / (a.length + b.length)
}

const notOffered = (c: { subject: string; code: string }, term: string, offered: string[]) => new ToolFailure('not_offered',
  `${c.subject} ${c.code} is not offered in ${term}.` + (offered.length ? ` It is offered in: ${offered.join(', ')}.` : ' It has no scheduled quarters.'),
  { retryable: false, hint: offered.length ? 'Ask the user which quarter they want, then pass it as term.' : undefined, details: { offered_terms: offered } })

// Said on every preview. Without it the agent previewed and committed in the same
// turn whenever the user had asked for the change (found filming; 3 of 3 removals).
const waitForYes = (state: string, what: string, act: string) =>
  `${state} yet. Show the user ${what} and end your turn. ${act} with dry_run=false and the confirm_token only after they say yes in a later message, even if they already asked for it.`

const previewRequired = (what: string, stale: boolean) => new ToolFailure('preview_required',
  stale ? 'The schedule changed since that preview, so its confirm_token no longer applies.' : `${what} needs a confirm_token from a preview of the current schedule.`,
  { retryable: false, hint: 'Call again with dry_run=true, show the user, then commit with its confirm_token.' })

/** Read, change, write only if nobody saved in between; on a conflict start over from the fresh row. */
async function saveWithRetry<T>(caller: Caller, change: (items: ScheduleItem[]) => { items: ScheduleItem[]; result: T }): Promise<{ result: T; saved: ScheduleItem[] }> {
  for (let i = 0; i < 3; i++) {
    const current = await readSchedule(caller)
    const { items, result } = change([...(current ?? [])])
    if (JSON.stringify(items) === JSON.stringify(current ?? [])) return { result, saved: current ?? [] }
    try {
      await writeSchedule(caller, items, current)
      return { result, saved: items }
    } catch (err) {
      if (!(err instanceof ScheduleConflict)) throw err
    }
  }
  throw new ToolFailure('conflict', 'The schedule kept changing while saving (probably edited in a browser tab at the same time).', { retryable: true, retryAfterSeconds: 2 })
}

const overlapsIn = (cat: Catalog, items: ScheduleItem[], term: string) => conflicts(cat, entriesFor(cat, items, term))

export function registerTools(server: McpServer) {
  server.registerTool('search_courses', {
    title: 'Search courses',
    description: 'Search Stanford\'s catalog with the site\'s filters and sorts, plus description search, days, times, rating and workload. Combine filters for requests like "WAY-FR, Tue/Thu only, not CS". Each result\'s course_id feeds every other tool.',
    annotations: RO,
    inputSchema: z.object({
      query: z.string().max(120).optional().describe('Words about the course ("climate policy"), a code ("CS 161", "CS 1" for CS 1xx), or an instructor. Matches titles and descriptions.'),
      term: Term.optional().describe('Only courses offered this quarter. Omit for any quarter.'),
      subjects: z.array(Subject).max(20).optional().describe('Only these departments, e.g. ["CS", "MATH"].'),
      exclude_subjects: z.array(Subject).max(20).optional().describe('Leave out these departments.'),
      schools: z.array(School).optional().describe("Only departments in these schools (the site's grouping)."),
      gers: z.array(Ger).optional().describe("Requirements satisfied, e.g. ['WAY-FR']."),
      gers_match: z.enum(['any', 'all']).default('any').describe("'any' (default): at least one of gers; 'all': every one."),
      levels: z.array(z.enum(['Undergrad', 'Graduate'])).optional().describe('Undergrad = course number under 200.'),
      formats: z.array(Component).optional().describe("Has a section of this kind, e.g. ['SEM'] for seminars."),
      units_min: z.number().min(0).max(20).optional().describe('Can be taken for at least this many units.'),
      units_max: z.number().min(0).max(20).optional().describe('Can be taken for at most this many units.'),
      days_only: z.array(Day).optional().describe("Every meeting is on these days, e.g. ['Tue', 'Thu']."),
      avoid_days: z.array(Day).optional().describe("No meeting on these days, e.g. ['Fri']."),
      earliest_start: ClockTime.optional().describe("No meeting starts before this, 24-hour 'HH:MM', e.g. '11:00'."),
      latest_end: ClockTime.optional().describe("No meeting ends after this, 24-hour 'HH:MM', e.g. '17:00'."),
      avoid_my_schedule_conflicts: z.boolean().default(false).describe("Only classes that fit around the user's saved schedule."),
      open_seats_only: z.boolean().default(false).describe("Hide classes that are closed or waitlisted (the site's toggle)."),
      new_only: z.boolean().default(false).describe('Only courses new this year.'),
      instructor: z.string().max(60).optional().describe('Taught by someone whose name contains this.'),
      exclude_words: z.array(z.string()).max(10).optional().describe('Leave out courses whose title, description or code contains any of these.'),
      exclude_course_ids: z.array(z.string()).max(50).optional().describe('course_ids to leave out, e.g. ones already shown.'),
      min_rating: z.number().min(0).max(5).optional().describe('Student rating at least this (out of 5).'),
      min_rated_by: z.number().int().min(0).optional().describe('At least this many students rated it.'),
      max_hours_per_week: z.number().min(0).optional().describe('Reported workload at most this many hours a week.'),
      grading: z.array(Grading).optional().describe('Only these grading bases.'),
      sort: z.enum(['relevance', 'rating', 'hours_per_week', 'hours_per_unit', 'units', 'code']).default('relevance').describe('relevance (default with a query, else code), rating (best first), hours_per_week / hours_per_unit (lightest first), units, code.'),
      order: z.enum(['asc', 'desc']).optional().describe('Override the sort direction.'),
      limit: z.number().int().min(1).max(25).default(10).describe('Results per page.'),
      offset: z.number().int().min(0).default(0).describe('Skip this many results (from next_offset).'),
    }).strict(),
  }, (args, ctx) => asTool(async () => {
    const cat = await getCatalog()
    const busy: Busy = new Map()
    if (args.avoid_my_schedule_conflicts) {
      for (const item of (await readSchedule(callerOf(ctx))) ?? []) {
        const e = entryOf(cat, item)
        if (!e.course || !e.term) continue
        busy.set(e.term, [...(busy.get(e.term) ?? []), { group: new Set(groupOf(cat, e.course.id)), slots: e.drawn.flatMap(s => requiredSlots(s, item)) }])
      }
    }
    const { hits, note } = search(cat, {
      ...args, gers_match: args.gers_match, open_seats_only: args.open_seats_only, new_only: args.new_only, sort: args.sort,
      earliest_start: args.earliest_start ? parseClock(args.earliest_start) : undefined,
      latest_end: args.latest_end ? parseClock(args.latest_end) : undefined,
    }, busy)
    const page = hits.slice(args.offset, args.offset + args.limit)
    return {
      matches: page.map(h => {
        const c = cat.byId.get(h.shown) ?? h.course
        return summarize(c, cat, args.term ?? null, h.snippetWords.length ? snippet(c.description ?? '', h.snippetWords) : null)
      }),
      total_matches: hits.length,
      next_offset: args.offset + args.limit < hits.length ? args.offset + args.limit : null,
      note,
    }
  }))

  server.registerTool('get_course', {
    title: 'Get course details',
    description: 'One course (course_id from search_courses): description, ratings, who takes it, and the sections for a quarter with meeting times, instructors and seats. Seats are live from Navigator when available, and status follows the site\'s rule (an "Open" flag with no seat left reads as Wait List or Closed). Each section_id can be passed to add_to_schedule.',
    annotations: RO,
    inputSchema: z.object({
      course_id: CourseId,
      term: Term.optional().describe('Quarter for sections and seats. Omit for the next quarter it is offered.'),
      component: Component.optional().describe("List every section of this kind, e.g. 'DIS' to choose a discussion."),
    }).strict(),
  }, (args, ctx) => asTool(async () => {
    const caller = callerOf(ctx)
    const cat = await getCatalog()
    const c = findCourse(cat, args.course_id)
    if (!c) throw notFound(cat, args.course_id)
    const offered = [...(c.terms ?? [])].sort((a, b) => termKey(a) - termKey(b))
    if (args.term && !offered.includes(args.term)) throw notOffered(c, args.term, offered)
    const t = args.term ?? offered.find(x => termKey(x) >= termKey(defaultTerm())) ?? offered[0]
    const all = sectionsIn(c, t).sort((a, b) => componentRank(a) - componentRank(b) || sectionNumber(a) - sectionNumber(b))
    const main = t ? standIn(c, t)?.component : undefined
    const shown: Section[] = []
    const more: Record<string, number> = {}
    for (const [comp, group] of byComponent(all)) {
      if (args.component && comp !== args.component) continue
      const keep = args.component || comp === main ? group : group.slice(0, SECONDARY_SHOWN)
      shown.push(...keep)
      if (group.length > keep.length) more[comp] = group.length - keep.length
    }
    const live = t ? await liveSeats(caller, t, shown.map(s => s.classId)) : null
    const merged = shown.map(s => {
      const lv = live?.seats.get(s.classId)
      return lv ? { section: { ...s, status: lv.status || s.status, enrolled: lv.enrolled, waitlist: lv.waitlist, combined: lv.combined, capacity: lv.capacity > 0 ? lv.capacity : s.capacity, waitlistMax: lv.waitlistMax > 0 ? lv.waitlistMax : s.waitlistMax }, live: true } : { section: s, live: false }
    })
    const years = await classYears(caller, c.id)
    const buckets: Record<string, string[]> = { Frosh: ['frosh'], Sophomore: ['soph'], Junior: ['junior'], Senior: ['senior'], Grad: ['coterm', 'masters allYr', 'phd or doctoral'], Professional: ['professional'], Other: ['ug 5yr', 'nonmatriculated', 'other'] }
    const classYearsPct = years?.total ? Object.fromEntries(Object.entries(buckets).map(([k, keys]) => [k, Math.round((100 * keys.reduce((n, key) => n + (years.levels[key] ?? 0), 0)) / years.total)]).filter(([, v]) => v)) : null
    const starts = all.map(s => s.startDate).filter(Boolean).sort()
    const ends = all.map(s => s.endDate).filter(Boolean).sort()
    return {
      course_id: c.id, code: code(c), title: c.title, description: (c.description ?? '').slice(0, 2000), units: c.units, grading: c.grading,
      level: formatLevel(c.code), gers: gersOf(c), instructors: c.instructors ?? [], offered_terms: offered,
      rating: rating(c.quality), rating_percentile: c.qualityPct ?? null, percentile_among: c.rankScope ?? null, rated_by: c.qualityN ?? null,
      learning_rating: rating(c.ratingBreakdown?.learning?.score), organization_rating: rating(c.ratingBreakdown?.organization?.score),
      hours_per_week: c.hours ?? null, cross_listed_as: groupOf(cat, c.id).filter(i => i !== c.id), class_years: classYearsPct,
      sections_term: t ?? '', instruction_dates: starts.length && ends.length ? `${starts[0]} to ${ends[ends.length - 1]}` : null,
      availability: availability(merged.map(m => m.section).concat(all.filter(s => !shown.includes(s)))),
      seats_as_of: live?.at ?? null,
      sections: merged.map(({ section: s, live: isLive }) => {
        const room = s.combined
        const line = room ?? s
        const cap = line.capacity || 0
        return {
          section_id: s.classId, component: s.component, section_number: s.sectionNumber, meetings: meetingLabels(s),
          instructors: [...new Set(s.meetings.flatMap(m => m.instructors ?? []))], status: displayedStatus(s.status, s, room),
          enrolled: line.enrolled, capacity: cap || null, seats_left: cap > 0 ? Math.max(0, cap - line.enrolled) : null,
          waitlist: line.waitlist, waitlist_max: line.waitlistMax, mode: s.instructionalMode && s.instructionalMode !== 'In Person' ? s.instructionalMode : null,
          seats_source: isLive ? 'live' : 'catalog',
        }
      }),
      more_sections: more,
    }
  }))

  server.registerTool('get_course_reviews', {
    title: 'Get course reviews',
    description: "Student evaluation comments for a course (course_id from search_courses), most recent quarter first, filterable like the site's Comments tab. Stanford-only data.",
    annotations: RO,
    inputSchema: z.object({
      course_id: CourseId,
      term: z.string().max(20).optional().describe("Only this past quarter, e.g. 'Spring 2026'."),
      instructor: z.string().max(60).optional().describe('Only reports for an instructor whose name contains this.'),
      sentiment: z.enum(['positive', 'negative', 'mixed', 'advice']).optional().describe("Only comments of this kind (the site's sentiment pills)."),
      keyword: z.string().max(60).optional().describe("Only comments containing this, e.g. 'workload'."),
      limit: z.number().int().min(1).max(40).default(12).describe('Most comments to return in total.'),
    }).strict(),
  }, (args, ctx) => asTool(async () => {
    const id = normalizeCourseId(args.course_id).replace(/[^A-Z0-9&]/g, '')
    const reports = [...await evaluations(callerOf(ctx), id)]
    if (!reports.length) {
      const cat = await getCatalog()
      if (!findCourse(cat, id)) throw notFound(cat, id)
    }
    reports.sort((a, b) => termKey(b.term) - termKey(a.term))
    const out = []
    let returned = 0
    let matching = 0
    for (const r of reports) {
      if (args.term && r.term !== args.term) continue
      if (args.instructor && !r.instructor.toLowerCase().includes(args.instructor.toLowerCase())) continue
      const picked: { text: string; sentiment: string | null }[] = []
      r.comments.forEach((raw, i) => {
        const text = (raw ?? '').trim()
        const tone = r.commentSentiment?.[i] ?? null
        if (!text || (args.sentiment && tone !== args.sentiment) || (args.keyword && !text.toLowerCase().includes(args.keyword.toLowerCase()))) return
        matching++
        if (returned < args.limit) {
          picked.push({ text: text.slice(0, 600), sentiment: tone })
          returned++
        }
      })
      if (picked.length) out.push({ term: r.term, instructor: r.instructor, respondents: respondents(String(r.respondents)), comments: picked })
    }
    return { course_id: id, terms: out, comments_returned: returned, comments_matching: matching }
  }))

  server.registerTool('get_course_evaluations', {
    title: 'Get course evaluations',
    description: "The numbers behind the site's Charts tab for a course (course_id from search_courses): quality, learning, organization and goals ratings with their spread, weekly hours (median and spread) and attendance, overall and per past offering. These are raw pooled responses, so they differ from the `rating` in search_courses and get_course, which is the site's score adjusted for small samples and averaged over quality, learning and organization. Stanford-only data. For what students wrote, use get_course_reviews.",
    annotations: RO,
    inputSchema: z.object({
      course_id: CourseId,
      term: z.string().max(20).optional().describe("Only this past quarter, e.g. 'Winter 2026'."),
      instructor: z.string().max(60).optional().describe('Only reports for an instructor whose name contains this.'),
    }).strict(),
  }, (args, ctx) => asTool(async () => {
    const id = normalizeCourseId(args.course_id).replace(/[^A-Z0-9&]/g, '')
    let reports = await evaluations(callerOf(ctx), id)
    if (!reports.length) {
      const cat = await getCatalog()
      if (!findCourse(cat, id)) throw notFound(cat, id)
    }
    reports = reports.filter(r => (!args.term || r.term === args.term) && (!args.instructor || r.instructor.toLowerCase().includes(args.instructor.toLowerCase())))
      .sort((a, b) => termKey(b.term) - termKey(a.term))
    return {
      course_id: id, reports: reports.length, overall: aggregate(reports),
      by_report: reports.slice(0, 12).map(r => ({ term: r.term, instructor: r.instructor, respondents: respondents(String(r.respondents)), stats: aggregate([r]) })),
    }
  }))

  server.registerTool('get_instructor', {
    title: 'Get instructor',
    description: "An instructor's courses in the current catalog (with ratings), and their past evaluations, like the site's instructor page.",
    annotations: RO,
    inputSchema: z.object({
      name: z.string().min(2).max(60).describe('A name as people say it: "Mehran Sahami", "Sahami".'),
      comments: z.number().int().min(0).max(20).default(5).describe('Recent evaluation comments to include.'),
    }).strict(),
  }, (args, ctx) => asTool(async () => {
    const cat = await getCatalog()
    const dir = await getInstructorDirectory()
    const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    const tokens = fold(args.name).split(/[^a-z0-9]+/).filter(Boolean)
    // The instructor index's raw spellings ("Sahami, Mehran"), which is how the catalog lists people.
    const names = [...new Set([...dir.entries.flatMap(e => e.aliases), ...cat.courses.flatMap(c => c.instructors ?? [])])]
    const scored = names.filter(n => {
      const parts = fold(n).split(/[^a-z0-9]+/).filter(Boolean)
      return tokens.length && tokens.every(t => parts.some(p => p === t || p.startsWith(t)))
    }).map(n => {
      const last = fold(n.split(',')[0]).replace(/[^a-z0-9]/g, '')
      return [tokens.includes(last) ? 0 : 1, n] as const
    }).sort()
    const chosen = scored[0]?.[1]
    if (!chosen) throw new ToolFailure('instructor_not_found', `No instructor matches '${args.name}'.`, { retryable: false, hint: 'Try the surname alone, or check spelling.' })
    const taught = new Map<string, typeof cat.courses[number]>()
    for (const c of cat.courses) if ((c.instructors ?? []).includes(chosen)) { const root = cat.byId.get(groupOf(cat, c.id)[0]) ?? c; taught.set(root.id, root) }
    const evals = await instructorEvaluations(callerOf(ctx), instructorSlug(chosen))
    const recent: string[] = []
    for (const e of [...(evals?.evaluations ?? [])].sort((a, b) => termKey(b.term) - termKey(a.term))) {
      for (const text of e.comments) if (recent.length < args.comments && text?.trim()) recent.push(`[${e.courseCode || e.courseId}, ${e.term}] ${text.trim().slice(0, 400)}`)
    }
    return {
      name: chosen, slug: instructorSlug(chosen),
      courses: [...taught.values()].sort((a, b) => code(a).localeCompare(code(b))).map(c => ({ course_id: c.id, code: code(c), title: c.title, terms: c.terms ?? [], rating: rating(c.quality) })),
      evaluated_reports: evals ? evals.evaluations.length : null, recent_comments: recent,
      other_matches: scored.map(([, n]) => n).filter(n => n !== chosen).slice(0, 5),
    }
  }))

  server.registerTool('get_my_schedule', {
    title: 'Get my schedule',
    description: "The user's Stanford Root calendar, per quarter: each course's sections and meeting times (or the site's default section when none is picked), units, overlaps between classes, and components still to pick. Each course_id works with remove_from_schedule.",
    annotations: RO,
    inputSchema: z.object({ term: Term.optional().describe('Only this quarter. Omit for every quarter with saved courses.') }).strict(),
  }, (args, ctx) => asTool(async () => {
    const caller = callerOf(ctx)
    const items = (await readSchedule(caller)) ?? []
    const cat = await getCatalog()
    const quarters = new Set<string>()
    for (const i of items) {
      if (i.selectedTerm) quarters.add(i.selectedTerm)
      else for (const t of findCourse(cat, i.id)?.terms ?? []) quarters.add(t)
    }
    const list = args.term ? [args.term] : [...quarters].sort((a, b) => termKey(a) - termKey(b))
    const terms = list.map(t => {
      const entries = entriesFor(cat, items, t)
      const required = conflicts(cat, entries)
      const withOptional = conflicts(cat, entries, true).filter(o => !required.some(r => JSON.stringify(r) === JSON.stringify(o)))
      const total = unitTotal(entries)
      return { term: t, entries: entries.map(entryOut), total_units: unitsLabel(total) ?? '0', over_20_units: total[1] > 20, overlaps: required, overlaps_if_attending_optional: withOptional }
    }).filter(t => args.term || t.entries.length)
    return { signed_in_as: caller.email, terms, total_saved: items.length }
  }))

  server.registerTool('add_to_schedule', {
    title: 'Add to schedule',
    description: "Save a course (course_id from search_courses) to the user's Stanford Root schedule, or change a saved course's quarter, sections or units. Works like the site's Add to Calendar: moving to another quarter starts the section picks over, and a cross-listed sibling already saved that quarter is replaced. Reports overlaps and anything still to pick. Planning only; this does not enroll.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    inputSchema: z.object({
      course_id: CourseId,
      term: Term.optional().describe('Quarter to plan it for. Omit for the current quarter.'),
      section_ids: z.array(z.number().int()).max(6).optional().describe('section_id values from get_course for this course and quarter. Each replaces the pick of the same component (a new DIS replaces the old DIS, the LEC stays).'),
      units: z.number().min(0).max(20).optional().describe('Units to take it for, for variable-unit courses.'),
    }).strict(),
  }, (args, ctx) => asTool(async () => {
    const caller = callerOf(ctx)
    const cat = await getCatalog()
    const c = findCourse(cat, args.course_id)
    if (!c) throw notFound(cat, args.course_id)
    const term = args.term ?? defaultTerm()
    const offered = [...(c.terms ?? [])].sort((a, b) => termKey(a) - termKey(b))
    if (!offered.includes(term)) throw notOffered(c, term, offered)
    const secs = sectionsIn(c, term)
    const unknown = (args.section_ids ?? []).filter(id => !secs.some(s => s.classId === id))
    if (unknown.length) throw new ToolFailure('invalid_section', `Section ids [${unknown.join(', ')}] are not ${code(c)} sections in ${term}.`, {
      retryable: false, hint: 'Use section_id values from get_course with the same course_id and term.',
      details: { valid_sections: secs.slice(0, 40).map(s => ({ section_id: s.classId, component: s.component, meetings: meetingLabels(s) })) },
    })
    const options = unitOptions(c, term)
    if (args.units !== undefined && options.length && !options.includes(args.units)) throw new ToolFailure('invalid_units', `${code(c)} can be taken for ${unitsLabel([Math.min(...options), Math.max(...options)])} units, not ${args.units}.`, { retryable: false, details: { unit_options: options } })
    const { result, saved } = await saveWithRetry(caller, items => {
      const r = applyAdd(items, cat, c, term, args.section_ids ?? [], args.units)
      return { items: r.items, result: r }
    })
    const entries = entriesFor(cat, saved, term)
    const mine = entries.find(e => e.item.id === c.id) as Entry
    const warnings: string[] = []
    if (mine.picked) for (const s of mine.drawn) { const st = displayedStatus(s.status, s, s.combined); if (st.toLowerCase() !== 'open') warnings.push(`Section ${s.classId} (${s.component}) is ${st}.`) }
    if (!mine.picked && secs.length) warnings.push("No section picked: the calendar shows the site's default section. Pick with section_ids from get_course.")
    else if (mine.unpicked.length) warnings.push(`Still to pick: ${mine.unpicked.join(', ')}.`)
    const item = saved.find(i => i.id === c.id)!
    if (options.length > 1 && typeof item.selectedUnits !== 'number') warnings.push(`Variable units (${unitsLabel([Math.min(...options), Math.max(...options)])}); pass units to choose.`)
    return {
      action: result.action, entry: entryOut(mine), term_was_defaulted: !args.term, replaced_cross_listing: result.replaced,
      overlaps: conflicts(cat, entries).filter(o => o.course_ids.includes(c.id)), term_units: unitsLabel(unitTotal(entries)) ?? '0', warnings, total_saved: saved.length,
    }
  }))

  server.registerTool('remove_from_schedule', {
    title: 'Remove from schedule',
    description: "Remove a course, or some of its picked sections, from the user's Stanford Root schedule. Two steps: call with dry_run=true (the default) to preview exactly what goes and get a confirm_token; show the user and end your turn. Only after they say yes in a later message, call with dry_run=false and that token, even if they asked for the removal. A token is only good for the schedule it was previewed on.",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    inputSchema: z.object({
      course_id: z.string().min(2).max(32).describe('A course_id from get_my_schedule.'),
      section_ids: z.array(z.number().int()).max(6).optional().describe('Remove only these picked sections. Removing the last picked section removes the course, as on the site.'),
      dry_run: z.boolean().default(true).describe('True (default) only previews. Pass false to actually remove, after the user agrees.'),
      confirm_token: z.string().max(32).optional().describe('The confirm_token from the preview. Required when dry_run is false.'),
    }).strict(),
  }, (args, ctx) => asTool(async () => {
    const caller = callerOf(ctx)
    const cat = await getCatalog()
    const id = normalizeCourseId(args.course_id).replace(/[^A-Z0-9&]/g, '')
    const tokenFor = (items: ScheduleItem[]) => token(id, [...(args.section_ids ?? [])].sort(), items.map(sortKeys))
    const plan = (items: ScheduleItem[]) => {
      if (!args.dry_run && args.confirm_token !== tokenFor(items)) throw previewRequired('Removing', !!args.confirm_token)
      const target = items.find(i => i.id === id)
      if (!target) throw new ToolFailure('not_in_schedule', `${id} is not on the saved schedule.`, { retryable: false, hint: 'Call get_my_schedule for the course_ids that are saved.', details: { saved_course_ids: items.map(i => i.id) } })
      if (!args.section_ids?.length) return { items: items.filter(i => i !== target), result: { target, removed: [] as number[], whole: true } }
      const picked = pickedIds(target)
      const notPicked = args.section_ids.filter(s => !picked.includes(s))
      if (notPicked.length) throw new ToolFailure('section_not_picked', `Sections [${notPicked.join(', ')}] are not picked for ${id}.`, { retryable: false, details: { picked_section_ids: picked } })
      const left = picked.filter(s => !args.section_ids!.includes(s))
      if (!left.length) return { items: items.filter(i => i !== target), result: { target, removed: args.section_ids, whole: true } }
      const updated: ScheduleItem = { ...target, selectedSectionIds: left }
      delete updated.selectedSectionId
      return { items: items.map(i => (i === target ? updated : i)), result: { target, removed: args.section_ids, whole: false } }
    }
    if (args.dry_run) {
      const items = (await readSchedule(caller)) ?? []
      const p = plan(items)
      return { dry_run: true, removed: entryOut(entryOf(cat, p.result.target)), removed_section_ids: p.result.removed, whole_course: p.result.whole, total_saved_after: p.items.length, confirm_token: tokenFor(items), note: waitForYes('Nothing is removed', 'what would go', 'Commit') }
    }
    const { result, saved } = await saveWithRetry(caller, plan)
    return { dry_run: false, removed: entryOut(entryOf(cat, result.target)), removed_section_ids: result.removed, whole_course: result.whole, total_saved_after: saved.length, confirm_token: null, note: null }
  }))

  server.registerTool('set_meetings_optional', {
    title: 'Mark meetings optional',
    description: "Mark a saved course's meetings optional, like the site's eye icon, for classes the user won't attend in person (e.g. recorded lectures). Optional meetings are dimmed on the site and left out of overlaps and export_calendar. Reversible with optional=false.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    inputSchema: z.object({
      course_id: z.string().min(2).max(32).describe('A course_id from get_my_schedule.'),
      optional: z.boolean().default(true).describe("True to mark optional (the site's eye icon), false to count them again."),
      section_id: z.number().int().optional().describe("Only this drawn section's meetings, e.g. the lecture."),
      days: z.array(Day).optional().describe('Only meetings on these days.'),
    }).strict(),
  }, (args, ctx) => asTool(async () => {
    const caller = callerOf(ctx)
    const cat = await getCatalog()
    const id = normalizeCourseId(args.course_id).replace(/[^A-Z0-9&]/g, '')
    const { result, saved } = await saveWithRetry(caller, items => {
      const target = items.find(i => i.id === id)
      if (!target) throw new ToolFailure('not_in_schedule', `${id} is not on the saved schedule.`, { retryable: false, hint: 'Call get_my_schedule for the course_ids that are saved.', details: { saved_course_ids: items.map(i => i.id) } })
      const e = entryOf(cat, target)
      const secs = e.drawn.filter(s => args.section_id === undefined || s.classId === args.section_id)
      if (args.section_id !== undefined && !secs.length) throw new ToolFailure('invalid_section', `Section ${args.section_id} is not on the calendar for ${id}.`, { retryable: false, details: { drawn_section_ids: e.drawn.map(s => s.classId) } })
      const keys = secs.flatMap(s => slotsOf(s).flatMap(sl => slotKeys(sl))).filter(k => !args.days?.length || args.days.includes(k.split('|')[0] as typeof DAY_ORDER[number]))
      if (!keys.length) throw new ToolFailure('no_meetings', `No timed meetings of ${id} match.`, { retryable: false })
      const current = target.optionalMeetings ?? []
      const next = args.optional ? [...current, ...keys.filter(k => !current.includes(k))] : current.filter(k => !keys.includes(k))
      const updated: ScheduleItem = { ...target }
      if (next.length) updated.optionalMeetings = next
      else delete updated.optionalMeetings
      return { items: items.map(i => (i === target ? updated : i)), result: { updated, keys } }
    })
    const e = entryOf(cat, result.updated)
    return {
      entry: entryOut(e), changed_meetings: [...new Set(result.keys.map(k => { const [d, s, t] = k.split('|'); return `${d} ${s}-${t}` }))].sort(),
      overlaps: e.term ? overlapsIn(cat, saved, e.term).filter(o => o.course_ids.includes(id)) : [],
    }
  }))

  server.registerTool('import_calendar', {
    title: 'Import calendar',
    description: 'Add the classes in an .ics calendar to the user\'s Stanford Root schedule, like the site\'s Import: each event titled with a course code ("CS 106B ...") becomes that course, with the section whose days and times match. Two steps: preview (the default) shows what would be added, what didn\'t match and why, and returns a confirm_token; show the user and end your turn. Only after they say yes in a later message, commit with dry_run=false and that token.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    inputSchema: z.object({
      ics: z.string().min(20).max(500_000).describe('The text of an .ics file (e.g. exported from Axess, Google Calendar or Stanford Root).'),
      term: Term.optional().describe('Quarter to import into. Omit to read it from the file.'),
      dry_run: z.boolean().default(true).describe("True (default) only previews. Pass false with the preview's confirm_token to save."),
      confirm_token: z.string().max(32).optional().describe('The confirm_token from the preview.'),
    }).strict(),
  }, (args, ctx) => asTool(async () => {
    const caller = callerOf(ctx)
    const cat = await getCatalog()
    const { events, term: calTerm } = parseIcs(args.ics)
    if (!events.length) throw new ToolFailure('no_events', 'The file has no events with a title, start and end.', { retryable: false, hint: 'Pass the full text of the .ics file, from BEGIN:VCALENDAR to END:VCALENDAR.' })
    const matches = matchIcs(cat, events, calTerm, args.term)
    const tokenFor = (items: ScheduleItem[]) => token(args.ics, args.term ?? null, items.map(sortKeys))
    const plan = (items: ScheduleItem[]) => {
      const rows = []
      let next = items
      for (const m of matches) {
        if (!m.course || m.reason) {
          rows.push({ summary: m.summary, term: m.term, course_id: m.course?.id ?? null, code: m.course ? code(m.course) : null, section_ids: [], unmatched_times: m.unmatchedTimes, action: 'skip', reason: m.reason })
          continue
        }
        const r = applyAdd(next, cat, m.course, m.term, m.sectionIds)
        next = r.items
        rows.push({ summary: m.summary, term: m.term, course_id: m.course.id, code: code(m.course), section_ids: m.sectionIds, unmatched_times: m.unmatchedTimes, action: r.action === 'added' ? 'add' : r.action === 'updated' ? 'update' : 'unchanged', reason: null })
      }
      return { items: next, result: rows }
    }
    if (args.dry_run) {
      const items = (await readSchedule(caller)) ?? []
      const p = plan(items)
      return { dry_run: true, courses: p.result, confirm_token: tokenFor(items), total_saved_after: p.items.length, note: waitForYes('Nothing is saved', 'what would be added', 'Commit') }
    }
    const { result, saved } = await saveWithRetry(caller, items => {
      if (args.confirm_token !== tokenFor(items)) throw previewRequired('Importing', !!args.confirm_token)
      return plan(items)
    })
    return { dry_run: false, courses: result, confirm_token: null, total_saved_after: saved.length, note: null }
  }))

  server.registerTool('export_calendar', {
    title: 'Export calendar',
    description: "An .ics file of one quarter of the saved schedule, like the site's Export, with each class repeating weekly from its first to last day of instruction. Save `ics` to `filename`; it imports into Google Calendar, Apple Calendar and Outlook. Read-only.",
    annotations: RO,
    inputSchema: z.object({ term: Term.optional().describe('Quarter to export. Omit for the current quarter.') }).strict(),
  }, (args, ctx) => asTool(async () => {
    const term = args.term ?? defaultTerm()
    const items = (await readSchedule(callerOf(ctx))) ?? []
    const cat = await getCatalog()
    const { ics, events, leftOff } = exportIcs(entriesFor(cat, items, term), term)
    const [season, year] = term.split(' ')
    return { term, filename: `stanford_schedule_${season}_${year}.ics`, events, left_off: leftOff, ics }
  }))

  server.registerTool('send_feedback', {
    title: 'Send feedback',
    description: "Send feedback or a feature request to Stanford Root's maintainer, like the site's Feedback dialog. Anonymous, and it cannot be unsent: only when the user asks to send feedback. Two steps: preview (the default) returns a confirm_token; show the user the exact text and end your turn. Only after they say yes in a later message, send with dry_run=false and that token.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    inputSchema: z.object({
      text: z.string().min(1).max(2000).describe("The message, in the user's words."),
      kind: z.enum(['feedback', 'request']).default('feedback').describe("'feedback' (general) or 'request' (an idea or feature)."),
      dry_run: z.boolean().default(true).describe("True (default) only previews. Pass false with the preview's confirm_token to send."),
      confirm_token: z.string().max(32).optional().describe('The confirm_token from the preview.'),
    }).strict(),
  }, (args, ctx) => asTool(async () => {
    const body = args.text.trim()
    const t = token(body, args.kind)
    if (args.dry_run) return { dry_run: true, sent: false, kind: args.kind, text: body, confirm_token: t, note: waitForYes('Not sent', 'this exact text', 'Send') }
    if (args.confirm_token !== t) throw new ToolFailure('preview_required', 'Sending needs the confirm_token from a preview of this exact text.', { retryable: false, hint: 'Call send_feedback with dry_run=true first and show the user the text.' })
    await sendFeedback(callerOf(ctx), body, args.kind)
    return { dry_run: false, sent: true, kind: args.kind, text: body, confirm_token: null, note: "Sent anonymously to the maintainer. It is not linked to the user's account." }
  }))
}

