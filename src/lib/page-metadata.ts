import type { Metadata, ResolvingMetadata } from 'next'
import { SITE_URL } from '@/lib/site'
import { inheritedOgImages } from '@/lib/inherited-og-images'

/**
 * Metadata for a plain top-level page (/faq, /about, ...) with its own share
 * preview.
 *
 * Next.js replaces the root layout's `openGraph` and `twitter` objects wholesale
 * rather than merging them, so a page that only set `title` and `description`
 * kept the home page's og:title, og:description and og:url, and a link to /faq
 * previewed as the home page. Setting them here means the parent's share card
 * has to be copied back in, which is what the image lookups below do.
 */
export async function pageMetadata(
  parent: ResolvingMetadata,
  page: {
    title: string
    description: string
    /** Path such as `/faq`; becomes the canonical link and og:url. */
    path: string
  } & Pick<Metadata, 'robots'>,
): Promise<Metadata> {
  const { title, description, path, ...rest } = page
  const resolved = await parent
  const twitterImages = resolved.twitter?.images
  return {
    ...rest,
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      title,
      description,
      url: `${SITE_URL}${path}`,
      siteName: 'Stanford Root',
      type: 'website',
      ...(await inheritedOgImages(parent)),
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      ...(twitterImages && twitterImages.length > 0 ? { images: twitterImages } : {}),
    },
  }
}
