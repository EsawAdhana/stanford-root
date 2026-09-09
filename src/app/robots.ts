import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/site'
import { blockedCrawlerTokens } from '@/lib/blocked-crawlers'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/auth/'],
      },
      // Stating it here as well as in the middleware. A crawler that reads
      // robots.txt stops without costing us a request; the middleware handles
      // the ones that do not.
      ...blockedCrawlerTokens.map((token) => ({
        userAgent: token,
        disallow: '/',
      })),
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  }
}
