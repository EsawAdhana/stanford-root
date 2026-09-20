import { NextResponse } from 'next/server'
import { getPublicClient } from '@/lib/supabase-admin'
import { rateLimit } from '@/lib/rate-limit'
import { isDevEvalsUnlocked } from '@/lib/dev-flags'
import { getStanfordUser } from '@/lib/stanford-auth'
import { EVALUATION_COLUMNS, toCourseEvaluation, type EvaluationRow } from '@/lib/evaluation-row'
import { readCachedEvaluations, writeCachedEvaluations } from '@/lib/evaluation-cache'
import { attachSentiment } from '@/lib/comment-sentiment'
import type { CourseEvaluation } from '@/types/course'

const MAX_COURSE_IDS = 50
const MAX_COURSE_ID_LENGTH = 64

/** POST /api/evaluations — bulk fetch by course IDs. Body: { courseIds: string[] } */
export async function POST(request: Request) {
  const user = await getStanfordUser()
  if (!user && !isDevEvalsUnlocked()) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Best-effort throttle: 60 requests / minute per user.
  if (user && !rateLimit(`evals:${user.id}`, 60, 60 * 1000)) {
    return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  try {
    const courseIds = (body as { courseIds?: unknown })?.courseIds
    if (!Array.isArray(courseIds) || courseIds.length === 0) {
      return NextResponse.json({ error: 'courseIds is required' }, { status: 400 })
    }
    if (courseIds.length > MAX_COURSE_IDS) {
      return NextResponse.json({ error: `At most ${MAX_COURSE_IDS} course IDs allowed` }, { status: 400 })
    }

    const ids = courseIds.filter((id): id is string =>
      typeof id === 'string' && id.length > 0 && id.length <= MAX_COURSE_ID_LENGTH)

    if (ids.length === 0) {
      return NextResponse.json({}, { headers: { 'Cache-Control': 'private, no-store' } })
    }

    // Serve what this instance already holds and ask Postgres only for the rest.
    // One course costs ~550KB to read, and the browser cache is per student, so
    // without this every student shopping the same course pays for it again.
    const byCourse: Record<string, CourseEvaluation[]> = {}
    const missing: string[] = []
    for (const id of ids) {
      const cached = readCachedEvaluations(id)
      byCourse[id] = cached ?? []
      if (!cached) missing.push(id)
    }

    if (missing.length > 0) {
      const supabase = getPublicClient()
      // Single query — Supabase supports .in() with many values (up to 1000+)
      const { data, error } = await supabase
        .from('evaluations')
        .select(EVALUATION_COLUMNS)
        .in('course_id', missing)

      if (error) throw error

      const fetched: CourseEvaluation[] = []
      for (const row of (data || []) as EvaluationRow[]) {
        const courseId = row.course_id
        if (!courseId) continue
        if (!byCourse[courseId]) byCourse[courseId] = []
        const evaluation = toCourseEvaluation(row)
        byCourse[courseId].push(evaluation)
        fetched.push(evaluation)
      }
      // Before writing the cache, so the scores are cached with the comments.
      await attachSentiment(fetched)
      for (const id of missing) writeCachedEvaluations(id, byCourse[id])
    }

    return NextResponse.json(byCourse, {
      // Stanford-only data — keep out of shared/CDN caches.
      headers: { 'Cache-Control': 'private, no-store' }
    })
  } catch (err) {
    console.error('Evaluations API error:', err)
    return NextResponse.json(
      { error: process.env.NODE_ENV === 'production' ? 'Failed to fetch evaluations' : (err instanceof Error ? err.message : 'Failed to fetch evaluations') },
      { status: 500 }
    )
  }
}
