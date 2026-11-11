import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Vercel serves the site from www and 308-redirects the apex to it. Every URL
// we hand to search engines (canonical, og:url, sitemap, robots) must name the
// host that actually serves the page, so these run with NEXT_PUBLIC_SITE_URL
// unset, the way production builds today.

const WWW = 'https://www.stanfordroot.com'
const APEX_PREFIX = /^https:\/\/stanfordroot\.com(\/|$)/

// The root layout pulls in fonts, providers and CSS. Only its metadata is
// under test here, so stub everything that is not plain data.
vi.mock('next/font/google', () => ({
  Inter: () => ({ className: 'inter' }),
  Instrument_Serif: () => ({ className: 'serif', variable: '--font-display' }),
}))
vi.mock('nuqs/adapters/next/app', () => ({ NuqsAdapter: () => null }))
vi.mock('@/components/theme-provider', () => ({ ThemeProvider: () => null }))
vi.mock('@/components/auth-provider', () => ({ AuthProvider: () => null }))
vi.mock('@/components/analytics-provider', () => ({ AnalyticsProvider: () => null }))
vi.mock('@/components/deferred-shell', () => ({ DeferredShell: () => null }))
vi.mock('@/components/nav-progress', () => ({ NavProgress: () => null }))
vi.mock('@/components/themed-toaster', () => ({ ThemedToaster: () => null }))
vi.mock('@/app/HumanBehaviorInit', () => ({ HumanBehaviorInit: () => null }))
vi.mock('@/app/globals.css', () => ({}))

beforeEach(() => {
  vi.resetModules()
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', '')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('SITE_URL', () => {
  it('defaults to the www host when the env var is unset', async () => {
    const { SITE_URL } = await import('@/lib/site')
    expect(SITE_URL).toBe(WWW)
  })

  it('still honours an explicit override and strips trailing slashes', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://preview.example.com//')
    const { SITE_URL } = await import('@/lib/site')
    expect(SITE_URL).toBe('https://preview.example.com')
  })

  it('keeps the Google consent-screen policy links on the exact apex strings', async () => {
    const site = await import('@/lib/site')
    expect(site.GOOGLE_CONSENT_PRIVACY_URL).toBe('https://stanfordroot.com/privacy')
    expect(site.GOOGLE_CONSENT_TERMS_URL).toBe('https://stanfordroot.com/terms')
  })
})

describe('root layout metadata', () => {
  it('resolves relative canonicals against www', async () => {
    const { metadata } = await import('@/app/layout')
    expect(metadata.metadataBase?.toString()).toBe(`${WWW}/`)
    // A course page sets alternates.canonical to a path like /CS106B; Next
    // resolves it against metadataBase.
    expect(new URL('/CS106B', metadata.metadataBase!).toString()).toBe(`${WWW}/CS106B`)
    expect((metadata.openGraph as { url?: string }).url).toBe(WWW)
  })
})

describe('robots.txt', () => {
  it('names the www host for Host and Sitemap', async () => {
    const { default: robots } = await import('@/app/robots')
    const out = robots()
    expect(out.host).toBe(WWW)
    expect(out.sitemap).toBe(`${WWW}/sitemap.xml`)
  })
})

describe('sitemap.xml', () => {
  it('lists every URL on the www host and none on the apex', async () => {
    const { default: sitemap } = await import('@/app/sitemap')
    const entries = await sitemap()
    // Static routes plus departments plus courses from the committed dump.
    expect(entries.length).toBeGreaterThan(1000)
    const offHost = entries.filter((e) => !e.url.startsWith(`${WWW}/`))
    expect(offHost).toEqual([])
    expect(entries.some((e) => APEX_PREFIX.test(e.url))).toBe(false)
    expect(entries[0].url).toBe(`${WWW}/`)
  })
})
