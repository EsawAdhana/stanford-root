import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runAudit, type AuditResult, type NodeResult, type ProgramResult } from '@/lib/requirements/audit'
import { buildCourseIndex } from '@/lib/requirements/course-index'
import { EMPTY_OVERRIDES, type AuditOverrides, type ProgramBlock, type ProgramChoice, type ProgramData, type StudentCourse } from '@/lib/requirements/types'

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

/** A subplan block's id, by the start of its name. */
function sub(code: string, name: string): string {
  const block = program(code).blocks.find(b => b.kind === 'subplan' && b.name.startsWith(name))
  if (!block) throw new Error(`no subplan ${name} in ${code}`)
  return block.id
}

const codesIn = (result: AuditResult, n: NodeResult) => n.applied.map(a => result.courses.get(a.courseId)!.course.code).sort()
/** Codes applied anywhere under a rule, for a choice whose courses sit on its children. */
const codesUnder = (result: AuditResult, n: NodeResult): string[] => [...codesIn(result, n), ...(n.children ?? []).flatMap(c => codesUnder(result, c))].sort()
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
    // The core block also holds the GPA rule, checked by hand, so look at the core courses themselves.
    const r = audit(['CS-BS'], [took('CS 107E'), took('CS 111'), took('CS 161', 'Autumn 2026', 5, '')])
    expect(find(r.programs[0], 'Core').status).toBe('in-progress')
  })

  it('counts a WIM course toward WIM and the senior project at once', () => {
    const r = audit(['CS-BS'], [took('CS 194W', 'Spring 2026', 3)])
    const p = r.programs[0]
    expect(find(p, 'Writing in the Major (WIM)').status).toBe('complete')
    expect(find(p, 'Senior Project (3 units)').status).toBe('complete')
  })

  it('counts a cross-listed course under either listing (STATS 229 for CS 229)', () => {
    const r = audit([{ code: 'CS-BS', subplan: sub('CS-BS', 'Artificial Intelligence') }], [took('STATS 229')])
    const area = find(r.programs[0], /^Area I: AI Methods/)
    expect(codesIn(r, area)).toEqual(['STATS 229'])
  })

  it('applies the 26-unit math floor on top of the course list', () => {
    const r = audit([{ code: 'CS-BS', subplan: sub('CS-BS', 'Artificial Intelligence') }], [took('CS 103', 'Autumn 2023', 3), took('CS 109', 'Autumn 2023', 3), took('MATH 19', 'Autumn 2022', 3), took('MATH 20', 'Autumn 2022', 3), took('MATH 21', 'Autumn 2022', 4), took('MATH 51'), took('MATH 52')])
    const math = find(r.programs[0], /^Mathematics/)
    expect(math.floor).toEqual({ need: 26, have: 26 })
    expect(math.status).toBe('complete')
  })
})

describe('double counting between programs', () => {
  const courses = [took('CS 106B'), took('CS 161')]

  it('lets a foundational course count toward two programs', () => {
    const r = audit([{ code: 'CS-BS', subplan: sub('CS-BS', 'Artificial Intelligence') }, 'ECON-BA'], courses)
    const [cs, econ] = r.programs
    expect(codesIn(r, find(cs, /^Engineering Fundamentals/))).toContain('CS 106B')
    expect(codesIn(r, find(econ, /^Elective Courses/))).toContain('CS 106B')
    expect(r.doubleCounted).toEqual([])
  })

  it('uses any other course once, where it is required', () => {
    const r = audit(['CS-BS', 'ECON-BA'], courses)
    const [cs, econ] = r.programs
    expect(codesIn(r, cs.blocks.find(b => b.block.name === 'Core Program Requirements')!.rules[0])).toContain('CS 161')
    expect(codesIn(r, find(econ, /^Elective Courses/))).not.toContain('CS 161')
  })

  it('lets a secondary major share everything', () => {
    const r = audit(['CS-BS', { code: 'ECON-BA', secondary: true }], courses)
    expect(codesIn(r, find(r.programs[1], /^Elective Courses/))).toContain('CS 161')
  })

  it('leaves the declared programs alone while exploring another (What-If)', () => {
    const r = audit(['CS-BS', { code: 'ECON-BA', exploring: true }], courses)
    expect(codesIn(r, find(r.programs[1], /^Elective Courses/))).toContain('CS 161')
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
    // Since the review, the School of Engineering science rules sit in each subplan but Computational Biology.
    const ai = { code: 'CS-BS', subplan: sub('CS-BS', 'Artificial Intelligence') }
    const r = audit([ai], [c], { overrides: { pins: [{ course: c.id, program: 'CS-BS', node: findIdIn('CS-BS', 'Artificial Intelligence', 'Science Elective (SoE approved list)') }] } })
    expect(find(r.programs[0], 'Science Elective (SoE approved list)').status).toBe('complete')
    expect(find(r.programs[0], 'Science Elective (SoE approved list)').applied[0].exception).toBeUndefined()
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
    const pinned = audit([{ code: 'CS-BS', subplan: sub('CS-BS', 'Theory') }], [c], { overrides: { pins: [{ course: c.id, program: 'CS-BS', node: findIdIn('CS-BS', 'Theory', 'Math Electives') }] } })
    const math = pinned.programs[0].blocks.find(b => b.block.name.startsWith('Theory'))!
    const electives = math.rules.flatMap(function all(n: NodeResult): NodeResult[] { return [n, ...(n.children ?? []).flatMap(all)] }).find(n => n.node.name === 'Math Electives')!
    expect(codesIn(pinned, electives)).toEqual(['CS 157'])
  })

  it('keeps an excluded course out of a program', () => {
    const c = took('CS 161')
    const r = audit(['CS-BS'], [c], { overrides: { exclusions: [{ course: c.id, program: 'CS-BS' }] } })
    expect(r.notApplied).toEqual([c.id])
  })

  it('treats a requirement marked done as complete', () => {
    const r = audit(['CS-BS'], [], { overrides: { done: [`CS-BS:${findId('CS-BS', 'Technology in Society')}`] } })
    expect(find(r.programs[0], 'Technology in Society').status).toBe('complete')
  })
})

describe('alternate paths', () => {
  const humbio = ['HUMBIO 2A', 'HUMBIO 3A', 'HUMBIO 4A'].map(c => took(c))

  it('picks the path the courses complete', () => {
    const r = audit([{ code: 'CS-BS', subplan: sub('CS-BS', 'Computational Biology') }], humbio)
    const seq = find(r.programs[0], 'Biology or Humbio Sequence')
    expect(seq.status).toBe('complete')
    expect(seq.auto).toBe(true)
  })

  it('prefers the path that finishes over a bigger path with more courses in it', () => {
    // Two of the three Biology courses vs all three Humbio courses: Humbio is done.
    const r = audit([{ code: 'CS-BS', subplan: sub('CS-BS', 'Computational Biology') }], [...humbio, took('BIO 82'), took('BIO 83')])
    const seq = find(r.programs[0], 'Biology or Humbio Sequence')
    expect(seq.status).toBe('complete')
    expect(seq.node.children!.find(c => c.id === seq.chosen![0])!.name).toBe('Humbio Sequence')
  })

  it('follows a path the student picked, even a worse one', () => {
    const base = audit([{ code: 'CS-BS', subplan: sub('CS-BS', 'Computational Biology') }], humbio)
    const node = find(base.programs[0], 'Biology or Humbio Sequence')
    const biology = node.node.children!.find(c => c.name === 'Biology Sequence')!.id
    const r = audit([{ code: 'CS-BS', subplan: sub('CS-BS', 'Computational Biology') }], humbio, { overrides: { paths: { [`CS-BS:${node.node.id}`]: biology } } })
    const picked = find(r.programs[0], 'Biology or Humbio Sequence')
    expect(picked.chosen).toEqual([biology])
    expect(picked.status).toBe('incomplete')
  })

  it('counts 3 of 4 MS breadth areas, and lets the implementation course double as one', () => {
    // CS 221 is also a Probability foundation; CS 109 is the more specific fit there.
    const r = audit(['CS-MS'], ['CS 109', 'CS 154', 'CS 221', 'CS 144'].map(c => took(c, 'Autumn 2025', 3, 'A', { career: 'GR' })))
    const ms = r.programs[0]
    expect(find(ms, 'Breadth Areas').status).toBe('complete')
    expect(codesUnder(r, find(ms, 'Probability'))).toEqual(['CS 109'])
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
    expect(find(r.programs[0], 'Core').status).toBe('planned')
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
    const run = () => audit([{ code: 'CS-BS', subplan: sub('CS-BS', 'Human-Computer Interaction') }, { code: 'CS-MS', subplan: sub('CS-MS', 'Human-Computer Interaction') }], courses, { ge: true })
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
      const r = audit([{ code: 'CS-BS', subplan: sub('CS-BS', 'Human-Computer Interaction') }, { code: 'CS-MS', subplan: sub('CS-MS', 'Human-Computer Interaction') }], fewer, { ge: true })
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

/** A rule's id inside one block, by the start of the block's name. */
function findIdIn(code: string, block: string, name: string): string {
  let id: string | undefined
  const walk = (n: ProgramData['blocks'][number]['rules'][number]) => {
    if (!id && n.name === name) id = n.id
    n.children?.forEach(walk)
  }
  program(code).blocks.filter(b => b.name.startsWith(block)).forEach(b => b.rules.forEach(walk))
  if (!id) throw new Error(`no rule ${name} in ${code} ${block}`)
  return id
}

describe('saved plans from before stable ids', () => {
  it('keeps programs and courses and clears choices keyed by the old ids', async () => {
    const { migrateDegreePlan } = await import('@/lib/requirements/degree-store')
    const v1 = {
      programs: [{ code: 'CS-BS', subplan: 'b9', optional: ['b5'] }, { code: 'ECON-MIN', secondary: true }],
      courses: [{ id: 'transcript:CS 106B:Autumn 2023', code: 'CS 106B', term: 'Autumn 2023', units: 5, source: 'transcript' }],
      overrides: { pins: [{ course: 'x', program: 'CS-BS', node: 'r12' }], exclusions: [], done: ['CS-BS:r3'], paths: { 'CS-BS:r7': 'r8' } },
    }
    const v2 = migrateDegreePlan(v1, 1) as typeof v1
    expect(v2.programs).toEqual([{ code: 'CS-BS', secondary: undefined, exploring: undefined }, { code: 'ECON-MIN', secondary: true, exploring: undefined }])
    expect(v2.courses).toEqual(v1.courses)
    expect(v2.overrides).toEqual(EMPTY_OVERRIDES)
    expect(migrateDegreePlan(v2, 2)).toBe(v2)
  })
})

describe('designations across two programs (found by the pair sweep)', () => {
  it('lets a major take back its WIM course from a minor that can use another course', async () => {
    const { verifyPair } = await import('@/lib/requirements/verify')
    expect(verifyPair(program('EPS-BS'), program('GEOPH-MIN'), index)).toEqual([])
  })

  it('never gives two programs the same designation course', async () => {
    const { verifyPair } = await import('@/lib/requirements/verify')
    for (const [a, b] of [['AA-BS', 'IDMEN-BS'], ['CSRE-BA', 'JEWSH-BA'], ['ECON-BA', 'ECON-BS'], ['HUMBI-BA', 'HUMBI-BS']]) {
      expect(verifyPair(program(a), program(b), index).filter(f => f.scenario === 'double counting')).toEqual([])
    }
  })
})

describe('program-wide rules', () => {
  it('caps test and transfer credit at 45 units toward the bachelor’s', () => {
    const credit = Array.from({ length: 12 }, (_, i) => took(['MATH 19', 'MATH 20', 'MATH 21', 'CHEM 31A', 'PHYSICS 41', 'CS 106A', 'ECON 1', 'PSYCH 1', 'HISTORY 1A', 'SPANLANG 1', 'SPANLANG 2', 'SPANLANG 3'][i], 'Test credit', 5, 'CR'))
    const r = audit(['CS-BS'], credit)
    expect(r.undergradUnits).toMatchObject({ completed: 45, externalOverCap: 15 })
  })

  it('counts letter-graded units and the graduate-level share across a master’s program', () => {
    const ms: ProgramData = { ...program('CS-MS'), letterUnitsMin: 12, gradUnitsShare: 0.5 }
    const run = (courses: StudentCourse[]) => runAudit({ programs: [{ data: ms, choice: { code: 'CS-MS' } }], courses, index, overrides: EMPTY_OVERRIDES, generalEducation: false, now: NOW }).programs[0]
    const status = (r: ProgramResult, key: string) => r.checks.find(c => c.key === key)?.status
    const letter = ['CS 229', 'CS 221', 'CS 224N'].map(c => took(c, 'Autumn 2025', 4, 'A', { career: 'GR' }))
    const ok = run(letter)
    expect([status(ok, 'letter'), status(ok, 'graduate')]).toEqual(['complete', 'complete'])
    const cr = run(letter.map(c => ({ ...c, grade: 'CR' })))
    expect(status(cr, 'letter')).toBe('incomplete')
    const undergradLevel = run(['CS 145', 'CS 154', 'CS 161', 'CS 229'].map(c => took(c, 'Autumn 2025', 4, 'A', { career: 'GR' })))
    expect(status(undergradLevel, 'graduate')).toBe('incomplete')
  })
})

/** A small program for one rule shape, so a test does not depend on one department's overlay. */
function made(code: string, blocks: ProgramBlock[], extra: Partial<ProgramData> = {}): ProgramData {
  return { code, name: code, kind: 'major', degree: 'BA', year: '2026-27', url: '', departments: [], blocks, ...extra }
}

function auditMade(programs: ProgramData[], courses: StudentCourse[], overrides: Partial<AuditOverrides> = {}): AuditResult {
  return runAudit({ programs: programs.map(data => ({ data, choice: { code: data.code } })), courses, index, overrides: { ...EMPTY_OVERRIDES, ...overrides }, generalEducation: false, now: NOW })
}

const check = (r: ProgramResult, key: string) => r.checks.find(c => c.key === key)

describe('counts over the whole program (found reviewing all 355 programs)', () => {
  // "The remaining units may be in linguistics" (LING-BA): an optional pool takes them, the 60 units checks them.
  const remaining = made('T-LING', [{ id: 'b', name: 'Major', rules: [
    { id: 'core', t: 'courses', mode: 'all', items: [['LINGUIST 1']] },
    { id: 'rest', t: 'courses', mode: 'any', pool: { subjects: ['LINGUIST'] }, optional: true },
  ] }], { unitsMin: 12 })

  it('checks the program’s minimum units, counting what the rules hold', () => {
    const two = [took('LINGUIST 1'), took('LINGUIST 105')]
    expect(check(auditMade([remaining], two).programs[0], 'units')).toMatchObject({ status: 'incomplete', have: 8, need: 12 })
    const three = [...two, took('LINGUIST 130A')]
    expect(auditMade([remaining], three).programs[0].status).toBe('complete')
    expect(auditMade([remaining], [...three].reverse()).programs[0].status).toBe('complete')
  })

  it('counts every graduate-career course toward a master’s units, research too, but not a CR course in a letter-grade program', () => {
    const ms = made('T-MS', [{ id: 'b', name: 'Core', rules: [{ id: 'ml', t: 'courses', mode: 'all', items: [['CS 229']] }] }], { kind: 'grad', degree: 'MS', unitsMin: 10, letterGrade: true })
    const gr = (code: string, units: number, grade = 'A') => took(code, 'Autumn 2025', units, grade, { career: 'GR' })
    const short = auditMade([ms], [gr('CS 229', 4), gr('CS 399', 3), gr('CS 221', 3, 'CR')]).programs[0]
    expect(check(short, 'units')).toMatchObject({ status: 'incomplete', have: 7 })
    expect(auditMade([ms], [gr('CS 229', 4), gr('CS 399', 3), gr('CS 399', 3)]).programs[0].status).toBe('complete')
  })

  it('stops counting units past a cap without failing the student for them', () => {
    const capped = made('T-CAP', [{ id: 'b', name: 'Major', rules: [{ id: 'any', t: 'courses', mode: 'any', pool: { subjects: ['LINGUIST', 'SPANLANG'] }, optional: true }] }], {
      unitsMin: 10,
      totals: [{ label: 'Language courses', maxUnits: 5, pool: { subjects: ['SPANLANG'] } }],
    })
    const r = auditMade([capped], [took('SPANLANG 1'), took('SPANLANG 2'), took('LINGUIST 105')]).programs[0]
    expect(check(r, 'units')).toMatchObject({ status: 'incomplete', have: 9 })
    expect(check(r, 'total:0')?.status).toBe('info')
    expect(auditMade([capped], [took('SPANLANG 1'), took('SPANLANG 2'), took('LINGUIST 105'), took('LINGUIST 130A')]).programs[0].status).toBe('complete')
  })

  it('fails a range only when the record goes over it', () => {
    const ranged = made('T-RANGE', [{ id: 'b', name: 'Major', rules: [{ id: 'any', t: 'courses', mode: 'any', pool: { subjects: ['LINGUIST'] }, optional: true }] }], {
      totals: [{ label: '8-12 units of Linguistics', minUnits: 8, maxUnits: 12, pool: { subjects: ['LINGUIST'] } }],
    })
    const three = ['LINGUIST 1', 'LINGUIST 105', 'LINGUIST 130A'].map(c => took(c))
    expect(check(auditMade([ranged], three).programs[0], 'total:0')?.status).toBe('complete')
    expect(check(auditMade([ranged], [...three, took('LINGUIST 150', 'Autumn 2024', 4)]).programs[0], 'total:0')?.status).toBe('incomplete')
  })

  it('applies a subplan’s own total only with that subplan', () => {
    const data = made('T-WHEN', [
      { id: 'b', name: 'Major', rules: [{ id: 'core', t: 'courses', mode: 'all', items: [['LINGUIST 1']] }] },
      { id: 's1', name: 'Plain', kind: 'subplan', rules: [{ id: 's1r', t: 'courses', mode: 'all', items: [['LINGUIST 105']] }] },
      { id: 's2', name: 'Long', kind: 'subplan', rules: [{ id: 's2r', t: 'courses', mode: 'all', items: [['LINGUIST 105']] }] },
    ], { totals: [{ label: '12 units with the long subplan', minUnits: 12, when: 's2' }] })
    const courses = [took('LINGUIST 1'), took('LINGUIST 105')]
    const run = (subplan: string) => runAudit({ programs: [{ data, choice: { code: data.code, subplan } }], courses, index, overrides: EMPTY_OVERRIDES, generalEducation: false, now: NOW }).programs[0]
    expect(run('s1').status).toBe('complete')
    expect(run('s2').status).toBe('incomplete')
  })
})

describe('designations and moves (found reviewing all 355 programs)', () => {
  const withWim = (wim: ProgramBlock['rules']) => made('T-WIM', [
    { id: 'b', name: 'Major', rules: [{ id: 'req', t: 'courses', mode: 'all', items: [['LINGUIST 105']] }, { id: 'more', t: 'courses', mode: 'atLeast', n: 2, items: [['LINGUIST 130A'], ['LINGUIST 150'], ['LINGUIST 1']] }] },
    { id: 'w', name: 'Writing in the Major', wim: true, rules: wim },
  ])

  it('keeps a course moved into a designation in the rule it fills', () => {
    const data = withWim([{ id: 'wim', t: 'courses', mode: 'atLeast', n: 1, items: [['LINGUIST 105'], ['LINGUIST 130A']] }])
    const courses = [took('LINGUIST 105'), took('LINGUIST 130A'), took('LINGUIST 150')]
    const r = auditMade([data], courses, { pins: [{ course: courses[0].id, program: data.code, node: 'wim' }] })
    const p = r.programs[0]
    expect(codesIn(r, p.blocks[0].rules[0])).toEqual(['LINGUIST 105'])
    expect(codesIn(r, p.blocks[1].rules[0])).toEqual(['LINGUIST 105'])
    expect(p.status).toBe('complete')
  })

  it('keeps a course moved into a free-text rule out when it misses the program’s grading rule', () => {
    const data = made('T-GRADE', [{ id: 'b', name: 'Minor', rules: [{ id: 'el', t: 'text', n: 1, manual: 'approval', name: 'Approved elective' }] }], { kind: 'minor', degree: '', letterGrade: true, minGrade: 'C' })
    const cr = took('LINGUIST 105', 'Autumn 2024', 4, 'CR')
    const low = took('LINGUIST 130A', 'Autumn 2024', 4, 'D')
    const pins = (c: StudentCourse) => [{ course: c.id, program: data.code, node: 'el' }]
    for (const c of [cr, low]) {
      const node = auditMade([data], [c], { pins: pins(c) }).programs[0].blocks[0].rules[0]
      expect(node.status).toBe('manual')
      expect(node.belowGrade).toEqual([c.id])
    }
    const ok = took('LINGUIST 150', 'Autumn 2024', 4, 'B')
    expect(auditMade([data], [ok], { pins: pins(ok) }).programs[0].status).toBe('complete')
  })

  it('lets a designation that asks for units take as many courses as it needs', () => {
    const data = withWim([{ id: 'wim', t: 'courses', mode: 'units', units: 8, items: [['LINGUIST 105'], ['LINGUIST 130A'], ['LINGUIST 150']] }])
    const r = auditMade([data], [took('LINGUIST 105'), took('LINGUIST 130A'), took('LINGUIST 150', 'Autumn 2024', 4)])
    expect(r.programs[0].blocks[1].rules[0]).toMatchObject({ status: 'complete' })
    expect(r.programs[0].blocks[1].rules[0].applied.length).toBeGreaterThanOrEqual(2)
  })
})

describe('listings, caps and optional groups (found by the full audit)', () => {
  it('counts a cross-listing in another subject, but not the other number in the same subject', () => {
    const ma = made('T-COMM', [{ id: 'b', name: 'Core', rules: [{ id: 'm', t: 'courses', mode: 'all', items: [['COMM 206']] }] }], { kind: 'grad', degree: 'MA' })
    const gr = (code: string) => took(code, 'Autumn 2025', 4, 'A', { career: 'GR' })
    expect(auditMade([ma], [gr('COMM 106')]).programs[0].status).toBe('incomplete')
    expect(auditMade([ma], [gr('COMM 206')]).programs[0].status).toBe('complete')
  })

  it('takes a course past a CR/NC cap out of the rules it would fill', () => {
    const data = made('T-CR', [{ id: 'b', name: 'Economics', rules: [{ id: 'e', t: 'courses', mode: 'all', items: [['ECON 1'], ['ECON 50']] }] }], {
      totals: [{ label: 'CR units', maxUnits: 5, grading: 'not-letter' }],
    })
    const r = auditMade([data], [took('ECON 1', 'Autumn 2024', 5, 'CR'), took('ECON 50', 'Winter 2025', 5, 'CR')]).programs[0]
    expect(r.blocks[0].rules[0]).toMatchObject({ status: 'incomplete' })
    expect(r.blocks[0].rules[0].applied).toHaveLength(1)
  })

  it('asks nothing of an optional group a student skips', () => {
    const data = made('T-OPT', [{ id: 'b', name: 'Major', rules: [
      { id: 'core', t: 'courses', mode: 'all', items: [['LINGUIST 1']] },
      { id: 'extra', t: 'any', optional: true, children: [{ id: 'x1', t: 'courses', mode: 'all', items: [['LINGUIST 105']] }, { id: 'x2', t: 'courses', mode: 'all', items: [['LINGUIST 130A']] }] },
    ] }])
    const r = auditMade([data], [took('LINGUIST 1')]).programs[0]
    expect(r.status).toBe('complete')
    expect(r.total).toBe(1)
  })
})

describe('moves between programs and rules (found by the pair sweep)', () => {
  it('gives a minor the cross-listed course a major holds beyond what it needs', () => {
    // ENGL-BA + CHILT-MIN: CHILATST 12D is ENGLISH 12D; the major's 10 units are met without it.
    const major = made('T-ENGL', [{ id: 'b', name: 'Major', rules: [{ id: 'lit', t: 'courses', mode: 'units', units: 10, pool: { subjects: ['ENGLISH'] } }] }])
    const minor = made('T-CHILT', [{ id: 'm', name: 'Minor', units: 10, rules: [{ id: 'el', t: 'courses', mode: 'any', pool: { subjects: ['CHILATST'] } }] }], { kind: 'minor', degree: '' })
    const courses = [took('ENGLISH 10A'), took('ENGLISH 172E'), took('CHILATST 12D', 'Autumn 2024', 5), took('CHILATST 100')]
    for (const order of [courses, [...courses].reverse()]) {
      const r = auditMade([major, minor], order)
      expect(r.programs.map(p => p.status)).toEqual(['complete', 'complete'])
      expect(r.doubleCounted).toEqual([])
    }
  })

  it('gives a minor the course it needs once its language cap stops counting units past 12', () => {
    // SPAN-BA + PORT-MIN: 14 Portuguese language units count as 12, so the
    // minor's 23 units need ILAC 102, which the major holds beyond its own.
    const major = made('T-SPAN', [{ id: 'b', name: 'Major', rules: [
      { id: 'core', t: 'courses', mode: 'all', items: [['ILAC 130'], ['ILAC 131']] },
      { id: 'rest', t: 'courses', mode: 'any', pool: { subjects: ['ILAC'], minNumber: 100, maxNumber: 299 }, optional: true },
    ] }], { unitsMin: 10 })
    const lang = ['PORTLANG 11A', 'PORTLANG 12A', 'PORTLANG 101', 'PORTLANG 102']
    const minor = made('T-PORT', [{ id: 'm', name: 'Minor', rules: [
      { id: 'lang', t: 'courses', mode: 'any', items: lang.map(c => [c]), optional: true },
      { id: 'rest', t: 'courses', mode: 'any', pool: { subjects: ['ILAC'], minNumber: 100, maxNumber: 299 }, optional: true },
    ] }], { kind: 'minor', degree: '', unitsMin: 13, totals: [{ label: 'Portuguese language units', maxUnits: 8, codes: lang }] })
    const courses = [took('ILAC 130', 'Autumn 2024', 5), took('ILAC 131', 'Autumn 2024', 5), took('ILAC 102', 'Autumn 2024', 5), ...lang.map(c => took(c, 'Winter 2025', c.endsWith('A') ? 4 : 3))]
    for (const order of [courses, [...courses].reverse()]) {
      const r = auditMade([major, minor], order)
      expect(r.programs.map(p => p.status)).toEqual(['complete', 'complete'])
      expect(check(r.programs[1], 'units')).toMatchObject({ have: 13, need: 13 })
    }
  })

  it('finds the one track pairing a Political Science record completes, out of twenty', async () => {
    const { verifyProgram } = await import('@/lib/requirements/verify')
    expect(verifyProgram(program('POLSC-BA'), index)).toEqual([])
  })
})
