import { normalizeCode } from './course-index'
import { TEST_CREDIT, TRANSFER_CREDIT } from './student-courses'
import type { Career } from './types'

/**
 * Reads course history out of text: the Axess unofficial transcript (as
 * extracted from its PDF, or copied out of it), a My Academic Path class
 * history, or a plain list a student typed.
 *
 * The transcript layout is PeopleSoft's: a term heading ("2024-2025 Autumn"),
 * then one row per course,
 *   CS 106B  LEC  PROGRAMMING ABSTRACTIONS  5.00  5.00  A  20.000
 * (code, component, title, units attempted, units earned, grade, grade points).
 * MAP writes the term into the row instead ("CS 106B ... AU/24 5 A").
 *
 * Nothing here has been checked against a real transcript yet, so the
 * parser reads each row from its end (grade points, grade, units) where the
 * layouts agree, and the import screen shows every row before it is saved.
 */

export interface ParsedCourse {
  code: string
  title: string
  term: string
  units: number
  grade: string
  career?: Career
}

export interface ParseResult {
  courses: ParsedCourse[]
  /** Lines that looked like a course but could not be read. */
  skipped: string[]
}

const GRADES = new Set([
  'A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-',
  'NP', 'CR', 'NC', 'S', 'W', 'I', 'N', 'N-', 'L', 'RP', 'GNR', 'P', 'NS', 'U', 'F', 'MP', 'H', 'HP', '+', '-',
  // MAP's "in progress" marker; read as no grade yet.
  'IP',
])

const COMPONENTS = new Set(['LEC', 'SEM', 'DIS', 'LAB', 'ACT', 'INS', 'IDS', 'PRA', 'RES', 'STU', 'COL', 'TUT', 'WKS', 'CAS', 'LNG', 'ISF', 'ISS', 'T/D', 'CLK', 'API', 'PRC'])

const SEASONS: Record<string, string> = { AUTUMN: 'Autumn', FALL: 'Autumn', WINTER: 'Winter', SPRING: 'Spring', SUMMER: 'Summer' }
const SEASON_CODES: Record<string, string> = { AU: 'Autumn', FA: 'Autumn', WI: 'Winter', SP: 'Spring', SU: 'Summer' }

/** "2024-2025 Autumn" -> "Autumn 2024"; "2024-2025 Winter" -> "Winter 2025". */
function academicYearTerm(startYear: number, season: string): string {
  return `${season} ${season === 'Autumn' ? startYear : startYear + 1}`
}

/** A term heading anywhere in a line, or undefined. */
export function findTerm(line: string): string | undefined {
  const upper = line.toUpperCase()
  let m = /\b(\d{4})\s*-\s*(\d{2,4})\s+(AUTUMN|FALL|WINTER|SPRING|SUMMER)\b/.exec(upper)
  if (m) return academicYearTerm(Number(m[1]), SEASONS[m[3]])
  m = /\b(AUTUMN|FALL|WINTER|SPRING|SUMMER)(?:\s+QUARTER)?\s+(\d{4})\b/.exec(upper)
  if (m) return `${SEASONS[m[1]]} ${m[2]}`
  m = /\b(\d{4})\s+(AUTUMN|FALL|WINTER|SPRING|SUMMER)\b/.exec(upper)
  if (m) return `${SEASONS[m[2]]} ${m[1]}`
  m = /\b(AU|FA|WI|SP|SU)\s*\/\s*(\d{2})\b/.exec(upper)
  if (m) {
    // MAP's codes carry the calendar year: AU/23 is Autumn 2023, WI/24 is Winter 2024.
    return `${SEASON_CODES[m[1]]} 20${m[2]}`
  }
  return undefined
}

function careerHeading(line: string): Career | undefined {
  const t = line.trim()
  if (t.length > 70) return undefined
  if (/\bundergraduate\b.*\b(record|career|program|matriculated)\b|\b(beginning of|start of) undergraduate\b/i.test(t)) return 'UG'
  if (/(^|[^r])\bgraduate\b.*\b(record|career|program)\b|\b(beginning of|start of) graduate\b/i.test(t) && !/undergraduate/i.test(t)) return 'GR'
  return undefined
}

function creditHeading(line: string): string | undefined {
  const t = line.trim()
  if (t.length > 80) return undefined
  if (/\b(test credits?|advanced placement|international baccalaureate|\bAP\b credit|external test)\b/i.test(t)) return TEST_CREDIT
  if (/\btransfer credits?\b/i.test(t)) return TRANSFER_CREDIT
  return undefined
}

const UNITS = /^\d{1,2}(?:\.\d{1,2})?$/
const POINTS = /^\d{1,3}\.\d{3}$/

/**
 * Parse transcript text. `subjects` is every subject code Stanford uses; a
 * line counts as a course only when it starts with one, so a heading such as
 * "TERM 2024" is never read as a course.
 */
export function parseTranscript(text: string, subjects: Set<string>): ParseResult {
  const courses: ParsedCourse[] = []
  const skipped: string[] = []
  let term: string | undefined
  let career: Career | undefined
  let credit: string | undefined
  const seen = new Set<string>()

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+/g, ' ').trim()
    if (!line) continue

    // Credit first: "Test Credits Applied Toward Undergraduate Matriculated"
    // names a career too, but it opens a test credit block.
    const creditTerm = creditHeading(line)
    if (creditTerm) { credit = creditTerm; continue }
    const heading = careerHeading(line)
    if (heading) { career = heading; credit = undefined; continue }

    const course = readCourseLine(line, subjects)
    if (!course) {
      const t = findTerm(line)
      // A term heading ends any test or transfer credit block above it.
      if (t && line.length < 60) { term = t; credit = undefined }
      continue
    }

    const rowTerm = course.term ?? credit ?? term
    if (!rowTerm) { skipped.push(line); continue }
    const key = `${course.code}|${rowTerm}|${course.grade}`
    if (seen.has(key)) continue
    seen.add(key)
    courses.push({
      code: course.code,
      title: course.title,
      term: rowTerm,
      units: course.units,
      grade: course.grade,
      ...(career ? { career } : {}),
    })
  }
  return { courses, skipped }
}

function readCourseLine(line: string, subjects: Set<string>): { code: string; title: string; units: number; grade: string; term?: string } | undefined {
  const m = /^([A-Za-z][A-Za-z&]{0,9})\s?(\d{1,3}[A-Za-z]{0,4}(?:-[A-Za-z0-9]+)?)\b\s*(.*)$/.exec(line)
  if (!m || !subjects.has(m[1].toUpperCase())) return undefined
  const code = normalizeCode(`${m[1]} ${m[2]}`)
  // pdf.js can glue a long title to the units column ("ALGORITHMS5.00").
  let rest = m[3].replace(/^[-–:,]\s*/, '').replace(/([A-Za-z)?])(\d{1,2}\.\d{2})\b/g, '$1 $2')
  const term = findTerm(rest)
  if (term) {
    rest = rest
      .replace(/\b(AU|FA|WI|SP|SU)\s*\/\s*\d{2}\b/i, ' ')
      .replace(/\b\d{4}\s*-\s*\d{2,4}\s+(Autumn|Fall|Winter|Spring|Summer)\b/i, ' ')
      .replace(/\b(Autumn|Fall|Winter|Spring|Summer)(\s+Quarter)?\s+\d{4}\b/i, ' ')
  }
  const tokens = rest.split(/[\s,]+/).filter(Boolean)

  // Read from the end, where every layout puts grade points, grade, units.
  if (tokens.length && POINTS.test(tokens[tokens.length - 1])) tokens.pop()
  let grade = ''
  if (tokens.length && GRADES.has(tokens[tokens.length - 1].toUpperCase()) && !UNITS.test(tokens[tokens.length - 1])) {
    grade = tokens.pop()!.toUpperCase()
    if (grade === 'IP') grade = ''
  }
  const numbers: number[] = []
  while (tokens.length && UNITS.test(tokens[tokens.length - 1])) numbers.unshift(Number(tokens.pop()))
  // A grade written before the units, with no title ("CS 106B A 5"). Only
  // then: a title can end in a grade-like word ("MECHANICS I").
  if (!grade && tokens.length === 1 && GRADES.has(tokens[0].toUpperCase()) && numbers.length) grade = tokens.pop()!.toUpperCase()
  if (numbers.length === 0) return undefined
  // Attempted then earned: earned is what counts, unless nothing is earned yet.
  const [attempted, earned] = numbers.length >= 2 ? [numbers[numbers.length - 2], numbers[numbers.length - 1]] : [numbers[0], numbers[0]]
  const units = earned > 0 ? earned : attempted
  if (units > 30) return undefined
  if (tokens.length && COMPONENTS.has(tokens[0].toUpperCase())) tokens.shift()
  return { code, title: titleCase(tokens.join(' ')), units, grade, term }
}

function titleCase(s: string): string {
  if (!s || s !== s.toUpperCase()) return s
  return s.toLowerCase().replace(/(^|[\s:(/-])([a-z])/g, (_, a, b) => a + b.toUpperCase())
}
