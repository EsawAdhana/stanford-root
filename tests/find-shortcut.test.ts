import { it, expect, describe } from 'vitest'
import { isFindShortcut } from '@/hooks/use-find-shortcut'

/**
 * Ctrl-F / Cmd-F is taken over on three views (catalog, schedule, comments), so
 * the predicate that decides "this keystroke is ours" has to be narrow. Every
 * case below is one a student can hit by accident: Cmd-Shift-F and Alt-Cmd-F
 * belong to other tools, a bare "f" is someone typing, and a held Cmd with any
 * other letter is a different shortcut entirely. Getting any of them wrong
 * swallows a key the browser or the student meant to use.
 */

const key = (over: Partial<KeyboardEvent> & { key: string }) => ({
  metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...over,
})

describe('isFindShortcut', () => {
  it('claims Ctrl-F and Cmd-F', () => {
    expect(isFindShortcut(key({ key: 'f', ctrlKey: true }))).toBe(true)
    expect(isFindShortcut(key({ key: 'f', metaKey: true }))).toBe(true)
  })

  it('claims it with caps lock on, where the browser reports "F"', () => {
    expect(isFindShortcut(key({ key: 'F', metaKey: true }))).toBe(true)
  })

  it('leaves Shift-Cmd-F and Alt-Cmd-F alone', () => {
    expect(isFindShortcut(key({ key: 'f', metaKey: true, shiftKey: true }))).toBe(false)
    expect(isFindShortcut(key({ key: 'f', metaKey: true, altKey: true }))).toBe(false)
    expect(isFindShortcut(key({ key: 'f', ctrlKey: true, shiftKey: true }))).toBe(false)
  })

  it('leaves a plain "f" alone, so typing in any field still types', () => {
    expect(isFindShortcut(key({ key: 'f' }))).toBe(false)
    expect(isFindShortcut(key({ key: 'F', shiftKey: true }))).toBe(false)
  })

  it('leaves other modified keys alone', () => {
    expect(isFindShortcut(key({ key: 'g', metaKey: true }))).toBe(false)
    expect(isFindShortcut(key({ key: 'k', metaKey: true }))).toBe(false)
    expect(isFindShortcut(key({ key: 'ArrowRight', ctrlKey: true }))).toBe(false)
  })

  it('survives events with no usable key (IME composition, autofill)', () => {
    expect(isFindShortcut(key({ key: '', metaKey: true }))).toBe(false)
    expect(isFindShortcut({ key: undefined as unknown as string, metaKey: true, ctrlKey: false, shiftKey: false, altKey: false })).toBe(false)
  })
})
