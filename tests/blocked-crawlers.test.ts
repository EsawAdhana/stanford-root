import { describe, expect, it } from 'vitest'
import { isBlockedCrawler } from '@/lib/blocked-crawlers'

/**
 * The block in `src/middleware.ts` returns 403 to anything this function calls
 * true, so the expensive mistake is a false positive: one bad match and real
 * students, or Googlebot, get a blank page.
 *
 * Every string below is a real user agent taken from the site's own analytics
 * over 2026-08-10 to 09-09, plus the adversarial variants the crawler could
 * plausibly switch to.
 *
 * That sample is spot checking. The population check was run in ClickHouse
 * against all 414 distinct user agents the site has ever recorded: exactly two
 * match, `ShapBot/0.1.0` and `Shap-User/0.1.0`, and no other user agent so much
 * as contains the substring "shap". Re-run it if the list in
 * `lib/blocked-crawlers` grows:
 *
 *   SELECT DISTINCT JSONExtractString(properties, '$raw_user_agent') AS ua
 *   FROM events WHERE project_id = '…' AND ua != ''
 *     AND match(lower(ua), '(^|[^a-z0-9-])(shapbot|shap-user)/[0-9]')
 */

const SHAPBOT =
  'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ShapBot/0.1.0'

describe('blocks the catalog scraper', () => {
  it('blocks the exact user agent seen in the logs', () => {
    expect(isBlockedCrawler(SHAPBOT)).toBe(true)
  })

  it('blocks its sibling and ignores casing', () => {
    expect(isBlockedCrawler('Mozilla/5.0 (KHTML, like Gecko); compatible; Shap-User/0.1.0')).toBe(true)
    expect(isBlockedCrawler(SHAPBOT.toLowerCase())).toBe(true)
    expect(isBlockedCrawler(SHAPBOT.toUpperCase())).toBe(true)
  })

  it('still blocks it after a version bump', () => {
    expect(isBlockedCrawler('compatible; ShapBot/1.0')).toBe(true)
    expect(isBlockedCrawler('compatible; ShapBot/12.4.7-beta')).toBe(true)
  })

  it('blocks it bare, with no Mozilla prefix', () => {
    expect(isBlockedCrawler('ShapBot/0.1.0')).toBe(true)
  })
})

describe('does not block anyone real', () => {
  // Top real user agents by session count over the month.
  const humans = [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6.1 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:155.0) Gecko/20100101 Firefox/155.0',
    'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Mobile Safari/537.36',
    // Honorlock is a proctoring browser, so this is a student mid-exam.
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.7871.184 Safari/537.36 Honorlock',
    // The odd clients real students actually arrive in: the Instagram and WeChat
    // in-app browsers, Claude's desktop app, Chromebooks, and the smaller
    // Chromium forks. Every one of these is a person.
    'Instagram 441.0.0.29.79 (iPhone14,5; iOS 26_5_2; en_US; en; scale=3.00; 1170x2532; 1030250346) AppleWebKit/420+',
    'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/99.0.4844.51 Mobile Safari/537.36 MicroMessenger/7.0.1',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Claude/1.46388.4 Chrome/148.0.7778.280 Safari/537.36',
    'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 YaBrowser/26.8.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Whale/4.39.410.13 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 Vivaldi/7.5.3735',
  ]

  it.each(humans)('allows %s', (ua) => {
    expect(isBlockedCrawler(ua)).toBe(false)
  })

  it('allows the search crawlers the site depends on', () => {
    expect(
      isBlockedCrawler('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'),
    ).toBe(false)
    expect(isBlockedCrawler('Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)')).toBe(
      false,
    )
  })

  it('allows an absent or empty user agent, which is what Google’s renderer sends', () => {
    expect(isBlockedCrawler(null)).toBe(false)
    expect(isBlockedCrawler(undefined)).toBe(false)
    expect(isBlockedCrawler('')).toBe(false)
  })

  it('does not match the token inside a longer word', () => {
    // The one that would actually bite: a substring match blocks these.
    expect(isBlockedCrawler('Mozilla/5.0 Shapbotter/3.0')).toBe(false)
    expect(isBlockedCrawler('Mozilla/5.0 (compatible; MyShapbot/1.0)')).toBe(false)
    expect(isBlockedCrawler('Mozilla/5.0 Shapshot/2.0')).toBe(false)
    expect(isBlockedCrawler('Mozilla/5.0 Shap-Users/1.0')).toBe(false)
  })

  it('does not match a bare token with no version, which is too loose to be a signature', () => {
    expect(isBlockedCrawler('shapbot')).toBe(false)
    expect(isBlockedCrawler('a page about shapbot')).toBe(false)
  })

  it('leaves the agents that browse on behalf of a person alone', () => {
    // 13 sessions between them over a month, and someone asked for the page.
    // They are a product call, not a scraper, so they stay out of the list.
    expect(
      isBlockedCrawler(
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 GrokAgent/1.0 (u:c459251c33139908)',
      ),
    ).toBe(false)
    expect(
      isBlockedCrawler(
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36; Manus-User/1.0',
      ),
    ).toBe(false)
    expect(
      isBlockedCrawler(
        'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36 (compatible; Google-Read-Aloud; +https://support.google.com/webmasters/answer/1061943)',
      ),
    ).toBe(false)
    expect(isBlockedCrawler('Google-NotebookLM')).toBe(false)
  })
})
