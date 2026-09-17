import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { ALLOWED_EVENTS } from '@/lib/analytics-events'
import { isKnownBot } from '@/lib/bot-agents'
import { rateLimit, getClientIp } from '@/lib/rate-limit'

const MAX_PROPS_BYTES = 2000
const MAX_PATH_LENGTH = 512
const MAX_PROP_KEYS = 20
const MAX_PROP_STRING_LENGTH = 256
const MAX_USER_AGENT_LENGTH = 256

/** Keep only primitive prop values (string/number/boolean) to limit PII and
 *  JSON bloat from arbitrary nested payloads. */
function sanitizeProps(props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  let keys = 0
  for (const [k, v] of Object.entries(props)) {
    if (keys >= MAX_PROP_KEYS) break
    if (typeof v === 'string') {
      out[k] = v.slice(0, MAX_PROP_STRING_LENGTH)
      keys++
    } else if (typeof v === 'number' || typeof v === 'boolean') {
      out[k] = v
      keys++
    }
  }
  return out
}

/** POST /api/track — records a first-party analytics event. Anonymous requests
 *  are allowed; user_id is derived server-side from the auth cookie (never trusted
 *  from the client). Always returns quickly and never leaks errors. */
export async function POST(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
  if (!url || !key) {
    // Analytics is best-effort — never error the client.
    return new NextResponse(null, { status: 204 })
  }

  // Crawlers that execute JavaScript load this SDK and fire events like any
  // browser, so the only place to stop them counting is here. Dropped rather
  // than flagged: every consumer of this table (the dashboards, Human
  // Behavior) would otherwise have to remember to filter, and the Sep 2026
  // audit found that none of them did. Over Sep 10-17 this discards roughly
  // 8-9% of events and about 64% of the *session* count, because a crawler
  // mints one throwaway session per page and a student reuses one all week.
  //
  // Page delivery is unaffected: search engines still get served, they just
  // stop being reported as visitors. See lib/bot-agents for that split.
  const userAgent = request.headers.get('user-agent')
  if (isKnownBot(userAgent)) {
    return new NextResponse(null, { status: 204 })
  }

  // Best-effort per-IP throttle to blunt write spam. Stays silent (204) so the
  // client experience is never affected.
  if (!rateLimit(`track:${getClientIp(request)}`, 120, 60 * 1000)) {
    return new NextResponse(null, { status: 204 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return new NextResponse(null, { status: 204 })
  }

  const { event, props, session_id, path } = (body ?? {}) as {
    event?: unknown
    props?: unknown
    session_id?: unknown
    path?: unknown
  }

  if (typeof event !== 'string' || !ALLOWED_EVENTS.has(event)) {
    return new NextResponse(null, { status: 204 })
  }

  let safeProps: Record<string, unknown> = {}
  if (props && typeof props === 'object' && !Array.isArray(props)) {
    try {
      if (JSON.stringify(props).length <= MAX_PROPS_BYTES) {
        safeProps = sanitizeProps(props as Record<string, unknown>)
      }
    } catch {
      safeProps = {}
    }
  }

  const sessionId = typeof session_id === 'string' ? session_id.slice(0, 64) : null
  const pagePath = typeof path === 'string' ? path.slice(0, MAX_PATH_LENGTH) : null

  try {
    const cookieStore = await cookies()
    const supabase = createServerClient(url, key, {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Ignored when called from a Route Handler
          }
        }
      }
    })

    const { data: { user } } = await supabase.auth.getUser()

    const row = {
      event,
      props: safeProps,
      session_id: sessionId,
      user_id: user?.id ?? null,
      path: pagePath,
    }
    // Only ever a non-bot agent by this point. Stored so a future traffic audit
    // is a WHERE clause instead of a behavioural inference.
    const agent = userAgent ? userAgent.slice(0, MAX_USER_AGENT_LENGTH) : null

    const { error } = await supabase
      .from('analytics_events')
      .insert({ ...row, user_agent: agent })

    // `user_agent` arrived in migration 20260917. If this deploy reaches
    // production ahead of that migration, every insert above fails on the
    // unknown column — and because this route swallows errors by design, it
    // would take analytics to zero with nothing in the logs. Retrying without
    // the column keeps counting through that window; it costs one extra
    // round trip only while the schema is behind.
    if (error) {
      await supabase.from('analytics_events').insert(row)
    }
  } catch {
    // Swallow — analytics must never affect the user experience.
  }

  return new NextResponse(null, { status: 204 })
}
