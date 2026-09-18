import { afterEach, describe, expect, it, vi } from 'vitest'
import { startRecorder } from '@/lib/humanbehavior'

/**
 * Human Behavior is the one pipeline this repo cannot clean up after the fact.
 * It ingests straight from the browser to its own endpoint, so unlike
 * `/api/track` there is no server hop where a crawler's events can be dropped,
 * and no query here can correct its dashboard retroactively. Refusing to call
 * `init` is the only lever.
 *
 * That refusal is only worth anything because of how `cdn.humanbehavior.co/v1/
 * loader.js` is built. Read on 2026-09-17: it is a queueing shim that sets
 * `window.HumanBehaviorTracker`, leaves `cfg` null, registers no listeners and
 * issues no network request. It injects `recorder-<version>.js` from inside
 * `init()` and nowhere else, and it never reads a `data-` attribute to
 * self-start. So a loader that is never initialised downloads no recorder,
 * opens no session, and sends nothing. If that ever changes, these tests still
 * pass while the guarantee is gone, so the loader has to be re-read when the
 * channel publishes a new shim.
 */

const STUDENT_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36'

// Typed to match HumanBehaviorLoader.init, so `mock.calls[0][1]` is the options
// argument rather than an empty tuple.
const trackerSpy = () => {
  const init = vi.fn(
    (_apiKey: string, _options?: { ingestionUrl?: string; version?: string }) => ({
      identifyUser: vi.fn(() => Promise.resolve()),
    }),
  )
  return { init }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

const asBrowser = (nav: Record<string, unknown>) => vi.stubGlobal('navigator', nav)

describe('the recorder never starts for a crawler', () => {
  // The agents that were actually inflating the visitor count, from Vercel's
  // request log for this project.
  const crawlers = [
    'AIWebIndex/2.0 (+https://lyrenth.com/bot; AI-readable web index)',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36 (compatible; meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler))',
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Amazonbot/0.1; +https://developer.amazon.com/support/amazonbot) Chrome/119.0.6045.214 Safari/537.36',
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/151.0.0.0 Safari/537.36',
  ]

  it.each(crawlers)('declines to init for %s', (ua) => {
    asBrowser({ webdriver: false, userAgent: ua })
    const tracker = trackerSpy()
    expect(startRecorder('hb_key', tracker)).toBe(false)
    expect(tracker.init).not.toHaveBeenCalled()
  })

  it('declines for a headless scraper wearing a real student user agent', () => {
    // meta-externalagent and friends announce themselves. This one does not:
    // Vercel classified 17,426 requests a week as browser_impersonation, whose
    // user agent is byte-identical to a student's. Only navigator.webdriver
    // separates them, and it exists solely in the browser, which is why this
    // guard cannot live on the server.
    asBrowser({ webdriver: true, userAgent: STUDENT_UA })
    const tracker = trackerSpy()
    expect(startRecorder('hb_key', tracker)).toBe(false)
    expect(tracker.init).not.toHaveBeenCalled()
  })
})

describe('the recorder still starts for a real student', () => {
  it('inits with the api key and the ingestion url', () => {
    asBrowser({ webdriver: false, userAgent: STUDENT_UA })
    const tracker = trackerSpy()
    expect(startRecorder('hb_key', tracker, { ingestionUrl: 'https://ingest.example' })).toBe(true)
    expect(tracker.init).toHaveBeenCalledTimes(1)
    expect(tracker.init).toHaveBeenCalledWith('hb_key', { ingestionUrl: 'https://ingest.example' })
  })

  it('passes no version, so the recorder tracks the channel instead of pinning', () => {
    // Pinning is what froze this app on recorder 0.8.2 for five releases.
    asBrowser({ webdriver: false, userAgent: STUDENT_UA })
    const tracker = trackerSpy()
    startRecorder('hb_key', tracker, { ingestionUrl: 'https://ingest.example' })
    const options = tracker.init.mock.calls[0][1]
    expect(options).toBeDefined()
    expect(options).not.toHaveProperty('version')
  })

  it('starts for a student whose browser predates navigator.webdriver', () => {
    asBrowser({ userAgent: STUDENT_UA })
    const tracker = trackerSpy()
    expect(startRecorder('hb_key', tracker)).toBe(true)
  })
})

describe('it declines safely when it cannot work at all', () => {
  it('does nothing without an api key, rather than initialising with undefined', () => {
    asBrowser({ webdriver: false, userAgent: STUDENT_UA })
    const tracker = trackerSpy()
    expect(startRecorder(undefined, tracker)).toBe(false)
    expect(tracker.init).not.toHaveBeenCalled()
  })

  it('does nothing when the loader script never defined the tracker', () => {
    // A content blocker or a CSP without the CDN host. Must not throw: this
    // runs from a Script onLoad handler on every page load.
    asBrowser({ webdriver: false, userAgent: STUDENT_UA })
    expect(() => startRecorder('hb_key', undefined)).not.toThrow()
    expect(startRecorder('hb_key', undefined)).toBe(false)
  })
})
