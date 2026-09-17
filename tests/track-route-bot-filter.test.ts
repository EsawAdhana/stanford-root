import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * The end-to-end guarantee behind the Sep 2026 traffic audit: a crawler that
 * runs JavaScript loads the analytics SDK and POSTs here exactly like a
 * browser, and this route is the last place it can be stopped before it becomes
 * a "visitor" on a dashboard.
 *
 * `isKnownBot` is unit-tested against the real user-agent corpus in
 * bot-agents.test.ts. This file tests the wiring: that a bot produces no insert
 * at all, that a student still does, and that the recorded user agent is
 * bounded.
 */

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key'

// Every row the route tried to write.
const inserted: Record<string, unknown>[] = []
// Set by a test to make the first insert fail, simulating the deploy window
// where the code knows about `user_agent` but the migration has not run.
let failInsertsWithUserAgent = false

vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({ getAll: () => [], set: () => {} }),
}))

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: () => Promise.resolve({ data: { user: null } }) },
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        if (failInsertsWithUserAgent && 'user_agent' in row) {
          return Promise.resolve({
            error: { message: "column analytics_events.user_agent does not exist" },
          })
        }
        inserted.push(row)
        return Promise.resolve({ error: null })
      },
    }),
  }),
}))

const { POST } = await import('@/app/api/track/route')

const post = (userAgent: string | null, body: unknown = { event: 'page_viewed', path: '/CS106B' }) =>
  POST(
    new Request('http://localhost/api/track', {
      method: 'POST',
      headers: userAgent === null ? {} : { 'user-agent': userAgent },
      body: JSON.stringify(body),
    }),
  )

const STUDENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36'

beforeEach(() => {
  inserted.length = 0
  failInsertsWithUserAgent = false
})

describe('a crawler never becomes a visitor', () => {
  // The agents that were actually minting sessions, from Vercel's request log.
  const bots = [
    'AIWebIndex/2.0 (+https://lyrenth.com/bot; AI-readable web index)',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36 (compatible; meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler))',
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Amazonbot/0.1; +https://developer.amazon.com/support/amazonbot) Chrome/119.0.6045.214 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/151.0.0.0 Safari/537.36',
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  ]

  it.each(bots)('writes nothing for %s', async (ua) => {
    const res = await post(ua)
    expect(inserted).toHaveLength(0)
    // Silent, so a crawler cannot tell it is being filtered and the client
    // contract is unchanged.
    expect(res.status).toBe(204)
  })

  it('drops the bot event before the rate limiter, not after', async () => {
    // 200 bot posts in a row must all be dropped for the same reason. If the
    // order were reversed the limiter would be spending its budget on crawlers
    // and could start rejecting the students sharing a NAT with them.
    for (let i = 0; i < 200; i++) await post('AIWebIndex/2.0 (+https://lyrenth.com/bot)')
    expect(inserted).toHaveLength(0)
    const res = await post(STUDENT)
    expect(res.status).toBe(204)
    expect(inserted).toHaveLength(1)
  })
})

describe('a real student is still counted', () => {
  it('inserts the event and records the user agent', async () => {
    await post(STUDENT)
    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toMatchObject({
      event: 'page_viewed',
      path: '/CS106B',
      user_agent: STUDENT,
    })
  })

  it('still counts a request with no user agent at all', async () => {
    // Absence is not evidence of a bot: privacy extensions strip it, and so
    // does Google's renderer. Under-counting real students would be the same
    // class of bug in the other direction.
    await post(null)
    expect(inserted).toHaveLength(1)
    expect(inserted[0].user_agent).toBeNull()
  })

  it('truncates an overlong user agent instead of rejecting the event', async () => {
    const huge = `Mozilla/5.0 (Macintosh) Chrome/152.0.0.0 ${'x'.repeat(4000)}`
    await post(huge)
    expect(inserted).toHaveLength(1)
    expect((inserted[0].user_agent as string).length).toBe(256)
  })

  it('keeps counting if the deploy lands before the user_agent migration', async () => {
    // The trap this guards: the route swallows errors on purpose, so an unknown
    // column would silently take analytics to zero with nothing in the logs.
    failInsertsWithUserAgent = true
    await post(STUDENT)
    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toMatchObject({ event: 'page_viewed', path: '/CS106B' })
    expect(inserted[0]).not.toHaveProperty('user_agent')
  })

  it('still rejects an event name that is not on the allowlist', async () => {
    // The pre-existing boundary must survive the new one.
    await post(STUDENT, { event: 'not_a_real_event', path: '/' })
    expect(inserted).toHaveLength(0)
  })
})
