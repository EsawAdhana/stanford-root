import { NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase-admin'
import { rateLimit } from '@/lib/rate-limit'
import { isDevEvalsUnlocked } from '@/lib/dev-flags'
import { getStanfordUser } from '@/lib/stanford-auth'
import type { ClassYearBreakdown } from '@/types/course'

const MAX_COURSE_IDS = 50
const MAX_COURSE_ID_LENGTH = 64

/**
 * POST /api/class-years — bulk fetch Carta class-level breakdowns. Body: { courseIds: string[] }
 *
 * Gated exactly like /api/evaluations: the source (Carta) is behind SUNet, so this
 * mirror stays behind the same login rather than becoming the one page that leaks it.
 */
export async function POST(request: Request) {
  const user = await getStanfordUser()
  if (!user && !isDevEvalsUnlocked()) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (user && !rateLimit(`classyears:${user.id}`, 60, 60 * 1000)) {
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

    const supabase = getServiceClient()
    const { data, error } = await supabase
      .from('course_class_years')
      .select('course_id, levels, total')
      .in('course_id', ids)

    if (error) throw error

    const byCourse: Record<string, ClassYearBreakdown | null> = {}
    // Every requested id gets a key, so the client can tell "no data" from "not asked"
    // and stop re-requesting a course Carta has nothing for.
    for (const id of ids) byCourse[id] = null
    for (const row of (data || []) as { course_id: string, levels: Record<string, number>, total: number }[]) {
      if (!row.course_id) continue
      byCourse[row.course_id] = { levels: row.levels || {}, total: row.total || 0 }
    }

    return NextResponse.json(byCourse, {
      // Stanford-only data — keep out of shared/CDN caches.
      headers: { 'Cache-Control': 'private, no-store' }
    })
  } catch (err) {
    console.error('Class years API error:', err)
    return NextResponse.json(
      { error: process.env.NODE_ENV === 'production' ? 'Failed to fetch class years' : (err instanceof Error ? err.message : 'Failed to fetch class years') },
      { status: 500 }
    )
  }
}
