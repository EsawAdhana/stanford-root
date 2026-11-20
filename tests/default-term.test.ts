import { describe, expect, it } from 'vitest'
import { getDefaultTerm, PLANNING_TERM } from '@/lib/terms'

/**
 * From late November students plan Winter, so the app opens on PLANNING_TERM
 * (Winter 2027) instead of the Autumn quarter still in session. The override has
 * to lapse by itself once Winter is over, and must never land on a term the
 * catalog has no classes for.
 */
const TERMS = ['Autumn 2026', 'Winter 2027', 'Spring 2027', 'Summer 2027']
const on = (y: number, m: number, d: number) => new Date(y, m - 1, d)

describe('the planning quarter', () => {
    it('is Winter 2027', () => {
        expect(PLANNING_TERM).toBe('Winter 2027')
    })

    it('wins over Autumn while Autumn is in session', () => {
        expect(getDefaultTerm(TERMS, on(2026, 11, 20))).toBe('Winter 2027')
        expect(getDefaultTerm(TERMS, on(2026, 12, 31))).toBe('Winter 2027')
    })

    it('is the default before the catalog has loaded', () => {
        expect(getDefaultTerm(undefined, on(2026, 11, 20))).toBe('Winter 2027')
        expect(getDefaultTerm([], on(2026, 11, 20))).toBe('Winter 2027')
    })

    it('stays the default while Winter is in session', () => {
        expect(getDefaultTerm(TERMS, on(2027, 1, 6))).toBe('Winter 2027')
        expect(getDefaultTerm(TERMS, on(2027, 3, 31))).toBe('Winter 2027')
    })

    it('lapses once Spring starts, with nothing to clear by hand', () => {
        expect(getDefaultTerm(TERMS, on(2027, 4, 1))).toBe('Spring 2027')
        expect(getDefaultTerm(undefined, on(2027, 4, 1))).toBe('Spring 2027')
    })

    it('keeps the summer rule once it has lapsed', () => {
        expect(getDefaultTerm(['Autumn 2027', 'Spring 2027', 'Summer 2027'], on(2027, 7, 15))).toBe('Autumn 2027')
    })

    it('falls back to the quarter in session when the catalog has no Winter yet', () => {
        expect(getDefaultTerm(['Autumn 2026', 'Spring 2027'], on(2026, 11, 20))).toBe('Autumn 2026')
    })
})
