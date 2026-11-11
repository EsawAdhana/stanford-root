import type { Metadata, ResolvingMetadata } from 'next'
import { describe, expect, it, vi } from 'vitest'
import { SITE_URL } from '@/lib/site'

/**
 * Each plain top-level page sets its own og:title, og:description and og:url.
 * Before, they set only a <title>, and because Next.js replaces the parent's
 * openGraph wholesale only when a page sets one, every share preview of /faq or
 * /about read as the home page. The share card image must still come through.
 */

vi.mock('@/components/site-header', () => ({ SiteHeader: () => null }))
vi.mock('@/components/connected-apps', () => ({ ConnectedApps: () => null }))
vi.mock('@/lib/departments', () => ({ getDepartments: async () => [] }))

const HOME_TITLE = 'Stanford Root — Search every Stanford course and evaluation'
const OG_IMAGE = { url: `${SITE_URL}/opengraph-image?abc123`, width: 1200, height: 630 }
const TWITTER_IMAGE = { url: `${SITE_URL}/twitter-image?abc123` }

/** What the root layout resolves to: the home page's share preview. */
const parent = Promise.resolve({
  title: { absolute: HOME_TITLE },
  openGraph: { title: HOME_TITLE, url: SITE_URL, images: [OG_IMAGE] },
  twitter: { title: HOME_TITLE, images: [TWITTER_IMAGE] },
}) as unknown as ResolvingMetadata

type MetadataModule = { generateMetadata: (props: unknown, parent: ResolvingMetadata) => Promise<Metadata> }

const pages: [string, () => Promise<MetadataModule>][] = [
  ['/departments', () => import('@/app/departments/page')],
  ['/faq', () => import('@/app/faq/page')],
  ['/about', () => import('@/app/about/page')],
  ['/privacy', () => import('@/app/privacy/page')],
  ['/terms', () => import('@/app/terms/page')],
  ['/schedule', () => import('@/app/schedule/layout')],
  ['/connected-apps', () => import('@/app/connected-apps/page')],
]

describe('top-level page share metadata', () => {
  it.each(pages)('%s has its own og and twitter tags and keeps the share card', async (path, load) => {
    const metadata = await (await load()).generateMetadata({}, parent)
    const og = metadata.openGraph!
    const twitter = metadata.twitter!

    expect(typeof metadata.title).toBe('string')
    expect(metadata.title).not.toBe(HOME_TITLE)
    expect(metadata.description).toBeTruthy()
    expect(metadata.alternates?.canonical).toBe(path)

    expect(og.title).toBe(metadata.title)
    expect(og.description).toBe(metadata.description)
    expect(og.url).toBe(`${SITE_URL}${path}`)
    expect(og.images).toEqual([OG_IMAGE])

    expect(twitter.title).toBe(metadata.title)
    expect(twitter.description).toBe(metadata.description)
    expect(twitter.images).toEqual([TWITTER_IMAGE])
  })

  it('keeps /connected-apps out of the index', async () => {
    const metadata = await (await import('@/app/connected-apps/page')).generateMetadata({}, parent)
    expect(metadata.robots).toEqual({ index: false, follow: false })
  })
})
