import { describe, it, expect, vi } from 'vitest'

// The catalog dumps are 33MB on disk. Serve a stand-in so the assertions are
// about headers and payload shape, not about reading the real file.
const LIGHT = [{ course_id: 'CS106B', subject: 'CS', code: '106B', title: 'Programming Abstractions', quality_pct: 91 }]
const FULL = [{ ...LIGHT[0], description: 'Abstraction and its relation to programming.', sections: [{ class_nbr: 1234 }] }]

vi.mock('fs/promises', () => ({
  readFile: (p: string) =>
    Promise.resolve(JSON.stringify(String(p).includes('full.json') ? FULL : LIGHT)),
}))
// Never reachable once the dump read succeeds; present so an accidental fallthrough
// fails loudly instead of opening a socket.
vi.mock('@/lib/supabase-admin', () => ({
  getPublicClient: () => { throw new Error('route fell through to Supabase') },
  mergeCourseRows: (r: unknown[]) => r,
  FULL_COURSE_COLUMNS: '',
  LIGHT_COURSE_COLUMNS: '',
}))

const { GET } = await import('@/app/api/courses/route')

const get = (qs = '') => GET(new Request(`http://localhost/api/courses${qs}`))

// Every field either dump is allowed to contain. Anything outside this set is a
// per-user value, and a per-user value in a shared-cache response is the leak the
// old no-store comment was worried about.
const PUBLIC_FIELDS = new Set([
  'course_id', 'subject', 'code', 'title', 'description', 'units', 'grading',
  'instructors', 'terms', 'sections', 'hours', 'quality', 'quality_pct',
  'quality_n', 'rating_breakdown', 'cross_list_with',
])

describe('/api/courses cache headers', () => {
  it('lets a shared cache hold the light dump', async () => {
    const cc = (await get()).headers.get('cache-control') ?? ''
    // The regression this exists for: 281.7GB of Fast Origin Transfer in one
    // billing cycle because every student pulled this from the function.
    expect(cc).not.toMatch(/no-store/)
    expect(cc).toMatch(/\bpublic\b/)
    expect(cc).toMatch(/s-maxage=\d+/)
  })

  it('lets a shared cache hold the full dump too', async () => {
    const cc = (await get('?full=1')).headers.get('cache-control') ?? ''
    expect(cc).not.toMatch(/no-store/)
    expect(cc).toMatch(/s-maxage=\d+/)
  })

  it('caches for a day at most, so a redeploy is never more than 24h from readers', async () => {
    const cc = (await get()).headers.get('cache-control') ?? ''
    const seconds = Number(/s-maxage=(\d+)/.exec(cc)?.[1])
    expect(seconds).toBeGreaterThan(0)
    expect(seconds).toBeLessThanOrEqual(86400)
  })

  it('serves the same bytes to a caller with a session cookie as to one without', async () => {
    // If these ever diverge, a URL-keyed CDN entry really could hand one user's
    // response to another, and the header above has to come back off.
    const anon = await (await get('?full=1')).text()
    const withCookie = await (await GET(new Request('http://localhost/api/courses?full=1', {
      headers: { cookie: 'sb-access-token=someone-elses-session', authorization: 'Bearer nope' },
    }))).text()
    expect(withCookie).toBe(anon)
  })

  it('carries no per-user field in either dump', async () => {
    for (const qs of ['', '?full=1']) {
      const rows = JSON.parse(await (await get(qs)).text()) as Array<Record<string, unknown>>
      expect(rows.length).toBeGreaterThan(0)
      for (const row of rows) {
        expect(Object.keys(row).filter(k => !PUBLIC_FIELDS.has(k))).toEqual([])
      }
    }
  })
})

describe('the routes that read a user stay uncacheable', () => {
  // The breaking case for this change is a later sweep that "makes the API
  // cacheable" and catches these three, which do gate on a Stanford session.
  it.each([
    'src/app/api/evaluations/route.ts',
    'src/app/api/class-years/route.ts',
    'src/app/api/instructors/[slug]/route.ts',
  ])('%s still sends no-store', async file => {
    const src = await (await import('fs/promises').then(() => import('node:fs'))).promises.readFile(file, 'utf8')
    expect(src).toMatch(/no-store/)
    expect(src).not.toMatch(/s-maxage/)
  })
})
