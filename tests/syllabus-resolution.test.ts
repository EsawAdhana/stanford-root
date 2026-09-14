import { describe, it, expect } from 'vitest'
import {
  resolveSyllabus,
  syllabusCourseKey,
  syllabusIdentifier,
  type SyllabusIndex,
} from '@/lib/syllabus'
import { codeToTerm, termToCode } from '@/lib/terms'

/**
 * These exist because the failure this feature fixes is invisible from the
 * client: syllabus.stanford.edu redirects every id pair to WebAuth, so a link
 * to a syllabus that was never posted, and a link whose two ids do not match
 * the cross-listing, both look exactly like a working one until after login.
 * The cases below are the ones that would put a dead link back on the page.
 */

const index: SyllabusIndex = {
  generatedAt: '2026-09-13T00:00:00.000Z',
  terms: ['W25', 'Sp25', 'F25', 'W26', 'F26'],
  termTitles: {
    W25: 'Winter 2025',
    Sp25: 'Spring 2025',
    F25: 'Fall 2025',
    W26: 'Winter 2026',
    F26: 'Fall 2026',
  },
  courses: {
    'CS-106A': { F25: [{ s: '01' }], F26: [{ s: '02' }, { s: '04' }] },
    'MATH-51': { W25: [{ s: '01' }], F25: [{ s: '05' }] },
    // Cross-listed: the file is owned by CSRE 10, viewed as AFRICAAM 10.
    'AFRICAAM-10': { F26: [{ s: '01', o: 'CSRE-10-01' }] },
    'CSRE-10': { F26: [{ s: '01' }] },
    'PSYCH-1': { F26: [{ s: '01', v: 'C' }] },
    'ANTHRO-2': { W25: [{ s: '01', v: 'C' }], F25: [{ s: '01' }] },
    'MGTECON-610': { F26: [{ s: '01', v: 'P', one: 1 }] },
    'PUBLPOL-318': { F26: [{ s: '01', v: 'P', o: 'LAW-7161-01' }] },
    // Has a file but is not published: the viewer opens empty (AA 101).
    'AA-101': { F26: [{ s: '01', p: 0 }] },
    'AA-190': { F26: [{ s: '01', p: 0 }], F25: [{ s: '01' }] },
  },
}

describe('term code conversion', () => {
  it('round-trips every season, using F for Autumn like the syllabus service', () => {
    expect(termToCode('Autumn 2026')).toBe('F26')
    expect(termToCode('Winter 2027')).toBe('W27')
    expect(termToCode('Spring 2027')).toBe('Sp27')
    expect(termToCode('Summer 2027')).toBe('Su27')
    expect(codeToTerm('F26')).toBe('Autumn 2026')
    expect(codeToTerm('Sp27')).toBe('Spring 2027')
  })

  it('rejects junk rather than emitting a half-formed code', () => {
    expect(termToCode('')).toBe('')
    expect(termToCode('Quarter 2026')).toBe('')
    expect(codeToTerm('X26')).toBe('')
    expect(codeToTerm('F2026')).toBe('')
  })
})

describe('identifier construction', () => {
  it('matches the form the syllabus service addresses sections by', () => {
    expect(syllabusIdentifier('CS', '106A', 'Autumn 2026', '02')).toBe('F26-CS-106A-02')
    expect(syllabusCourseKey('cs', '106a')).toBe('CS-106A')
    expect(syllabusCourseKey('MS&E', '180')).toBe('MS&E-180')
  })

  it('returns empty rather than a guessable id when a part is missing', () => {
    expect(syllabusIdentifier('CS', '106A', 'Autumn 2026', '')).toBe('')
    expect(syllabusIdentifier('CS', '', 'Autumn 2026', '01')).toBe('')
    expect(syllabusIdentifier('CS', '106A', 'nonsense', '01')).toBe('')
  })
})

describe('resolveSyllabus', () => {
  it('links the selected term when the catalog section is published', () => {
    const r = resolveSyllabus(index, 'CS', '106A', 'Autumn 2026', ['02', '03'])
    expect(r).toEqual({
      status: 'current',
      term: 'Autumn 2026',
      url: 'https://syllabus.stanford.edu/syllabus/doWebAuth/F26-CS-106A-02/F26-CS-106A-02',
    })
  })

  it('sends the OWNING id first for a cross-listing, which is what the viewer needs', () => {
    // Passing F26-AFRICAAM-10-01 twice renders the viewer with no document.
    const r = resolveSyllabus(index, 'AFRICAAM', '10', 'Autumn 2026', ['01'])
    expect('url' in r && r.url).toBe(
      'https://syllabus.stanford.edu/syllabus/doWebAuth/F26-CSRE-10-01/F26-AFRICAAM-10-01'
    )
  })

  it('leaves a self-owned listing with the same id on both sides', () => {
    const r = resolveSyllabus(index, 'CSRE', '10', 'Autumn 2026', ['01'])
    expect('url' in r && r.url).toBe(
      'https://syllabus.stanford.edu/syllabus/doWebAuth/F26-CSRE-10-01/F26-CSRE-10-01'
    )
  })

  it('uses the download endpoint for a PUBLIC single-file syllabus, as the service does', () => {
    const r = resolveSyllabus(index, 'MGTECON', '610', 'Autumn 2026', ['01'])
    expect('url' in r && r.url).toBe(
      'https://syllabus.stanford.edu/syllabus/downloadSyllabus?courseId=F26-MGTECON-610-01'
    )
  })

  it('uses the unauthenticated viewer for a PUBLIC multi-file syllabus, owner first', () => {
    const r = resolveSyllabus(index, 'PUBLPOL', '318', 'Autumn 2026', ['01'])
    expect('url' in r && r.url).toBe(
      'https://syllabus.stanford.edu/syllabus/#/viewSyllabus/F26-LAW-7161-01/F26-PUBLPOL-318-01'
    )
  })

  it('does not assume section 01 (the old bug: 1,294 Autumn 2026 rows are sections 02-08)', () => {
    const r = resolveSyllabus(index, 'CS', '106A', 'Autumn 2026', ['01'])
    expect(r.status).toBe('current')
    expect('url' in r && r.url).toContain('F26-CS-106A-02')
  })

  it('prefers the catalog section order when several are published', () => {
    const r = resolveSyllabus(index, 'CS', '106A', 'Autumn 2026', ['04', '02'])
    expect('url' in r && r.url).toContain('F26-CS-106A-04')
  })

  it('falls back to the most recent earlier term, naming it', () => {
    const r = resolveSyllabus(index, 'MATH', '51', 'Winter 2027', ['01'])
    expect(r).toEqual({
      status: 'fallback',
      term: 'Autumn 2025',
      url: 'https://syllabus.stanford.edu/syllabus/doWebAuth/F25-MATH-51-05/F25-MATH-51-05',
    })
  })

  it('never advertises a newer term as the fallback for an older one', () => {
    const r = resolveSyllabus(index, 'CS', '106A', 'Winter 2025', ['01'])
    expect(r).toEqual({ status: 'none' })
  })

  it('treats enrolled-only syllabi as unavailable, not as a link', () => {
    const r = resolveSyllabus(index, 'PSYCH', '1', 'Autumn 2026', ['01'])
    expect(r).toEqual({ status: 'restricted', term: 'Autumn 2026' })
  })

  it('prefers an openable older syllabus over a restricted newer one', () => {
    const r = resolveSyllabus(index, 'ANTHRO', '2', 'Winter 2026', ['01'])
    expect(r.status).toBe('fallback')
    expect('term' in r && r.term).toBe('Autumn 2025')
  })

  it('reports nothing for an unindexed course, and for a missing index', () => {
    expect(resolveSyllabus(index, 'CS', '999X', 'Autumn 2026', ['01'])).toEqual({ status: 'none' })
    expect(resolveSyllabus(null, 'CS', '106A', 'Autumn 2026', ['01'])).toEqual({ status: 'none' })
  })

  it('still resolves when the catalog has no section numbers at all', () => {
    const r = resolveSyllabus(index, 'CS', '106A', 'Autumn 2026', [])
    expect(r.status).toBe('current')
    expect('url' in r && r.url).toContain('F26-CS-106A-02')
  })

  it('is case- and whitespace-insensitive on the course code', () => {
    const r = resolveSyllabus(index, 'cs ', ' 106a', 'Autumn 2026', [' 02 '])
    expect(r.status).toBe('current')
  })

  it('ignores malformed entries rather than emitting a broken URL', () => {
    const broken: SyllabusIndex = {
      ...index,
      courses: { 'CS-1U': { F26: [{ s: '' }, null as never] } },
    }
    expect(resolveSyllabus(broken, 'CS', '1U', 'Autumn 2026', ['01'])).toEqual({ status: 'none' })
  })

  it('never links an unpublished syllabus: the viewer opens empty (AA 101)', () => {
    expect(resolveSyllabus(index, 'AA', '101', 'Autumn 2026', ['01'])).toEqual({ status: 'none' })
  })

  it('falls back past an unpublished term to the last published one', () => {
    const r = resolveSyllabus(index, 'AA', '190', 'Autumn 2026', ['01'])
    expect(r.status).toBe('fallback')
    expect('term' in r && r.term).toBe('Autumn 2025')
  })
})
