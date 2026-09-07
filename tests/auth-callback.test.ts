import { describe, it, expect } from 'vitest'
import { authErrorParam, classifyCallback, safeNextPath } from '@/lib/auth-callback'

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
