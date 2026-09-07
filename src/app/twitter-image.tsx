import { OG_SIZE, OG_CONTENT_TYPE, OG_ALT, renderOgCard } from '@/lib/og-card'

export const alt = OG_ALT
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export default function TwitterImage() {
  return renderOgCard()
}
