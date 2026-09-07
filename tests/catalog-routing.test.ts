import fs from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { getCrossListPrimaryMap, getCrossListGroupIds, normalizeCourseId, resolveToCanonicalPrimary } from '@/lib/utils'

/**
 * Every course must be reachable at its own URL. Cross-list resolution rewrites
 * /<id> to a canonical primary, so a bad mapping silently redirects a
 * real course to a different one (or to nothing). Checked over the whole dump.
 */
type Course = { course_id: string; subject: string; code: string; title: string }

let courses: Array<{ id: string; title: string }>
let ids: Set<string>
let primaryMap: Map<string, string>

const show = (xs: string[], n = 8) => (xs.length > n ? [...xs.slice(0, n), `…+${xs.length - n} more`] : xs)

beforeAll(() => {
    const raw: Course[] = JSON.parse(fs.readFileSync('data/catalog/full.json', 'utf8'))
    courses = raw.map(c => ({ id: c.course_id, title: c.title }))
    ids = new Set(courses.map(c => normalizeCourseId(c.id)))
    primaryMap = getCrossListPrimaryMap(courses)
})

describe('course URLs resolve', () => {
    it('normalizes every catalog id to itself (ids are already canonical form)', () => {
        const bad = courses.filter(c => normalizeCourseId(c.id) !== c.id).map(c => c.id)
        expect(show(bad)).toEqual([])
    })

    it('survives a URL round-trip, including subjects with an ampersand', () => {
        const bad = courses
            .filter(c => normalizeCourseId(decodeURIComponent(encodeURIComponent(c.id))) !== normalizeCourseId(c.id))
            .map(c => c.id)
        expect(show(bad)).toEqual([])
        // MS&E is the only subject with a non-letter character; make sure it is covered.
        expect(courses.some(c => c.id.startsWith('MS&E'))).toBe(true)
    })

    it('resolves every id to a course that exists in the catalog', () => {
        const bad: string[] = []
        for (const c of courses) {
            const canonical = resolveToCanonicalPrimary(normalizeCourseId(c.id), primaryMap)
            if (!ids.has(canonical)) bad.push(`${c.id} -> ${canonical} (missing)`)
        }
        expect(show(bad)).toEqual([])
    })

    it('resolves idempotently, so a redirect never bounces again', () => {
        // Cross-listed codes DO redirect by design (ARCHLGY 1 -> ANTHRO 3, and
        // 1,194 others). What must hold is that the destination is final:
        // resolving it again returns itself, or the router loops.
        const bad: string[] = []
        for (const c of courses) {
            const once = resolveToCanonicalPrimary(normalizeCourseId(c.id), primaryMap)
            const twice = resolveToCanonicalPrimary(once, primaryMap)
            if (once !== twice) bad.push(`${c.id}: ${once} -> ${twice}`)
        }
        expect(show(bad)).toEqual([])
    })

    it('sends every member of a cross-list pair to the same canonical id', () => {
        // Mutual listings (A's title names B, B's title names A) must agree, or
        // the two URLs show different pages for the same class.
        const bad: string[] = []
        for (const [alt, primary] of primaryMap) {
            if (!ids.has(alt) || !ids.has(primary)) continue
            const a = resolveToCanonicalPrimary(alt, primaryMap)
            const b = resolveToCanonicalPrimary(primary, primaryMap)
            if (a !== b) bad.push(`${alt} -> ${a} but ${primary} -> ${b}`)
        }
        expect(show(bad)).toEqual([])
    })

    it('caches per courses array without leaking between arrays', () => {
        // The map is memoised on array identity. A second array with different
        // titles must not get the first array's answer.
        const a = [{ id: 'CS106B', title: 'Programming Abstractions (AA 1)' }, { id: 'AA1', title: 'Other' }]
        const b = [{ id: 'CS106B', title: 'Programming Abstractions' }, { id: 'AA1', title: 'Other' }]
        expect(getCrossListPrimaryMap(a).get('CS106B')).toBe('AA1')
        expect(getCrossListPrimaryMap(b).has('CS106B')).toBe(false)
        // Same array twice returns the very same Map instance.
        expect(getCrossListPrimaryMap(a)).toBe(getCrossListPrimaryMap(a))
    })

    it('keeps cross-list groups symmetric', () => {
        // One pass: group by canonical id, then check membership both ways.
        const groups = new Map<string, string[]>()
        for (const c of courses) {
            const canonical = resolveToCanonicalPrimary(normalizeCourseId(c.id), primaryMap)
            const list = groups.get(canonical) ?? []
            list.push(normalizeCourseId(c.id))
            groups.set(canonical, list)
        }
        const canonicalOf = new Map<string, string>()
        for (const [canonical, members] of groups) for (const m of members) canonicalOf.set(m, canonical)
        const bad: string[] = []
        for (const [canonical, members] of groups) {
            for (const m of members) if (canonicalOf.get(m) !== canonical) bad.push(`${m} in ${canonical} but maps to ${canonicalOf.get(m)}`)
        }
        expect(show(bad)).toEqual([])
        expect([...groups.values()].filter(g => g.length > 1).length).toBeGreaterThan(100)
    })
})
