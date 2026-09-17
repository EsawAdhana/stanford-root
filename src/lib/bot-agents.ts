/**
 * Bots we still serve, but refuse to *count*.
 *
 * This is a deliberately different policy from `lib/blocked-crawlers`, and the
 * two must not be merged:
 *
 *   - `isBlockedCrawler` → the request gets a 403. Reserved for crawlers that
 *     take the whole catalog and give nothing back.
 *   - `isKnownBot` (here) → the page is served normally, but `/api/track`
 *     drops the event. Googlebot must keep indexing us; it must never show up
 *     in a visitor count.
 *
 * Why this exists: on 2026-09-17 an audit of `analytics_events` over Sep 10-17
 * found 12,874 recorded "sessions", of which roughly 8,200 were crawlers
 * minting one throwaway session per page. They were only ~6-9% of *events* but
 * ~64% of the *session* count, because a crawler fires one `page_viewed` and
 * never comes back while a student fires dozens. Any dashboard counting
 * sessions or unique visitors was therefore wrong by about 3x. Vercel's own
 * request log put bot-attributed `/api/track` calls at 8.7% over the same
 * window, which is the number this list is calibrated against.
 *
 * The cost asymmetry is the reverse of the 403 list. There, a false positive
 * blanks the page for a real student, so the list is tiny and exact. Here a
 * false positive silently drops one event, and a false *negative* quietly
 * inflates every number on the dashboard. So this list is broad on purpose and
 * includes the search engines.
 *
 * Deliberately NOT here, to stay consistent with the 403 list's reasoning:
 * Google-Read-Aloud, Google-NotebookLM, GrokAgent, Manus-User. Each acts for a
 * person who asked for the page, and together they were 72 sessions in a month.
 *
 * Also deliberately absent: `whatsapp`. Its link-preview fetcher versions
 * itself (`WhatsApp/2.x`), but the in-app browser a student actually taps
 * through in does not, and the same reasoning that keeps the Instagram and
 * WeChat webviews out of the 403 list applies here. One uncounted link preview
 * is cheaper than dropping a real student.
 */

/** Explicit agents, matched as `token` optionally followed by `/<version>`. */
const BOT_TOKENS = [
  // Pure scrapers seen in this site's logs.
  'aiwebindex',
  'shapbot',
  'shap-user',
  'theweb.report',
  // AI crawlers and answer engines.
  'meta-externalagent',
  'amazonbot',
  'bytespider',
  'petalbot',
  'gptbot',
  'oai-searchbot',
  'chatgpt-user',
  'chatgpt-operator',
  'gpt-actions',
  'claudebot',
  'claude-web',
  'anthropic-ai',
  'perplexitybot',
  'perplexity-user',
  'duckassistbot',
  'applebot',
  'applebot-extended',
  'ccbot',
  'google-extended',
  'cohere-ai',
  'diffbot',
  'timpibot',
  'omgili',
  'webzio-extended',
  // Search, SEO and preview crawlers. Served, never counted.
  'googlebot',
  'googleother',
  'google-inspectiontool',
  'storebot-google',
  'adsbot-google',
  'google-adsbot',
  'mediapartners-google',
  'apis-google',
  'feedfetcher-google',
  'bingbot',
  'bingpreview',
  'msnbot',
  'yandexbot',
  'yandeximages',
  'yandexuserproxy',
  'securityresearch',
  'baiduspider',
  'duckduckbot',
  'slurp',
  'bravebot',
  'seznambot',
  'sogou',
  'exabot',
  'ia_archiver',
  'archive.org_bot',
  'semrushbot',
  'ahrefsbot',
  'ahrefssiteaudit',
  'mj12bot',
  'dotbot',
  'rogerbot',
  'screaming frog',
  'serpstatbot',
  'dataforseobot',
  'barkrowler',
  'zoominfobot',
  'facebookexternalhit',
  'facebookcatalog',
  'twitterbot',
  'linkedinbot',
  'slackbot',
  'slack-imgproxy',
  'discordbot',
  'telegrambot',
  'pinterestbot',
  'redditbot',
  'embedly',
  'bitlybot',
  'vkshare',
  'skypeuripreview',
  'nuzzel',
  'outbrain',
  // Headless automation. Never a student on this site.
  'headlesschrome',
  'phantomjs',
  'puppeteer',
  'playwright',
  'selenium',
  'webdriver',
  'cypress',
  'scrapy',
  'apache-httpclient',
  'python-requests',
  'python-urllib',
  'aiohttp',
  'httpx',
  'go-http-client',
  'okhttp',
  'node-fetch',
  'guzzlehttp',
  'libwww-perl',
  'curl',
  'wget',
  // Uptime and performance monitors.
  'uptimerobot',
  'pingdom',
  'statuscake',
  'betteruptime',
  'site24x7',
  'newrelicpinger',
  'datadog',
  'chrome-lighthouse',
  'lighthouse',
  'pagespeed',
  'gtmetrix',
  'webpagetest',
] as const

/**
 * `token`, bounded by anything that is not a letter or digit.
 *
 * The boundary has to admit `-`, `.` and `_`, because real agents suffix
 * themselves that way: `Slackbot-LinkExpanding`, `Applebot-Extended`,
 * `AhrefsSiteAudit`. It must still reject a token that runs straight into more
 * letters, which is what keeps `Securlocker` off the `curl` token and
 * `SogouMobileBrowser` off `sogou` — see the substring cases in the tests.
 */
const BOT_TOKEN_RE = new RegExp(
  `(?:^|[^a-z0-9])(?:${BOT_TOKENS.map(escapeRe).join('|')})(?:$|[^a-z0-9])`,
  'i',
)

/**
 * Anything that versions itself as a bot/crawler/spider. Catches the next
 * `AIWebIndex` before anyone has to notice it in the logs and add it above.
 * The `/<digit>` is required for the same reason as in `blocked-crawlers`: a
 * bare "bot" appears in device names (CUBOT_X30) and product names.
 */
const GENERIC_BOT_RE =
  /(?:^|[^a-z0-9])[a-z0-9._-]*(?:bot|crawler|spider|scraper|indexer)\/[0-9]/i

/** Unversioned but unambiguous self-descriptions. */
const GENERIC_WORD_RE = /(?:^|[^a-z0-9])(?:crawler|spider)(?:$|[^a-z0-9])/i

/**
 * A user agent that is just a URL. No browser sends this; vulnerability
 * scanners do. Ours currently probes with
 * `http://stanfordroot.com/wp-admin/install.php?step=1`, looking for a
 * WordPress install that does not exist.
 */
const URL_AS_UA_RE = /^\s*https?:\/\//i

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * True when this user agent is a bot whose activity must not reach analytics.
 *
 * An absent or empty user agent returns false. Google's renderer sends requests
 * with no UA at all, and more importantly a missing UA is not evidence of
 * anything — treating it as a bot would silently drop real students behind
 * privacy extensions.
 */
export function isKnownBot(userAgent: string | null | undefined): boolean {
  if (!userAgent) return false
  return (
    BOT_TOKEN_RE.test(userAgent) ||
    GENERIC_BOT_RE.test(userAgent) ||
    GENERIC_WORD_RE.test(userAgent) ||
    URL_AS_UA_RE.test(userAgent)
  )
}

/** The tokens themselves, for tests and for any future robots.txt use. */
export const botTokens = BOT_TOKENS
