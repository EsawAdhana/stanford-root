import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { canonicalCoursePath } from '@/middleware'
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
    // Departments, upper or lower case: no digit, so not this function's business.
    '/CS', '/cs', '/MS&E', '/ms&e',
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
