import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runAudit } from '@/lib/requirements/audit'
import { buildCourseIndex } from '@/lib/requirements/course-index'
import { EMPTY_OVERRIDES, type ProgramData, type RuleNode } from '@/lib/requirements/types'
import { programVariants, synthesizeStudent, verifyPair, verifyProgram } from '@/lib/requirements/verify'

/**
 * Every program in the built Bulletin data (public/requirements), through
 * every scenario in src/lib/requirements/verify.ts. This is the gate that
 * says the audit works for English and Music, not only for CS.
 *
 * Completeness findings are allowed only where a reviewer wrote down why in
 * the program's overlay summary ("Left: ..."), because the Bulletin itself
 * lists fewer courses than it asks for. Consistency findings (order, plan,
 * in progress, extras, a missing course, grades) and crashes never are.
 */

const DIR = join(__dirname, '..', 'public', 'requirements')
const index = buildCourseIndex(JSON.parse(readFileSync(join(DIR, 'courses.json'), 'utf8')))
const programs: ProgramData[] = readdirSync(join(DIR, 'programs'))
  .filter(f => f.endsWith('.json'))
  .map(f => JSON.parse(readFileSync(join(DIR, 'programs', f), 'utf8')))

const COMPLETENESS = new Set(['building a complete record', 'complete record', 'nothing to audit'])

function freeText(p: ProgramData): string[] {
  const out: string[] = []
  const walk = (n: RuleNode) => {
    if (n.children?.length) return n.children.forEach(walk)
    if (n.t === 'text' && !n.info && !n.manual && !n.optional) out.push(`${n.id} ${n.name ?? ''}`)
  }
  p.blocks.forEach(b => b.rules.forEach(walk))
  return out
}

describe('every program in the Bulletin', () => {
  it('has all 355 programs', () => {
    expect(programs.length).toBeGreaterThanOrEqual(350)
  })

  it('was reviewed against the Bulletin text', () => {
    expect(programs.filter(p => !p.reviewed).map(p => p.code)).toEqual([])
  })

  it('has no free-text rule left unread: each is encoded, information, or marked for a person to check', () => {
    const left = programs.flatMap(p => freeText(p).map(r => `${p.code}: ${r}`))
    expect(left).toEqual([])
  })

  it('passes every audit scenario, except what a reviewer documented', { timeout: 300_000 }, () => {
    const unexplained: string[] = []
    for (const p of programs) {
      const documented = /\bLeft:/.test(p.reviewNotes ?? '')
      for (const f of verifyProgram(p, index)) {
        if (COMPLETENESS.has(f.scenario) && documented) continue
        unexplained.push(`${f.program} [${f.variant}] ${f.scenario}: ${f.message}`)
      }
    }
    expect(unexplained).toEqual([])
  })

  it('keeps each major complete with general education audited alongside it', { timeout: 120_000 }, () => {
    const broken: string[] = []
    for (const p of programs.filter(d => d.kind === 'major')) {
      const v = programVariants(p)[0]
      const s = synthesizeStudent(p, v.choice, index, 'UG')
      if (s.short.length) continue
      const alone = runAudit({ programs: [{ data: p, choice: v.choice }], courses: s.courses, index, overrides: { ...EMPTY_OVERRIDES, done: s.done, pins: s.pins }, generalEducation: false, now: new Date(2026, 9, 23) }).programs[0]
      const withGe = runAudit({ programs: [{ data: p, choice: v.choice }], courses: s.courses, index, overrides: { ...EMPTY_OVERRIDES, done: s.done, pins: s.pins }, generalEducation: true, now: new Date(2026, 9, 23) }).programs[0]
      if (alone.status !== withGe.status || alone.met !== withGe.met) broken.push(`${p.code}: ${alone.status} ${alone.met} alone, ${withGe.status} ${withGe.met} with general education`)
    }
    expect(broken).toEqual([])
  })
})

describe('programs together', () => {
  // The full cross product (majors x minors, majors x majors, majors x
  // master's) runs with `node scripts/check-requirements.mjs --pairs`; here a
  // fixed sample keeps the suite fast.
  const majors = programs.filter(p => p.kind === 'major').sort((a, b) => a.code.localeCompare(b.code))
  const minors = programs.filter(p => p.kind === 'minor').sort((a, b) => a.code.localeCompare(b.code))
  const masters = programs.filter(p => p.kind === 'grad' && /^M/.test(p.degree)).sort((a, b) => a.code.localeCompare(b.code))

  it('never double counts and keeps both complete when their courses do not overlap', { timeout: 300_000 }, () => {
    const findings: string[] = []
    majors.forEach((a, i) => {
      const partners = [majors[(i + 1) % majors.length], minors[(i * 7) % minors.length], masters[(i * 11) % masters.length]]
      for (const b of partners) for (const f of verifyPair(a, b, index)) findings.push(`${f.program} ${f.scenario}: ${f.message}`)
    })
    expect(findings).toEqual([])
  })

  // Every pair a full sweep flagged while the audit was built, rerun on each
  // test run so a fix for one cannot quietly break another (a cap counted in
  // the Portuguese minor's 23 units once stopped CSRE giving AFRICAAM 198 back
  // to the African and African American Studies minor). EASST-BA + NATAM-BA is
  // left out: its record needs one designation course traded for another,
  // which no repair does.
  const flagged = [
    'AA-BS + ARCHA-BA', 'AA-BS + ARTS-MIN', 'AA-BS + CPLIT-BA', 'AA-BS + EASYS-BS', 'AA-BS + EASYS-MS',
    'AA-BS + ECON-BA', 'AA-BS + ECON-BS', 'AA-BS + GERST-BA', 'AA-BS + HSTRY-BA', 'AA-BS + IDMEN-BS',
    'AA-BS + ITAL-BA', 'AA-BS + SYMBO-BS', 'AFRAM-BA + INTLR-BA', 'AMSTU-BA + AMSTU-MIN',
    'AMSTU-BA + EASYS-MS', 'AMSTU-BA + ENGL-BA', 'ANTHR-BA + CHILT-MIN', 'ANTHR-BA + EASST-BA',
    'ANTHR-BA + EASYS-MS', 'ARCHA-BA + AA-MIN', 'ARCHA-BA + ARCHA-MIN', 'ARCHA-BA + EASYS-MS',
    'ARCHA-BA + NATAM-MIN', 'ARTHS-BA + ART-MIN', 'ARTHS-BA + ASAM-BA', 'ARTHS-BA + CHILT-BA',
    'ARTHS-BA + NATAM-BA', 'ARTP-BA + CPLIT-MIN', 'ARTP-BA + EASYS-MS', 'ARTP-BA + FILM-MIN',
    'ASAM-BA + AFRAM-MIN', 'BIOE-BS + BIOE-MS', 'BIOE-BS + EASYS-MS', 'CE-BS + EASYS-MS',
    'CHEM-BS + EASYS-MS', 'CHEME-BS + EASYS-MS', 'CHILT-BA + AFRAM-MIN', 'CHILT-BA + ENGL-BA',
    'CHILT-BA + ENGL-MIN', 'CHILT-BA + FILM-MIN', 'CHILT-BA + HSTRY-BA', 'CHILT-BA + PORT-MIN',
    'CLASS-BA + EASYS-MS', 'CPLIT-BA + AA-MIN', 'CPLIT-BA + CHILT-MIN', 'CPLIT-BA + EASYS-MS',
    'CPLIT-BA + ENGR-BS', 'CPLIT-BA + ITAL-BA', 'CPLIT-BA + PHREL-BA', 'CPLIT-BA + SLAV-BA',
    'CPLIT-BA + SYMBO-BS', 'CS-BS + EASYS-MS', 'CS-BS + ENGR-BS', 'CS-BS + MGTSC-BS',
    'CS-BS + SYMBO-BS', 'CSRE-BA + AFRAM-MIN', 'CSRE-BA + INTLR-BA', 'CSRE-BA + JEWSH-BA',
    'CSRE-BA + NATAM-BA', 'DATSC-BA + DATSC-BS', 'DATSC-BA + EASYS-MS', 'DATSC-BA + STATS-MIN',
    'DATSC-BS + DIGHUM-MIN', 'DATSC-BS + EASYS-MS', 'DATSC-BS + STATS-MIN', 'DATSC-BS + STS-BA',
    'DATSC-BS + STS-BS', 'DESIGN-BS + EASYS-BS', 'DESIGN-BS + EASYS-MS', 'EASST-BA + EASST-MIN',
    'EASST-BA + EASYS-MS', 'EASYS-BS + ENGR-BS', 'EASYS-BS + MGTSC-BS', 'EASYS-BS + STS-BA',
    'EASYS-BS + STS-BS', 'ECON-BA + AA-MIN', 'ECON-BA + BIOE-MS', 'ECON-BA + EASYS-MS',
    'ECON-BA + ECON-BS', 'ECON-BA + ENGR-BS', 'ECON-BA + MATH-BS', 'ECON-BS + AA-MIN',
    'ECON-BS + EASYS-MS', 'ECON-BS + ENGR-BS', 'EE-BS + EASYS-MS', 'EE-BS + MATH-BS',
    'ENERGY-BS + EASYS-MS', 'ENGL-BA + CHILT-MIN', 'ENGL-BA + EASYS-MS', 'ENGL-BA + NATAM-MIN',
    'EPS-BS + GEOPH-BS', 'EPS-BS + GEOPH-MIN', 'FGSS-BA + EASYS-MS', 'FGSS-BA + INTLR-BA',
    'FGSS-BA + JEWSH-BA', 'GEOPH-BS + GEOPH-MIN', 'GERST-BA + AA-MIN', 'GERST-BA + EASYS-MS',
    'GERST-BA + ITAL-BA', 'GERST-BA + SLAV-BA', 'GERST-BA + SYMBO-BS', 'HSTRY-BA + AA-MIN',
    'HUMBI-BA + EASYS-MS', 'HUMBI-BA + HUMBI-BS', 'HUMBI-BA + HUMBI-MIN', 'HUMBI-BA + INTLR-BA',
    'HUMBI-BA + MEDHUM-MIN', 'HUMBI-BA + STS-BA', 'HUMBI-BA + STS-BS', 'HUMBI-BS + EASYS-MS',
    'HUMBI-BS + HUMBI-MIN', 'HUMBI-BS + INTLR-BA', 'HUMBI-BS + MEDHUM-MIN', 'HUMBI-BS + STS-BA',
    'HUMBI-BS + STS-BS', 'IDMEN-BS + EASYS-MS', 'ILAC-BA + INTLR-BA', 'ILAC-BA + PORT-MIN',
    'ILAC-BA + SPAN-BA', 'ILAC-BA + SPAN-MIN', 'INTLR-BA + EASYS-MS', 'INTLR-BA + NATAM-MIN',
    'INTLR-BA + SLAV-BA', 'INTLR-BA + SPAN-BA', 'ITAL-BA + AA-MIN', 'ITAL-BA + EASYS-MS',
    'ITAL-BA + ME-BS', 'ITAL-BA + PHILO-BA', 'ITAL-BA + PHREL-BA', 'ITAL-BA + SLAV-BA',
    'ITAL-BA + SYMBO-BS', 'ITAL-BA + SYMBO-MIN', 'JEWSH-BA + AFRAM-MIN', 'JEWSH-BA + EASYS-MS',
    'JEWSH-BA + FILM-MIN', 'JEWSH-BA + MEDHUM-MIN', 'JEWSH-BA + NATAM-BA', 'JEWSH-BA + PHREL-BA',
    'JEWSH-BA + PORT-MIN', 'JEWSH-BA + SPAN-MIN', 'LING-BA + EASYS-MS', 'LING-BA + LING-MIN',
    'LING-BA + PHREL-BA', 'LING-BA + SYMBO-BS', 'MATH-BS + EASYS-MS', 'MATH-BS + EE-MIN',
    'ME-BS + EASYS-MS', 'ME-BS + SYMBO-BS', 'MGTSC-BS + EASYS-MS', 'MUSIC-BA + EASYS-MS',
    'NATAM-BA + EASYS-MS', 'NATAM-BA + EDUC-MIN', 'NATAM-BA + NATAM-MIN', 'NATAM-BA + PORT-MIN',
    'NATAM-BA + SOCIO-BA', 'NATAM-BA + SOCIO-MIN', 'PHILO-BA + PHREL-BA', 'PHILO-BA + SLAV-BA',
    'PHILO-BA + SYMBO-BS', 'PHILO-BA + SYMBO-MIN', 'PHREL-BA + RELST-BA', 'POLSC-BA + COMMU-MIN',
    'POLSC-BA + ECON-MIN', 'POLSC-BA + PUBPO-MIN', 'PSYCH-BA + EASYS-MS', 'PSYCH-BA + SYMBO-MIN',
    'PUBPO-BA + EASYS-MS', 'PUBPO-BA + PUBPO-MIN', 'SLAV-BA + EASYS-MS', 'SLAV-BA + SYMBO-BS',
    'SLAV-BA + SYMBO-MIN', 'SPAN-BA + EASYS-MS', 'SPAN-BA + PORT-MIN', 'SPAN-BA + SPAN-MIN',
    'SYMBO-BS + AA-MIN', 'SYMBO-BS + EASYS-MS', 'SYMBO-BS + SYMBO-MIN', 'THPST-BA + EASYS-MS',
    'THPST-BA + FILM-MIN',
  ]

  it('keeps both complete in every pair the full sweep has flagged', { timeout: 120_000 }, () => {
    const byCode = new Map(programs.map(p => [p.code, p]))
    const findings = flagged.flatMap(pair => {
      const [a, b] = pair.split(' + ').map(code => byCode.get(code)!)
      return verifyPair(a, b, index).map(f => `${f.program} ${f.scenario}: ${f.message}`)
    })
    expect(findings).toEqual([])
  })
})
