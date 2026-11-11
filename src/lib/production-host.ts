/**
 * The only hosts whose analytics events are recorded. Local dev servers and
 * Vercel previews run against the production Supabase project, and in the
 * month to 2026-11-10 they wrote 388 rows there, including 90 of the 155
 * app_crashed events (crashes from half-built branches), all labelled as
 * human traffic.
 */
export const PRODUCTION_HOSTS = new Set(['www.stanfordroot.com', 'stanfordroot.com'])

/**
 * The host a request was made to: Vercel's x-forwarded-host, else Host, else
 * the request URL. Lowercased, with any port and trailing dot removed.
 */
export function requestHost(request: Request): string {
  const raw =
    request.headers.get('x-forwarded-host')?.split(',')[0] ||
    request.headers.get('host') ||
    new URL(request.url).host
  return raw.trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '')
}

export function isProductionRequest(request: Request): boolean {
  return PRODUCTION_HOSTS.has(requestHost(request))
}
