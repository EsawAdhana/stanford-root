import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runAudit, type AuditResult, type NodeResult, type ProgramResult } from '@/lib/requirements/audit'
import { buildCourseIndex } from '@/lib/requirements/course-index'
import { EMPTY_OVERRIDES, type AuditOverrides, type ProgramChoice, type ProgramData, type StudentCourse } from '@/lib/requirements/types'

/**
 * Runs the audit over the real 2026-27 Bulletin data in public/requirements,
 * so a change to the build script that breaks a real program breaks here too.
 * Several cases are the ones My Academic Path and Grad Tree got wrong for a
 * CS BS + MS coterm student (see the Sep 29 degree-planner research).
 */

const DIR = join(__dirname, '..', 'public', 'requirements')
const index = buildCourseIndex(JSON.parse(readFileSync(join(DIR, 'courses.json'), 'utf8')))
const program = (code: string): ProgramData => JSON.parse(readFileSync(join(DIR, 'programs', `${code}.json`), 'utf8'))

// Autumn 2026 is in session.
const NOW = new Date(2026, 9, 22)

let seq = 0
function took(code: string, term = 'Autumn 2024', units?: number, grade = 'A', extra: Partial<StudentCourse> = {}): StudentCourse {
  return { id: `c${seq++}`, code, term, units: units ?? index.get(code)?.max ?? 3, grade, source: 'manual', ...extra }
}

function audit(
  programs: (string | ({ code: string } & Partial<ProgramChoice>))[],
  courses: StudentCourse[],
  opts: { overrides?: Partial<AuditOverrides>; ge?: boolean } = {},
): AuditResult {
  return runAudit({
    programs: programs.map(p => {
      const choice = typeof p === 'string' ? { code: p } : p
      return { data: program(choice.code), choice }
    }),
    courses,
    index,
    overrides: { ...EMPTY_OVERRIDES, ...opts.overrides },
    generalEducation: opts.ge ?? false,
    now: NOW,
  })
}

function find(r: ProgramResult, name: string | RegExp): NodeResult {
  let hit: NodeResult | undefined
  const walk = (n: NodeResult) => {
    const label = n.node.name ?? ''
    if (!hit && (typeof name === 'string' ? label === name : name.test(label))) hit = n
    n.children?.forEach(walk)
  }
  r.blocks.forEach(b => b.rules.forEach(walk))
  if (!hit) throw new Error(`no rule named ${name} in ${r.code}`)
  return hit
}

const codesIn = (result: AuditResult, n: NodeResult) => n.applied.map(a => result.courses.get(a.courseId)!.course.code).sort()
const ge = (result: AuditResult, code: string) => result.generalEducation.find(p => p.code === code)!

describe('Ways: a course with two Ways lands where it does the most good', () => {
  // The MAP complaint: ARCHLGY 151 and AMSTUD 145 each carry A-II and SI, and
  // COLLEGE 101 carries only A-II. MAP and Grad Tree reported A-II 1/2, SI 0/2.
  const courses = [took('ARCHLGY 151'), took('AMSTUD 145'), took('COLLEGE 101')]

  it('fills A-II twice and SI once', () => {
    const r = audit([], courses, { ge: true })
    const ways = ge(r, 'GE-WAYS')
    expect(find(ways, /^Way-AII/).status).toBe('complete')
    expect(codesIn(r, find(ways, /^Way-AII/))).toContain('COLLEGE 101')
    expect(find(ways, /^Way-SI/).have.courses).toBe(1)
  })

  it('gives the same answer whatever order the courses come in', () => {
    const forward = audit([], courses, { ge: true })
    const backward = audit([], [...courses].reverse(), { ge: true })
    const summary = (r: AuditResult) => ['AII', 'SI'].map(w => find(ge(r, 'GE-WAYS'), new RegExp(`^Way-${w}`)).have.courses)
    expect(summary(backward)).toEqual(summary(forward))
  })

  it('counts a two-Ways course toward one Way only', () => {
    const r = audit([], [took('AMSTUD 145')], { ge: true })
    const ways = ge(r, 'GE-WAYS')
    const uses = ['AII', 'SI'].map(w => find(ways, new RegExp(`^Way-${w}`)).applied.length)
    expect(uses.reduce((a, b) => a + b)).toBe(1)
  })

  it('lets the same course fill a Way and COLLEGE', () => {
    const r = audit([], [took('COLLEGE 102')], { ge: true })
    expect(find(ge(r, 'GE-COLLEGE'), /Civic/).have.courses).toBe(1)
    const ways = ge(r, 'GE-WAYS')
    expect(find(ways, /^Way-SI/).have.courses + find(ways, /^Way-ER/).have.courses).toBe(1)
  })

  it('follows the Bulletin on units, grading, level and test credit', () => {
    const r = audit([], [
      took('PHIL 1', 'Autumn 2024', 2), // 2 units: below the 3-unit floor
      took('ME 104', 'Autumn 2024', 4, 'CR'), // CR on a course with a letter option
      took('PHYSICS 41', 'Autumn 2024', 4, 'S'), // S/NC-only course: S counts
      took('LINGUIST 280', 'Autumn 2024', 3), // graduate listing of LINGUIST 180
      took('CS 106A', 'Test credit', 5, 'CR'), // test credit
    ], { ge: true })
    const ways = ge(r, 'GE-WAYS')
    expect(find(ways, /^Way-AII/).applied).toHaveLength(0)
    expect(find(ways, /^Way-AQR/).applied).toHaveLength(0)
    expect(codesIn(r, find(ways, /^Way-SMA/))).toEqual(['PHYSICS 41'])
    expect(find(ways, /^Way-FR/).applied).toHaveLength(0)
  })

  it('takes LINGUIST 180 for AQR where LINGUIST 280 failed', () => {
    const r = audit([], [took('LINGUIST 180', 'Autumn 2024', 3)], { ge: true })
    expect(find(ge(r, 'GE-WAYS'), /^Way-AQR/).status).toBe('complete')
  })
})

describe('CS BS', () => {
  it('needs a subplan before it can be complete', () => {
    const r = audit(['CS-BS'], [])
    expect(r.programs[0].needsSubplan).toBe(true)
    expect(r.programs[0].status).toBe('incomplete')
  })

  it('accepts CS 107E for the CS 107 slot, and reports in-progress work as in progress', () => {
    const r = audit(['CS-BS'], [took('CS 107E'), took('CS 111'), took('CS 161', 'Autumn 2026', 5, '')])
    const core = r.programs[0].blocks.find(b => b.block.name === 'Core Program Requirements')!
    expect(core.status).toBe('in-progress')
  })

  it('counts a WIM course toward WIM and the senior project at once', () => {
    const r = audit(['CS-BS'], [took('CS 194W', 'Spring 2026', 3)])
    const p = r.programs[0]
    expect(find(p, 'Writing in the Major (WIM)').status).toBe('complete')
    expect(find(p, 'Senior Project (3 units)').status).toBe('complete')
  })

  it('counts a cross-listed course under either listing (STATS 229 for CS 229)', () => {
    const r = audit([{ code: 'CS-BS', subplan: 'b6' }], [took('STATS 229')])
    const area = find(r.programs[0], /^Area I: AI Methods/)
    expect(codesIn(r, area)).toEqual(['STATS 229'])
  })

  it('applies the 26-unit math floor on top of the course list', () => {
    const r = audit(['CS-BS'], [took('CS 103', 'Autumn 2023', 3), took('CS 109', 'Autumn 2023', 3), took('MATH 19', 'Autumn 2022', 3), took('MATH 20', 'Autumn 2022', 3), took('MATH 21', 'Autumn 2022', 4), took('MATH 51'), took('MATH 52')])
    const math = find(r.programs[0], /^Mathematics/)
    expect(math.floor).toEqual({ need: 26, have: 26 })
    expect(math.status).toBe('complete')
  })
})

describe('double counting between programs', () => {
  const courses = [took('CS 106B'), took('CS 161')]

  it('lets a foundational course count toward two programs', () => {
    const r = audit(['CS-BS', 'ECON-BA'], courses)
    const [cs, econ] = r.programs
    expect(codesIn(r, find(cs, /^Engineering Fundamentals/))).toContain('CS 106B')
    expect(codesIn(r, find(econ, 'Elective Courses'))).toContain('CS 106B')
    expect(r.doubleCounted).toEqual([])
  })

  it('uses any other course once, where it is required', () => {
    const r = audit(['CS-BS', 'ECON-BA'], courses)
    const [cs, econ] = r.programs
    expect(codesIn(r, cs.blocks.find(b => b.block.name === 'Core Program Requirements')!.rules[0])).toContain('CS 161')
    expect(codesIn(r, find(econ, 'Elective Courses'))).not.toContain('CS 161')
  })

  it('lets a secondary major share everything', () => {
    const r = audit(['CS-BS', { code: 'ECON-BA', secondary: true }], courses)
    expect(codesIn(r, find(r.programs[1], 'Elective Courses'))).toContain('CS 161')
  })

  it('leaves the declared programs alone while exploring another (What-If)', () => {
    const r = audit(['CS-BS', { code: 'ECON-BA', exploring: true }], courses)
    expect(codesIn(r, find(r.programs[1], 'Elective Courses'))).toContain('CS 161')
    expect(codesIn(r, r.programs[0].blocks.find(b => b.block.name === 'Core Program Requirements')!.rules[0])).toContain('CS 161')
  })
})

describe('coterm BS + MS', () => {
  const ug = ['CS 103', 'CS 109', 'CS 161', 'CS 107', 'CS 111'].map(c => took(c, 'Autumn 2023'))

  it('satisfies MS foundations with undergraduate courses at 0 units', () => {
    const r = audit(['CS-BS', 'CS-MS'], ug)
    const ms = r.programs[1]
    const foundations = find(ms, 'Foundations')
    expect(foundations.status).toBe('complete')
    expect(foundations.children!.flatMap(c => c.applied).every(a => a.units === 0)).toBe(true)
    expect(r.gradUnits?.completed).toBe(0)
  })

  it('counts graduate-career units toward the MS and not the BS', () => {
    const grad = took('CS 229', 'Autumn 2025', 4, 'A', { career: 'GR' })
    const r = audit(['CS-BS', 'CS-MS'], [...ug, grad])
    expect(r.gradUnits?.completed).toBe(4)
    expect(r.undergradUnits?.completed).toBe(ug.reduce((s, c) => s + c.units, 0))
  })
})

describe('moves, exclusions and marking done', () => {
  it('moves a course into a free-text requirement (a bucket move)', () => {
    const c = took('CHEM 31A')
    const r = audit(['CS-BS'], [c], { overrides: { pins: [{ course: c.id, program: 'CS-BS', node: findId('CS-BS', 'Science Elective') }] } })
    expect(find(r.programs[0], 'Science Elective').status).toBe('complete')
    expect(find(r.programs[0], 'Science Elective').applied[0].exception).toBeUndefined()
  })

  it('flags a course moved somewhere it is not listed as an exception', () => {
    const c = took('HISTORY 1A')
    const r = audit(['CS-BS'], [c], { overrides: { pins: [{ course: c.id, program: 'CS-BS', node: findId('CS-BS', 'Writing in the Major (WIM)') }] } })
    const wim = find(r.programs[0], 'Writing in the Major (WIM)')
    expect(wim.applied[0]).toMatchObject({ courseId: c.id, pinned: true, exception: true })
  })

  it('moves a course between requirements it is listed for', () => {
    // CS 157 is a math elective and a theory elective; pinned, it stays in math.
    const c = took('CS 157')
    const pinned = audit([{ code: 'CS-BS', subplan: 'b12' }], [c], { overrides: { pins: [{ course: c.id, program: 'CS-BS', node: findId('CS-BS', 'Math Electives') }] } })
    expect(codesIn(pinned, find(pinned.programs[0], 'Math Electives'))).toEqual(['CS 157'])
  })

  it('keeps an excluded course out of a program', () => {
    const c = took('CS 161')
    const r = audit(['CS-BS'], [c], { overrides: { exclusions: [{ course: c.id, program: 'CS-BS' }] } })
    expect(r.notApplied).toEqual([c.id])
  })

  it('treats a requirement marked done as complete', () => {
    const r = audit(['CS-BS'], [], { overrides: { done: [`CS-BS:${findId('CS-BS', 'Technology in Science')}`] } })
    expect(find(r.programs[0], 'Technology in Science').status).toBe('complete')
  })
})

describe('alternate paths', () => {
  const humbio = ['HUMBIO 2A', 'HUMBIO 3A', 'HUMBIO 4A'].map(c => took(c))

  it('picks the path the courses complete', () => {
    const r = audit([{ code: 'CS-BS', subplan: 'b7' }], humbio)
    const seq = find(r.programs[0], 'Biology or Humbio Sequence')
    expect(seq.status).toBe('complete')
    expect(seq.auto).toBe(true)
  })

  it('prefers the path that finishes over a bigger path with more courses in it', () => {
    // Two of the three Biology courses vs all three Humbio courses: Humbio is done.
    const r = audit([{ code: 'CS-BS', subplan: 'b7' }], [...humbio, took('BIO 82'), took('BIO 83')])
    const seq = find(r.programs[0], 'Biology or Humbio Sequence')
    expect(seq.status).toBe('complete')
    expect(seq.node.children!.find(c => c.id === seq.chosen![0])!.name).toBe('Humbio Sequence')
  })

  it('follows a path the student picked, even a worse one', () => {
    const base = audit([{ code: 'CS-BS', subplan: 'b7' }], humbio)
    const node = find(base.programs[0], 'Biology or Humbio Sequence')
    const biology = node.node.children!.find(c => c.name === 'Biology Sequence')!.id
    const r = audit([{ code: 'CS-BS', subplan: 'b7' }], humbio, { overrides: { paths: { [`CS-BS:${node.node.id}`]: biology } } })
    const picked = find(r.programs[0], 'Biology or Humbio Sequence')
    expect(picked.chosen).toEqual([biology])
    expect(picked.status).toBe('incomplete')
  })

  it('counts 3 of 4 MS breadth areas, and lets the implementation course double as one', () => {
    // CS 221 is also a Probability foundation; CS 109 is the more specific fit there.
    const r = audit(['CS-MS'], ['CS 109', 'CS 154', 'CS 221', 'CS 144'].map(c => took(c, 'Autumn 2025', 3, 'A', { career: 'GR' })))
    const ms = r.programs[0]
    expect(find(ms, 'Breadth Areas').status).toBe('complete')
    expect(codesIn(r, find(ms, 'Probability'))).toEqual(['CS 109'])
    const ssi = find(ms, 'Significant Software Implementation')
    expect(ssi.status).toBe('complete')
    expect(ssi.applied[0].shared).toBe(true)
  })
})

describe('units toward the bachelor’s degree', () => {
  it('caps pass/fail units at 36', () => {
    const courses = Array.from({ length: 10 }, (_, i) => took('ATHLETIC 10', `Autumn ${2020 + Math.floor(i / 3)}`, 4, 'S'))
    const r = audit(['CS-BS'], courses)
    expect(r.undergradUnits).toMatchObject({ completed: 36, overCap: 4, need: 180 })
  })

  it('needs 225 for a B.A. and a B.S.', () => {
    const r = audit(['CS-BS', 'ECON-BA'], [])
    expect(r.undergradUnits?.need).toBe(225)
  })
})

describe('statuses by term', () => {
  it('reads past terms as done, the current term as in progress and later terms as planned', () => {
    const r = audit(['CS-BS'], [took('CS 107', 'Spring 2026', 5, ''), took('CS 111', 'Autumn 2026', 5, ''), took('CS 161', 'Winter 2027', 5, '')])
    const core = r.programs[0].blocks.find(b => b.block.name === 'Core Program Requirements')!
    expect(core.status).toBe('planned')
  })

  it('does not count failed or withdrawn attempts', () => {
    const r = audit(['CS-BS'], [took('CS 161', 'Autumn 2025', 5, 'NP'), took('CS 111', 'Autumn 2025', 5, 'W')])
    expect(r.notCounted).toHaveLength(2)
  })
})

describe('a full record', () => {
  it('solves a 45-course BS + MS + general education audit quickly and the same way twice', () => {
    const codes = [
      'COLLEGE 101', 'COLLEGE 102', 'PWR 1', 'PWR 2AB', 'SPANLANG 3', 'CS 106B', 'CS 103', 'CS 109', 'MATH 19', 'MATH 20', 'MATH 21',
      'MATH 51', 'MATH 52', 'PHYSICS 41', 'PHYSICS 43', 'ENGR 40M', 'CS 107', 'CS 111', 'CS 161', 'CS 147', 'CS 247G', 'CS 347',
      'CS 177', 'CS 278', 'CS 448B', 'CS 194W', 'ARCHLGY 151', 'AMSTUD 145', 'POLISCI 125', 'PHIL 1', 'ME 104', 'CS 154', 'CS 145',
      'CS 221', 'CS 229', 'CS 124', 'CS 224N', 'CS 231N', 'CS 142', 'CS 146J', 'ENGLISH 106A', 'COMM 254', 'CS 206', 'CS 210A', 'CS 329X',
    ]
    const courses = codes.map((c, i) => took(c, `${['Autumn', 'Winter', 'Spring'][i % 3]} ${2022 + Math.floor(i / 12)}`, undefined, 'A', { career: i > 33 ? 'GR' : 'UG' }))
    const run = () => audit([{ code: 'CS-BS', subplan: 'b9' }, { code: 'CS-MS', subplan: 'b8' }], courses, { ge: true })
    const start = performance.now()
    const first = run()
    const elapsed = performance.now() - start
    const second = run()
    const fingerprint = (r: AuditResult) => JSON.stringify([...r.programs, ...r.generalEducation].map(p => [p.code, p.met, p.total, p.status]))
    expect(fingerprint(second)).toBe(fingerprint(first))
    expect(elapsed).toBeLessThan(1500)

    // Dropping any one course never leaves more requirements met.
    const metOf = (r: AuditResult) => [...r.programs, ...r.generalEducation].reduce((s, p) => s + p.metWithPlan, 0)
    const full = metOf(first)
    for (let i = 0; i < courses.length; i += 3) {
      const fewer = courses.filter((_, j) => j !== i)
      const r = audit([{ code: 'CS-BS', subplan: 'b9' }, { code: 'CS-MS', subplan: 'b8' }], fewer, { ge: true })
      expect(metOf(r), `without ${courses[i].code}`).toBeLessThanOrEqual(full)
    }
  })
})

function findId(code: string, name: string): string {
  let id: string | undefined
  const walk = (n: ProgramData['blocks'][number]['rules'][number]) => {
    if (!id && n.name === name) id = n.id
    n.children?.forEach(walk)
  }
  program(code).blocks.forEach(b => b.rules.forEach(walk))
  if (!id) throw new Error(`no rule ${name} in ${code}`)
  return id
}
