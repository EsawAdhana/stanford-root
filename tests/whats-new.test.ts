import { describe, it, expect } from 'vitest'
import { isReturningVisitor, isSharedSchedulePath, onceForPageLoad } from '@/lib/whats-new'

describe('the what is new card skips only the shared schedule', () => {
  it('skips /s', () => {
    expect(isSharedSchedulePath('/s')).toBe(true)
    expect(isSharedSchedulePath('/s/')).toBe(true)
  })
  it('shows on pages that merely start with s', () => {
    for (const path of ['/schedule', '/STATS116', '/SOC1', '/', '/CS106B', null, undefined]) {
      expect(isSharedSchedulePath(path)).toBe(false)
    }
  })
})

describe('the what is new card only counts what the browser held at page load', () => {
  it('a first-time visitor with an empty cart and no session is not returning', () => {
    expect(isReturningVisitor({ savedClasses: 0, signedIn: false })).toBe(false)
  })
  it('saved classes at load or a session make a returning student', () => {
    expect(isReturningVisitor({ savedClasses: 1, signedIn: false })).toBe(true)
    expect(isReturningVisitor({ savedClasses: 0, signedIn: true })).toBe(true)
    expect(isReturningVisitor({ savedClasses: 4, signedIn: true })).toBe(true)
  })
  it('keeps the first answer when the cart changes later in the visit', async () => {
    // The first-timer bug: the check re-ran on every route change, so adding
    // a first class on /schedule and then opening a course page showed the card.
    let cartSize = 0
    let calls = 0
    const returning = onceForPageLoad(async () => {
      calls += 1
      return isReturningVisitor({ savedClasses: cartSize, signedIn: false })
    })
    expect(await returning()).toBe(false)
    cartSize = 1 // the visitor adds CS 106A
    expect(await returning()).toBe(false) // route change to the course page
    expect(await returning()).toBe(false)
    expect(calls).toBe(1)
  })
  it('shares one pending check between callers that arrive before it settles', async () => {
    let calls = 0
    const returning = onceForPageLoad(() => { calls += 1; return Promise.resolve(true) })
    const [a, b] = await Promise.all([returning(), returning()])
    expect([a, b, calls]).toEqual([true, true, 1])
  })
})
