/**
 * Keeps the catalog search box and the ?q= URL parameter in step without the
 * URL ever overwriting what the student is typing.
 *
 * The box writes to the URL 250 ms after the last keystroke. The URL comes back
 * later (nuqs throttles the write, then Next re-renders the catalog), and the
 * box used to copy every value that came back into itself. Typing at about one
 * key per 250 ms, an older value could come back after the next letter was
 * typed, wipe it, and get written again: "machine learning" became
 * "machine leaning".
 *
 * The value comes back late because the catalog re-renders before the box sees
 * it: on a slow laptop the next key lands first. It can also come back more than
 * once, and out of order: nuqs applies the write at once, then re-reads ?q=
 * from Next's search params, which can still hold an earlier write for a moment.
 *
 * So the box is the source of truth while it is in use. A URL value the box
 * wrote in the last few seconds is an echo and is ignored. Any other value came
 * from somewhere else (Back/Forward, Clear all, a link) and replaces the text.
 */

export const SEARCH_DEBOUNCE_MS = 250
/** How long a value the box wrote can still come back as an echo. */
export const ECHO_WINDOW_MS = 2000

export type SearchBoxSync = {
  /** The text in the box. */
  readonly value: string
  /** The student typed; commits after the debounce. */
  type(value: string): void
  /** ?q= changed. Replaces the box's text only when the change didn't come from the box. */
  urlChanged(query: string): void
  /**
   * Commit now (Enter, or the box lost focus). Writes nothing when ?q= already
   * holds the text: any ?q= write while a link click is navigating cancels the
   * navigation, so a card clicked right after a search needed a second click.
   */
  flush(): void
  /**
   * The box lost focus to a press on a link. Hold the pending commit until the
   * click resolves, since writing ?q= now would cancel the navigation.
   */
  holdForLink(): void
  /**
   * The press that blurred the box is over. If it started a navigation, the
   * pending text is dropped (the catalog is going away); otherwise it commits.
   */
  releaseLink(navigating: boolean): void
  /** Cancel any pending commit (unmount). */
  dispose(): void
}

type Options = {
  initial: string
  /** Writes ?q=; null removes it. */
  commit: (query: string | null) => void
  /** Called when the box's text must change for a reason other than typing. */
  onValue: (value: string) => void
  delayMs?: number
}

/** What a box value looks like once it is in the URL: blank becomes no parameter, read back as ''. */
const urlForm = (value: string) => (value.trim() ? value : '')

export function createSearchBoxSync({ initial, commit, onValue, delayMs = SEARCH_DEBOUNCE_MS }: Options): SearchBoxSync {
  let value = initial
  // The last value the URL holds or was told to hold, in URL form.
  let committed = urlForm(initial)
  // Values the box wrote recently, with when, so their echoes can be recognised.
  let recentWrites: { query: string; at: number }[] = []
  let timer: ReturnType<typeof setTimeout> | null = null
  let held = false

  const cancel = () => {
    if (timer != null) clearTimeout(timer)
    timer = null
  }

  const write = () => {
    cancel()
    held = false
    const next = urlForm(value)
    if (next === committed) return
    committed = next
    const now = Date.now()
    recentWrites = recentWrites.filter(w => now - w.at < ECHO_WINDOW_MS)
    recentWrites.push({ query: next, at: now })
    commit(next || null)
  }

  return {
    get value() { return value },
    type(next) {
      value = next
      held = false
      cancel()
      timer = setTimeout(write, delayMs)
    },
    urlChanged(query) {
      if (query === urlForm(value)) return
      const now = Date.now()
      if (recentWrites.some(w => w.query === query && now - w.at < ECHO_WINDOW_MS)) return
      cancel()
      held = false
      recentWrites = []
      committed = query
      value = query
      onValue(query)
    },
    flush: write,
    holdForLink() {
      if (timer == null) return
      cancel()
      held = true
    },
    releaseLink(navigating) {
      if (!held) return
      held = false
      if (!navigating) write()
    },
    dispose: cancel,
  }
}
