import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import {
  buildInstructorCourseIndex,
  getInstructorCoursesFromDump,
  getInstructorDirectory,
  lookupInstructorCourses,
  type DumpInstructorCourse,
  type DumpRow,
} from '@/lib/catalog-dump'
import {
  buildInstructorDirectory,
  hasFullFirstName,
  instructorInitialSlug,
  instructorSlug,
  parseInstructorName,
  resolveInstructorSlug,
  type InstructorDirectory,
} from '@/lib/instructors'
import { getCrossListPrimaryMap, normalizeCourseId, resolveToCanonicalPrimary } from '@/lib/utils'

type NameFns = {
  instructorSlug: (raw: string) => string
  instructorInitialSlug: (raw: string) => string
  firstName: (raw: string) => string
}
const plainFns: NameFns = {
  instructorSlug,
  instructorInitialSlug,
  firstName: raw => parseInstructorName(raw).first,
}
/** Same pure functions, cached per string, so the reference scan can run over thousands of instructors. */
function memoFns(): NameFns {
  const cache = (fn: (raw: string) => string) => {
    const m = new Map<string, string>()
    return (raw: string) => {
      let v = m.get(raw)
      if (v === undefined) m.set(raw, (v = fn(raw)))
      return v
    }
  }
  return {
    instructorSlug: cache(instructorSlug),
    instructorInitialSlug: cache(instructorInitialSlug),
    firstName: cache(raw => parseInstructorName(raw).first),
  }
}
const idTitlesByRows = new WeakMap<DumpRow[], { id: string; title: string }[]>()

/**
 * The per-page catalog scan getInstructorCoursesFromDump used before the index,
 * kept as the reference the index has to agree with. With plainFns it is the old
 * code line for line; memo only caches the pure name functions and the cross-list map.
 */
function scanInstructorCourses(
  rows: DumpRow[],
  dir: InstructorDirectory,
  entry: { slug: string; initialSlug: string },
  fns: NameFns = plainFns,
  memo = false,
): DumpInstructorCourse[] {
  const { instructorSlug, instructorInitialSlug } = fns
  const parseInstructorName = (raw: string) => ({ first: fns.firstName(raw) })
  const soleForInitial = (dir.namedByInitialSlug.get(entry.initialSlug)?.length ?? 0) === 1
  const out: DumpInstructorCourse[] = []
  for (const row of rows) {
    const instructors = (row.instructors as string[] | undefined) || []
    const grading = String(row.grading || '').trim()
    if (instructors.length === 0 || !grading || grading === 'TBD') continue
    const id = String(row.course_id || row.id || '')
    if (!id) continue
    const matches = instructors.some(raw => {
      if (instructorSlug(raw) === entry.slug) return true
      if (!hasFullFirstName(parseInstructorName(raw).first)) {
        return soleForInitial && instructorInitialSlug(raw) === entry.initialSlug
      }
      return false
    })
    if (!matches) continue
    out.push({
      id,
      subject: String(row.subject || ''),
      code: String(row.code || ''),
      title: String(row.title || ''),
      terms: ((row.terms as string[] | undefined) || []).slice(),
      quality: row.quality != null && row.quality !== '' ? Number(row.quality) : null,
      hours: row.hours != null && row.hours !== '' ? Number(row.hours) : null,
    })
  }
  if (out.length < 2) return out
  const idTitles = (memo && idTitlesByRows.get(rows)) ||
    rows.map(r => ({ id: String(r.course_id || r.id || ''), title: String(r.title ?? '') }))
  if (memo) idTitlesByRows.set(rows, idTitles)
  const primaryMap = getCrossListPrimaryMap(idTitles)
  const kept = new Map<string, DumpInstructorCourse>()
  for (const course of out) {
    const canonical = resolveToCanonicalPrimary(normalizeCourseId(course.id), primaryMap)
    const existing = kept.get(canonical)
    if (!existing) {
      kept.set(canonical, course)
      continue
    }
    const terms = [...new Set([...existing.terms, ...course.terms])]
    const winner = normalizeCourseId(course.id) === canonical ? course : existing
    kept.set(canonical, { ...winner, terms })
  }
  return [...kept.values()]
}

const row = (id: string, title: string, instructors: string[], extra: Partial<DumpRow> = {}): DumpRow => {
  const [subject, code] = [id.match(/^[A-Z]+/)![0], id.replace(/^[A-Z]+/, '')]
  return { course_id: id, subject, code, title, instructors, terms: ['Autumn 2026'], grading: 'Letter or Credit/No Credit', hours: 2, quality: 4.1, ...extra }
}

describe('instructor course index, synthetic catalog', () => {
  const rows: DumpRow[] = [
    row('CS101', 'Intro', ['Smith, Jane']),
    row('CS102', 'Follow-on', ['Smith, J.']),
    row('MATH1', 'Calculus', ['Clark, Susan']),
    row('MATH2', 'Algebra', ['Clark, Steven']),
    row('MATH3', 'Topology', ['Clark, S.']),
    row('COMM172', 'Media Psychology (COMM 272)', ['Reeves, Byron'], { terms: ['Autumn 2026'] }),
    row('COMM272', 'Media Psychology (COMM 172)', ['Reeves, Byron'], { terms: ['Winter 2027'] }),
    row('COMM300', 'Grad Seminar (COMM 172)', ['Lee, Ann'], { terms: ['Spring 2027'] }),
    row('SPAN1', 'Spanish', ['Núñez Martínez, José']),
    row('SPAN2', 'More Spanish', ['Nunez Martinez, Jose', 'Nunez Martinez, Jose']),
    row('CS999', 'Not graded yet', ['Smith, Jane'], { grading: 'TBD' }),
    row('CS998', 'No grading at all', ['Smith, Jane'], { grading: '' }),
    { title: 'No id', instructors: ['Smith, Jane'], grading: 'Letter' },
    row('CS997', 'Nobody', []),
    row('CS996', 'Empty quality', ['Smith, Jane'], { quality: '', hours: null }),
  ]
  const dir = buildInstructorDirectory(rows.flatMap(r => (r.instructors as string[]) || []))
  const index = buildInstructorCourseIndex(rows)
  const look = (slug: string) => {
    const entry = dir.bySlug.get(slug)
    expect(entry, `directory has ${slug}`).toBeTruthy()
    const got = lookupInstructorCourses(index, dir, entry!)
    expect(got).toEqual(scanInstructorCourses(rows, dir, entry!))
    return got
  }

  it('attaches an abbreviated "Last, F." row when exactly one full name shares the initial', () => {
    expect(look('smith-jane').map(c => c.id)).toEqual(['CS101', 'CS102', 'CS996'])
  })

  it('keeps the abbreviated row off both people when two full names share the initial', () => {
    expect(look('clark-susan').map(c => c.id)).toEqual(['MATH1'])
    expect(look('clark-steven').map(c => c.id)).toEqual(['MATH2'])
    // The initial-only page still finds it through its own slug.
    expect(look('clark-s').map(c => c.id)).toEqual(['MATH3'])
  })

  it('the initial-only entry does not pick up the full-name rows', () => {
    expect(look('smith-j').map(c => c.id)).toEqual(['CS102'])
  })

  it('collapses a cross-listed class to its canonical listing and unions the quarters', () => {
    const got = look('reeves-byron')
    expect(got).toHaveLength(1)
    expect(got[0].id).toBe('COMM172')
    expect(got[0].terms).toEqual(['Autumn 2026', 'Winter 2027'])
  })

  it('keeps the listing the instructor teaches when the canonical one is someone else\'s', () => {
    expect(look('lee-ann').map(c => c.id)).toEqual(['COMM300'])
  })

  it('matches accented and unaccented spellings of one name, once per row', () => {
    const entry = dir.bySlug.get(instructorSlug('Núñez Martínez, José'))!
    expect(entry.slug).toBe(instructorSlug('Nunez Martinez, Jose'))
    expect(look(entry.slug).map(c => c.id)).toEqual(['SPAN1', 'SPAN2'])
  })

  it('skips ungradeable, id-less and empty rows, and maps blank figures to null', () => {
    const got = look('smith-jane')
    expect(got.map(c => c.id)).not.toContain('CS999')
    expect(got.map(c => c.id)).not.toContain('CS998')
    expect(got.find(c => c.id === 'CS996')).toMatchObject({ quality: null, hours: null })
  })

  it('returns nothing for an unknown slug and does not share term arrays with the rows', () => {
    expect(lookupInstructorCourses(index, dir, { slug: 'nobody-here', initialSlug: 'nobody-h' })).toEqual([])
    const got = look('smith-jane')
    got[0].terms.push('mutated')
    expect(rows[0].terms).toEqual(['Autumn 2026'])
  })
})

describe('instructor course index, real catalog', () => {
  const rows = JSON.parse(readFileSync(join(process.cwd(), 'data', 'catalog', 'light.json'), 'utf8')) as DumpRow[]

  it('matches the old scan for ~200 evenly spaced instructors and every initial-only or initial-fallback one', async () => {
    const dir = await getInstructorDirectory()
    const entries = dir.entries
    const index = buildInstructorCourseIndex(rows)
    // INSTRUCTOR_INDEX_FULL=1 compares every instructor instead (about a minute).
    const step = process.env.INSTRUCTOR_INDEX_FULL ? 1 : Math.max(1, Math.floor(entries.length / 200))
    const picked = new Map<string, (typeof entries)[number]>()
    for (let i = 0; i < entries.length; i += step) picked.set(entries[i].slug, entries[i])
    let initialOnly = 0
    let fallbackCandidates = 0
    for (const e of entries) {
      if (!e.named) {
        picked.set(e.slug, e)
        initialOnly++
      } else if (index.abbreviatedByInitial.has(e.initialSlug)) {
        // Full names that would take abbreviated rows, and ones blocked from them.
        picked.set(e.slug, e)
        fallbackCandidates++
      }
    }
    console.log(`[instructor-index] ${entries.length} instructors, ${initialOnly} initial-only, ${fallbackCandidates} full names sharing an abbreviated row's initial`)

    const fns = memoFns()
    let differences = 0
    let withCourses = 0
    let n = 0
    for (const entry of picked.values()) {
      const want = scanInstructorCourses(rows, dir, entry, fns, true)
      const got = await getInstructorCoursesFromDump(entry)
      if (JSON.stringify(got) !== JSON.stringify(want)) differences++
      if (want.length) withCourses++
      // Let vitest's worker answer its own heartbeats during the long loop.
      if (++n % 100 === 0) await new Promise(r => setImmediate(r))
    }
    console.log(`[instructor-index] compared ${picked.size} instructors (${withCourses} with upcoming classes): ${differences} differences`)
    expect(picked.size).toBeGreaterThan(200)
    expect(withCourses).toBeGreaterThan(50)
    expect(differences).toBe(0)
  }, 300_000)

  it('the five page payloads and the API route slug resolution are unchanged', async () => {
    const dir = await getInstructorDirectory()
    const fns = memoFns()
    const multi = dir.entries.filter(e => e.slug !== 'reeves-byron')
      .filter((e, i) => i % 50 === 0 && scanInstructorCourses(rows, dir, e, fns, true).length >= 3)
      .slice(0, 3)
    const initialOnly = dir.entries.find(e =>
      !e.named && resolveInstructorSlug(dir, e.slug).kind === 'found' &&
      scanInstructorCourses(rows, dir, e, fns, true).length > 0)!
    const slugs = ['reeves-byron', ...multi.map(e => e.slug), initialOnly.slug]
    console.log(`[instructor-index] page payload check: ${slugs.join(', ')}`)
    expect(new Set(slugs).size).toBe(5)
    for (const slug of slugs) {
      // /api/instructors/[slug] reads the catalog only through this resolution.
      const resolved = resolveInstructorSlug(dir, slug)
      expect(resolved.kind, slug).toBe('found')
      if (resolved.kind !== 'found') continue
      const got = JSON.stringify(await getInstructorCoursesFromDump(resolved.entry))
      expect(got, slug).toBe(JSON.stringify(scanInstructorCourses(rows, dir, resolved.entry)))
    }
  }, 120_000)

  it('times a lookup before and after', async () => {
    const dir = await getInstructorDirectory()
    const entries = dir.entries
    await getInstructorCoursesFromDump(entries[0]) // load and index once

    let t = performance.now()
    for (const e of entries) await getInstructorCoursesFromDump(e)
    const after = (performance.now() - t) / entries.length

    const sample = entries.filter((_, i) => i % Math.floor(entries.length / 50) === 0)
    t = performance.now()
    for (const e of sample) scanInstructorCourses(rows, dir, e)
    const before = (performance.now() - t) / sample.length

    t = performance.now()
    buildInstructorCourseIndex(rows)
    const build = performance.now() - t

    console.log(
      `[instructor-index] old scan ${before.toFixed(2)} ms per lookup (${sample.length} sampled); ` +
      `index ${after.toFixed(3)} ms per lookup over all ${entries.length}; index build ${build.toFixed(0)} ms once`
    )
    expect(after).toBeLessThan(before)
  }, 120_000)
})
