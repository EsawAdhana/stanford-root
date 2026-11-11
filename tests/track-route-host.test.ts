import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * Dev servers and Vercel previews talk to the production Supabase project, so
 * /api/track records an event only when the request reached the live site.
 * Everyone else still gets the same silent 204.
 */

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key'

const inserted: Record<string, unknown>[] = []

vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({ getAll: () => [], set: () => {} }),
}))

// The public-key client only reads the signed-in user. Any write through it
// is a regression: the public key no longer has INSERT on analytics_events.
const publicKeyWrites: unknown[] = []
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: () => Promise.resolve({ data: { user: null } }) },
    from: (table: string) => {
      publicKeyWrites.push(table)
      return { insert: () => Promise.resolve({ error: { message: 'permission denied' } }) }
    },
  }),
}))

// Rows are written with the server's key.
vi.mock('@/lib/supabase-admin', () => ({
  getServiceClient: () => ({
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        inserted.push(row)
        return Promise.resolve({ error: null })
      },
    }),
  }),
}))

const { POST } = await import('@/app/api/track/route')
const { requestHost } = await import('@/lib/production-host')

const STUDENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36'

const post = (url: string, headers: Record<string, string> = {}) =>
  POST(
    new Request(url, {
      method: 'POST',
      headers: { 'user-agent': STUDENT, ...headers },
      body: JSON.stringify({ event: 'app_crashed', path: '/CS106B', props: { message: 'x' } }),
    }),
  )

beforeEach(() => {
  inserted.length = 0
  publicKeyWrites.length = 0
})

describe('events are recorded only from the live site', () => {
  it.each([
    'https://www.stanfordroot.com/api/track',
    'https://stanfordroot.com/api/track',
    'https://WWW.StanfordRoot.com:443/api/track',
  ])('records %s', async (url) => {
    const res = await post(url)
    expect(res.status).toBe(204)
    expect(inserted).toHaveLength(1)
  })

  it.each([
    'http://localhost:3000/api/track',
    'http://127.0.0.1:3000/api/track',
    'http://[::1]:3000/api/track',
    'http://root.localhost:3000/api/track',
    'https://stanford-root-git-fix-x-esaw.vercel.app/api/track',
    'https://stanford-root.vercel.app/api/track',
    'https://www.stanfordroot.com.evil.example/api/track',
    'https://evilstanfordroot.com/api/track',
    'https://staging.stanfordroot.com/api/track',
  ])('writes nothing for %s and still answers 204', async (url) => {
    const res = await post(url)
    expect(res.status).toBe(204)
    expect(inserted).toHaveLength(0)
  })

  it('goes by the host Vercel forwards, not the internal URL', async () => {
    await post('http://localhost:3000/api/track', { 'x-forwarded-host': 'www.stanfordroot.com' })
    expect(inserted).toHaveLength(1)
    inserted.length = 0
    await post('https://www.stanfordroot.com/api/track', { 'x-forwarded-host': 'my-branch.vercel.app' })
    expect(inserted).toHaveLength(0)
  })

  it('takes the first of several forwarded hosts', async () => {
    await post('http://localhost:3000/api/track', { 'x-forwarded-host': 'localhost:3000, www.stanfordroot.com' })
    expect(inserted).toHaveLength(0)
  })
})

describe('requestHost', () => {
  const host = (url: string, headers: Record<string, string> = {}) => requestHost(new Request(url, { headers }))

  it('lowercases and drops the port and a trailing dot', () => {
    expect(host('https://WWW.StanfordRoot.COM:8443/x')).toBe('www.stanfordroot.com')
    expect(host('https://x.test/', { 'x-forwarded-host': 'www.stanfordroot.com.' })).toBe('www.stanfordroot.com')
  })

  it('keeps an IPv6 host recognisable rather than mangling it into a match', () => {
    expect(host('http://[::1]:3000/x')).toBe('[::1]')
  })
})

describe('analytics rows are written with the server key', () => {
  it('never writes through the public-key client', async () => {
    const { POST: post2 } = await import('@/app/api/track/route')
    await post2(new Request('https://www.stanfordroot.com/api/track', {
      method: 'POST',
      headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36' },
      body: JSON.stringify({ event: 'page_viewed', path: '/CS106B' }),
    }))
    expect(inserted).toHaveLength(1)
    expect(publicKeyWrites).toHaveLength(0)
  })
})
