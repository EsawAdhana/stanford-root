import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { classCandidates, offeringsFromDump } from '../scripts/scrape-sections.mjs'

/**
 * The year is read from class records, so which class numbers a run tries, and
 * what happens when Navigator pushes back, decide whether the catalog is whole.
 */
const YEAR = ['Autumn 2026', 'Winter 2027', 'Spring 2027', 'Summer 2027']
const section = (term: string, classId: number, units: string) => ({ term, classId, units })

describe('which classes a run reads', () => {
    it('takes this year\'s sections from the last dump and ExploreCourses, primaries marked by their units', () => {
        const dump = [{ course_id: 'CS106A', sections: [section('Autumn 2026', 1801, '3-5'), section('Autumn 2026', 1834, ''), section('Spring 2026', 7001, '5')] }]
        const ec = [{ course_id: 'CS106A', sections: [section('Autumn 2026', 1801, '3-5'), section('Winter 2027', 2100, '3-5'), section('Winter 2027', 0, '3')] }]
        const { candidates, counts } = classCandidates(YEAR, dump, ec)
        expect(candidates).toEqual([
            { strm: '1272', classNbr: 1801, primary: true },
            { strm: '1272', classNbr: 1834, primary: false },
            { strm: '1272', classNbr: 1801, primary: true },
            { strm: '1274', classNbr: 2100, primary: true },
        ])
        expect(counts).toEqual([2, 2])
    })

    it('reads nothing for a year the dump and ExploreCourses do not have', () => {
        const dump = [{ course_id: 'CS106A', sections: [section('Autumn 2025', 1801, '3-5')] }]
        expect(classCandidates(YEAR, dump, []).candidates).toEqual([])
    })
})

describe('the year that just ended, from the last dump', () => {
    const dump = [
        { course_id: 'CS238', title: 'Decision Making under Uncertainty (AA 228)', sections: [section('Winter 2027', 1, '3-4')] },
        { course_id: 'CS999', title: 'Old', sections: [section('Winter 2026', 2, '3')] },
        { course_id: 'CS1', title: 'Unscheduled', sections: [] },
    ]

    it('counts a course scheduled that year, and the cross-list codes its title names', () => {
        expect([...offeringsFromDump('20262027', dump)].sort()).toEqual(['AA228', 'CS238'])
    })

    it('is empty for a year the dump does not hold', () => {
        expect(offeringsFromDump('20272028', dump).size).toBe(0)
    })
})

describe('the scrape script', () => {
    const script = join(__dirname, '../scripts/scrape-sections.mjs')
    const run = (path: string) => {
        try {
            execFileSync(process.execPath, [path], { env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' }, stdio: 'pipe' })
            return ''
        } catch (err) {
            return String((err as { stderr?: Buffer }).stderr)
        }
    }

    it('still starts when run, directly or through a symlink, now that tests can import it', () => {
        // With no Supabase env it stops at its first check, which proves main() ran.
        expect(run(script)).toMatch(/Missing env vars/)
        const link = join(mkdtempSync(join(tmpdir(), 'scrape-link-')), 'scrape.mjs')
        symlinkSync(script, link)
        expect(run(link)).toMatch(/Missing env vars/)
    })
})
