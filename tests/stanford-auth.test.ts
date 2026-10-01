import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * getStanfordUser gates the Stanford-only routes (evaluations, instructor and
 * class-year data). It accepts a browser session cookie or, for apps connected
 * through Stanford Root's OAuth server, a bearer token. These cases try to get
 * through the gate without a valid Stanford identity.
 */

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key'

let requestHeaders: Record<string, string> = {}
// What Supabase says each bearer token belongs to; anything absent is invalid.
let tokenOwners: Record<string, string> = {}
// The email of the session cookie's user, or null for no cookie session.
let cookieEmail: string | null = null

vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(new Headers(requestHeaders)),
  cookies: () => Promise.resolve({ getAll: () => [], set: () => {} }),
}))

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: {
      getUser: (jwt?: string) => {
        if (jwt === undefined) {
          return Promise.resolve({ data: { user: cookieEmail ? { id: 'cookie-user', email: cookieEmail } : null } })
        }
        const email = tokenOwners[jwt]
        return Promise.resolve({ data: { user: email ? { id: `token-${jwt}`, email } : null } })
      },
    },
  }),
}))

const { getStanfordUser, bearerToken } = await import('@/lib/stanford-auth')

beforeEach(() => {
  requestHeaders = {}
  tokenOwners = {}
  cookieEmail = null
})

describe('getStanfordUser', () => {
  it('accepts a bearer token that belongs to a Stanford account', async () => {
    tokenOwners = { good: 'student@stanford.edu' }
    requestHeaders = { authorization: 'Bearer good' }
    expect((await getStanfordUser())?.id).toBe('token-good')
  })

  it('rejects a valid bearer token for a non-Stanford account', async () => {
    tokenOwners = { gmail: 'someone@gmail.com' }
    requestHeaders = { authorization: 'Bearer gmail' }
    expect(await getStanfordUser()).toBeNull()
  })

  it('rejects look-alike domains', async () => {
    tokenOwners = {
      a: 'x@stanford.edu.evil.com',
      b: 'x@notstanford.edu',
      c: 'x@stanford.edu ',
    }
    for (const token of Object.keys(tokenOwners)) {
      requestHeaders = { authorization: `Bearer ${token}` }
      expect(await getStanfordUser()).toBeNull()
    }
  })

  it('does not fall back to a Stanford cookie when the bearer token is invalid', async () => {
    cookieEmail = 'student@stanford.edu'
    requestHeaders = { authorization: 'Bearer revoked' }
    expect(await getStanfordUser()).toBeNull()
  })

  it('still accepts a Stanford browser session with no Authorization header', async () => {
    cookieEmail = 'student@stanford.edu'
    expect((await getStanfordUser())?.id).toBe('cookie-user')
  })

  it('ignores a non-bearer Authorization header and uses the cookie', async () => {
    cookieEmail = 'student@stanford.edu'
    requestHeaders = { authorization: 'Basic dXNlcjpwYXNz' }
    expect((await getStanfordUser())?.id).toBe('cookie-user')
  })
})

describe('bearerToken', () => {
  it.each([
    ['Bearer abc.def.ghi', 'abc.def.ghi'],
    ['bearer abc', 'abc'],
    ['Bearer   abc  ', 'abc'],
    ['Bearer', null],
    ['Bearer ', null],
    ['Bearer a b', null],
    ['Basic abc', null],
    ['', null],
  ])('%j -> %j', (header, expected) => {
    expect(bearerToken(header)).toBe(expected)
  })

  it('handles a missing header', () => {
    expect(bearerToken(null)).toBeNull()
  })
})
