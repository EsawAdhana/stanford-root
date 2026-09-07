import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Stanford Root',
    short_name: 'Root',
    description: 'A better way to browse Stanford courses — search, evaluations, and schedule building.',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#8C1515',
    icons: [
      { src: '/icon', sizes: '32x32', type: 'image/png' },
      { src: '/apple-icon', sizes: '180x180', type: 'image/png' },
    ],
  }
}
