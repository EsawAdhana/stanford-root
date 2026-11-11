/**
 * Pages live on www.stanfordroot.com; the bare domain sends people there. The
 * MCP server is the exception: an MCP client signs in against the exact address
 * it was given, so a redirect makes sign-in fail ("protected resource does not
 * match"). The bare domain therefore answers /api/mcp and its /.well-known
 * metadata itself, and redirects everything else.
 *
 * This only takes effect once Vercel stops redirecting the bare domain at the
 * domain level (Project > Domains > stanfordroot.com > no redirect). Until then
 * Vercel's own 308 runs first and nothing here is reached on that host.
 */
const BARE_HOST = 'stanfordroot.com'
const CANONICAL_ORIGIN = 'https://www.stanfordroot.com'

const servedOnBareHost = (pathname: string) => pathname === '/api/mcp' || pathname.startsWith('/.well-known/')

/** Where a request to the bare domain should be sent, or null to serve it where it is. */
export function canonicalRedirect(host: string | null, pathname: string, search: string): string | null {
  const name = (host ?? '').toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '')
  if (name !== BARE_HOST || servedOnBareHost(pathname)) return null
  return `${CANONICAL_ORIGIN}${pathname}${search}`
}
