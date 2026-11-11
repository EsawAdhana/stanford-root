import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildDescriptionSegments } from '@/components/course-description'
import { hashDescription } from '@/lib/course-bare-links'
import frozen from '@/lib/course-bare-links.json'
import { decodeHtmlEntities, normalizeCatalogDescription } from '@/lib/utils'
import fixture from './fixtures/course-bare-links.json'

/**
 * End-to-end over the shipped review file: for the descriptions that motivated
 * each verdict, assert what links and what stays plain text. These are the cases
 * a regex got wrong, so they are the cases worth pinning.
 *
 * The descriptions live in tests/fixtures/course-bare-links.json, copied from the
 * catalog dump, so a course the registrar drops (PHIL 187C left on 2026-10-08) or
 * rewrites cannot turn this suite red. Each description is stored the way the page
 * receives it (normalizeCatalogDescription, which trims), because the reviewed links
 * are keyed by a hash of exactly that text. The fixture's `catalog` is the
 * subject|code -> id table those descriptions need, taken from the same dump.
 */
const descriptions = fixture.descriptions as Record<string, string>
const catalog = fixture.catalog as Record<string, string>
const resolveFromFixture = (subject: string, code: string) => catalog[`${subject}|${code}`]

/** Links in a rendered description, as "text -> courseId". */
const linksFor = (
    courseId: string,
    description: string,
    resolve: (subject: string, code: string) => string | undefined,
) =>
    buildDescriptionSegments(courseId, description, resolve)
        .filter(s => s.courseId)
        .map(s => `${s.text}->${s.courseId}`)

const linksIn = (courseId: string) => {
    const description = descriptions[courseId]
    if (description === undefined) throw new Error(`${courseId} is not in tests/fixtures/course-bare-links.json`)
    return linksFor(courseId, description, resolveFromFixture)
}

// Each row: the number is not a course, so this link must not exist.
const FORBIDDEN: Array<[courseId: string, forbidden: string, why: string]> = [
    ['ATHLETIC50', '60->ATHLETIC60', 'training hours'],
    ['ATHLETIC50', '10->ATHLETIC10', 'week quarter'],
    ['CS283', '25->CS25', 'page count'],
    ['CS183E', '25->CS25', 'date 9/13/25'],
    ['ANES340A', '300P->ANES300P', 'room E2 300P'],
    ['MED303A', '267->MED267', 'room CVRC CV-267'],
    ['JAPANLNG22', '23->JAPANLNG23', 'URL ?page_id=23'],
    ['OSPKYOTO101K', '39->OSPKYOTO39', 'URL ?page_id=39'],
    ['ENGLISH190SW', '90->ENGLISH90', '90-page script'],
    ['GERMAN802', '135->GERMAN135', '135 units'],
    ['PHYSICS293', '25->PHYSICS25', '25 units of physics'],
    ['PHYSWELL51', '12->PHYSWELL12', '12 yards'],
    ['PHYSWELL52', '50->PHYSWELL50', '50 yards'],
    ['PHYSWELL53', '50->PHYSWELL50', '50 yards'],
    ['TAPS202', '30->TAPS30', '30-page essay'],
    ['COMPLIT242', '100->COMPLIT100', '100-level course'],
    ['CEE176B', '100->CEE100', '100% clean energy'],
    ['PHIL180', '99->PHIL99', 'numbered over 99'],
    ['PHIL187', '100->PHIL100', 'numbered above 100'],
    ['PHIL187C', '99->PHIL99', 'numbered above 99'],
]

describe('reviewed bare-number links, against pinned descriptions', () => {
    it('pins the exact text each reviewed entry was frozen against', () => {
        // If a fixture description drifted from the reviewed text, bareLinksFor would
        // find no entry and every assertion below would pass for the wrong reason.
        const keys = new Set(Object.keys(frozen))
        const reviewedIds = new Set(Object.keys(frozen).map(k => k.slice(0, k.lastIndexOf(':'))))
        const checked = Object.keys(descriptions).filter(id => reviewedIds.has(id))
        expect(checked.length).toBeGreaterThan(10)
        for (const id of checked) {
            expect(keys.has(`${id}:${hashDescription(decodeHtmlEntities(descriptions[id]))}`), id).toBe(true)
        }
        // The course that broke the old version of this suite is still exercised.
        expect(checked).toContain('PHIL187C')
    })

    it.each(FORBIDDEN)('%s does not link %s (%s)', (courseId, forbidden) => {
        expect(linksIn(courseId)).not.toContain(forbidden)
    })

    it('re-points prereqs to the subject the sentence names', () => {
        // "Prerequisites: BIOMEDIN 210 or 214 or 215 or 217 or 260" on a BIOE page.
        // BIOMEDIN is now BMDS; nothing here should resolve to BIOE.
        const bioe = linksIn('BIOE212')
        expect(bioe.every(l => l.includes('->BMDS'))).toBe(true)
        expect(bioe.length).toBeGreaterThan(0)
        // The sentence says BIOMEDIN, a subject the catalog has renamed; the reviewed
        // verdict still supplies the target, and the link covers the subject too.
        expect(bioe).toContain('BIOMEDIN 210->BMDS210')

        // "Recommended prerequisites: Medicine 300A, Pediatrics 300A, or Surgery 300A"
        expect(linksIn('MED295')).toContain('300A->PEDS300A')
        expect(linksIn('MED295')).toContain('300A->SURG300A')

        // "PREREQUISITES: Med 300A and Surg 300A" on an ANES page.
        expect(linksIn('ANES306A')).toContain('300A->SURG300A')

        // Shared quantitative-methods boilerplate reused across departments.
        expect(linksIn('MS&E134')).toContain('108->ECON108')
        // "DATASCI 112" names its subject, so the whole reference is the link text.
        expect(linksIn('EARTHSYS153')).toContain('DATASCI 112->DATASCI112')

        // "Concurrent enrollment in MATH 19, 20, 52, or 53" on an ENGR page.
        expect(linksIn('ENGR199A')).toContain('20->MATH20')
    })

    it('keeps same-subject prereq lists working', () => {
        expect(linksIn('ARTSTUDI245')).toEqual(['140->ARTSTUDI140', '145->ARTSTUDI145'])
        expect(linksIn('AA257')).toEqual(['240->AA240'])
        expect(linksIn('CS161')).toEqual(['106B->CS106B', '103->CS103', '109->CS109'])
    })

    it('links explicit subject codes without a review entry', () => {
        // Not in the frozen list at all; the subject is in the text, so it resolves live.
        const segs = buildDescriptionSegments('MADEUP1', 'Prerequisites: CS 106A and MATH 51.', resolveFromFixture)
        expect(segs.filter(s => s.courseId).map(s => `${s.text}->${s.courseId}`)).toEqual([
            'CS 106A->CS106A',
            'MATH 51->MATH51',
        ])
    })

    it('does not depend on the course still being in the catalog', () => {
        // PHIL 187C is no longer offered, and the old suite read it from the live dump.
        // An empty resolver stands in for a catalog that has lost every course.
        const links = linksFor('PHIL187C', descriptions.PHIL187C, () => undefined)
        expect(links).not.toContain('99->PHIL99')
        expect(descriptions.PHIL187C).toMatch(/99/)
    })
})

/**
 * The one check against the nightly dump: today's text for each pinned course must
 * not produce the forbidden link either. A course the registrar has dropped is
 * skipped with the reason shown, never failed; the pinned suite above still covers it.
 */
describe('reviewed bare-number links, against the live catalog dump', () => {
    const rows = JSON.parse(fs.readFileSync('data/catalog/full.json', 'utf8')) as Array<{
        course_id: string
        subject: string
        code: string
        description?: string
    }>
    const byId = new Map(rows.map(c => [c.course_id, c]))
    const ids = new Map(rows.map(c => [`${c.subject}|${c.code}`, c.course_id]))
    const resolveLive = (subject: string, code: string) => ids.get(`${subject}|${code}`)

    it.for(FORBIDDEN)('live %s does not link %s (%s)', ([courseId, forbidden], ctx) => {
        const course = byId.get(courseId)
        if (!course) ctx.skip(`${courseId} is no longer in data/catalog/full.json; covered by the pinned suite`)
        // rowToCourse normalises the description before the page renders it.
        expect(linksFor(courseId, normalizeCatalogDescription(course!.description), resolveLive)).not.toContain(forbidden)
    })
})
