import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const resendApiKey = process.env.RESEND_API_KEY || ''
const feedbackEmailTo = process.env.FEEDBACK_EMAIL_TO || ''
const fromEmail = process.env.RESEND_FROM_EMAIL || 'CHANGED <onboarding@resend.dev>'

const MAX_TEXT_LENGTH = 2000
const ALLOWED_TYPES = ['comment', 'request', 'general'] as const

export async function POST (request: Request) {
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json(
      { error: 'Feedback is not configured' },
      { status: 503 }
    )
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
  if (text.length > MAX_TEXT_LENGTH) {
    return NextResponse.json(
      { error: `Text must be at most ${MAX_TEXT_LENGTH} characters` },
      { status: 400 }
    )
  }

  const type = body.type && ALLOWED_TYPES.includes(body.type as typeof ALLOWED_TYPES[number])
    ? body.type
    : 'general'

  const supabase = createClient(supabaseUrl, supabaseAnonKey)
  const { error: err } = await supabase
    .from('app_feedback')
    .insert({ text, type })

  if (err) {
    console.error('Feedback insert error:', err)
    return NextResponse.json(
      { error: 'Failed to save feedback' },
      { status: 500 }
    )
  }

  if (resendApiKey && feedbackEmailTo) {
    try {
      const resend = new Resend(resendApiKey)
      await resend.emails.send({
        from: fromEmail,
        to: feedbackEmailTo,
        subject: `[CHANGED] New feedback: ${type}`,
        text: `Type: ${type}\n\n${text}`
      })
    } catch (emailErr) {
      console.error('Feedback email send error:', emailErr)
    }
  }

  return NextResponse.json({ ok: true })
}
