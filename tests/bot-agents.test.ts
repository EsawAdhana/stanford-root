import { afterEach, describe, expect, it, vi } from 'vitest'
import { isKnownBot, isBotClient } from '@/lib/bot-agents'
import { isBlockedCrawler } from '@/lib/blocked-crawlers'

/**
 * `isKnownBot` gates the `/api/track` insert, so the two failure modes are:
 *
 *   - false positive → one real student's event is silently dropped.
 *   - false negative → every session and visitor number on the dashboard is
 *     inflated, which is the bug this function exists to fix.
 *
 * Both are cheap per-event and expensive in aggregate, so the bot strings below
 * are the real ones from Vercel's request log for this project over
 * 2026-09-14 to 09-17, and the human strings are the same corpus
 * `blocked-crawlers.test.ts` uses, on the principle that a UA which must not
 * get a 403 must also not be erased from the numbers.
 */

// Every one of these was pulled from `vercel metrics ... --group-by
// client_user_agent` for this project, ordered by request count.
const REAL_BOTS_FROM_OUR_LOGS = [
  // 152,929 requests over three days: the scraper this work was triggered by.
  'AIWebIndex/2.0 (+https://lyrenth.com/bot; AI-readable web index)',
  // 80,169 requests, and the single largest source of fake analytics events.
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36 (compatible; meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler))',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36 (compatible; meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler))',
  'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Amazonbot/0.1; +https://developer.amazon.com/support/amazonbot) Chrome/119.0.6045.214 Safari/537.36',
  'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7977.82 Mobile Safari/537.36 (compatible; GoogleOther)',
  'Mozilla/5.0 (Linux; Android 7.0;) AppleWebKit/537.36 (HTML, like Gecko) Mobile Safari/537.36 (compatible; PetalBot;+https://webmaster.petalsearch.com/site/petalbot)',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/151.0.0.0 Safari/537.36',
  'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Bravebot/1.0; +https://search.brave.com/help/brave-search-crawler)',
  'TheWebReport/1.0; +https://theweb.report',
  'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ShapBot/0.1.0',
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
  'Mozilla/5.0 (compatible; SemrushBot/7~bl; +http://www.semrush.com/bot.html)',
  'Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)',
  'Mozilla/5.0 (compatible; CCBot/2.0; +https://commoncrawl.org/faq/)',
  'Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)',
  'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot',
  'Mozilla/5.0 (compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot)',
  'Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)',
  'Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)',
  'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
  'Twitterbot/1.0',
  'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
  'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
  'Mozilla/5.0 (compatible; Yandex/1.01.001; +http://yandex.com/bots) YandexBot/3.0',
  'Mozilla/5.0 (compatible; Baiduspider/2.0; +http://www.baidu.com/search/spider.html)',
  'Mozilla/5.0 (compatible; DuckDuckBot/1.1; +http://duckduckgo.com/duckduckbot.html)',
  'Mozilla/5.0 (compatible; Applebot/0.1; +http://www.apple.com/go/applebot)',
  'Mozilla/5.0 (compatible; Bytespider; +https://zhanzhang.toutiao.com/) AppleWebKit/537.36',
  'curl/8.7.1',
  'Wget/1.21.4',
  'python-requests/2.32.3',
  'Go-http-client/2.0',
  'Scrapy/2.11.2 (+https://scrapy.org)',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Chrome-Lighthouse',
  'Mozilla/5.0 (compatible; UptimeRobot/2.0; http://www.uptimerobot.com/)',
]

// Byte-identical to the human corpus in blocked-crawlers.test.ts. If a string
// is safe enough to serve, it is real enough to count.
const REAL_HUMANS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6.1 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 26_6_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/153.0.8010.24 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36 Edg/153.0.0.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:155.0) Gecko/20100101 Firefox/155.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6.2 Safari/605.1.15',
  'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.7871.184 Safari/537.36 Honorlock',
  'Instagram 441.0.0.29.79 (iPhone14,5; iOS 26_5_2; en_US; en; scale=3.00; 1170x2532; 1030250346) AppleWebKit/420+',
  'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/99.0.4844.51 Mobile Safari/537.36 MicroMessenger/7.0.1',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Claude/1.46388.4 Chrome/148.0.7778.280 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 YaBrowser/26.8.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Whale/4.39.410.13 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 Vivaldi/7.5.3735',
]

const STUDENT_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36'

describe('counts no bot as a visitor', () => {
  it.each(REAL_BOTS_FROM_OUR_LOGS)('suppresses %s', (ua) => {
    expect(isKnownBot(ua)).toBe(true)
  })

  it('suppresses a scanner that sends a URL as its user agent', () => {
    // Real string from the logs: something probing for a WordPress install.
    expect(isKnownBot('http://stanfordroot.com/wp-admin/install.php?step=1')).toBe(true)
    expect(isKnownBot('https://example.com/')).toBe(true)
  })

  it('suppresses the self-declared robots the generic rules would miss', () => {
    expect(isKnownBot('Mozilla/5.0 (compatible; YandexUserproxy; robot; +http://yandex.com/bots)')).toBe(true)
    expect(isKnownBot('Mozilla/5.0 (compatible; SecurityResearch/1.0)')).toBe(true)
  })

  it('catches the next unknown crawler by its version suffix alone', () => {
    // The point of the generic rule: nobody should have to notice these in the
    // logs first, the way AIWebIndex had to be noticed.
    expect(isKnownBot('SomeBrandNewBot/1.0 (+http://example.com)')).toBe(true)
    expect(isKnownBot('AcmeCrawler/3.2')).toBe(true)
    expect(isKnownBot('DataSpider/0.9-beta')).toBe(true)
    expect(isKnownBot('CatalogScraper/2')).toBe(true)
    expect(isKnownBot('Some-Indexer/1.4')).toBe(true)
    expect(isKnownBot('Mozilla/5.0 (compatible; a web crawler)')).toBe(true)
  })
})

describe('erases nobody real from the numbers', () => {
  it.each(REAL_HUMANS)('counts %s', (ua) => {
    expect(isKnownBot(ua)).toBe(false)
  })

  it('counts a missing or empty user agent, which is not evidence of anything', () => {
    // Google's renderer sends no UA, and so do students behind privacy
    // extensions. Treating absence as a bot would drop real traffic.
    expect(isKnownBot(null)).toBe(false)
    expect(isKnownBot(undefined)).toBe(false)
    expect(isKnownBot('')).toBe(false)
  })

  it('does not fire on a bot token buried inside a longer word', () => {
    // The device names and browsers that a naive substring match would erase.
    expect(isKnownBot('Mozilla/5.0 (Linux; Android 10; CUBOT_X30 Build/QP1A) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Mobile Safari/537.36')).toBe(false)
    expect(isKnownBot('Mozilla/5.0 (Linux; Android 13; SogouMobileBrowser/5.2) AppleWebKit/537.36 Chrome/152.0.0.0')).toBe(false)
    expect(isKnownBot('Mozilla/5.0 Securlocker/2.1 Safari/537.36')).toBe(false)
    expect(isKnownBot('Mozilla/5.0 (Windows NT 10.0) Roboto/1.0 Safari/537.36')).toBe(false)
    expect(isKnownBot('Mozilla/5.0 Spidermonkey-Browser/4.0')).toBe(false)
    expect(isKnownBot('Mozilla/5.0 (compatible; Abbotsford/1.0)')).toBe(false)
    expect(isKnownBot('Mozilla/5.0 Wgetter/1.0')).toBe(false)
  })

  it('does not fire on an unversioned bare token that is too loose to be a signature', () => {
    expect(isKnownBot('a browser that is not a bot')).toBe(false)
    expect(isKnownBot('Mozilla/5.0 (I am definitely not a robot)')).toBe(false)
  })

  it('counts the OS-level fetchers that belong to a real device', () => {
    // These are the top "crawler-shaped" agents in our own logs that are
    // nonetheless a person's iPhone or Mac: iOS link previews, Safari's
    // networking stack, and Chrome's prefetch proxy. They fetch without running
    // JS, so they never reach /api/track anyway, but if that changes they are a
    // real device and should be counted, not erased.
    expect(isKnownBot('NetworkingExtension/8624.5.1.10.3 Network/5812.160.9 iOS/26.6.2')).toBe(false)
    expect(isKnownBot('com.apple.WebKit.Networking/21624.5.1.11.3 Network/5812.160.9 macOS/26.6.2')).toBe(false)
    expect(isKnownBot('Chrome Privacy Preserving Prefetch Proxy')).toBe(false)
  })

  it('leaves the agents that act for a real person alone, matching the 403 policy', () => {
    // Same call as blocked-crawlers: someone asked for the page.
    expect(isKnownBot('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 GrokAgent/1.0 (u:c459251c33139908)')).toBe(false)
    expect(isKnownBot('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36; Manus-User/1.0')).toBe(false)
    expect(isKnownBot('Google-NotebookLM')).toBe(false)
    expect(isKnownBot('Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36 (compatible; Google-Read-Aloud; +https://support.google.com/webmasters/answer/1061943)')).toBe(false)
  })
})

describe('the two policies stay separate', () => {
  /**
   * The invariant that keeps this refactor-safe. Search engines are how
   * students find the site, so they must be served; they are not students, so
   * they must not be counted. Anything that trips the 403 list must also be
   * suppressed from analytics, never the reverse.
   */
  const searchEngines = [
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
  ]

  it.each(searchEngines)('serves but does not count %s', (ua) => {
    expect(isBlockedCrawler(ua)).toBe(false)
    expect(isKnownBot(ua)).toBe(true)
  })

  it.each([...REAL_BOTS_FROM_OUR_LOGS])(
    'suppresses analytics for anything the 403 list blocks: %s',
    (ua) => {
      if (isBlockedCrawler(ua)) expect(isKnownBot(ua)).toBe(true)
    },
  )

  it.each(REAL_HUMANS)('never 403s or uncounts a real student: %s', (ua) => {
    expect(isBlockedCrawler(ua)).toBe(false)
    expect(isKnownBot(ua)).toBe(false)
  })
})

describe('isBotClient: the browser-side guard for Human Behavior', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const stub = (nav: unknown) => vi.stubGlobal('navigator', nav)

  it('catches a headless scraper impersonating a real student, which the server cannot', () => {
    // This is the whole reason the check exists client-side. The user agent is
    // byte-identical to a real student's, so /api/track's server-side filter
    // has nothing to go on; only navigator.webdriver gives it away.
    stub({ webdriver: true, userAgent: STUDENT_UA })
    expect(isKnownBot(STUDENT_UA)).toBe(false)
    expect(isBotClient()).toBe(true)
  })

  it('leaves a real student alone', () => {
    stub({ webdriver: false, userAgent: STUDENT_UA })
    expect(isBotClient()).toBe(false)
  })

  it('treats a missing webdriver property as a real browser', () => {
    // Older browsers do not define it at all; absence is not evidence.
    stub({ userAgent: STUDENT_UA })
    expect(isBotClient()).toBe(false)
  })

  it('still catches a self-identifying crawler by user agent', () => {
    stub({ webdriver: false, userAgent: 'AIWebIndex/2.0 (+https://lyrenth.com/bot)' })
    expect(isBotClient()).toBe(true)
  })

  it('falls back to the user agent if reading webdriver throws', () => {
    stub({
      get webdriver(): boolean {
        throw new Error('blocked by a hardening extension')
      },
      userAgent: 'AIWebIndex/2.0 (+https://lyrenth.com/bot)',
    })
    expect(isBotClient()).toBe(true)
  })

  it('does not throw and does not claim bot when there is no navigator at all', () => {
    // Server render and prerender. Must never report a bot, or a static build
    // could bake in the wrong behaviour.
    stub(undefined)
    expect(isBotClient()).toBe(false)
  })
})
