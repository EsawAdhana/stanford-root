import { join } from 'path'

// Where the prebuilt catalog dumps live on disk.
//
// full.json (~33MB) and light.json (~4MB) used to sit in public/catalog/, which
// meant Vercel served them at https://www.stanfordroot.com/catalog/full.json —
// the entire catalog, every rating and every section, as one permanently
// addressable, CDN-cached download. Moving them is what closes that: a rewrite
// or firewall rule would leave the file addressable.
//
// It does NOT make the catalog private, and this comment used to claim it did.
// the catalog at / is a client component and src/lib/store.ts fetches /api/courses from
// the browser for both dumps, so the data is still reachable by anyone who loads
// the site. What changed is that it now comes per-request, no-store and rate
// limited, instead of as a static file a scraper can bookmark.
//
// instructors.json stays under public/ because the browser really does fetch it
// (src/hooks/use-instructor-search.ts) — it is 600KB of instructor names with no
// evaluation data attached.
//
// Anything reading from SERVER_CATALOG_DIR at request time needs its route
// listed in `outputFileTracingIncludes` in next.config.mjs, or the file will not
// be in the deployed function bundle. Every caller treats a missing file as a
// cache miss and falls back to Supabase, so a missing entry costs latency
// rather than correctness.
export const SERVER_CATALOG_DIR = join(process.cwd(), 'data', 'catalog')

/** Path to a server-only catalog dump. */
export function serverCatalogPath(file: 'full.json' | 'light.json'): string {
  return join(SERVER_CATALOG_DIR, file)
}

/** Path to a dump that is also served to the browser from public/. */
export function publicCatalogPath(file: 'instructors.json'): string {
  return join(process.cwd(), 'public', 'catalog', file)
}
