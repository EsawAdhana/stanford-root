import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveSyllabus, type SyllabusIndex } from '@/lib/syllabus'
import { codeToTerm, compareTerms } from '@/lib/terms'

/**
 * Invariants over the committed syllabus index. A bad scrape shows up here
 * rather than as a course page whose button silently goes dead (or, worse,
 * silently goes live and lands on WebAuth for nothing).
 */

const indexPath = path.join(process.cwd(), 'public', 'syllabi', 'index.json')
const index: SyllabusIndex = JSON.parse(fs.readFileSync(indexPath, 'utf8'))

type LightCourse = { course_id: string; subject: string; code: string; terms?: string[] }
const catalog: LightCourse[] = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), 'data', 'catalog', 'light.json'), 'utf8')
)

describe('committed syllabus index', () => {
  it('covers a multi-term window, newest last', () => {
    expect(index.terms.length).toBeGreaterThanOrEqual(8)
    const asTerms = index.terms.map(codeToTerm)
    expect(asTerms.every(Boolean)).toBe(true)
    // Oldest first: the fallback walk depends on this ordering being real.
    expect(asTerms).toEqual([...asTerms].sort(compareTerms))
  })

  it('only lists terms it actually indexed, with real section numbers', () => {
    const known = new Set(index.terms)
    const badTerms: string[] = []
    const badSections: string[] = []
    for (const [key, byTerm] of Object.entries(index.courses)) {
      for (const [term, entries] of Object.entries(byTerm)) {
        if (!known.has(term)) badTerms.push(`${key}@${term}`)
        if (entries.length === 0) badSections.push(`${key}@${term}`)
        for (const entry of entries) {
          if (!/^[A-Za-z0-9]+$/.test(entry.s)) badSections.push(`${key}@${term}:${entry.s}`)
        }
      }
    }
    expect(badTerms.slice(0, 10)).toEqual([])
    expect(badSections.slice(0, 10)).toEqual([])
  })

  it('records more than one section number, so the old always-01 guess is gone', () => {
    const sections = new Set<string>()
    for (const byTerm of Object.values(index.courses)) {
      for (const entries of Object.values(byTerm)) {
        for (const entry of entries) sections.add(entry.s)
      }
    }
    expect(sections.size).toBeGreaterThan(1)
    expect(sections.has('01')).toBe(true)
  })

  it('points a cross-listed entry at the listing that owns the file', () => {
    // Regression for the blank viewer: AFRICAAM 10's file lives under CSRE 10.
    const africaam = index.courses['AFRICAAM-10']?.F26 ?? []
    const owned = africaam.find(e => e.o)
    expect(owned).toBeDefined()
    const r = resolveSyllabus(index, 'AFRICAAM', '10', 'Autumn 2026', ['01'])
    expect('url' in r && r.url).toContain('/F26-CSRE-10-01/F26-AFRICAAM-10-01')
  })

  it('never emits a URL with the same id twice when the listing does not own its file', () => {
    // Each entry is resolved against an index holding only itself, so a
    // fallback to some other (self-owned) term cannot mask a bad pairing.
    let checked = 0
    for (const [key, byTerm] of Object.entries(index.courses)) {
      for (const [term, entries] of Object.entries(byTerm)) {
        for (const entry of entries) {
          if (!entry.o || entry.p === 0 || entry.v === 'C') continue
          const [subject, ...rest] = key.split('-')
          const isolated: SyllabusIndex = {
            ...index,
            courses: { [key]: { [term]: [entry] } },
          }
          const r = resolveSyllabus(isolated, subject, rest.join('-'), codeToTerm(term), [entry.s])
          expect(r.status).toBe('current')
          const url = 'url' in r ? r.url : ''
          if (entry.v === 'P' && entry.one === 1) {
            // PUBLIC single-file syllabi are a download of the owning id.
            // Encoded, because subjects like MS&E would otherwise truncate the
            // query string at the ampersand.
            expect(url).toBe(
              'https://syllabus.stanford.edu/syllabus/downloadSyllabus?courseId=' +
                encodeURIComponent(`${term}-${entry.o}`)
            )
          } else {
            const [owner, listing] = url.split('/').slice(-2)
            expect(owner).toBe(`${term}-${entry.o}`)
            expect(listing).toBe(`${term}-${key}-${entry.s}`)
            expect(owner).not.toBe(listing)
          }
          checked++
        }
      }
    }
    expect(checked).toBeGreaterThan(50)
  })

  it('records unpublished sections too, so the rule can change without a re-pull', () => {
    let unpublished = 0
    for (const byTerm of Object.values(index.courses)) {
      for (const entries of Object.values(byTerm)) {
        for (const entry of entries) if (entry.p === 0) unpublished++
      }
    }
    expect(unpublished).toBeGreaterThan(100)
  })

  it('never links an unpublished section', () => {
    const offenders: string[] = []
    for (const [key, byTerm] of Object.entries(index.courses)) {
      for (const [term, entries] of Object.entries(byTerm)) {
        if (!entries.every(e => e.p === 0)) continue
        const [subject, ...rest] = key.split('-')
        const r = resolveSyllabus(index, subject, rest.join('-'), codeToTerm(term), [entries[0].s])
        if (r.status === 'current') offenders.push(`${key}@${term}`)
      }
    }
    expect(offenders.slice(0, 10)).toEqual([])
  })

  it('resolves a real link for a meaningful slice of the live catalog', () => {
    const current = catalog.filter(c => (c.terms ?? []).length > 0)
    let linkable = 0
    for (const course of current) {
      const term = (course.terms ?? [])[0]
      const r = resolveSyllabus(index, course.subject, course.code, term, [])
      if (r.status === 'current' || r.status === 'fallback') linkable++
    }
    // Sanity floor, not a target: if a scrape breaks, this collapses to ~0.
    expect(linkable).toBeGreaterThan(current.length * 0.1)
  })

  it('never builds a link for a course it has no entry for', () => {
    const r = resolveSyllabus(index, 'NOTASUBJECT', '999', 'Autumn 2026', ['01'])
    expect(r).toEqual({ status: 'none' })
  })
})
