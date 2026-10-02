import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { ScheduleItem } from '@/lib/schedule-sync'
import type { ClassYearBreakdown, CourseEvaluation } from '@/types/course'
import { getPublicClient } from '@/lib/supabase-admin'
import { rateLimit } from '@/lib/rate-limit'
import { EVALUATION_COLUMNS, toCourseEvaluation, type EvaluationRow } from '@/lib/evaluation-row'
import { readCachedEvaluations, writeCachedEvaluations } from '@/lib/evaluation-cache'
import { attachSentiment } from '@/lib/comment-sentiment'
import { getInstructorDirectory } from '@/lib/catalog-dump'
import { resolveInstructorSlug } from '@/lib/instructors'
import { strmForTerm, MAX_CLASS_NBRS_PER_REQUEST, type LiveSeat } from '@/lib/seats'
import { readLiveSeats } from '@/lib/live-seats'
import { submitFeedback, type FeedbackType } from '@/lib/feedback'
import { ToolFailure, authRequired, stanfordOnly } from './errors'

/** Who the bearer token belongs to, as verified by Supabase Auth. */
export type Caller = { token: string; userId: string; email: string }

export const isStanford = (c: Caller) => c.email.endsWith('@stanford.edu')

function upstream(what: string, err: unknown): ToolFailure {
  console.error(`MCP ${what} failed:`, err)
  return new ToolFailure('upstream_unavailable', `Stanford Root could not load ${what}.`, { retryable: true, retryAfterSeconds: 5 })
}

function limited(key: string, limit: number, windowMs: number, what: string) {
  if (!rateLimit(key, limit, windowMs)) {
    throw new ToolFailure('rate_limited', `Too many ${what} requests.`, { retryable: true, retryAfterSeconds: Math.ceil(windowMs / 1000 / 4), hint: 'Wait, then call again.' })
  }
}

/** A Supabase client acting as the user: row-level security scopes it to their own rows. */
function asUser(caller: Caller): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL || '', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${caller.token}` } },
  })
}

/** The saved schedule, or null when the user has no row yet. */
export async function readSchedule(caller: Caller): Promise<ScheduleItem[] | null> {
  const { data, error } = await asUser(caller).from('user_schedules').select('schedule').eq('user_id', caller.userId).maybeSingle()
  if (error) {
    if (error.code === 'PGRST301' || /jwt/i.test(error.message)) throw authRequired('The Stanford Root connection expired.')
    throw upstream('your saved schedule', error)
  }
  if (!data) return null
  return Array.isArray(data.schedule) ? (data.schedule as ScheduleItem[]) : []
}

export class ScheduleConflict extends Error {}

/** Save only if the row still holds `expected`, so a change made in a browser tab meanwhile is never overwritten. */
export async function writeSchedule(caller: Caller, next: ScheduleItem[], expected: ScheduleItem[] | null): Promise<void> {
  const db = asUser(caller)
  if (expected === null) {
    const { error } = await db.from('user_schedules').insert({ user_id: caller.userId, schedule: next }).select('user_id')
    if (error?.code === '23505') throw new ScheduleConflict()
    if (error) throw upstream('saving your schedule', error)
    return
  }
  const { data, error } = await db.from('user_schedules').update({ schedule: next })
    .eq('user_id', caller.userId).eq('schedule', JSON.stringify(expected)).select('user_id')
  if (error) throw upstream('saving your schedule', error)
  if (!data?.length) throw new ScheduleConflict()
}

/** Every evaluation report for a course, as POST /api/evaluations serves it (Stanford-only). */
export async function evaluations(caller: Caller, courseId: string): Promise<CourseEvaluation[]> {
  if (!isStanford(caller)) throw stanfordOnly()
  limited(`evals:${caller.userId}`, 60, 60_000, 'evaluation')
  const cached = readCachedEvaluations(courseId)
  if (cached) return cached
  const { data, error } = await getPublicClient().from('evaluations').select(EVALUATION_COLUMNS).in('course_id', [courseId])
  if (error) throw upstream('evaluations', error)
  const rows = ((data || []) as EvaluationRow[]).map(toCourseEvaluation)
  await attachSentiment(rows)
  writeCachedEvaluations(courseId, rows)
  return rows
}

export async function classYears(caller: Caller, courseId: string): Promise<ClassYearBreakdown | null> {
  if (!isStanford(caller)) return null
  limited(`classyears:${caller.userId}`, 60, 60_000, 'class year')
  const { data, error } = await getPublicClient().from('course_class_years').select('course_id, levels, total').eq('course_id', courseId).maybeSingle()
  if (error || !data) return null
  return { levels: data.levels || {}, total: data.total || 0 }
}

export type InstructorEvaluation = CourseEvaluation & { courseId: string }

/** As GET /api/instructors/[slug] serves it, or null for an unknown slug. */
export async function instructorEvaluations(caller: Caller, slug: string): Promise<{ name: string; evaluations: InstructorEvaluation[] } | null> {
  if (!isStanford(caller)) return null
  limited(`instructor:${caller.userId}`, 60, 60_000, 'instructor')
  const resolved = resolveInstructorSlug(await getInstructorDirectory(), slug)
  if (resolved.kind !== 'found') return null
  const { data, error } = await getPublicClient().from('evaluations').select(EVALUATION_COLUMNS).in('instructor', resolved.entry.aliases).order('course_id', { ascending: true })
  if (error) throw upstream('instructor evaluations', error)
  const seen = new Set<string>()
  const out: InstructorEvaluation[] = []
  for (const row of (data || []) as EvaluationRow[]) {
    if (!row.course_id) continue
    const e = toCourseEvaluation(row)
    const key = `${e.term}|${e.courseCode}|${e.instructor}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ ...e, courseId: row.course_id })
  }
  await attachSentiment(out)
  return { name: resolved.entry.name, evaluations: out }
}

/** Live Navigator seats, through the same cache and breaker as /api/seats. Null when unavailable. */
export async function liveSeats(caller: Caller, term: string, classNbrs: number[]): Promise<{ seats: Map<number, LiveSeat>; at: string | null } | null> {
  const strm = strmForTerm(term)
  if (!strm || !classNbrs.length || !rateLimit(`mcp-seats:${caller.userId}`, 60, 60_000)) return null
  try {
    const res = await readLiveSeats(strm, classNbrs.slice(0, MAX_CLASS_NBRS_PER_REQUEST))
    const seats = new Map(Object.values(res.seats).map(s => [s.classNbr, s]))
    return seats.size ? { seats, at: res.fetchedAt } : null
  } catch {
    return null
  }
}

export async function sendFeedback(caller: Caller, text: string, type: FeedbackType): Promise<void> {
  limited(`mcp-feedback:${caller.userId}`, 5, 60 * 60_000, 'feedback')
  const result = await submitFeedback(text, type)
  if (!result.ok) throw new ToolFailure('upstream_unavailable', result.error, { retryable: true, retryAfterSeconds: 30 })
}
