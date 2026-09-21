import { useEffect, type RefObject } from 'react'

/**
 * True when a keydown is the plain "find on page" chord (Ctrl-F / Cmd-F).
 *
 * Split out from the hook so the modifier rules are testable without a DOM.
 * Shift and Alt are excluded on purpose: Cmd-Shift-F and Alt-Cmd-F are other
 * shortcuts (and browser/OS ones), so claiming them would steal keys the
 * student meant for something else.
 */
export function isFindShortcut(e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>): boolean {
  if (e.key?.toLowerCase() !== 'f') return false
  if (!e.metaKey && !e.ctrlKey) return false
  return !e.shiftKey && !e.altKey
}

/**
 * Point Ctrl-F / Cmd-F at the search box the page already has.
 *
 * Every view here that filters a list has its own search field, and the
 * browser's find bar is the wrong tool for all of them: it only matches the
 * rows currently rendered, so on a comment list that lazy-loads ten at a time
 * it silently misses most of the text a student is looking for.
 *
 * `enabled` exists because the catalog header shares one SearchBar across
 * routes and only wants the shortcut on the catalog itself.
 */
export function useFindShortcut(ref: RefObject<HTMLInputElement | null>, enabled = true): void {
  useEffect(() => {
    if (!enabled) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isFindShortcut(e)) return
      const input = ref.current
      if (!input) return
      e.preventDefault()
      input.focus()
      input.select()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [ref, enabled])
}
