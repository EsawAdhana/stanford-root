import { describe, expect, it } from 'vitest'
import { MAX_SHARED_COURSES, displayCode, missingSections, readShareLink, shareLinkNotice, shareLinkPath, type SharedEntry } from '@/lib/share-link'

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
    expect(roundTrip('Winter 2027', entries)).toEqual({ term: 'Winter 2027', entries, skipped: 0, overLimit: 0 })
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

describe('the notice for what a link holds but the page does not show', () => {
  const F = 'Autumn 2026'
  // CS 106A's Autumn 2026 lecture and a discussion, from the catalog dump.
  const catalog = [
    { id: 'CS106A', subject: 'CS', code: '106A', sections: [{ term: F, classId: 1801 }, { term: F, classId: 1802 }, { term: 'Spring 2027', classId: 99999 }] },
    { id: 'MATH51', subject: 'MATH', code: '51', sections: [{ term: F, classId: 6636 }] },
  ]
  const loaded = () => true

  it('says when a picked section no longer exists', () => {
    // 99999 is a Spring class number: class numbers belong to one term.
    const shared = read('t=F26&c=CS106A.99999~4,MATH51.6636')!
    const missing = missingSections(shared, catalog, loaded)
    expect(missing).toEqual([{ code: 'CS 106A', missing: 1, noneLeft: true }])
    expect(shareLinkNotice({ unfound: 0, overLimit: 0 }, missing))
      .toBe('1 section in this link no longer exists, so CS 106A shows its default section instead.')
  })

  it('says a class is shown without the sections that are gone', () => {
    const shared = read('t=F26&c=CS106A.1801-5-6')!
    expect(shareLinkNotice({ unfound: 0, overLimit: 0 }, missingSections(shared, catalog, loaded)))
      .toBe('2 sections in this link no longer exist, so CS 106A is shown without them.')
  })

  it('does not judge sections before they have loaded', () => {
    const shared = read('t=F26&c=CS106A.99999')!
    expect(missingSections(shared, catalog, () => false)).toEqual([])
  })

  it('counts classes past the limit', () => {
    const ids = Array.from({ length: MAX_SHARED_COURSES + 3 }, (_, i) => `CS${i + 1}`).join(',')
    const shared = read(`t=W27&c=${ids}`)!
    expect(shared.overLimit).toBe(3)
    expect(shareLinkNotice({ unfound: 0, overLimit: shared.overLimit }, []))
      .toBe('A shared schedule shows up to 40 classes, so the last 3 classes in this link aren\'t shown.')
    expect(shareLinkNotice({ unfound: 0, overLimit: 1 }, []))
      .toBe('A shared schedule shows up to 40 classes, so the last class in this link isn\'t shown.')
  })

  it('keeps the unfound-class line and joins the lines', () => {
    expect(shareLinkNotice({ unfound: 2, overLimit: 0 }, [{ code: 'CS 106A', missing: 1, noneLeft: true }]))
      .toBe("2 classes in this link couldn't be found in the catalog, so they aren't shown. 1 section in this link no longer exists, so CS 106A shows its default section instead.")
    expect(shareLinkNotice({ unfound: 0, overLimit: 0 }, [])).toBe('')
    expect(shareLinkNotice({ unfound: 0, overLimit: 0 }, [
      { code: 'CS 106A', missing: 1, noneLeft: true },
      { code: 'CS 107', missing: 2, noneLeft: false },
      { code: 'MATH 51', missing: 1, noneLeft: false },
    ])).toBe('4 sections in this link no longer exist, so CS 106A shows its default section instead, and CS 107 and MATH 51 are shown without the missing ones.')
    expect(shareLinkNotice({ unfound: 0, overLimit: 0 }, [
      { code: 'CS 106A', missing: 1, noneLeft: true },
      { code: 'CS 107', missing: 1, noneLeft: true },
    ])).toBe('2 sections in this link no longer exist, so CS 106A and CS 107 show their default section instead.')
  })
})

describe('displayCode', () => {
  it('splits a catalog id for a link preview', () => {
    expect(displayCode('CS224N')).toBe('CS 224N')
    expect(displayCode('MS&E120')).toBe('MS&E 120')
    expect(displayCode('WEIRD')).toBe('WEIRD')
  })
})
