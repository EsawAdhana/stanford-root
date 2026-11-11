import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSearchBoxSync, SEARCH_DEBOUNCE_MS, type SearchBoxSync } from '@/lib/search-box-sync'

/**
 * Reproduced in the browser (CPU slowed 10x): typing "machine learning" at
 * about 250 ms a key ended as "mcieleanng". Each commit re-rendered the whole
 * catalog, the next key landed before that render did, and the render then
 * copied the committed (older) text back into the box.
 *
 * The harness below plays the URL the way nuqs and Next deliver it: each write
 * comes back after a render delay, and comes back again later from Next's
 * search params, sometimes after a newer write has already landed.
 */

type Url = { value: string; writes: (string | null)[] }

function harness(opts: { renderMs: number; rereadMs: number }) {
  const url: Url = { value: '', writes: [] }
  let box = ''
  let sync: SearchBoxSync
  const deliver = (q: string) => { url.value = q; sync.urlChanged(q) }
  sync = createSearchBoxSync({
    initial: '',
    commit: q => {
      url.writes.push(q)
      const v = q ?? ''
      setTimeout(() => deliver(v), opts.renderMs)
      setTimeout(() => deliver(v), opts.rereadMs)
    },
    onValue: v => { box = v },
  })
  const type = (ch: string) => { box += ch; sync.type(box) }
  return { url, type, get box() { return box }, sync, deliver }
}

/** Keys roughly 245 ms apart, the way a person types: some gaps a little over the debounce. */
const GAPS = [245, 255, 240, 262, 245, 251]

function typeSlowly(h: { type: (ch: string) => void }, text: string) {
  let i = 0
  for (const ch of text) {
    h.type(ch)
    vi.advanceTimersByTime(GAPS[i++ % GAPS.length])
  }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('search box and ?q=', () => {
  it('keeps every letter when the URL echoes a commit after the next key', () => {
    const h = harness({ renderMs: 20, rereadMs: 400 })
    typeSlowly(h, 'machine learning')
    vi.advanceTimersByTime(3000)
    expect(h.box).toBe('machine learning')
    expect(h.url.value).toBe('machine learning')
  })

  it('keeps every letter on a slow laptop where the render takes longer than a key', () => {
    const h = harness({ renderMs: 260, rereadMs: 700 })
    typeSlowly(h, 'machine learning')
    vi.advanceTimersByTime(3000)
    expect(h.box).toBe('machine learning')
    expect(h.url.value).toBe('machine learning')
  })

  it('this timeline does drop letters under the old rule (the URL always overwrites the box)', () => {
    // The old SearchBar: an effect copied ?q= into the box on every change.
    const url = { value: '' }
    let box = ''
    let timer: ReturnType<typeof setTimeout> | undefined
    const urlChanged = (q: string) => { url.value = q; box = q }
    const type = (ch: string) => {
      box += ch
      clearTimeout(timer)
      const v = box
      timer = setTimeout(() => {
        setTimeout(() => urlChanged(v), 260)
        setTimeout(() => urlChanged(v), 700)
      }, SEARCH_DEBOUNCE_MS)
    }
    typeSlowly({ type }, 'machine learning')
    vi.advanceTimersByTime(3000)
    expect(box).not.toBe('machine learning')
  })

  it('commits once, 250 ms after the last key', () => {
    const h = harness({ renderMs: 20, rereadMs: 400 })
    for (const ch of 'math') { h.type(ch); vi.advanceTimersByTime(100) }
    expect(h.url.writes).toEqual([])
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS)
    expect(h.url.writes).toEqual(['math'])
  })

  it('takes Clear all and Back from the URL', () => {
    const h = harness({ renderMs: 20, rereadMs: 400 })
    for (const ch of 'math') h.type(ch)
    vi.advanceTimersByTime(5000)
    h.deliver('')
    expect(h.box).toBe('')
    h.deliver('cs 106a')
    expect(h.box).toBe('cs 106a')
  })

  it('drops a pending commit when the URL changes for another reason', () => {
    const h = harness({ renderMs: 20, rereadMs: 400 })
    for (const ch of 'math') h.type(ch)
    vi.advanceTimersByTime(5000)
    h.type('s')
    h.deliver('')
    vi.advanceTimersByTime(5000)
    expect(h.box).toBe('')
    expect(h.url.writes).toEqual(['math'])
  })

  it('writes no parameter for a blank box, and a flush with nothing new writes nothing', () => {
    const h = harness({ renderMs: 20, rereadMs: 400 })
    h.type('a')
    h.sync.flush()
    expect(h.url.writes).toEqual(['a'])
    h.sync.flush()
    expect(h.url.writes).toEqual(['a'])
    h.sync.type('   ')
    h.sync.flush()
    expect(h.url.writes).toEqual(['a', null])
  })

  // Any ?q= write while a link click is navigating cancels the navigation (Next
  // treats the replaceState as a newer action), so a course card clicked right
  // after typing only blurred the box. Reproduced in a production build: type
  // "writing", click the second card, and the page stays on the catalog.
  describe('blurring the box by pressing a link', () => {
    it('writes nothing when ?q= already holds the text', () => {
      const h = harness({ renderMs: 20, rereadMs: 400 })
      for (const ch of 'writing') h.type(ch)
      vi.advanceTimersByTime(1000)
      expect(h.url.writes).toEqual(['writing'])
      h.sync.holdForLink()
      h.sync.flush()
      h.sync.releaseLink(true)
      vi.advanceTimersByTime(5000)
      expect(h.url.writes).toEqual(['writing'])
    })

    it('holds a pending search while the click resolves, and drops it if the link navigates', () => {
      const h = harness({ renderMs: 20, rereadMs: 400 })
      for (const ch of 'writing') h.type(ch)
      vi.advanceTimersByTime(100)
      h.sync.holdForLink()
      vi.advanceTimersByTime(1000)
      expect(h.url.writes).toEqual([])
      h.sync.releaseLink(true)
      vi.advanceTimersByTime(5000)
      expect(h.url.writes).toEqual([])
    })

    it('commits the held search when the press did not navigate', () => {
      const h = harness({ renderMs: 20, rereadMs: 400 })
      for (const ch of 'writing') h.type(ch)
      vi.advanceTimersByTime(100)
      h.sync.holdForLink()
      h.sync.releaseLink(false)
      expect(h.url.writes).toEqual(['writing'])
    })

    it('typing again after a hold debounces as usual', () => {
      const h = harness({ renderMs: 20, rereadMs: 400 })
      h.type('w')
      h.sync.holdForLink()
      h.type('r')
      h.sync.releaseLink(true)
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS)
      expect(h.url.writes).toEqual(['wr'])
    })
  })
})
