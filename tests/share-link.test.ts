import { describe, expect, it } from 'vitest'
import { MAX_SHARED_COURSES, displayCode, readShareLink, shareLinkPath, type SharedEntry } from '@/lib/share-link'

/** What the share page reads back from a link the schedule page built. */
function roundTrip(term: string, entries: SharedEntry[]) {
  const path = shareLinkPath(term, entries)
  if (!path) return null
  return readShareLink(new URL(path, 'https://stanfordroot.com').searchParams)
}

const read = (query: string) => readShareLink(new URLSearchParams(query))

describe('share links carry the schedule', () => {
  it('round-trips courses, class numbers, and unit picks', () => {
    const entries: SharedEntry[] = [
      { id: 'CS229', selectedSectionIds: [6454] },
      { id: 'CS161', selectedSectionIds: [1933, 1940], selectedUnits: 4 },
      { id: 'CS224N' },
    ]
    expect(roundTrip('Winter 2027', entries)).toEqual({ term: 'Winter 2027', entries, skipped: 0 })
  })

  it('builds a short, readable link', () => {
    expect(shareLinkPath('Winter 2027', [{ id: 'CS229', selectedSectionIds: [6454] }, { id: 'CS161' }]))
      .toBe('/s?t=W27&c=CS229.6454,CS161')
  })

  it('survives the & in MS&E', () => {
    const path = shareLinkPath('Autumn 2026', [{ id: 'MS&E120' }, { id: 'CS106A' }])!
    expect(path).toBe('/s?t=F26&c=MS%26E120,CS106A')
    expect(roundTrip('Autumn 2026', [{ id: 'MS&E120' }, { id: 'CS106A' }])?.entries.map(e => e.id)).toEqual(['MS&E120', 'CS106A'])
  })

  it('never uses a `code` parameter, which the middleware hands to the sign-in callback', () => {
    const path = shareLinkPath('Spring 2027', [{ id: 'CS1' }])!
    expect(new URL(path, 'https://x.test').searchParams.has('code')).toBe(false)
  })

  it('handles every season', () => {
    for (const term of ['Autumn 2026', 'Winter 2027', 'Spring 2027', 'Summer 2027']) {
      expect(roundTrip(term, [{ id: 'CS1' }])?.term).toBe(term)
    }
  })

  it('drops a fractional unit pick rather than writing one the reader rejects', () => {
    expect(roundTrip('Winter 2027', [{ id: 'CS1', selectedUnits: 2.5 }])?.entries).toEqual([{ id: 'CS1' }])
  })

  it('makes no link for an empty term or an unparseable one', () => {
    expect(shareLinkPath('Winter 2027', [])).toBeNull()
    expect(shareLinkPath('Someday', [{ id: 'CS1' }])).toBeNull()
  })
})

describe('reading a link someone could have mangled', () => {
  it('needs a term and at least one course', () => {
    expect(read('')).toBeNull()
    expect(read('t=W27')).toBeNull()
    expect(read('c=CS229')).toBeNull()
    expect(read('t=X99&c=CS229')).toBeNull()
    expect(read('t=W27&c=')).toBeNull()
  })

  it('skips tokens that do not parse and counts them', () => {
    const shared = read('t=W27&c=CS229.6454,<script>,cs161,CS224N.12a,,CS107')
    expect(shared?.entries.map(e => e.id)).toEqual(['CS229', 'CS107'])
    expect(shared?.skipped).toBe(3)
  })

  it('keeps the first of a repeated course', () => {
    expect(read('t=W27&c=CS229.1,CS229.2')?.entries).toEqual([{ id: 'CS229', selectedSectionIds: [1] }])
  })

  it('caps the number of courses it reads', () => {
    const many = Array.from({ length: 200 }, (_, i) => `CS${i + 1}`).join(',')
    expect(read(`t=W27&c=${many}`)?.entries).toHaveLength(MAX_SHARED_COURSES)
  })

  it('refuses an absurdly long parameter outright', () => {
    expect(read(`t=W27&c=CS1.${'1-'.repeat(2000)}1`)).toBeNull()
  })

  it('rejects ids and numbers outside what the catalog uses', () => {
    expect(read('t=W27&c=CS229.12345678')?.entries).toBeUndefined()
    expect(read('t=W27&c=CS229~123')).toBeNull()
    expect(read('t=W27&c=C')).toBeNull()
  })
})

describe('displayCode', () => {
  it('splits a catalog id for a link preview', () => {
    expect(displayCode('CS224N')).toBe('CS 224N')
    expect(displayCode('MS&E120')).toBe('MS&E 120')
    expect(displayCode('WEIRD')).toBe('WEIRD')
  })
})
