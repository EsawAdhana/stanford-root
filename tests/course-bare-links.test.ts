import fs from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { buildDescriptionSegments } from '@/components/course-description'

/**
 * End-to-end over the shipped review file: for the descriptions that motivated
 * each verdict, assert what links and what stays plain text. These are the cases
 * a regex got wrong, so they are the cases worth pinning.
 */
describe('reviewed bare-number links, against the real catalog', () => {
    let byId: Map<string, { subject: string; code: string; description?: string }>
    let resolve: (subject: string, code: string) => string | undefined

    beforeAll(() => {
        const courses = JSON.parse(fs.readFileSync('data/catalog/full.json', 'utf8'))
        byId = new Map(courses.map((c: any) => [c.course_id, c]))
        const ids = new Map<string, string>(courses.map((c: any) => [`${c.subject}|${c.code}`, c.course_id]))
        resolve = (subject, code) => ids.get(`${subject}|${code}`)
    })

    /** Links in a course's rendered description, as "text -> courseId". */
    const linksIn = (courseId: string) => {
        const course = byId.get(courseId)
        if (!course) throw new Error(`${courseId} is not in the catalog dump`)
        return buildDescriptionSegments(courseId, course.description || '', resolve)
            .filter(s => s.courseId)
            .map(s => `${s.text}->${s.courseId}`)
    }

    // Each row: the number is not a course, so this link must not exist.
    it.each([
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
    ])('%s does not link %s (%s)', (courseId, forbidden) => {
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
        // Not in the frozen list at all — subject is in the text, so it resolves live.
        const segs = buildDescriptionSegments('MADEUP1', 'Prerequisites: CS 106A and MATH 51.', resolve)
        expect(segs.filter(s => s.courseId).map(s => `${s.text}->${s.courseId}`)).toEqual([
            'CS 106A->CS106A',
            'MATH 51->MATH51',
        ])
    })
})
