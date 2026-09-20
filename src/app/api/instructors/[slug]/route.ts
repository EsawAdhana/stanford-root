import { NextResponse } from 'next/server'
import { getPublicClient } from '@/lib/supabase-admin'
import { rateLimit } from '@/lib/rate-limit'
import { isDevEvalsUnlocked } from '@/lib/dev-flags'
import { getStanfordUser } from '@/lib/stanford-auth'
import { getInstructorDirectory } from '@/lib/catalog-dump'
import { resolveInstructorSlug } from '@/lib/instructors'
import { EVALUATION_COLUMNS, toCourseEvaluation, type EvaluationRow } from '@/lib/evaluation-row'
import { attachSentiment } from '@/lib/comment-sentiment'
import type { CourseEvaluation } from '@/types/course'

export type InstructorEvaluation = CourseEvaluation & { courseId: string }

/**
 * GET /api/instructors/[slug] — every evaluation written for one person.
 *
 * Same Stanford-only gate as /api/evaluations. Unlike that route this can't be
 * driven from the client's course IDs: the catalog only covers upcoming terms,
 * so an instructor's teaching history exists solely in the evaluations table.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const user = await getStanfordUser()
  if (!user && !isDevEvalsUnlocked()) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (user && !rateLimit(`instructor:${user.id}`, 60, 60 * 1000)) {
    return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 })
  }

  const { slug } = await params

  try {
    const directory = await getInstructorDirectory()
    const resolved = resolveInstructorSlug(directory, slug)
    if (resolved.kind !== 'found') {
      return NextResponse.json({ error: 'Instructor not found' }, { status: 404 })
    }

    const supabase = getPublicClient()
    const { data, error } = await supabase
      .from('evaluations')
      .select(EVALUATION_COLUMNS)
      .in('instructor', resolved.entry.aliases)
      // Deterministic order matters: ~9% of records are cross-listed under
      // several course IDs, and the dedupe below keeps whichever arrives first.
      // Unordered, the same class could show as AA 222 on one load and CS 361
      // on the next.
      .order('course_id', { ascending: true })

    if (error) throw error

    // Cross-listed offerings are stored once per course ID with identical
    // content, so keep one copy or every rating and comment counts twice.
    const seen = new Set<string>()
    const evaluations: InstructorEvaluation[] = []
    for (const row of (data || []) as EvaluationRow[]) {
      if (!row.course_id) continue
      const evaluation = toCourseEvaluation(row)
      const key = `${evaluation.term}|${evaluation.courseCode}|${evaluation.instructor}`
      if (seen.has(key)) continue
      seen.add(key)
      evaluations.push({ ...evaluation, courseId: row.course_id })
    }

    await attachSentiment(evaluations)

    return NextResponse.json(
      { slug: resolved.entry.slug, name: resolved.entry.name, evaluations },
      { headers: { 'Cache-Control': 'private, no-store' } }
    )
  } catch (err) {
    console.error('Instructor API error:', err)
    return NextResponse.json(
      { error: process.env.NODE_ENV === 'production' ? 'Failed to fetch instructor' : (err instanceof Error ? err.message : 'Failed to fetch instructor') },
      { status: 500 }
    )
  }
}
