/**
 * Crawlers that are denied at the edge, before a page renders.
 *
 * Why this exists: on 2026-09-08 an unidentified scraper calling itself
 * `ShapBot/0.1.0` started walking the whole course catalog from about a dozen
 * Google Cloud IPs, one course page per request, roughly 130 to 300 requests an
 * hour. It executes JavaScript, so the analytics SDK loaded and reported every
 * hit as a brand new visitor with a fresh cookie. Over Sep 3 to 9 that turned
 * 2,024 real visitors into a reported 6,871, and it was still climbing.
 *
 * The block is keyed on the user agent, not the IP. The IPs are Google Cloud
 * and rotate, but this crawler names itself, and denying the request before the
 * page renders is what stops it minting analytics visitors: no HTML, no SDK, no
 * session.
 *
 * Deliberately NOT in this list:
 *   - Googlebot, Bingbot and friends. They are how students find the site.
 *   - An empty user agent. Google's renderer sends requests with no UA at all,
 *     so an empty string has to fall through or search indexing breaks.
 *   - Google-NotebookLM, Google-Read-Aloud, GrokAgent. Together they were 72
 *     sessions in a month, and they act on behalf of a person who asked for the
 *     page. Add them here if that changes.
 *
 * If this crawler comes back under a new name, add the token to the list. The
 * `/version` suffix is required so a substring like "shapbotter" in some real
 * browser string can never trip it.
 */
/**
 * Added 2026-09-17: `AIWebIndex/2.0 (+https://lyrenth.com/bot)`, running from
 * Hetzner. Over Sep 10-17 it made 266,799 requests, the second-highest of any
 * user agent on the site, and it was the largest single consumer of
 * `/api/courses` — 4,605 calls against 3,323 from every student on Stanford's
 * network combined. It runs a headless browser, so it also fired `/api/track`
 * and minted a throwaway visitor per page.
 *
 * It fetched robots.txt six times, which is the whole reason it needed adding
 * here: it is a compliant crawler, and until this commit robots.txt answered
 * `allow: /`. The block and the robots.txt disallow now say the same thing.
 */
const BLOCKED_CRAWLER_TOKENS = ['shapbot', 'shap-user', 'aiwebindex'] as const

const BLOCKED_CRAWLER_RE = new RegExp(
  `(?:^|[^a-z0-9-])(?:${BLOCKED_CRAWLER_TOKENS.join('|')})/[0-9]`,
  'i',
)

/**
 * True when this user agent belongs to a crawler we refuse to serve. An absent
 * or empty user agent is always allowed through, see the note above.
 */
export function isBlockedCrawler(userAgent: string | null | undefined): boolean {
  if (!userAgent) return false
  return BLOCKED_CRAWLER_RE.test(userAgent)
}

/** The tokens themselves, so robots.txt can name the same crawlers. */
export const blockedCrawlerTokens = BLOCKED_CRAWLER_TOKENS
