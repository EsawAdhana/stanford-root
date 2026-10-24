/**
 * Convert programs from the cached Bulletin data with their overlays, print
 * them, and run every audit scenario over them (src/lib/requirements/verify.ts).
 * Run through scripts/check-requirements.mjs, which bundles this file.
 *
 *   node scripts/check-requirements.mjs ENGL-BA            # scenarios for one program
 *   node scripts/check-requirements.mjs ENGL-BA --tree     # its rule tree, ids and full text
 *   node scripts/check-requirements.mjs ENGL-BA --explain  # a complete record and where each course went
 *   node scripts/check-requirements.mjs --find "PHIL 80"   # look up courses (or --find ENGLISH for a subject)
 *   node scripts/check-requirements.mjs --all              # every program
 *   node scripts/check-requirements.mjs --all --kind major # one kind
 *   node scripts/check-requirements.mjs --pairs            # majors with minors and master's programs
 *   node scripts/check-requirements.mjs --pair ECON-BA ECON-MIN
 *   node scripts/check-requirements.mjs --all --json report.json
 *   node scripts/check-requirements.mjs ENGL-BA --record rec.json  # audit a hand-built record
 */
import { readFileSync, writeFileSync } from 'fs'
import { buildCourseTable, convertProgram } from './convert.mjs'
import { readCache, readOverlays, setsByGroupOf } from './io.mjs'
import { buildCourseIndex } from '../../src/lib/requirements/course-index'
import { programVariants, synthesizeStudent, unmet, verifyPair, verifyProgram, type Finding } from '../../src/lib/requirements/verify'
import { forEachApplied, nodeKey, runAudit } from '../../src/lib/requirements/audit'
import { EMPTY_OVERRIDES, type ProgramData, type RuleNode } from '../../src/lib/requirements/types'

export async function main(args: string[], root: string) {
  const flags = new Set(args.filter(a => a.startsWith('--')))
  const value = (flag: string) => {
    const i = args.indexOf(flag)
    return i >= 0 ? args[i + 1] : undefined
  }
  const codes = args.filter((a, i) => !a.startsWith('--') && !['--kind', '--json', '--find', '--path', '--record', '--as'].includes(args[i - 1]))

  const raw = readCache(root)
  const table = buildCourseTable(raw.courses)
  const setsByGroup = setsByGroupOf(raw.courseSets)
  const overlays = readOverlays(root)
  const index = buildCourseIndex({ rows: table.rows as never })
  const year = '2026-27'

  const find = value('--find')
  if (find !== undefined) {
    // Course codes the Bulletin text names, by code or title words.
    const hits = /^[A-Z&]+$/.test(find) ? index.all.filter(c => c.code.split(' ')[0] === find) : index.search(find, 60)
    for (const c of hits.slice(0, 400)) console.log(`${c.code.padEnd(14)} ${String(c.min === c.max ? c.min : `${c.min}-${c.max}`).padEnd(6)} ${c.tags.join(' ').padEnd(8)} ${c.title}`)
    console.log(`${hits.length} courses`)
    return
  }

  const programs = new Map<string, { data: ProgramData; errors: string[]; warnings: string[] }>()
  for (const p of raw.programs) {
    if (p.status && p.status !== 'Active') continue
    const { file, errors, warnings } = convertProgram(p, table, setsByGroup, year, overlays.get(p.code))
    programs.set(p.code, { data: file as ProgramData, errors, warnings })
  }

  let selected = flags.has('--all') || flags.has('--pairs') ? [...programs.keys()] : codes
  const kind = value('--kind')
  if (kind) selected = selected.filter(c => programs.get(c)?.data.kind === kind)
  const missing = selected.filter(c => !programs.has(c))
  if (missing.length) {
    console.error(`Not a program code: ${missing.join(', ')}`)
    process.exitCode = 1
    return
  }
  if (selected.length === 0) {
    console.error('Name one or more program codes, or pass --all.')
    process.exitCode = 1
    return
  }

  if (flags.has('--tree')) {
    for (const code of selected) printTree(programs.get(code)!.data)
    return
  }

  if (value('--record')) {
    // A hand-built record: node scripts/check-requirements.mjs ENGL-BA --record rec.json
    // rec.json: { "subplan": "<block id or name start>", "optional": ["<block id>"], "courses": [{ "code": "ENGLISH 10A", "units": 5, "grade": "A", "term": "Autumn 2024" }] }
    const rec = JSON.parse(readFileSync(value('--record')!, 'utf8'))
    const data = programs.get(codes[0])!.data
    const subplan = rec.subplan && (data.blocks.find(b => b.id === rec.subplan) ?? data.blocks.find(b => b.kind === 'subplan' && b.name.startsWith(rec.subplan)))?.id
    const career = data.kind === 'grad' || data.kind === 'phd-minor' ? 'GR' : 'UG'
    const courses = (rec.courses as { code: string; units?: number; grade?: string; term?: string; career?: 'UG' | 'GR' }[]).map((c, i) => ({
      id: `r${i}`, code: c.code, term: c.term ?? 'Autumn 2024', units: c.units ?? index.get(c.code)?.max ?? 3, grade: c.grade ?? 'A', source: 'manual' as const, career: c.career ?? career,
    }))
    const r = runAudit({ programs: [{ data, choice: { code: data.code, subplan, optional: rec.optional } }], courses, index, overrides: { ...EMPTY_OVERRIDES, done: rec.done ?? [], pins: rec.pins ?? [] }, generalEducation: false, now: new Date(2026, 9, 23) })
    const p = r.programs[0]
    console.log(`${data.code} ${p.status} ${p.met}/${p.total}${subplan ? ` (subplan ${subplan})` : ''}`)
    const where = new Map<string, string[]>()
    forEachApplied(p, (a, n) => where.set(a.courseId, [...(where.get(a.courseId) ?? []), `${n.node.name ?? n.node.id} (${a.units}u${a.shared ? ', shared' : ''})`]))
    for (const c of courses) console.log(`  ${c.code.padEnd(14)} ${String(c.units).padStart(2)}u ${c.grade.padEnd(3)} -> ${where.get(c.id)?.join('; ') ?? 'NOT APPLIED'}`)
    for (const line of unmet(p)) console.log(`  unmet: ${line}`)
    for (const c of p.checks) console.log(`  check: ${c.label}: ${c.detail} (${c.status})`)
    return
  }

  if (flags.has('--units-min')) {
    // Programs whose complete record falls short of "Minimum Units in the Program".
    let short = 0
    for (const code of selected) {
      const data = programs.get(code)!.data
      if (!data.unitsMin) continue
      const v = programVariants(data)[0]
      const s = synthesizeStudent(data, v.choice, index, data.kind === 'grad' || data.kind === 'phd-minor' ? 'GR' : 'UG')
      const r = runAudit({ programs: [{ data, choice: v.choice }], courses: s.courses, index, overrides: { ...EMPTY_OVERRIDES, done: s.done, pins: s.pins }, generalEducation: false, now: new Date(2026, 9, 23) }).programs[0]
      if (r.units < data.unitsMin) { short++; console.log(`${code.padEnd(12)} ${data.kind.padEnd(9)} ${String(r.units).padStart(4)} of ${data.unitsMin} ${r.status}`) }
    }
    console.log(`${short} short`)
    return
  }

  if (flags.has('--explain') && flags.has('--pair')) {
    // Two programs' records together: where each course went.
    const [a, b] = codes.map(c => programs.get(c)!.data)
    const va = programVariants(a)[0]
    const vb = programVariants(b)[0]
    const sa = synthesizeStudent(a, va.choice, index, a.kind === 'grad' || a.kind === 'phd-minor' ? 'GR' : 'UG', 'a')
    const sb = synthesizeStudent(b, vb.choice, index, b.kind === 'grad' || b.kind === 'phd-minor' ? 'GR' : 'UG', 'b')
    const paths = Object.fromEntries(args.filter((x, i) => args[i - 1] === '--path').map(x => x.split('=')).flatMap(([node, child]) => [[nodeKey(a.code, node), child], [nodeKey(b.code, node), child]]))
    const r = runAudit({ programs: [{ data: a, choice: va.choice }, { data: b, choice: vb.choice }], courses: [...sa.courses, ...sb.courses], index, overrides: { ...EMPTY_OVERRIDES, done: [...sa.done, ...sb.done], pins: [...sa.pins, ...sb.pins], paths }, generalEducation: false, now: new Date(2026, 9, 23) })
    const where = new Map<string, string[]>()
    for (const p of r.programs) forEachApplied(p, (x, n) => where.set(x.courseId, [...(where.get(x.courseId) ?? []), `${p.code} ${n.node.name ?? n.node.id} (${x.units}u)`]))
    for (const p of r.programs) console.log(`${p.code} ${p.status} ${p.met}/${p.total}`)
    for (const [who, s] of [[a.code, sa], [b.code, sb]] as const) {
      console.log(`\n${who}'s record`)
      for (const c of s.courses) console.log(`  ${c.code.padEnd(14)} ${String(c.units).padStart(2)}u -> ${where.get(c.id)?.join('; ') ?? 'NOT APPLIED'}`)
    }
    for (const p of r.programs) for (const line of unmet(p)) console.log(`unmet ${p.code}: ${line}`)
    for (const p of r.programs) for (const c of p.checks) if (c.status !== 'complete') console.log(`check ${p.code}: ${c.label}: ${c.detail} (${c.status})`)
    return
  }

  if (flags.has('--explain')) {
    // Where each course of the synthesized record went, per variant.
    for (const code of selected) {
      const data = programs.get(code)!.data
      for (const v of programVariants(data)) {
        const s = synthesizeStudent(data, v.choice, index, data.kind === 'grad' || data.kind === 'phd-minor' ? 'GR' : 'UG')
        // --path node=child forces an alternate path, to see how it audits.
        const paths = Object.fromEntries(args.filter((a, i) => args[i - 1] === '--path').map(a => a.split('=')).map(([node, child]) => [nodeKey(code, node), child]))
        // --reverse audits the record in reverse order, the way the "reversed order" scenario does.
        // --as planned | progress: every course in a later term or this one, as those scenarios do.
        const as = value('--as')
        const timed = as === 'planned' ? s.courses.map(c => ({ ...c, term: 'Spring 2027', grade: undefined }))
          : as === 'progress' ? s.courses.map(c => ({ ...c, term: 'Autumn 2026', grade: undefined })) : s.courses
        const order = flags.has('--reverse') ? [...timed].reverse() : timed
        const r = runAudit({ programs: [{ data, choice: v.choice }], courses: order, index, overrides: { ...EMPTY_OVERRIDES, done: s.done, pins: s.pins, paths }, generalEducation: false, now: new Date(2026, 9, 23) })
        const p = r.programs[0]
        console.log(`\n${code} [${v.label}] ${p.status} ${p.met}/${p.total}`)
        const where = new Map<string, string[]>()
        forEachApplied(p, (a, n) => where.set(a.courseId, [...(where.get(a.courseId) ?? []), `${n.node.name ?? n.node.id} (${a.units}u${a.shared ? ', shared' : ''})`]))
        for (const c of s.courses) console.log(`  ${c.code.padEnd(14)} ${String(c.units).padStart(2)}u -> ${where.get(c.id)?.join('; ') ?? 'NOT APPLIED'}`)
        for (const line of unmet(p)) console.log(`  unmet: ${line}`)
        for (const c of p.checks) if (c.status !== 'complete') console.log(`  check: ${c.label}: ${c.detail} (${c.status})`)
        for (const line of s.short) console.log(`  short: ${line}`)
      }
    }
    return
  }

  const findings: Finding[] = []
  let overlayErrors = 0
  if (flags.has('--pair')) {
    // Two named programs together: node scripts/check-requirements.mjs --pair ECON-BA ECON-BS
    const [a, b] = codes
    if (!a || !b) { console.error('--pair needs two program codes'); process.exitCode = 1; return }
    findings.push(...verifyPair(programs.get(a)!.data, programs.get(b)!.data, index))
  } else if (flags.has('--pairs')) {
    const all = [...programs.values()].map(p => p.data)
    const majors = all.filter(d => d.kind === 'major')
    const minors = all.filter(d => d.kind === 'minor')
    const masters = all.filter(d => d.kind === 'grad' && /^M/.test(d.degree))
    for (const a of majors) {
      for (const b of [...minors, ...majors.filter(m => m.code > a.code), ...masters]) findings.push(...verifyPair(a, b, index))
    }
  } else {
    for (const code of selected) {
      const { data, errors, warnings } = programs.get(code)!
      for (const e of errors) { console.log(`OVERLAY ERROR ${e}`); overlayErrors++ }
      if (selected.length === 1) for (const w of warnings) console.log(`warning ${w}`)
      findings.push(...verifyProgram(data, index))
    }
  }

  const byProgram = new Map<string, Finding[]>()
  for (const f of findings) byProgram.set(f.program, [...(byProgram.get(f.program) ?? []), f])
  for (const [code, list] of byProgram) {
    console.log(`\n${code}`)
    for (const f of list) console.log(`  [${f.variant}] ${f.scenario}: ${f.message}`)
  }
  const checked = flags.has('--pairs') || flags.has('--pair') ? 'pairs' : `${selected.length} programs`
  const failing = byProgram.size
  console.log(`\n${checked} checked: ${failing ? `${failing} with findings, ${findings.length} findings` : 'no findings'}${overlayErrors ? `, ${overlayErrors} overlay errors` : ''}`)

  const json = value('--json')
  if (json) {
    writeFileSync(json, JSON.stringify({ findings, programs: [...programs.values()].map(p => ({ code: p.data.code, kind: p.data.kind, name: p.data.name, reviewed: p.data.reviewed ?? null, ...coverage(p.data) })) }, null, 1))
  }
  if (findings.length || overlayErrors) process.exitCode = 1
}

/**
 * How much of a program the audit checks on its own: rules it evaluates,
 * rules a person must check (marked with why), and free text nobody has
 * looked at yet, which is what a review drives to zero.
 */
export function coverage(p: ProgramData) {
  let checked = 0
  let manual = 0
  let freeText = 0
  const walk = (n: RuleNode) => {
    if (n.children?.length) return n.children.forEach(walk)
    if (n.t === 'courses') checked++
    else if (n.t === 'text' && !n.info && !n.optional) {
      if (n.manual) manual++
      else freeText++
    }
  }
  p.blocks.forEach(b => b.rules.forEach(walk))
  return { checked, manual, freeText }
}

function printTree(p: ProgramData) {
  console.log(`${p.code}  ${p.name}  (${p.kind}${p.degree ? `, ${p.degree}` : ''})  ${p.url}`)
  if (p.unitsMin) console.log(`unitsMin ${p.unitsMin}${p.unitsUniversityMin ? ` (university ${p.unitsUniversityMin})` : ''}`)
  if (p.subplanRequired !== undefined) console.log(`subplanRequired ${p.subplanRequired}`)
  if (p.totals?.length) console.log(`totals: ${JSON.stringify(p.totals)}`)
  for (const [label, text] of [['GPA', p.gpa], ['Grading', p.grading], ['Policies', p.policies], ['Transfer and AP credit', p.transferPolicy], ['Other requirements', p.otherRequirements]] as const) {
    if (text) console.log(`${label}: ${text.replace(/\n+/g, ' / ')}`)
  }
  if (p.letterGrade || p.minGrade) console.log(`overlay: letterGrade=${p.letterGrade ?? false} minGrade=${p.minGrade ?? '-'}`)
  for (const b of p.blocks) {
    console.log(`\n## block ${b.id}  "${b.name}"${b.kind ? `  kind=${b.kind}` : ''}${b.units ? `  units>=${b.units}` : ''}${b.wim ? '  wim' : ''}${b.unlessSubplan ? '  unlessSubplan' : ''}`)
    if (b.notes) console.log(`   notes: ${b.notes.replace(/\n+/g, ' / ')}`)
    b.rules.forEach(r => printNode(r, 1))
  }
}

function printNode(n: RuleNode, depth: number) {
  const pad = '  '.repeat(depth)
  const bits = [
    n.t + (n.mode ? `:${n.mode}` : ''),
    n.n !== undefined ? `n=${n.n}` : '',
    n.units !== undefined ? `units=${n.units}` : '',
    n.optional ? 'optional' : '',
    n.info ? 'info' : '',
    n.shares ? 'shares' : '',
    n.manual ? `manual=${n.manual}` : '',
    n.minUnitsEach ? `minUnitsEach=${n.minUnitsEach}` : '',
    n.letter ? 'letter' : '',
    n.reviewed ? 'REVIEWED' : '',
  ].filter(Boolean).join(' ')
  console.log(`${pad}- [${n.id}] ${bits}  "${n.name ?? ''}"`)
  if (n.items) console.log(`${pad}    items (${n.items.length}): ${n.items.map(i => i.join(' | ')).join(', ')}`)
  if (n.pool) console.log(`${pad}    pool: ${JSON.stringify(n.pool)}`)
  if (n.limits) console.log(`${pad}    limits: ${JSON.stringify(n.limits)}`)
  if (n.desc) console.log(`${pad}    text: ${n.desc.replace(/\n+/g, ' / ')}`)
  if (n.notes) console.log(`${pad}    notes: ${n.notes.replace(/\n+/g, ' / ')}`)
  n.children?.forEach(c => printNode(c, depth + 1))
}
