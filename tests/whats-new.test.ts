import { describe, it, expect } from 'vitest'
import { isSharedSchedulePath } from '@/lib/whats-new'

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
