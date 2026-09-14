import { codeToTerm, compareTerms, termToCode } from '@/lib/terms'

/**
 * Syllabus links, resolved against what Stanford has actually published.
 *
 * syllabus.stanford.edu/syllabus/doWebAuth/<a>/<b> redirects to WebAuth for
 * any pair of ids, real or not, so the old behaviour -- always render the
 * button, always build the URL -- sent roughly nine in ten clicks to a login
 * wall that led nowhere. scripts/scrape-syllabi.mjs records the service's own
 * per-section flags in public/syllabi/index.json; this module applies the same
 * link rule the service's own search UI applies:
 *
 *   "PUBLIC" == syllabusVisibility
 *     ? (isOnlyOneFile ? <download action> : `#/viewSyllabus/${courseId}/${origCourseId}`)
 *     : `/syllabus/doWebAuth/${courseId}/${origCourseId}`
 *
 * rendered only when `hasSyllabus`. That is the service's *link* rule, not its
 * *content* rule, and the difference cost a round of logged-in testing:
 *
 *   AMHRLANG 1  published, single file            -> renders the PDF
 *   PSYC 124    published, multi-file, public     -> renders the syllabus
 *   AA 228      published, multi-file, enrolled   -> renders the syllabus
 *   AA 101      NOT published                     -> viewer opens empty
 *
 * So `published` is required even though the service's own UI links without
 * it, and neither `isOnlyOneFile` nor `courseVisibility` predicts anything.
 *
 * One residual false positive is accepted knowingly. AFRICAAM 10 / CSRE 10
 * reports INSTITUTION and published, and both its listings answer "restricted
 * to members of the course website in Canvas" once you are logged in. Nothing
 * in the search payload distinguishes it from AA 228, which has identical
 * flags and renders fine, so the alternative to a rare wrong link is throwing
 * away every correct one.
 *
 * The two path segments are different ids. `origCourseId` is the listing being
 * viewed and `courseId` is the listing that owns the file; for AFRICAAM 10,
 * cross-listed as CSRE 10, the pair is F26-CSRE-10-01 / F26-AFRICAAM-10-01.
 * Passing the listing id twice loads the viewer with no document in it, which
 * on screen is indistinguishable from a gated syllabus.
 */

const BASE = 'https://syllabus.stanford.edu/syllabus'

/** Visibility as the service reports it. INSTITUTION is the unstated default. */
export type SyllabusVisibility = 'INSTITUTION' | 'PUBLIC' | 'COURSE'

/**
 * One section carrying a syllabus, with every flag the viewer's behaviour turns
 * on. Defaults are omitted to keep the committed index small; see
 * scripts/scrape-syllabi.mjs for the key legend.
 */
export interface SyllabusEntry {
  /** Section number, e.g. "01". */
  s: string
  /** 0 when the syllabus is not published. Absent means published. */
  p?: 0
  /** syllabusVisibility: "P"ublic or "C"ourse. Absent means INSTITUTION. */
  v?: 'P' | 'C'
  /** courseVisibility: "P"ublic or "I"nstitution. Absent means COURSE. */
  c?: 'P' | 'I'
  /** Owning id minus its term prefix, e.g. "CSRE-10-01", when cross-listed. */
  o?: string
  /** 1 when the syllabus is a single uploaded file. */
  one?: 1
}

export interface SyllabusIndex {
  generatedAt: string
  /** Indexed term codes, oldest first. */
  terms: string[]
  termTitles: Record<string, string>
  /** "CS-106A" -> term code -> sections. */
  courses: Record<string, Record<string, SyllabusEntry[]>>
}

export type SyllabusResolution =
  /** The selected term has a syllabus. */
  | { status: 'current'; url: string; term: string }
  /** The selected term has none, so this links the most recent term that does. */
  | { status: 'fallback'; url: string; term: string }
  /** A syllabus exists but only enrolled students can open it. */
  | { status: 'restricted'; term: string }
  /** Nothing published for this course in any indexed term. */
  | { status: 'none' }

interface NormalEntry {
  section: string
  published: boolean
  visibility: SyllabusVisibility
  owner: string | null
  onlyOneFile: boolean
}

const VISIBILITY: Record<string, SyllabusVisibility> = { P: 'PUBLIC', C: 'COURSE' }

function normalize(entry: SyllabusEntry): NormalEntry | null {
  if (!entry?.s) return null
  return {
    section: entry.s,
    published: entry.p !== 0,
    visibility: entry.v ? VISIBILITY[entry.v] : 'INSTITUTION',
    owner: entry.o ?? null,
    onlyOneFile: entry.one === 1,
  }
}

/** The key courses are indexed under: "CS-106A", "AFRICAAM-10". */
export function syllabusCourseKey(subject: string, code: string): string {
  const subjectClean = (subject || '').replace(/\s+/g, '').toUpperCase()
  const codeClean = (code || '').replace(/\s+/g, '').toUpperCase()
  if (!subjectClean || !codeClean) return ''
  return `${subjectClean}-${codeClean}`
}

/** The identifier the syllabus service addresses a section by: "F26-CS-106A-01". */
export function syllabusIdentifier(
  subject: string,
  code: string,
  term: string,
  sectionNumber: string
): string {
  const key = syllabusCourseKey(subject, code)
  const termCode = termToCode(term)
  const section = (sectionNumber || '').replace(/\s+/g, '')
  if (!key || !termCode || !section) return ''
  return `${termCode}-${key}-${section}`
}

/**
 * The viewer URL for one entry, or null when the service itself offers no link.
 * Mirrors the service's link builder exactly, including the PUBLIC single-file
 * case, which its UI serves as a download rather than a page.
 */
export function syllabusUrlFor(
  termCode: string,
  courseKey: string,
  entry: NormalEntry
): string | null {
  const listing = `${termCode}-${courseKey}-${entry.section}`
  const owner = entry.owner ? `${termCode}-${entry.owner}` : listing

  if (entry.visibility === 'PUBLIC') {
    return entry.onlyOneFile
      ? `${BASE}/downloadSyllabus?courseId=${encodeURIComponent(owner)}`
      : `${BASE}/#/viewSyllabus/${owner}/${listing}`
  }
  return `${BASE}/doWebAuth/${owner}/${listing}`
}

/**
 * Pick the entry to link for a term. The catalog's section numbers are the
 * candidates; prefer one the index knows about, in the order the caller listed
 * them, and fall back to the index's own first openable entry when the catalog
 * has no match (cross-listed classes are filed under the parent's numbering).
 * Unpublished and enrolled-only entries are never picked: an unpublished one
 * opens the viewer with nothing in it, which is the exact experience this
 * whole change exists to stop.
 */
function pickEntry(entries: SyllabusEntry[] | undefined, candidates: string[]): NormalEntry | null {
  const open = (entries ?? [])
    .map(normalize)
    .filter((e): e is NormalEntry => e != null && e.published && e.visibility !== 'COURSE')
  if (open.length === 0) return null
  const normalized = candidates.map(s => (s || '').replace(/\s+/g, '')).filter(Boolean)
  for (const candidate of normalized) {
    const match = open.find(e => e.section === candidate)
    if (match) return match
  }
  return open[0]
}

function hasRestricted(entries: SyllabusEntry[] | undefined): boolean {
  return (entries ?? []).some(e => {
    const n = normalize(e)
    return n != null && n.published && n.visibility === 'COURSE'
  })
}

/**
 * What the syllabus button should do for `term`.
 *
 * `sectionNumbers` are the catalog's section numbers for that term, in display
 * order. When the selected term has nothing published, this walks the indexed
 * terms backwards from the selected one and links the most recent syllabus that
 * exists -- an old reading list beats a dead link, as long as the UI says which
 * term it came from. Terms newer than the selected one are never used as a
 * fallback: for a future quarter the honest answer is that nothing is posted
 * yet, and a newer term can only exist when the user is looking at the past.
 */
export function resolveSyllabus(
  index: SyllabusIndex | null,
  subject: string,
  code: string,
  term: string,
  sectionNumbers: string[] = []
): SyllabusResolution {
  if (!index) return { status: 'none' }

  const key = syllabusCourseKey(subject, code)
  const byTerm = key ? index.courses[key] : undefined
  if (!byTerm) return { status: 'none' }

  const termCode = termToCode(term)
  const currentEntry = termCode ? pickEntry(byTerm[termCode], sectionNumbers) : null
  const currentUrl = currentEntry ? syllabusUrlFor(termCode, key, currentEntry) : null
  if (currentUrl) return { status: 'current', url: currentUrl, term }

  // Most recent indexed term at or before the selected one, newest first.
  const earlier = Object.keys(byTerm)
    .map(c => ({ code: c, term: codeToTerm(c) }))
    .filter(t => t.term && (!term || compareTerms(t.term, term) < 0))
    .sort((a, b) => compareTerms(b.term, a.term))

  for (const candidate of earlier) {
    const entry = pickEntry(byTerm[candidate.code], sectionNumbers)
    const url = entry ? syllabusUrlFor(candidate.code, key, entry) : null
    if (url) return { status: 'fallback', url, term: candidate.term }
  }

  // Nothing openable. Say so precisely when the reason is enrolled-only access.
  const restrictedTerm = [termCode, ...earlier.map(t => t.code)]
    .find(c => hasRestricted(byTerm[c]))
  if (restrictedTerm) {
    return { status: 'restricted', term: codeToTerm(restrictedTerm) || term }
  }

  return { status: 'none' }
}
