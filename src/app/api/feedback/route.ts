import { NextResponse } from 'next/server'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { FEEDBACK_TYPES, MAX_FEEDBACK_LENGTH, submitFeedback, type FeedbackType } from '@/lib/feedback'

export async function POST (request: Request) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)) {
    return NextResponse.json(
      { error: 'Feedback is not configured' },
      { status: 503 }
    )
  }

  if (!rateLimit(`feedback:${getClientIp(request)}`, 5, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 })
  }

  let body: { text?: string; type?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const text = typeof body.text === 'string' ? body.text.trim() : ''
  if (!text) {
    return NextResponse.json({ error: 'Text is required' }, { status: 400 })
  }
  if (text.length > MAX_FEEDBACK_LENGTH) {
    return NextResponse.json(
      { error: `Text must be at most ${MAX_FEEDBACK_LENGTH} characters` },
      { status: 400 }
    )
  }

  const typeInput: FeedbackType = body.type && FEEDBACK_TYPES.includes(body.type as FeedbackType)
    ? body.type as FeedbackType
    : 'feedback'

  const result = await submitFeedback(text, typeInput)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
