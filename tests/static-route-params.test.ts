import { describe, expect, it, vi } from 'vitest'
import { getInstructorDirectory } from '@/lib/catalog-dump'
import { instructorSlug, resolveInstructorSlug } from '@/lib/instructors'

/**
 * `[code]` and `instructors/[slug]` set `dynamicParams = false`, so a path that
 * generateStaticParams leaves out is a 404. That is right for junk, and wrong
 * for anything that used to render or redirect. These tests pin that every
 * instructor slug the resolver can turn into a page or a redirect is listed.
 * (Course and department spellings are redirected by middleware instead; see
 * tests/course-code-redirect.test.ts.)
 */

vi.mock('@/components/site-header', () => ({ SiteHeader: () => null }))
vi.mock('@/components/instructor-detail-content', () => ({ InstructorDetailContent: () => null }))
vi.mock('@/app/[code]/course-view', () => ({ CourseView: () => null, courseMetadata: () => ({}) }))
vi.mock('@/app/[code]/department-view', () => ({ DepartmentView: () => null }))

const instructorPage = await import('@/app/instructors/[slug]/page')
const codePage = await import('@/app/[code]/page')

describe('instructors/[slug] static params', () => {
  it('only serves listed slugs', () => {
    expect(instructorPage.dynamicParams).toBe(false)
  })

  it('lists every slug that resolves to a person or a redirect, and nothing ambiguous', async () => {
    const listed = new Set((await instructorPage.generateStaticParams()).map(p => p.slug))
    const directory = await getInstructorDirectory()

    const candidates = new Set<string>([
      ...directory.bySlug.keys(),
      ...directory.namedByInitialSlug.keys(),
    ])
    const missing: string[] = []
    const ambiguousListed: string[] = []
    for (const slug of candidates) {
      const kind = resolveInstructorSlug(directory, slug).kind
      if ((kind === 'found' || kind === 'redirect') && !listed.has(slug)) missing.push(slug)
      if (kind === 'ambiguous' && listed.has(slug)) ambiguousListed.push(slug)
    }
    expect(missing).toEqual([])
    expect(ambiguousListed).toEqual([])
    // The initial-only slug that course-evaluations.tsx builds for "Aaker, J."
    // redirects to Jennifer Aaker, so it has to be listed.
    expect(instructorSlug('Aaker, J.')).toBe('aaker-j')
    expect(resolveInstructorSlug(directory, 'aaker-j')).toEqual({ kind: 'redirect', slug: 'aaker-jennifer' })
    expect(listed.has('aaker-j')).toBe(true)
  })
})

describe('[code] static params', () => {
  it('only serves listed codes', () => {
    expect(codePage.dynamicParams).toBe(false)
  })

  it('lists canonical courses and departments, MS&E included', async () => {
    const listed = new Set((await codePage.generateStaticParams()).map(p => p.code))
    for (const code of ['CS106B', 'MATH51', 'MS&E232', 'CS', 'MS&E']) expect(listed.has(code)).toBe(true)
  })
})
