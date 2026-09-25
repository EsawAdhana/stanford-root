import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { Course, Section } from '@/types/course'
import type { LiveSeat } from './seats'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Decode HTML entities in user-facing text (e.g. course descriptions/titles from API).
 * Converts &nbsp; &amp; &#39; etc. to actual characters so we never show raw "&something;" placeholders.
 */
export function decodeHtmlEntities(text: string): string {
  if (!text || typeof text !== 'string') return text
  let s = text
  // Numeric decimal &#39; &#039; &#8230; (semicolon optional per HTML5)
  s = s.replace(/&#(\d+);?/g, (_, num) => {
    const n = parseInt(num, 10)
    return n >= 0 && n <= 0x10FFFF ? String.fromCodePoint(n) : `&#${num};`
  })
  // Numeric hex &#x00A0; &#x1F;
  s = s.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
    const n = parseInt(hex, 16)
    return n >= 0 && n <= 0x10FFFF ? String.fromCodePoint(n) : `&#x${hex};`
  })
  // Named entities (do &amp; last so it doesn't break others)
  s = s.replace(/&nbsp;/g, ' ')
  s = s.replace(/&lt;/g, '<')
  s = s.replace(/&gt;/g, '>')
  s = s.replace(/&quot;/g, '"')
  s = s.replace(/&apos;/g, "'")
  s = s.replace(/&lsquo;/g, "'")
  s = s.replace(/&rsquo;/g, "'")
  s = s.replace(/&ldquo;/g, '"')
  s = s.replace(/&rdquo;/g, '"')
  s = s.replace(/&ndash;/g, '–')
  s = s.replace(/&mdash;/g, '—')
  s = s.replace(/&hellip;/g, '…')
  s = s.replace(/&amp;/g, '&')
  return s
}

/**
 * Tidy a catalog title for display, sorting and <title>.
 *
 * Upstream ships 10 titles with leading or trailing spaces (" The Spring Film
 * II") and ~68 with doubled inner spaces. Both survive into sort keys and search
 * matching, where whitespace is significant even though HTML collapses it.
 */
export function normalizeCatalogTitle(title: string | null | undefined): string {
  if (!title || typeof title !== 'string') return ''
  return title.replace(/\s+/g, ' ').trim()
}

/**
 * Tidy a catalog description for display.
 *
 * A handful of upstream descriptions carry stray markup — "<e>The Italian",
 * "<i>...</i>", "<link>" — which React renders literally as text. Tag-shaped
 * tokens are dropped; angle-bracketed URLs ("<https://...>") keep the URL and
 * lose only the brackets. Inner whitespace is left alone so the reviewed
 * course-link offsets stay anchored.
 */
export function normalizeCatalogDescription(description: string | null | undefined): string {
  if (!description || typeof description !== 'string') return ''
  return description
    .replace(/<((?:https?:\/\/|www\.)[^>\s]+)>/gi, '$1')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .trim()
}

/**
 * Cross-list grouping lives in ./cross-list.mjs so the scraper can import the exact same
 * implementation -- refreshMetrics pools a class's evaluations over its group and the
 * course page merges the on-screen ones over its group, so the two must never diverge.
 * Re-exported here because everything already imports these from '@/lib/utils'.
 */
export {
  getAlternateCourseCodesFromTitle,
  normalizeCourseId,
  getCrossListPrimaryMap,
  resolveToCanonicalPrimary,
  getCrossListGroupIds,
  buildCrossListGroups,
  deriveEvalPairings,
} from './cross-list.mjs'

/**
 * Aggregate enrollment for the same logical section across cross-listed catalog entries.
 * Matches per sibling course by classId first, then component + sectionNumber within the anchor term.
 * Every field is summed across the group, because the registrar caps each listing
 * separately: CEE 121 and CEE 221 each seat 60, and the class holds 120. Taking the
 * max while summing the enrolled counts made 24 sections in the current dump render
 * over capacity -- CEE 121 read "86 / 60" for a class that was 86 of 120.
 */
/**
 * The same logical section as it is numbered under the group's other listings.
 *
 * A cross-listed class has one meeting but a class number per listing, and only the
 * canonical listing's number reached the page -- a grad student reading COMM 172 never
 * saw that their own listing, COMM 272, enrols under 12515. Matched exactly as the
 * enrollment aggregate matches: classId first, then component + section number in the
 * anchor's term.
 */
export function crossListedSectionPeers(
  anchor: Section,
  anchorCourseId: string,
  crossListCourseIds: string[],
  courses: Course[]
): Array<{ courseId: string; subject: string; code: string; classId: number }> {
  const byId = new Map(courses.map(c => [c.id, c]))
  const peers: Array<{ courseId: string; subject: string; code: string; classId: number }> = []
  for (const cid of crossListCourseIds) {
    if (cid === anchorCourseId) continue
    const c = byId.get(cid)
    if (!c?.sections?.length) continue
    const sameTerm = c.sections.filter(s => s.term === anchor.term)
    const hit =
      sameTerm.find(s => s.classId === anchor.classId) ??
      sameTerm.find(s => s.component === anchor.component && s.sectionNumber === anchor.sectionNumber)
    if (hit && hit.classId && hit.classId !== anchor.classId) {
      peers.push({ courseId: c.id, subject: c.subject, code: c.code, classId: hit.classId })
    }
  }
  return peers
}

export function aggregateCrossListedSectionEnrollment(
  anchor: Section,
  crossListCourseIds: string[],
  courses: Course[],
  liveSeats?: Map<number, LiveSeat>
): Pick<Section, 'enrolled' | 'capacity' | 'waitlist' | 'waitlistMax'> {
  // A live reading replaces the dump's snapshot for that one section; siblings
  // with no live reading keep theirs, so a partial fetch still aggregates.
  const withLive = (s: Section): Section => {
    const live = liveSeats?.get(s.classId)
    if (!live) return s
    // Capacity is the one field where a zero is more likely a gap in the live
    // reading than a real cap of nothing, and a zero would hide the whole
    // enrollment line. Counts always take the live value.
    return {
      ...s,
      enrolled: live.enrolled,
      capacity: live.capacity > 0 ? live.capacity : s.capacity,
      waitlist: live.waitlist,
      waitlistMax: live.waitlistMax > 0 ? live.waitlistMax : s.waitlistMax,
      combined: live.combined,
    }
  }
  anchor = withLive(anchor)
  // The room's own numbers, when Navigator has them, beat any sum: enrolled and
  // waitlist add across listings but caps do not, so CS 140M (30) + EE 186 (50)
  // read "50 / 80" for a lecture capped at 50. Only the anchor's own room counts:
  // every listing in a room carries it, and a sibling matched by section number
  // alone may sit in a different one.
  const combined = anchor.combined
  if (combined) {
    return {
      enrolled: combined.enrolled,
      capacity: combined.capacity,
      waitlist: combined.waitlist,
      waitlistMax: combined.waitlistMax,
    }
  }
  const byId = new Map(courses.map(c => [c.id, c]))
  const matches: Section[] = []
  for (const cid of crossListCourseIds) {
    const c = byId.get(cid)
    if (!c?.sections?.length) continue
    const sameTerm = c.sections.filter(s => s.term === anchor.term)
    const hit =
      sameTerm.find(s => s.classId === anchor.classId) ??
      sameTerm.find(
        s => s.component === anchor.component && s.sectionNumber === anchor.sectionNumber
      )
    if (hit) matches.push(withLive(hit))
  }
  if (matches.length === 0) {
    return {
      enrolled: anchor.enrolled,
      capacity: anchor.capacity,
      waitlist: anchor.waitlist,
      waitlistMax: anchor.waitlistMax,
    }
  }
  const sum = (pick: (s: Section) => number | undefined) => matches.reduce((a, s) => a + (pick(s) ?? 0), 0)
  // People add across listings; caps do not (a room's cap matched the sum of its
  // listings' caps in 22 of 379 Autumn 2026 rooms). With no room from Navigator,
  // which publishes none for discussions and labs, the class's cap is unknown, so
  // report none rather than a sum: SYMSYS 1's third discussion read "16 / 353"
  // from six listings each flagged Open with caps of 150, 15, 15, 150, 18 and 5.
  return {
    enrolled: sum(s => s.enrolled),
    capacity: matches.length < 2 ? sum(s => s.capacity) : 0,
    waitlist: sum(s => s.waitlist),
    waitlistMax: sum(s => s.waitlistMax),
  }
}

// Very lightweight heuristic mapping for Stanford subjects.
// This is only used for filtering facets, so it's intentionally best-effort.
export function getSchoolFromSubject(subject: string) {
  if (!subject) return ''

  const s = subject.trim().toUpperCase()

  const engineering = new Set([
    'AA',
    'BIOE', 'CS', 'CME', 'EE', 'MS&E', 'MSE', 'ENGR', 'ME', 'MATSCI', 'ENERGY', 'STS'
  ])

  const business = new Set(['GSBGEN', 'MGTECON', 'STRAMGT', 'FINANCE', 'OIT', 'HRMGT'])
  const education = new Set(['EDUC', 'EDUCATION'])
  const law = new Set(['LAW'])
  const medicine = new Set(['MED', 'SURG', 'PEDS', 'OBGYN', 'PSYC', 'PSY', 'PATH', 'ANAT'])
  const sustainability = new Set(['SUST', 'EARTHSYS', 'CEE', 'ENV', 'ENVRES'])

  if (engineering.has(s)) return 'Engineering'
  if (business.has(s)) return 'Business'
  if (education.has(s)) return 'Education'
  if (law.has(s)) return 'Law'
  if (medicine.has(s)) return 'Medicine'
  if (sustainability.has(s)) return 'Sustainability'

  // Default bucket
  return 'Humanities & Sciences'
}

// Syllabus URLs moved to src/lib/syllabus.ts, which only builds a link when
// Stanford's syllabus service says one was actually published; term <-> term
// code conversion moved to src/lib/terms.ts.

export function parseUnitsOptions(units: string | number): number[] {
  if (typeof units === 'number') {
    return isNaN(units) ? [] : [units]
  }
  // Strip " units" or " unit" suffix and trim; support en-dash (–) and minus (−) in ranges
  const s = String(units).toLowerCase().replace(/\s*units?\s*$/i, '').trim()
  if (!s) return []

  const rangeMatch = s.match(/^(\d+)\s*[-–−]\s*(\d+)$/)
  if (rangeMatch) {
    const low = parseInt(rangeMatch[1], 10)
    const high = parseInt(rangeMatch[2], 10)
    if (low <= high) {
      const opts: number[] = []
      for (let i = low; i <= high; i++) opts.push(i)
      return opts
    }
  }
  const plusMatch = s.match(/^(\d+)\+$/)
  if (plusMatch) return [parseInt(plusMatch[1], 10)]
  const single = parseFloat(s)
  return isNaN(single) ? [] : [single]
}

/**
 * Workload per unit, the figure shown as "N hrs/unit".
 *
 * Derived here rather than read from the stored `difficulty` column: that column
 * was computed against whatever unit count the course carried when its
 * evaluations were scraped, so 41 courses that have since been re-unitised
 * disagreed with the unit count displayed beside them. Zero-unit courses get
 * nothing instead of their raw hour count.
 *
 * Ranges divide by the largest option, which is the convention the stored
 * column used in all 1,249 range cases.
 */
export function hoursPerUnit(hours: number | null | undefined, units: string | number | null | undefined): number | undefined {
  if (hours == null || !Number.isFinite(hours)) return undefined
  const options = parseUnitsOptions((units ?? '') as string).filter(u => u > 0)
  if (!options.length) return undefined
  return hours / Math.max(...options)
}

/**
 * Pool evaluation figures across every code a class is listed under, so the
 * rating does not depend on which listing you opened. Each figure is the mean
 * over the members that have one; a member with no evaluations is skipped
 * rather than counted as zero.
 */
export function aggregateCrossListMetrics(
  members: Array<{ hours?: number | null; quality?: number | null; units?: string | number | null }>,
): { hours?: number; quality?: number; hrsPerUnit?: number } {
  const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : undefined)
  const hours = mean(members.map(m => m.hours).filter((h): h is number => h != null && Number.isFinite(h)))
  const quality = mean(members.map(m => m.quality).filter((q): q is number => q != null && Number.isFinite(q)))
  // Per-member hrs/unit, because members can carry different unit counts.
  const hrsPerUnit = mean(
    members
      .map(m => hoursPerUnit(m.hours, m.units))
      .filter((v): v is number => v != null && Number.isFinite(v)),
  )
  return {
    ...(hours != null && { hours }),
    ...(quality != null && { quality }),
    ...(hrsPerUnit != null && { hrsPerUnit }),
  }
}

/**
 * Pick the precomputed rating figures for a cross-listed class.
 *
 * Not averaged, and not pooled, because a cross-listed group's evaluation rows are
 * DUPLICATES rather than a partition: one report is filed verbatim under each code it
 * lists (1,907 of 1,907 multi-listing reports in the table have byte-identical response
 * counts). So all members that have data carry the same numbers, and averaging them is
 * arithmetically equivalent to taking one -- while pooling them would count 20 students
 * as 40 and wrongly weaken the small-sample shrinkage.
 *
 * Taking the member with the most responses is the cheap way to say "whichever listing
 * actually has the data" -- AFRICAAM 10 has none while its CSRE 10 and TAPS 10 listings
 * have the same 20 responses.
 *
 * Averaging the score would give the same answer today. Averaging the PERCENTILE would
 * not be safe even so: it is a rank, not a quantity, so the mean of the 95th and 4th
 * percentiles is a number that no course's score maps to.
 */
type RatingFields = Pick<Course, 'quality' | 'qualityN' | 'qualityPct' | 'rankScope' | 'ratingBreakdown'>

export function resolveCrossListRating(
  members: Array<RatingFields>,
  /**
   * The listing being displayed. The SCORE is shared by the whole group, but the RANK is
   * per department -- CSRE 10 is ranked against CSRE and its TAPS 10 listing against
   * TAPS off the same score -- so the rank has to come from this listing's own row, not
   * from whichever sibling happens to hold the most responses. Omitted, or with no rank
   * of its own, the sibling's rank is used and the label names that sibling's peer group.
   */
  self?: RatingFields,
): RatingFields {
  let best: (typeof members)[number] | undefined
  for (const member of members) {
    if (member?.quality == null) continue
    if (!best || (member.qualityN ?? 0) > (best.qualityN ?? 0)) best = member
  }
  const ranked = self?.qualityPct != null ? self : best
  return {
    quality: best?.quality,
    qualityN: best?.qualityN,
    qualityPct: ranked?.qualityPct,
    rankScope: ranked?.rankScope,
    ratingBreakdown: mergeRatingRanks(best?.ratingBreakdown, ranked?.ratingBreakdown),
  }
}

/** Scores and sample sizes from the listing that has the data, ranks from this listing. */
function mergeRatingRanks(
  scores: Course['ratingBreakdown'],
  ranks: Course['ratingBreakdown'],
): Course['ratingBreakdown'] {
  if (!scores || !ranks || scores === ranks) return scores
  const out: NonNullable<Course['ratingBreakdown']> = {}
  for (const [category, stat] of Object.entries(scores) as Array<[keyof typeof scores, NonNullable<typeof scores>[keyof typeof scores]]>) {
    if (!stat) continue
    const rank = ranks[category]
    out[category] = rank ? { ...stat, pct: rank.pct, scope: rank.scope } : stat
  }
  return out
}

/** Use "unit" only when value is exactly 1; otherwise "units". Ranges (e.g. "1-3") and "1+" always use "units". */
export function unitsLabel(value: number | string | null | undefined): 'unit' | 'units' {
  if (value == null || value === '') return 'units'
  const s = String(value).trim()
  // Ranges like "1-3", "2–4" and "1+" always use "units"
  if (/^\d+\s*[-–−]\s*\d+/.test(s) || /\d+\+$/.test(s)) return 'units'
  if (value === 1 || value === '1') return 'unit'
  const n = typeof value === 'number' ? value : parseFloat(s)
  if (!isNaN(n) && n === 1) return 'unit'
  return 'units'
}

/** Normalize a level string (e.g. "UG", "Graduate", "UNDERGRAD") to "Undergrad" or "Graduate". */
export function formatLevel(level: string): string {
  if (!level || !String(level).trim()) return 'N/A';
  const l = String(level).toUpperCase().trim();
  if (l.includes('UNDERGRAD') || l === 'UG' || l === 'U') return 'Undergrad';
  if (l.includes('GRAD') || l === 'GR' || l === 'G') return 'Graduate';
  // If it's a code-based check (e.g. "106A" -> Undergrad, "246" -> Graduate)
  const codeMatch = String(level).match(/\d+/);
  if (codeMatch) {
    const num = parseInt(codeMatch[0], 10);
    if (num < 200) return 'Undergrad';
    return 'Graduate';
  }
  return level;
}

/** GER display: show only acronym (e.g. "Applied Quantitative Reasoning (AQR)" -> "AQR"). */
const GER_ABBREV: Record<string, string> = {
  'Aesthetic and Interpretive Inquiry': 'AII',
  'Applied Quantitative Reasoning': 'AQR',
  'Creative Expression': 'CE',
  'Exploring Difference and Power': 'EDP',
  'Ethical Reasoning': 'ER',
  'Formal Reasoning': 'FR',
  'Scientific Method and Analysis': 'SMA',
  'Social Inquiry': 'SI',
  'Engaging Diversity': 'ED',
  'Writing and Rhetoric': 'PWR',
  'Civic, Liberal, and Global Education': 'COLLEGE'
}

export function isAllowedGer(ger: string): boolean {
  const g = ger.toUpperCase()
  // WAYS (all 8)
  if (g.startsWith('WAY-')) return true
  const ways = ['AII', 'AQR', 'CE', 'EDP', 'ER', 'FR', 'SMA', 'SI', 'ED']
  if (ways.some(w => g === w || g.includes(`(${w})`))) return true

  // WIM
  if (g === 'WIM' || g.includes('WRITING IN THE MAJOR')) return true

  // COLLEGE
  if (g.includes('COLLEGE') || g.includes('CIVIC, LIBERAL, AND GLOBAL EDUCATION')) return true

  // PWR
  if (g.includes('PWR 1') || g.includes('PWR 2') || g === 'PWR' || g.includes('WRITING 1') || g.includes('WRITING 2')) return true

  // Language
  if (g.includes('LANGUAGE') && !g.includes('GER:')) return true
  if (g === 'LANG') return true

  return false
}

export function abbreviateGer(ger: string): string {
  const match = ger.match(/\s*\(([A-Za-z0-9+]+)\)\s*$/)
  if (match) return match[1]
  const abbr = GER_ABBREV[ger] ?? ger
  if (abbr === 'Engaging Diversity') return 'ED' // Fix for old/mixed format
  return abbr
}

const COMPONENT_MAP: Record<string, string> = {
  LEC: 'Lecture',
  SEM: 'Seminar',
  DIS: 'Discussion',
  LAB: 'Laboratory',
  LBS: 'Lab Section',
  INS: 'Independent Study',
  PRA: 'Practicum',
  LNG: 'Language',
  'T/D': 'Thesis/Dissertation',
  CLK: 'Clerkship',
  WKS: 'Workshop',
  COL: 'Colloquium',
  CAS: 'Case Study',
  ACT: 'Activity',
  ISF: 'Intro Seminar - Freshman',
  CLN: 'Clinical',
  RES: 'Research',
  ISS: 'Intro Seminar - Sophomore',
  ITR: 'Internship',
  RSC: 'Research Section',
  TUT: 'Tutorial',
  SIM: 'Simulation'
};

export function formatComponent(comp: string): string {
  if (!comp) return '';
  const c = comp.toUpperCase().trim();
  return COMPONENT_MAP[c] ?? comp;
}

/**
 * Custom sort comparator for course codes.
 * Ensures "7" comes before "10", and "106A" comes before "106B".
 * Does this by extracting the numeric part, comparing it, and then falling back to alphabetical for suffixes.
 */
export function compareCourseCodes(a: string, b: string): number {
  const parseCode = (code: string) => {
    const match = (code || '').match(/^(\d+)(.*)$/)
    if (match) {
      return { num: parseInt(match[1], 10), suffix: match[2].trim().toLowerCase() }
    }
    // Fallback if there are no leading numbers (e.g. some weird seminar codes)
    return { num: 0, suffix: (code || '').toLowerCase() }
  }

  const parsedA = parseCode(a)
  const parsedB = parseCode(b)

  if (parsedA.num !== parsedB.num) {
    return parsedA.num - parsedB.num // Ascending numeric 7 < 10
  }

  return parsedA.suffix.localeCompare(parsedB.suffix) // Ascending alphabetical A < B
}
