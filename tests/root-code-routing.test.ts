import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { normalizeCourseId } from '@/lib/utils'

/**
 * Course and department pages live at the root: `/CS106B` and `/CS`, both served
 * by the single `src/app/[code]` segment. That flattening only works while three
 * things hold, and none of them is enforced by the type system:
 *
 *   1. No subject is also a course id, or `/CS` is ambiguous.
 *   2. No subject or course id matches a real top-level route, because a static
 *      Next segment always beats `[code]`. A department called PLAN would be
 *      silently unreachable the day someone adds `src/app/plan/page.tsx`.
 *   3. Every code survives a URL round trip, MS&E included.
 *
 * So these are checked against the committed dump and against the actual route
 * folders on disk, rather than a hand-kept list that would drift.
 */

type LightRow = { course_id?: string; subject?: string; grading?: string }

const show = (xs: string[], n = 8) => (xs.length > n ? [...xs.slice(0, n), `…+${xs.length - n} more`] : xs)

function isGradeable(grading: string | undefined): boolean {
  const g = (grading || '').trim()
  return Boolean(g) && g !== 'TBD'
}

const rows: LightRow[] = JSON.parse(fs.readFileSync('data/catalog/light.json', 'utf8'))
const courseIds = new Set<string>()
const subjects = new Set<string>()
for (const row of rows) {
  if (!isGradeable(row.grading)) continue
  if (row.course_id) courseIds.add(row.course_id)
  if (row.subject) subjects.add(row.subject)
}

/** A directory only becomes a route once it holds a page or a route handler. */
function hasRouteFile(dir: string): boolean {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  return entries.some(e =>
    (e.isFile() && /^(page|route)\.(tsx?|jsx?)$/.test(e.name)) ||
    (e.isDirectory() && hasRouteFile(path.join(dir, e.name)))
  )
}

/** Top-level paths Next.js resolves before it ever reaches `[code]`. */
function reservedRootPaths(): string[] {
  const appDir = 'src/app'
  const reserved: string[] = ['_next', 'favicon.ico']
  for (const entry of fs.readdirSync(appDir, { withFileTypes: true })) {
    if (entry.name.startsWith('[') || entry.name.startsWith('(')) continue
    if (entry.isDirectory()) {
      if (hasRouteFile(path.join(appDir, entry.name))) reserved.push(entry.name)
      continue
    }
    // File-convention routes: icon.tsx -> /icon, sitemap.ts -> /sitemap.xml.
    const base = entry.name.replace(/\.(tsx?|jsx?)$/, '')
    if (['layout', 'page', 'error', 'not-found', 'globals'].includes(base)) continue
    if (base === 'sitemap') reserved.push('sitemap.xml')
    else if (base === 'robots') reserved.push('robots.txt')
    else if (base === 'manifest') reserved.push('manifest.webmanifest')
    else reserved.push(base)
  }
  return reserved
}

describe('root-level course and department URLs', () => {
  it('has no subject that is also a course id', () => {
    const clashes = [...subjects].filter(s => courseIds.has(s))
    expect(show(clashes)).toEqual([])
  })

  it('has no code that a top-level route would shadow', () => {
    // Case-insensitive: the resolver upper-cases a lowercase code and redirects,
    // so /faq colliding with a subject FAQ would break in either casing.
    const reserved = new Set(reservedRootPaths().map(p => p.toLowerCase()))
    // The reserved list must be real, or this test proves nothing.
    expect(reserved.has('faq')).toBe(true)
    expect(reserved.has('departments')).toBe(true)
    expect(reserved.has('instructors')).toBe(true)
    expect(reserved.has('api')).toBe(true)
    expect(reserved.has('sitemap.xml')).toBe(true)

    const clashes = [...subjects, ...courseIds].filter(c => reserved.has(c.toLowerCase()))
    expect(show(clashes)).toEqual([])
  })

  it('survives a URL round trip at the root, ampersands included', () => {
    const bad = [...subjects, ...courseIds].filter(
      c => decodeURIComponent(encodeURIComponent(c)) !== c
    )
    expect(show(bad)).toEqual([])
    expect(subjects.has('MS&E')).toBe(true)
    expect(encodeURIComponent('MS&E103')).toBe('MS%26E103')
  })

  it('keeps every code in the already-canonical normalized form', () => {
    // The resolver 308s anything whose normalized form differs from the id it
    // was given. If a stored id were not canonical, its own URL would redirect
    // to itself and loop.
    const bad = [...courseIds].filter(id => normalizeCourseId(id) !== id)
    expect(show(bad)).toEqual([])
    const badSubjects = [...subjects].filter(s => s !== s.toUpperCase())
    expect(show(badSubjects)).toEqual([])
  })
})
