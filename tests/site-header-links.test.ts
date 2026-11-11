import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The header is mounted on every page, and it used to drop the Schedule link on
 * /faq alone, so the same header changed shape depending on which page you
 * opened. This renders it for each top-level page and checks the link is there.
 */

let currentPath = '/'

vi.mock('next/navigation', () => ({
  usePathname: () => currentPath,
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/lib/auth-store', () => ({
  useAuthStore: (select: (s: unknown) => unknown) =>
    select({ user: null, isLoading: false, signOut: () => {} }),
}))
vi.mock('@/components/search-bar', () => ({ SearchBar: () => null }))
vi.mock('@/components/mobile-filter-menu', () => ({ MobileFilterMenu: () => null }))
vi.mock('@/components/stanford-login-button', () => ({ StanfordLoginButton: () => null }))
vi.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => 'THEME_TOGGLE' }))

const { SiteHeader } = await import('@/components/site-header')

describe('SiteHeader', () => {
  beforeEach(() => {
    currentPath = '/'
  })

  it.each([
    '/', '/faq', '/FAQ', '/about', '/privacy', '/terms', '/departments',
    '/connected-apps', '/CS106B', '/CS', '/instructors/jane-doe', '/this-is-not-a-page',
  ])('links to the schedule on %s', path => {
    currentPath = path
    const html = renderToStaticMarkup(createElement(SiteHeader))
    expect(html).toContain('href="/schedule"')
    expect(html).toContain('aria-label="Schedule"')
  })

  // The phone catalog header holds the filter button and the search box too, so
  // the theme toggle steps aside below `sm` there and only there. The layout
  // itself is checked by screenshot at 320 and 390px; this pins the rule.
  it('hides the theme toggle on phones on the catalog only', () => {
    currentPath = '/'
    expect(renderToStaticMarkup(createElement(SiteHeader))).toContain('<div class="hidden sm:flex">THEME_TOGGLE</div>')
    for (const path of ['/faq', '/CS106B', '/schedule']) {
      currentPath = path
      expect(renderToStaticMarkup(createElement(SiteHeader))).toContain('<div class="flex">THEME_TOGGLE</div>')
    }
  })
})
