import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: { unoptimized: true },
  // data/catalog/{full,light}.json are read with fs at request time but live
  // outside public/, so Next.js's file tracing cannot infer them — every route
  // that reads a dump has to name it here or the file is absent from the
  // deployed bundle. Missing it is not fatal (each reader falls back to
  // Supabase) but it is much slower, so keep this list in step with the
  // importers of @/lib/catalog-dump, @/lib/departments and @/lib/catalog-paths.
  outputFileTracingIncludes: {
    '/[code]': ['./data/catalog/full.json', './data/catalog/light.json'],
    '/api/courses': ['./data/catalog/full.json', './data/catalog/light.json'],
    '/api/courses/[courseId]': ['./data/catalog/full.json'],
    '/api/instructors/[slug]': ['./data/catalog/full.json', './data/catalog/light.json'],
    '/departments': ['./data/catalog/light.json'],
    '/instructors/[slug]': ['./data/catalog/full.json', './data/catalog/light.json'],
    // The share card draws the real browse view, so it runs filterCourses over
    // the full dump the way /browse does. Static at build, but traced anyway.
    '/opengraph-image': ['./data/catalog/full.json', './data/catalog/light.json'],
    '/twitter-image': ['./data/catalog/full.json', './data/catalog/light.json'],
    '/sitemap.xml': ['./data/catalog/light.json'],
  },
  // Course and department pages moved to the root: /courses/CS106B is now
  // /CS106B and /browse/CS is now /CS. These are the ~15k URLs already in
  // Google's index and in people's bookmarks, so they redirect rather than 404.
  // Order matters, Next takes the first match: /browse/departments has to be
  // listed before the /browse/:subject pattern that would otherwise swallow it.
  async redirects () {
    return [
      { source: '/browse', destination: '/', permanent: true },
      { source: '/browse/departments', destination: '/departments', permanent: true },
      { source: '/browse/:subject', destination: '/:subject', permanent: true },
      { source: '/courses/:courseId', destination: '/:courseId', permanent: true },
    ]
  },
  turbopack: {
    root: path.resolve(__dirname)
  },
  async headers () {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          {
            key: 'Content-Security-Policy',
            value:
              // cdn.humanbehavior.co is in script-src because the recording SDK is
              // loaded from the CDN rather than bundled: the loader script and the
              // recorder it pulls in are both script fetches from that host. A
              // bundled npm build only needed 'self', which is why this directive
              // did not list it before. connect-src already covers the ingestion
              // host via https://*.humanbehavior.co.
              "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://unpkg.com https://cdn.humanbehavior.co; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://syllabus.stanford.edu https://*.humanbehavior.co; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
          }
        ]
      }
    ]
  }
};

export default nextConfig;
