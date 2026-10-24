import { describe, expect, it } from 'vitest'
import { buildCourseTable, convertProgram } from '../scripts/requirements/convert.mjs'
import { runAudit } from '@/lib/requirements/audit'
import { buildCourseIndex } from '@/lib/requirements/course-index'
import { EMPTY_OVERRIDES, type ProgramData } from '@/lib/requirements/types'

/**
 * The Coursedog-to-rules conversion on small hand-written inputs, for the
 * fields the all-programs review found missing or misread.
 */

const course = (id: number, subject: string, number: string, units = 5) => ({
  courseGroupId: String(id),
  code: `${subject}${number}`,
  subjectCode: subject,
  courseNumber: number,
  longName: `${subject} ${number}`,
  career: 'Undergraduate',
  credits: { creditHours: { min: units, max: units } },
  customFields: {},
})

const courses = [course(1, 'LING', '1'), course(2, 'LING', '2'), course(3, 'LING', '3'), course(4, 'LING', '4'), course(5, 'LAW', '201', 4)]
courses[4].career = 'Law'
const table = buildCourseTable(courses)

const rule = (id: string, condition: string, ids: number[], extra: Record<string, unknown> = {}) => ({
  id, condition, name: id, value: { condition: 'courses', values: ids.map(i => ({ value: [String(i)], logic: 'and' })) }, ...extra,
})

function program(rules: unknown[], extra: Record<string, unknown> = {}, blocks: unknown[] = []) {
  return {
    code: 'T-BA', longName: 'Test (BA)', type: '(MAJ) Major', level: 'Undergraduate Matriculated', degreeDesignation: 'BA - Bachelor of Arts',
    requisites: { requisitesSimple: [{ id: 'core', name: 'Core', rules }, ...blocks] },
    ...extra,
  }
}

const convert = (p: unknown, overlay?: unknown) => convertProgram(p, table, new Map(), '2026-27', overlay) as { file: ProgramData; errors: string[]; warnings: string[] }

describe('converting a Bulletin program', () => {
  it('reads the unit minimum, subplan flag and policies from customFields, where Coursedog keeps them', () => {
    const { file } = convert(program([rule('r1', 'completedAllOf', [1])], {
      customFields: {
        unitsProgramMin: 71, subplanRequired: false,
        programGradingPolicies: '<p>Courses must be taken for a letter grade.</p>',
        programAdditionalPolicies: '<p>Courses can only be counted once.</p>',
        WOZxr: '<p>Transfer credit cannot be used toward the minor.</p>',
        AZvZN: 'Submit a senior survey',
      },
    }, [{ id: 'sub', name: 'Poetry Subplan', rules: [rule('r2', 'completedAllOf', [2])] }]))
    expect(file).toMatchObject({
      unitsMin: 71, subplanRequired: false,
      grading: 'Courses must be taken for a letter grade.',
      policies: 'Courses can only be counted once.',
      transferPolicy: 'Transfer credit cannot be used toward the minor.',
      otherRequirements: 'Submit a senior survey',
    })
  })

  it('reads "Complete 1 or more course(s) and earn 5 or more credit(s)" as a count with a unit floor, and its maximums as caps', () => {
    const { file } = convert(program([rule('r1', 'completeVariableCoursesAndVariableCredits', [1, 2, 3], { minCourses: 1, minCredits: 5, maxCourses: 2, maxCredits: 10 })]))
    const node = file.blocks[0].rules[0]
    expect(node).toMatchObject({ t: 'courses', mode: 'atLeast', n: 1, units: 5 })
    expect(node.limits?.map(l => [l.max, l.maxUnits])).toEqual([[2, undefined], [undefined, 10]])
  })

  it('keeps Law, Medicine and GSB courses, as graduate courses', () => {
    const index = buildCourseIndex({ rows: table.rows as never })
    expect(index.get('LAW 201')?.tags).toContain('GR')
  })

  it('applies a block that only counts without a subplan, and lets an overlay say a subplan is required', () => {
    const raw = program([rule('r1', 'completedAllOf', [1])], { customFields: { subplanRequired: false } }, [
      { id: 'depth', name: 'Depth', rules: [rule('r2', 'completedAllOf', [2])] },
      { id: 'sub', name: 'Poetry Subplan', rules: [rule('r3', 'completedAllOf', [3])] },
    ])
    const { file, errors } = convert(raw, { code: 'T-BA', blocks: { depth: { unlessSubplan: true, why: 'quote' } } })
    expect(errors).toEqual([])
    const index = buildCourseIndex({ rows: table.rows as never })
    const run = (subplan: string | undefined, codes: string[]) => runAudit({
      programs: [{ data: file, choice: { code: 'T-BA', subplan } }],
      courses: codes.map((code, i) => ({ id: `c${i}`, code, term: 'Autumn 2024', units: 5, grade: 'A', source: 'manual' as const })),
      index, overrides: EMPTY_OVERRIDES, generalEducation: false, now: new Date(2026, 9, 23),
    }).programs[0]
    expect(run(undefined, ['LING 1', 'LING 2']).status).toBe('complete')
    expect(run('sub', ['LING 1', 'LING 3']).status).toBe('complete')
    expect(run(undefined, ['LING 1']).status).toBe('incomplete')

    const required = convert(raw, { code: 'T-BA', program: { subplanRequired: true, why: 'quote' } }).file
    const r = runAudit({ programs: [{ data: required, choice: { code: 'T-BA' } }], courses: [], index, overrides: EMPTY_OVERRIDES, generalEducation: false, now: new Date(2026, 9, 23) }).programs[0]
    expect(r.needsSubplan).toBe(true)
  })

  it('keeps a section that is only text, and the program\'s own free-form requirements, as free-text rules', () => {
    const raw = {
      ...program([rule('r1', 'completedAllOf', [1])], {}, [{ id: 'lang', name: 'Language Requirement', notes: '<p>Students must demonstrate competence in three languages.</p>', rules: [] }]),
    }
    raw.requisites = { ...raw.requisites, requisitesFreeform: { showInCatalog: true, value: '<p>In the first two years, complete the core sequence.</p>' } } as typeof raw.requisites
    const { file } = convert(raw)
    const lang = file.blocks.find(b => b.id === 'lang')!
    expect(lang.rules).toEqual([{ id: 'lang-text', t: 'text', name: 'Language Requirement', desc: 'Students must demonstrate competence in three languages.' }])
    expect(lang.notes).toBeUndefined()
    expect(file.blocks.find(b => b.id === 'freeform')?.rules[0]).toMatchObject({ id: 'freeform-text', t: 'text', desc: 'In the first two years, complete the core sequence.' })
  })

  it('keeps a bundle in a choice together, as the page shows it ("CHEM 31A AND CHEM 31B")', () => {
    const r = { id: 'chem', condition: 'completedAnyOf', name: 'General Chemistry', value: { condition: 'courses', values: [{ value: ['1', '2'], logic: 'and' }, { value: ['3'], logic: 'and' }] } }
    const node = convert(program([r])).file.blocks[0].rules[0]
    expect(node).toMatchObject({ t: 'any', children: [{ mode: 'all', items: [['LING 1'], ['LING 2']] }, { mode: 'all', items: [['LING 3']] }] })
    const index = buildCourseIndex({ rows: table.rows as never })
    const run = (codes: string[]) => runAudit({
      programs: [{ data: convert(program([r])).file, choice: { code: 'T-BA' } }],
      courses: codes.map((code, i) => ({ id: `c${i}`, code, term: 'Autumn 2024', units: 5, grade: 'A', source: 'manual' as const })),
      index, overrides: EMPTY_OVERRIDES, generalEducation: false, now: new Date(2026, 9, 23),
    }).programs[0].status
    expect(run(['LING 1'])).toBe('incomplete')
    expect(run(['LING 1', 'LING 2'])).toBe('complete')
    expect(run(['LING 3'])).toBe('complete')
  })

  it('reads only what the page shows: "Complete ALL" stays all, and a course rule gets no hidden unit floor', () => {
    const all = rule('r1', 'completedAllOf', [1, 2, 3], { restriction: 1, credits: 12 })
    const node = convert(program([all])).file.blocks[0].rules[0]
    expect(node).toMatchObject({ mode: 'all' })
    expect(node.units).toBeUndefined()
    const named = rule('r2', 'completedAtLeastXOf', [1, 2, 3], { restriction: 2, credits: 9, name: 'Electives (minimum 8 units)' })
    expect(convert(program([named])).file.blocks[0].rules[0]).toMatchObject({ mode: 'atLeast', n: 2, units: 8 })
  })

  it('rejects a program total it cannot read', () => {
    const { errors } = convert(program([rule('r1', 'completedAllOf', [1])]), {
      code: 'T-BA',
      program: { totals: [{ label: 'nothing to count', why: 'quote' }, { label: 'bad grading', minUnits: 5, grading: 'pass', why: 'quote' }, { label: 'bad block', minUnits: 5, when: 'nope', why: 'quote' }] },
    })
    expect(errors).toHaveLength(3)
  })
})
