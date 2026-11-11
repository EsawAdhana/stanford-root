import { describe, it, expect } from 'vitest'
import { authErrorParam, classifyCallback, redirectOriginFor, safeNextPath } from '@/lib/auth-callback'

// The callback reads NEXT_PUBLIC_SITE_URL directly, not SITE_URL, so moving
// SITE_URL's default to www changes nothing here. Production has the variable
// unset, so the request's own host is the allowed forwarded host.
describe('redirectOriginFor', () => {
  const prod = { nodeEnv: 'production', siteUrl: undefined }

  it('sends www sign-ins back to www', () => {
    expect(redirectOriginFor('https://www.stanfordroot.com/auth/callback?code=x', 'www.stanfordroot.com', prod))
      .toBe('https://www.stanfordroot.com')
  })

  it('sends an apex request back to the apex, which then redirects to www', () => {
    expect(redirectOriginFor('https://stanfordroot.com/auth/callback?code=x', 'stanfordroot.com', prod))
      .toBe('https://stanfordroot.com')
  })

  it('keeps a Vercel preview sign-in on the preview host', () => {
    const preview = 'stanford-root-git-fix-abc-esaw.vercel.app'
    expect(redirectOriginFor(`https://${preview}/auth/callback?code=x`, preview, prod)).toBe(`https://${preview}`)
  })

  it('returns localhost in dev regardless of forwarded host', () => {
    expect(redirectOriginFor('http://localhost:3000/auth/callback?code=x', 'evil.example.com', {
      nodeEnv: 'development',
      siteUrl: 'https://stanfordroot.com',
    })).toBe('http://localhost:3000')
  })

  it('returns localhost under next start with the local .env.local apex value', () => {
    expect(redirectOriginFor('http://localhost:3000/auth/callback?code=x', null, {
      nodeEnv: 'production',
      siteUrl: 'https://stanfordroot.com',
    })).toBe('http://localhost:3000')
  })

  it('ignores a forwarded host that does not match the request host', () => {
    expect(redirectOriginFor('https://www.stanfordroot.com/auth/callback?code=x', 'evil.example.com', prod))
      .toBe('https://www.stanfordroot.com')
    expect(redirectOriginFor('https://www.stanfordroot.com/auth/callback?code=x', 'evil.example.com, www.stanfordroot.com', prod))
      .toBe('https://www.stanfordroot.com')
  })

  it('only trusts the configured host when the variable is set', () => {
    const env = { nodeEnv: 'production', siteUrl: 'https://www.stanfordroot.com' }
    // Behind a proxy the request URL can carry an internal host.
    expect(redirectOriginFor('http://internal:3000/auth/callback', 'www.stanfordroot.com', env))
      .toBe('https://www.stanfordroot.com')
    expect(redirectOriginFor('http://internal:3000/auth/callback', 'stanfordroot.com', env))
      .toBe('http://internal:3000')
  })

  it('uses the first entry of a comma-separated forwarded host', () => {
    expect(redirectOriginFor('https://www.stanfordroot.com/auth/callback', ' www.stanfordroot.com , proxy.internal', prod))
      .toBe('https://www.stanfordroot.com')
  })
})

const params = (qs: string) => new URLSearchParams(qs)

describe('classifyCallback', () => {
  it('exchanges when Google sent a code', () => {
    expect(classifyCallback(params('code=abc123'))).toEqual({ kind: 'exchange', code: 'abc123' })
  })

  it('treats a cancel as a cancel, not a failure', () => {
    // This is the bug: pressing Cancel at the Google prompt used to show
    // "Sign-in failed. Could not complete sign-in. Please try again."
    expect(classifyCallback(params('error=access_denied'))).toEqual({ kind: 'cancelled' })
    expect(authErrorParam({ kind: 'cancelled' })).toBeNull()
  })

  it('keeps a real provider error, with its description', () => {
    expect(classifyCallback(params('error=admin_policy_enforced&error_description=Blocked+by+admin'))).toEqual({
      kind: 'provider_error',
      reason: 'admin_policy_enforced',
      description: 'Blocked by admin',
    })
  })

  it('prefers the error over a code when Google sends both', () => {
    expect(classifyCallback(params('error=access_denied&code=abc')).kind).toBe('cancelled')
  })

  it('reports a bare callback as missing_code rather than exchanging nothing', () => {
    expect(classifyCallback(params('')).kind).toBe('missing_code')
    expect(classifyCallback(params('next=%2Fschedule')).kind).toBe('missing_code')
    expect(authErrorParam({ kind: 'missing_code' })).toBe('missing_code')
  })

  it('does not treat an empty code as a code', () => {
    expect(classifyCallback(params('code=')).kind).toBe('missing_code')
  })
})

describe('safeNextPath', () => {
  it('keeps a same-origin path', () => {
    expect(safeNextPath('/schedule')).toBe('/schedule')
    // `/` is the catalog now, not a landing page that bounces, so it is kept.
    expect(safeNextPath('/')).toBe('/')
    expect(safeNextPath('/CS106B?q=abstractions')).toBe('/CS106B?q=abstractions')
  })

  it.each([
    ['//evil.example.com', '/'],
    ['https://evil.example.com', '/'],
    ['evil', '/'],
    [null, '/'],
  ])('rewrites %j to %s', (input, expected) => {
    expect(safeNextPath(input)).toBe(expected)
  })
})
