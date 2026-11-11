import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  MALFORMED_URL_REWRITE,
  RESERVED_ROOT_SEGMENTS,
  canonicalCoursePath,
  hasMalformedEncoding,
} from '@/middleware'
import { normalizeCourseId } from '@/lib/utils'

/**
 * `src/middleware.ts` answers a loosely typed course URL with a 308 to its
 * canonical spelling before routing. Anything this returns non-null for gets
 * redirected, so the costly mistakes are redirecting a real page (a static
 * route, a file, a department) or redirecting a canonical URL to itself.
 */

const rows: { course_id?: string; id?: string }[] = JSON.parse(
  fs.readFileSync('data/catalog/light.json', 'utf8'),
)
const catalogIds = [...new Set(rows.map(r => String(r.course_id || r.id || '')).filter(Boolean))]

describe('canonicalCoursePath', () => {
  it.each([
    ['/cs106b', '/CS106B'],
    ['/Cs106B', '/CS106B'],
    ['/CS%20106B', '/CS106B'],
    ['/cs%20106b', '/CS106B'],
    ['/CS 106B', '/CS106B'],
    ['/cs-106b', '/CS106B'],
    ['/cs.106b', '/CS106B'],
    ['/math51', '/MATH51'],
    ['/ms&e232', '/MS%26E232'],
    ['/ms%26e232', '/MS%26E232'],
    ['/MS%26E%20232', '/MS%26E232'],
    ['/ms%26e%20232', '/MS%26E232'],
    // Not in the catalog: it still gets the canonical spelling, then the usual not-found page.
    ['/zzz999', '/ZZZ999'],
    // Departments.
    ['/cs', '/CS'],
    ['/Cs', '/CS'],
    ['/math', '/MATH'],
    ['/ms&e', '/MS%26E'],
    ['/ms%26e', '/MS%26E'],
    // Not a subject: one hop to the same not-found page.
    ['/foo', '/FOO'],
  ])('%s redirects to %s', (input, expected) => {
    expect(canonicalCoursePath(input)).toBe(expected)
  })

  it.each([
    // Already canonical, in every encoding the browser might send.
    '/CS106B', '/MATH51', '/MS&E232', '/MS%26E232', '/ZZZ999',
    // Static routes and their children.
    '/', '/about', '/faq', '/privacy', '/terms', '/schedule', '/departments',
    '/connected-apps', '/connect', '/s', '/api', '/api/courses', '/api/courses/cs106b',
    '/auth/callback', '/oauth/consent', '/instructors/jane-doe', '/instructors/cs106b',
    '/_next/static/chunks/main.js',
    // Files and file-convention routes.
    '/robots.txt', '/sitemap.xml', '/opengraph-image', '/twitter-image', '/icon',
    '/apple-icon', '/manifest.webmanifest', '/favicon.ico', '/catalog/instructors.json',
    // Departments already in canonical form.
    '/CS', '/MS&E', '/MS%26E', '/FOO',
    // Reserved routes in any casing are never uppercased into a department.
    '/About', '/FAQ', '/Schedule', '/S', '/brand', '/catalog', '/syllabi',
    // Nonsense and near misses.
    '/this-is-not-a-page', '/106b', '/cs106b/', '/cs106b/extra', '/cs_106b',
    '/cs--106b', '/cs106b.txt', '/%', '/%FF', '/cs%E0%A4%A106b',
  ])('%s is left alone', input => {
    expect(canonicalCoursePath(input)).toBeNull()
  })

  it('never redirects a real catalog id, so no canonical page can loop', () => {
    expect(catalogIds.length).toBeGreaterThan(1000)
    const redirected = catalogIds.filter(id => canonicalCoursePath(`/${encodeURIComponent(id)}`) !== null)
    expect(redirected).toEqual([])
    // Every id is its own normal form, which is what lets the middleware compute
    // the page's canonical URL without loading the catalog.
    expect(catalogIds.filter(id => normalizeCourseId(id) !== id)).toEqual([])
  })

  it('sends the lowercase form of every subject to that subject', () => {
    const subjects = [...new Set(rows.map(r => String((r as { subject?: string }).subject || '')).filter(Boolean))]
    expect(subjects).toContain('MS&E')
    const wrong = subjects.filter(
      s => canonicalCoursePath(`/${encodeURIComponent(s.toLowerCase())}`) !== `/${encodeURIComponent(s)}`,
    )
    expect(wrong).toEqual([])
    expect(subjects.filter(s => canonicalCoursePath(`/${encodeURIComponent(s)}`) !== null)).toEqual([])
  })

  it('reserves every top-level route folder and public entry', () => {
    // A lowercase letters-only segment that is not reserved gets uppercased,
    // so a top-level route missing from the list would become unreachable.
    const roots = [
      ...fs.readdirSync('src/app', { withFileTypes: true })
        .filter(e => e.isDirectory() && !/^[[(_]/.test(e.name))
        .map(e => e.name),
      ...fs.readdirSync('public'),
    ]
    expect(roots).toContain('faq')
    expect(roots.filter(r => !RESERVED_ROOT_SEGMENTS.has(r.toLowerCase()))).toEqual([])
  })

  it('sends the lowercase and spaced forms of every catalog id to that id', () => {
    const wrong = catalogIds.filter(id => {
      const target = `/${encodeURIComponent(id)}`
      const lower = canonicalCoursePath(`/${encodeURIComponent(id.toLowerCase())}`)
      const spaced = canonicalCoursePath(`/${encodeURIComponent(id.replace(/(\d)/, ' $1'))}`)
      return lower !== target || spaced !== target
    })
    expect(wrong).toEqual([])
  })
})

describe('hasMalformedEncoding', () => {
  it.each(['/%', '/%FF', '/instructors/%FF', '/%E0%A4%A', '/cs%2', '/a%zz'])(
    '%s is malformed',
    path => expect(hasMalformedEncoding(path)).toBe(true),
  )

  it.each(['/', '/CS106B', '/MS%26E232', '/CS%20106B', '/instructors/jane-doe', '/%E0%A4%A1', '/%25'])(
    '%s is fine',
    path => expect(hasMalformedEncoding(path)).toBe(false),
  )

  it('rewrites to a path no catalog code or route can claim', () => {
    expect(hasMalformedEncoding(MALFORMED_URL_REWRITE)).toBe(false)
    expect(canonicalCoursePath(MALFORMED_URL_REWRITE)).toBeNull()
    expect(catalogIds).not.toContain(MALFORMED_URL_REWRITE.slice(1))
  })
})
