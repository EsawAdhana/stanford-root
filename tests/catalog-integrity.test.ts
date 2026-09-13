import fs from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { aggregateCrossListMetrics, decodeHtmlEntities, hoursPerUnit, parseUnitsOptions } from '@/lib/utils'
import { rowToCourse } from '@/lib/course-mapper'
import { buildDescriptionSegments } from '@/components/course-description'
import { buildCrossListGroups } from '@/lib/utils'
import { normalizeCatalogDescription } from '@/lib/utils'
import { hashDescription } from '@/lib/course-bare-links'

/**
 * Whole-catalog invariants. These run over every course in the committed dump,
 * so a bad scrape or a normalisation regression fails here rather than showing
 * up as one weird course page. Each expectation reports the offending course
 * ids, not just a count.
 */
type Meeting = { days?: string; time?: string; location?: string; instructors?: string[] }
type Section = {
    term?: string
    classId?: number
    units?: string
    status?: string
    capacity?: number
    enrolled?: number
    waitlist?: number
    waitlistMax?: number
    openSeats?: number
    component?: string
    sectionNumber?: string
    startDate?: string
    endDate?: string
    gers?: string[]
    meetings?: Meeting[]
    instructionalMode?: string
    grading?: string
    classLevel?: string
}
type Course = {
    course_id: string
    subject: string
    code: string
    title: string
    description?: string
    units?: string | number
    grading?: string
    instructors?: string[]
    terms?: string[]
    sections?: Section[]
    hours?: unknown
    quality?: unknown
    difficulty?: unknown
    isNew?: unknown
}

let full: Course[]
let light: Array<Omit<Course, 'description' | 'sections'>>

/** Cap listings so a failure message stays readable. */
const show = (xs: string[], n = 8) => (xs.length > n ? [...xs.slice(0, n), `…+${xs.length - n} more`] : xs)

beforeAll(() => {
    full = JSON.parse(fs.readFileSync('data/catalog/full.json', 'utf8'))
    light = JSON.parse(fs.readFileSync('data/catalog/light.json', 'utf8'))
})

describe('identity and keys', () => {
    it('has no duplicate course ids', () => {
        const seen = new Set<string>()
        const dupes: string[] = []
        for (const c of full) {
            if (seen.has(c.course_id)) dupes.push(c.course_id)
            seen.add(c.course_id)
        }
        expect(show(dupes)).toEqual([])
    })

    it('derives every course id from subject + code', () => {
        const bad = full
            .filter(c => c.course_id !== `${c.subject}${c.code}`.replace(/\s+/g, ''))
            .map(c => `${c.course_id} (${c.subject} ${c.code})`)
        expect(show(bad)).toEqual([])
    })

    it('has a non-empty subject, code and title everywhere', () => {
        const bad = full
            .filter(c => !c.subject?.trim() || !c.code?.trim() || !c.title?.trim())
            .map(c => c.course_id)
        expect(show(bad)).toEqual([])
    })

    it('keeps subject codes uppercase and code shapes plausible', () => {
        const badSubject = full.filter(c => c.subject !== c.subject.toUpperCase()).map(c => c.course_id)
        const badCode = full.filter(c => !/^\d{1,3}[A-Z0-9]{0,4}$|^[A-Z]?\d{1,4}[A-Z]{0,3}$/.test(c.code)).map(c => `${c.course_id}:${c.code}`)
        expect(show(badSubject)).toEqual([])
        expect(show(badCode)).toEqual([])
    })
})

describe('text hygiene', () => {
    /** Entities the ingest is supposed to decode before writing the dump. */
    const ENTITY = /&(?:#\d+|#x[0-9a-fA-F]+|amp|lt|gt|quot|apos|nbsp|rsquo|lsquo|ldquo|rdquo|hellip|mdash|ndash);/

    it('leaves no undecoded HTML entities in titles', () => {
        const bad = full.filter(c => ENTITY.test(c.title)).map(c => `${c.course_id}: ${c.title}`)
        expect(show(bad)).toEqual([])
    })

    it('leaves no undecoded HTML entities in instructor names', () => {
        const bad = full
            .filter(c => (c.instructors || []).some(n => ENTITY.test(n)))
            .map(c => `${c.course_id}: ${(c.instructors || []).filter(n => ENTITY.test(n)).join('|')}`)
        expect(show(bad)).toEqual([])
    })

    it('has no subject code glued to a unit noun — the "CEE 80 minutes" corruption', () => {
        const bad: string[] = []
        for (const c of full) {
            const text = decodeHtmlEntities(c.description || '')
            const m = text.match(
                new RegExp(`\\b${c.subject}\\s+\\d{1,3}\\s*(?:minutes?|mins?|hours?|hrs?|yards?|pages?|%|PM|AM)\\b`, 'i'),
            )
            if (m) bad.push(`${c.course_id}: ${m[0]}`)
        }
        expect(show(bad)).toEqual([])
    })

    it('has no control characters in titles', () => {
        const bad = full
            .filter(c => /[\u0000-\u0008\u000b-\u001f\u007f]/.test(c.title))
            .map(c => `${c.course_id}: ${JSON.stringify(c.title)}`)
        expect(show(bad)).toEqual([])
    })
})

describe('units and grading', () => {
    it('parses every units value to at least one option', () => {
        const bad = full
            .filter(c => c.units != null && String(c.units).trim() !== '' && parseUnitsOptions(c.units as string).length === 0)
            .map(c => `${c.course_id}: ${JSON.stringify(c.units)}`)
        expect(show(bad)).toEqual([])
    })

    it('keeps unit counts inside Stanford limits (0–30)', () => {
        const bad: string[] = []
        for (const c of full) {
            for (const u of parseUnitsOptions((c.units ?? '') as string)) {
                if (u < 0 || u > 30) bad.push(`${c.course_id}: ${u}`)
            }
        }
        expect(show(bad)).toEqual([])
    })

    it('uses a known grading basis', () => {
        const values = new Set(full.map(c => (c.grading || '').trim()).filter(Boolean))
        // Stanford's real bases, including the school-specific ones.
        const KNOWN = /^(Letter|Credit\/No Credit|Letter or Credit\/No Credit|Satisfactory\/No Credit|Medical|Pass\/Restricted Credit\/No Credit|Letter \(ABCD\/NP\)|Not Graded|Multiple|TGR|GSB |MED |Law |RO |Qualifying)/i
        const unknown = [...values].filter(v => !KNOWN.test(v))
        expect(show(unknown)).toEqual([])
    })
})

describe('sections and meetings', () => {
    it('gives every section a term that the course also lists', () => {
        const bad: string[] = []
        for (const c of full) {
            const terms = new Set(c.terms || [])
            for (const s of c.sections || []) {
                if (!s.term) bad.push(`${c.course_id}: section ${s.classId} has no term`)
                else if (!terms.has(s.term)) bad.push(`${c.course_id}: section term "${s.term}" not in terms [${[...terms].join(', ')}]`)
            }
        }
        expect(show(bad)).toEqual([])
    })

    it('uses well-formed term labels', () => {
        const bad = new Set<string>()
        for (const c of full) for (const t of c.terms || []) if (!/^(Autumn|Winter|Spring|Summer) \d{4}$/.test(t)) bad.add(`${c.course_id}: ${t}`)
        expect(show([...bad])).toEqual([])
    })

    it('never has a meeting whose start time is at or after its end time', () => {
        const bad: string[] = []
        const parse = (t: string) => {
            const m = t.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i)
            if (!m) return null
            let h = parseInt(m[1], 10) % 12
            if (/pm/i.test(m[3])) h += 12
            return h * 60 + parseInt(m[2], 10)
        }
        for (const c of full) {
            for (const s of c.sections || []) {
                for (const mt of s.meetings || []) {
                    if (!mt.time) continue
                    const [a, b] = mt.time.split(/\s*[–-]\s*/)
                    const start = parse((a || '').trim())
                    const end = parse((b || '').trim())
                    if (start == null || end == null) bad.push(`${c.course_id}: unparsed time "${mt.time}"`)
                    else if (start >= end) bad.push(`${c.course_id}: ${mt.time}`)
                }
            }
        }
        expect(show(bad)).toEqual([])
    })

    it('uses only real day names', () => {
        const DAYS = new Set(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'])
        const bad = new Set<string>()
        for (const c of full) {
            for (const s of c.sections || []) {
                for (const mt of s.meetings || []) {
                    for (const d of (mt.days || '').split(',').map(x => x.trim()).filter(Boolean)) {
                        if (!DAYS.has(d)) bad.add(`${c.course_id}: "${d}"`)
                    }
                }
            }
        }
        expect(show([...bad])).toEqual([])
    })

    it('keeps seat counts internally consistent', () => {
        const bad: string[] = []
        for (const c of full) {
            for (const s of c.sections || []) {
                const { capacity, enrolled, openSeats, waitlist, waitlistMax, classId } = s
                if (typeof capacity !== 'number' || typeof enrolled !== 'number') continue
                if (capacity < 0 || enrolled < 0) bad.push(`${c.course_id}/${classId}: negative seats`)
                if (typeof openSeats === 'number' && openSeats !== Math.max(0, capacity - enrolled))
                    bad.push(`${c.course_id}/${classId}: openSeats ${openSeats} != ${capacity}-${enrolled}`)
                // No waitlist-vs-cap check: the registrar itself publishes sections past
                // both caps. ASLLANG 1 section 02 (Autumn 2026) reads waitTot 8 / waitCap 5
                // straight from Navigator, and 47 sections in this dump are enrolled over
                // capacity. Only our own arithmetic is an invariant here.
                if (typeof waitlist === 'number' && waitlist < 0)
                    bad.push(`${c.course_id}/${classId}: negative waitlist`)
            }
        }
        expect(show(bad)).toEqual([])
    })

    it('dates a section start before its end', () => {
        const bad: string[] = []
        for (const c of full) {
            for (const s of c.sections || []) {
                if (!s.startDate || !s.endDate) continue
                if (!/^\d{4}-\d{2}-\d{2}$/.test(s.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(s.endDate))
                    bad.push(`${c.course_id}: bad date format ${s.startDate}..${s.endDate}`)
                else if (s.startDate > s.endDate) bad.push(`${c.course_id}: ${s.startDate} > ${s.endDate}`)
            }
        }
        expect(show(bad)).toEqual([])
    })

    /**
     * Class ids are Stanford's per-term class numbers: reused freely across
     * terms (24,143 of them are), unique within a term. Live-seat lookups and
     * the per-course enrollment map key on classId, so both invariants below
     * are load-bearing.
     */
    it('gives each class id one owner within a term', () => {
        const owner = new Map<string, string>()
        const bad: string[] = []
        for (const c of full) {
            for (const s of c.sections || []) {
                if (typeof s.classId !== 'number') continue
                const key = `${s.term}|${s.classId}`
                const prev = owner.get(key)
                if (prev && prev !== c.course_id) bad.push(`${key}: ${prev} and ${c.course_id}`)
                owner.set(key, c.course_id)
            }
        }
        expect(show(bad)).toEqual([])
    })

    it('never repeats a class id across terms within one course', () => {
        // course-detail-content keys enrollmentBySectionId by classId across all
        // of a course's terms; a repeat there would show one term's seats in another.
        const bad: string[] = []
        for (const c of full) {
            const seen = new Map<number, string>()
            for (const s of c.sections || []) {
                if (typeof s.classId !== 'number') continue
                const prev = seen.get(s.classId)
                if (prev && prev !== s.term) bad.push(`${c.course_id} classId ${s.classId}: ${prev} and ${s.term}`)
                seen.set(s.classId, s.term || '')
            }
        }
        expect(show(bad)).toEqual([])
    })
})

describe('ratings', () => {
    it('keeps quality on a 1–5 scale and hours in a sane range', () => {
        const bad: string[] = []
        for (const c of full) {
            const q = c.quality as number | null
            const h = c.hours as number | null
            if (q != null && (typeof q !== 'number' || q < 1 || q > 5)) bad.push(`${c.course_id}: quality ${q}`)
            if (h != null && (typeof h !== 'number' || h < 0 || h > 80)) bad.push(`${c.course_id}: hours ${h}`)
        }
        expect(show(bad)).toEqual([])
    })

})

describe('light.json mirrors full.json', () => {
    it('covers exactly the same course ids', () => {
        const f = new Set(full.map(c => c.course_id))
        const l = new Set(light.map(c => c.course_id))
        expect(show([...f].filter(id => !l.has(id)))).toEqual([])
        expect(show([...l].filter(id => !f.has(id)))).toEqual([])
    })

    it('agrees on the fields it duplicates', () => {
        const byId = new Map(full.map(c => [c.course_id, c]))
        const bad: string[] = []
        for (const c of light) {
            const f = byId.get(c.course_id)!
            for (const k of ['subject', 'code', 'title', 'units', 'grading'] as const) {
                if (JSON.stringify((c as any)[k]) !== JSON.stringify((f as any)[k])) bad.push(`${c.course_id}.${k}`)
            }
            if (JSON.stringify(c.terms) !== JSON.stringify(f.terms)) bad.push(`${c.course_id}.terms`)
            if (JSON.stringify(c.instructors) !== JSON.stringify(f.instructors)) bad.push(`${c.course_id}.instructors`)
        }
        expect(show(bad)).toEqual([])
    })
})

/**
 * Everything above reads the dump. These read courses the way the app does —
 * through rowToCourse — which is where titles are tidied, stray markup is
 * dropped and hrs/unit is derived. Upstream is allowed to be messy; what
 * reaches a page is not.
 */
describe('courses as the app renders them', () => {
    let mapped: ReturnType<typeof rowToCourse>[]

    beforeAll(() => {
        mapped = full.map(c => rowToCourse(c))
    })

    it('renders no stray markup in any description', () => {
        const bad = mapped.filter(c => /<\/?[a-z][^>]*>/i.test(c.description || '')).map(c => c.id)
        expect(show(bad)).toEqual([])
    })

    it('keeps the URL when it strips angle brackets around one', () => {
        const law = mapped.find(c => c.id === 'LAW810N')!
        expect(law.description).toContain('https://publicpolicy.stanford.edu/undergraduate/major')
        expect(law.description).not.toContain('<https://')
    })

    it('has no untrimmed or doubled whitespace in titles', () => {
        const bad = mapped
            .filter(c => c.title !== c.title.trim() || /\s{2,}/.test(c.title))
            .map(c => `${c.id}: ${JSON.stringify(c.title)}`)
        expect(show(bad)).toEqual([])
    })

    it('derives hrs/unit from hours and the current unit count, everywhere', () => {
        const bad: string[] = []
        for (const c of mapped) {
            const shown = hoursPerUnit(c.hours, c.units)
            if (shown == null) continue
            const options = parseUnitsOptions((c.units ?? '') as string).filter(u => u > 0)
            const expected = (c.hours as number) / Math.max(...options)
            if (Math.abs(shown - expected) > 1e-9) bad.push(`${c.id}: ${shown} != ${expected}`)
        }
        expect(show(bad)).toEqual([])
    })

    it('publishes no hrs/unit for a zero-unit course', () => {
        const bad = mapped
            .filter(c => String(c.units).trim() === '0' && hoursPerUnit(c.hours, c.units) != null)
            .map(c => c.id)
        expect(show(bad)).toEqual([])
    })

    it('pools evaluation figures across every listing of a class', () => {
        // AA 274A / CS 237A / EE 260A / ME 274A are one class; each listing must
        // show the mean over the listings that have evaluations, not its own.
        const group = ['AA274A', 'CS237A', 'EE260A', 'ME274A'].map(id => mapped.find(c => c.id === id)!)
        const pooled = aggregateCrossListMetrics(group)
        const qualities = group.map(c => c.quality).filter((q): q is number => q != null)
        expect(qualities.length).toBeGreaterThan(1)
        expect(pooled.quality).toBeCloseTo(qualities.reduce((a, b) => a + b, 0) / qualities.length, 10)
    })

    it('ignores members with no evaluations rather than counting them as zero', () => {
        const pooled = aggregateCrossListMetrics([
            { hours: 10, quality: 4, units: '5' },
            { hours: null, quality: null, units: '5' },
        ])
        expect(pooled.quality).toBe(4)
        expect(pooled.hours).toBe(10)
        expect(pooled.hrsPerUnit).toBe(2)
    })
})

describe('the new-course flag agrees with the ratings', () => {
    /**
     * A course cannot be new to Stanford and already carry student evaluations. Both
     * facts are derived per cross-list group, so a disagreement means the two groupings
     * diverged -- which is exactly what happened: markNewCourses read siblings out of
     * one row's own title, so MATSCI 402A was flagged brand-new while showing the 4.3 it
     * inherited from EE 402A, a class taught since 2023.
     */
    it('never flags a course as new while it carries a rating', () => {
        const bad = light.filter(c => (c as { isNew?: unknown }).isNew === true && c.quality != null)
        expect(show(bad.map(c => `${c.course_id}: isNew with quality ${String(c.quality)}`))).toEqual([])
    })

    it('agrees with itself across every listing of one class', () => {
        // Same class, so the same answer whichever code you open. Groups are built in one
        // pass; calling getCrossListGroupIds per course is O(n^2) over 8,600 rows.
        const groups: Map<string, string[]> = buildCrossListGroups(light.map(c => ({
            id: c.course_id,
            title: c.title,
            crossListWith: (c as { cross_list_with?: string[] }).cross_list_with || [],
        })))
        const byId = new Map(light.map(c => [c.course_id, c as { isNew?: unknown }]))
        const bad: string[] = []
        for (const members of groups.values()) {
            if (members.length < 2) continue
            // undefined abstains, so only compare the listings that were judged.
            const answers = new Set(members.map(id => byId.get(id)?.isNew).filter(v => v !== undefined))
            if (answers.size > 1) bad.push(`${members.sort().join(',')}: isNew is ${[...answers].join(' and ')}`)
        }
        expect(show(bad)).toEqual([])
    })
})

describe('reviewed course links point somewhere real', () => {
    /**
     * Only the entries the renderer can actually reach are checked.
     *
     * bareLinksFor keys on course id AND a hash of the decoded description, so an entry
     * whose description has since been edited is never looked up and renders nothing --
     * that is the module's designed fallback, not a fault. Checking those anyway made
     * this suite fail for a non-bug: the nightly refresh in a28bae6 rewrote MUSIC 72A's
     * description, its dead offset 90 landed on "uch" instead of "12C", and main went
     * red while the site rendered correct plain text throughout. 22 entries are dead
     * right now and one wrong nightly edit away from doing it again.
     *
     * For a LIVE entry the check is exact rather than advisory: the hash pins the text
     * the offsets were computed against, so a span that is not a course number means the
     * frozen data really is corrupt and would mislabel arbitrary prose.
     *
     * A reviewed link's TARGET no longer has to be in the catalog. Stanford unschedules
     * courses every term, and buildDescriptionSegments now drops a bare link whose target
     * has left, exactly as it already drops a subject-qualified one. Failing here instead
     * would only flag the churn once a day, and the honest fix -- deleting the entry --
     * throws away a human review that becomes correct again when the course returns.
     */
    it('sits on spans that are still course numbers', () => {
        const frozen: Record<string, Array<[number, number, string]>> = JSON.parse(
            fs.readFileSync('src/lib/course-bare-links.json', 'utf8'),
        )
        const byId = new Map(full.map(c => [c.course_id, c]))
        const bad: string[] = []
        for (const [key, links] of Object.entries(frozen)) {
            const courseId = key.slice(0, key.lastIndexOf(':'))
            const course = byId.get(courseId)
            // The described course itself left the catalog: nothing renders this entry.
            if (!course) continue
            const text = decodeHtmlEntities(normalizeCatalogDescription(course.description || ''))
            // The description was edited after the review: bareLinksFor cannot find this
            // entry, so its offsets describe text that no longer exists anywhere.
            if (key.slice(key.lastIndexOf(':') + 1) !== hashDescription(text)) continue
            for (const [offset, length] of links) {
                const span = text.slice(offset, offset + length)
                if (!/^\d{2,3}[A-Z]?$/.test(span)) bad.push(`${courseId}: span at ${offset} is ${JSON.stringify(span)}`)
            }
        }
        expect(show(bad)).toEqual([])
    })

    it('never links a bare number to a course that is not in the catalog', () => {
        // The guard that replaces the old target assertion, checked against the real
        // frozen data and the real dump rather than a fixture.
        const frozen: Record<string, Array<[number, number, string]>> = JSON.parse(
            fs.readFileSync('src/lib/course-bare-links.json', 'utf8'),
        )
        const ids = new Set(full.map(c => c.course_id))
        const byId = new Map(full.map(c => [c.course_id, c]))
        const linked: string[] = []
        for (const [key, links] of Object.entries(frozen)) {
            const courseId = key.slice(0, key.lastIndexOf(':'))
            const course = byId.get(courseId)
            if (!course) continue
            const source = course.description || ''
            // Same reachability rule as above: an entry the renderer cannot look up
            // cannot link anything, so feeding its dead offsets in proves nothing.
            if (key.slice(key.lastIndexOf(':') + 1) !== hashDescription(decodeHtmlEntities(normalizeCatalogDescription(source)))) continue
            const bare = new Map<number, [number, string]>(
                links.map(([offset, length, target]) => [offset, [length, target]]),
            )
            const segments = buildDescriptionSegments(
                courseId,
                source,
                () => undefined,
                bare,
                id => ids.has(id),
            )
            for (const seg of segments) {
                if (seg.courseId && !ids.has(seg.courseId)) linked.push(`${courseId} -> ${seg.courseId}`)
            }
        }
        expect(show(linked)).toEqual([])
    })
})
