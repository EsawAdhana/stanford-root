import { describe, expect, it } from 'vitest'
import { splitLinkSegments } from '@/lib/linkify'
import { buildDescriptionSegments } from '@/components/course-description'

const roundTrip = (text: string) => splitLinkSegments(text).map(s => s.text).join('')
const links = (text: string) => splitLinkSegments(text).filter(s => s.href).map(s => [s.text, s.href])

describe('splitLinkSegments', () => {
    it('links the URL in the reported ENGR 306 description', () => {
        const text =
            'More information is available at https://goto.stanford.edu/stanfordengr306 . Attendance on the first day of class is a requirement for enrollment.'
        expect(links(text)).toEqual([
            ['https://goto.stanford.edu/stanfordengr306', 'https://goto.stanford.edu/stanfordengr306'],
        ])
        expect(roundTrip(text)).toBe(text)
    })

    it('leaves the sentence period outside the link', () => {
        expect(links('See https://biobuds.stanford.edu.')).toEqual([
            ['https://biobuds.stanford.edu', 'https://biobuds.stanford.edu'],
        ])
    })

    it('keeps a trailing slash but drops the period after it', () => {
        expect(links('at http://biodesign.stanford.edu/.')).toEqual([
            ['http://biodesign.stanford.edu/', 'http://biodesign.stanford.edu/'],
        ])
    })

    it('drops an unbalanced closing paren but keeps a balanced one', () => {
        expect(links('(see https://music.stanford.edu/play/ensembles)')).toEqual([
            ['https://music.stanford.edu/play/ensembles', 'https://music.stanford.edu/play/ensembles'],
        ])
        expect(links('https://en.wikipedia.org/wiki/Design_(disambiguation)')).toEqual([
            ['https://en.wikipedia.org/wiki/Design_(disambiguation)', 'https://en.wikipedia.org/wiki/Design_(disambiguation)'],
        ])
    })

    it('handles several trailing marks and a semicolon list', () => {
        expect(links('a https://a.stanford.edu/x); b https://b.stanford.edu/y;')).toEqual([
            ['https://a.stanford.edu/x', 'https://a.stanford.edu/x'],
            ['https://b.stanford.edu/y', 'https://b.stanford.edu/y'],
        ])
    })

    it('gives a scheme-less www host an https href without rewriting the text', () => {
        const segs = splitLinkSegments('visit www.stanford.edu/x today')
        expect(segs.find(s => s.href)).toEqual({ text: 'www.stanford.edu/x', href: 'https://www.stanford.edu/x' })
        expect(roundTrip('visit www.stanford.edu/x today')).toBe('visit www.stanford.edu/x today')
    })

    it('links an email as mailto and leaves the bare host alone', () => {
        expect(links('email jane@stanford.edu or ask at stanford.edu.')).toEqual([
            ['jane@stanford.edu', 'mailto:jane@stanford.edu'],
        ])
    })

    it('keeps the sentence period out of an address and handles dotted local parts', () => {
        expect(links('Contact Deborah.Jeon@va.gov.')).toEqual([['Deborah.Jeon@va.gov', 'mailto:Deborah.Jeon@va.gov']])
        expect(links('(email a+b@stanford.edu), then')).toEqual([['a+b@stanford.edu', 'mailto:a+b@stanford.edu']])
    })

    it('does not pull an address out of a URL', () => {
        expect(links('see https://x.stanford.edu/list?u=a@b.edu now')).toEqual([
            ['https://x.stanford.edu/list?u=a@b.edu', 'https://x.stanford.edu/list?u=a@b.edu'],
        ])
    })

    it('does not treat a lone @ or a schedule string as an address', () => {
        expect(links('meets @ 3pm in room 240')).toEqual([])
        expect(links('contact@ the front desk')).toEqual([])
    })

    it('does not link a bare scheme', () => {
        expect(links('the https:// prefix')).toEqual([])
    })

    it('round-trips text with no URL at all', () => {
        const text = 'Prerequisites: CEE 107S. Meets 12:30 PM - 1:50 PM.'
        expect(roundTrip(text)).toBe(text)
        expect(links(text)).toEqual([])
    })

    it('round-trips back-to-back URLs', () => {
        const text = 'https://a.stanford.edu https://b.stanford.edu'
        expect(roundTrip(text)).toBe(text)
        expect(links(text)).toHaveLength(2)
    })
})

describe('description segments treat a URL as one link', () => {
    const resolve = (subject: string, code: string) =>
        ({ 'CS|106A': 'CS106A' } as Record<string, string>)[`${subject}|${code}`]

    it('never links a course reference that lives inside a URL', () => {
        const text = 'Prerequisites: CS 106A. Info at https://goto.stanford.edu/cs106a-30 and CS 106A staff.'
        const segs = buildDescriptionSegments('ENGR306', text, resolve, new Map())
        expect(segs.map(s => s.text).join('')).toBe(text)
        expect(segs.filter(s => s.href).map(s => s.text)).toEqual(['https://goto.stanford.edu/cs106a-30'])
        expect(segs.filter(s => s.courseId).map(s => s.text)).toEqual(['CS 106A', 'CS 106A'])
        // No segment is both a course link and a URL.
        expect(segs.filter(s => s.href && s.courseId)).toEqual([])
    })

    it('does not link a reviewed bare number that falls inside a URL', () => {
        const text = 'Prerequisites: see https://x.stanford.edu/30 for details.'
        const bare = new Map<number, [number, string]>([[text.indexOf('/30') + 1, [2, 'CEE30']]])
        const segs = buildDescriptionSegments('ENGR306', text, resolve, bare)
        expect(segs.filter(s => s.courseId)).toEqual([])
        expect(segs.map(s => s.text).join('')).toBe(text)
    })

    it('decodes entities before finding the URL', () => {
        const segs = buildDescriptionSegments('ENGR306', 'go to https://x.stanford.edu/a&amp;b now', resolve, new Map())
        expect(segs.filter(s => s.href).map(s => s.href)).toEqual(['https://x.stanford.edu/a&b'])
    })
})
