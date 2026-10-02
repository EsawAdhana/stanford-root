import { after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'

/**
 * Saves anonymous feedback and emails the maintainer, for POST /api/feedback
 * and the hosted MCP server's send_feedback. Callers validate and rate limit.
 */

export const MAX_FEEDBACK_LENGTH = 2000
export const FEEDBACK_TYPES = ['feedback', 'request'] as const
export type FeedbackType = typeof FEEDBACK_TYPES[number]

export async function submitFeedback(text: string, typeInput: FeedbackType): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
  if (!supabaseUrl || !supabaseKey) return { ok: false, error: 'Feedback is not configured' }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  })
  // Map API types to DB schema: 'feedback' -> 'general', 'request' -> 'request'
  const type = typeInput === 'feedback' ? 'general' : typeInput
  const { error: err } = await supabase.from('app_feedback').insert({ text, type })
  if (err) {
    console.error('Feedback insert error:', err)
    return { ok: false, error: process.env.NODE_ENV === 'production' ? 'Failed to save feedback' : err.message }
  }

  // Send the notification email after responding so request latency isn't tied to the email provider
  const resendApiKey = process.env.RESEND_API_KEY || ''
  if (resendApiKey) {
    after(async () => {
      try {
        const resend = new Resend(resendApiKey)
        const { error: emailErr } = await resend.emails.send({
          from: process.env.RESEND_FROM_EMAIL || 'Stanford Root <onboarding@resend.dev>',
          to: process.env.FEEDBACK_EMAIL_TO || 'adhanaesaw@gmail.com',
          subject: `[Stanford Root] New feedback: ${typeInput}`,
          text: `Type: ${typeInput}\nFrom: Anonymous\n\n${text}`
        })
        if (emailErr) console.error('Feedback email send error:', emailErr)
      } catch (emailErr) {
        console.error('Feedback email send error:', emailErr)
      }
    })
  } else {
    console.warn('Feedback saved but email skipped: RESEND_API_KEY is not set')
  }
  return { ok: true }
}
