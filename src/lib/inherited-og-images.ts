import type { Metadata, ResolvingMetadata } from 'next'

export type OpenGraphImages = Pick<NonNullable<Metadata['openGraph']>, 'images'>

/**
 * The share card the root layout resolved (src/app/opengraph-image.tsx), for a
 * page that sets its own `openGraph`.
 *
 * Next.js replaces the parent's `openGraph` object wholesale rather than merging
 * it, so a page that sets a title and url there loses og:image unless it copies
 * the image back in. Reading it off the resolved parent gives exactly the URL the
 * home page emits, content hash included, instead of a hand-built path.
 *
 * Returns `{}` when the parent has no image, so spreading it never writes an
 * empty `images` list over anything.
 */
export async function inheritedOgImages(parent: ResolvingMetadata): Promise<OpenGraphImages> {
  const images = (await parent).openGraph?.images
  return images && images.length > 0 ? { images } : {}
}
