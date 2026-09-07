/**
 * Cross-list grouping: the one implementation of "which catalog codes are the same class".
 *
 * Plain .mjs so the scraper (plain node) and the UI (via utils.ts, which re-exports these)
 * share it. They MUST share it: refreshMetrics pools a class's evaluations over its whole
 * group, and the course page merges the on-screen evaluations over its whole group. If the
 * two disagreed about the group, the headline rating and the charts under it would count
 * different sets of students.
 */

/**
 * Extract alternate course codes from a title's trailing parenthetical, e.g. "(CS 137A, EE 160A)".
 * Returns normalized ids (no space, uppercase) for comparison, or empty array if none.
 */
export function getAlternateCourseCodesFromTitle(title) {
  if (!title || typeof title !== 'string') return []
  const trimmed = title.trim()
  const match = trimmed.match(/\s*\(([^)]+)\)\s*$/)
  if (!match) return []
  const inner = match[1].trim()
  const courseCodeList = /^[A-Za-z&]{2,10}\s+\d{1,3}[A-Za-z]?(\s*,\s*[A-Za-z&]{2,10}\s+\d{1,3}[A-Za-z]?)*$/
  if (!courseCodeList.test(inner)) return []
  return inner.split(/\s*,\s*/).map(part => part.replace(/\s+/g, '').toUpperCase())
}

/** Normalize course id for comparison (no spaces, uppercase). */
export function normalizeCourseId(id) {
  if (!id || typeof id !== 'string') return ''
  return id.replace(/\s+/g, '').toUpperCase()
}

/**
 * Map from normalized member id -> the canonical id of its cross-list class.
 *
 * Titles declare siblings ("Principles of Robot Autonomy I (AA 274A, CS 237A,
 * EE 260A)"), but they declare them pairwise and inconsistently: AA 274A's title
 * may name three siblings while CS 237A's names three different ones. Following
 * those links one hop at a time made a four-code class resolve to three
 * different canonical ids depending on which code you entered from, so the same
 * class showed different pooled evaluations per URL.
 *
 * So group by connected component (union-find) and pick one canonical member —
 * the alphabetically first id that exists in the catalog. Only non-canonical
 * members are keyed, which makes resolution a single hop and idempotent.
 *
 * Cached per `courses` array identity: the catalog mounts FilterSidebar and
 * CourseList, which each built their own copy, and getCrossListGroupIds rebuilt
 * one per call — ~6 ms each over 8,648 courses, repeated on every catalog change.
 */
const primaryMapCache = new WeakMap()

export function getCrossListPrimaryMap(courses) {
  const cached = primaryMapCache.get(courses)
  if (cached) return cached
  const built = buildCrossListPrimaryMap(courses)
  primaryMapCache.set(courses, built)
  return built
}

function buildCrossListPrimaryMap(courses) {
  const parent = new Map()
  const find = (x) => {
    let root = x
    while (parent.get(root) !== root) root = parent.get(root)
    // Path-compress so repeated lookups over the whole catalog stay cheap.
    let cur = x
    while (parent.get(cur) !== root) {
      const next = parent.get(cur)
      parent.set(cur, root)
      cur = next
    }
    return root
  }
  const add = (x) => { if (!parent.has(x)) parent.set(x, x) }
  const union = (a, b) => {
    const ra = find(a)
    const rb = find(b)
    if (ra === rb) return
    // Keep the alphabetically smaller id as the root so the canonical choice
    // does not depend on iteration order.
    if (ra < rb) parent.set(rb, ra)
    else parent.set(ra, rb)
  }

  const real = new Set(courses.map(c => normalizeCourseId(c.id)))
  for (const c of courses) {
    const self = normalizeCourseId(c.id)
    add(self)
    for (const alt of getAlternateCourseCodesFromTitle(c.title)) {
      // Ignore codes that are not in the catalog: they cannot be a destination.
      if (!real.has(alt)) continue
      add(alt)
      union(self, alt)
    }
    // Codes Stanford evaluated jointly. Titles miss paired undergrad/grad listings
    // (MATSCI 184 / 214, EE 267 / 267W, HISTORY 40 / 140): the catalog never declares
    // them cross-listed, yet a single evaluation report covers both, so their students
    // are the same students. Without this, one code showed no rating at all while its
    // twin showed a full one, and both showed only a slice of the responses.
    for (const alt of c.crossListWith || []) {
      const norm = normalizeCourseId(alt)
      if (!real.has(norm) || norm === self) continue
      add(norm)
      union(self, norm)
    }
  }

  const map = new Map()
  for (const id of parent.keys()) {
    const canonical = find(id)
    if (canonical !== id) map.set(id, canonical)
  }
  return map
}

/**
 * Resolve a normalized course id to its canonical primary (for redirects).
 * One hop with the component map above; the visited guard is kept so a
 * hand-built or legacy map cannot spin.
 */
export function resolveToCanonicalPrimary(norm, primaryMap) {
  const visited = new Set()
  let current = norm
  while (primaryMap.has(current)) {
    if (visited.has(current)) {
      return [...visited].sort()[0]
    }
    visited.add(current)
    current = primaryMap.get(current)
  }
  return current
}

/**
 * Returns all course IDs in the same cross-list group as the given course.
 * Used to aggregate evaluations from CS 24, LINGUIST 35, BILL 99, etc. when they're the same class.
 * Falls back to [courseId] when courses is empty (e.g. still loading) or course not in catalog.
 */
export function getCrossListGroupIds(courseId, courses) {
  if (!courses.length) return [courseId]
  const primaryMap = getCrossListPrimaryMap(courses)
  const norm = normalizeCourseId(courseId)
  const canonical = resolveToCanonicalPrimary(norm, primaryMap)
  const group = []
  for (const c of courses) {
    const cNorm = normalizeCourseId(c.id)
    if (resolveToCanonicalPrimary(cNorm, primaryMap) === canonical) {
      group.push(c.id)
    }
  }
  return group.length > 0 ? group : [courseId]
}

/**
 * canonical id -> every catalog id in that cross-list group, for one pass over the catalog.
 * Same grouping as getCrossListGroupIds, built once instead of per course.
 *
 * @param {Array<{ id: string, title: string, crossListWith?: string[] }>} courses
 * @returns {Map<string, string[]>}
 */
export function buildCrossListGroups(courses) {
    const primaryMap = getCrossListPrimaryMap(courses)
    const groups = new Map()
    for (const course of courses) {
        const canonical = resolveToCanonicalPrimary(normalizeCourseId(course.id), primaryMap)
        if (!groups.has(canonical)) groups.set(canonical, [])
        groups.get(canonical).push(course.id)
    }
    return groups
}

/**
 * Codes that share an evaluation report, keyed by catalog id.
 *
 * An evaluation's course_code lists every code the report covers
 * ("Sp24-MATSCI-184-01/Sp24-MATSCI-214-01"). That is Stanford evaluating those codes as
 * one class, which the catalog title does not always admit -- so it is the evidence
 * buildCrossListPrimaryMap needs to stop treating them as separate courses.
 *
 * @param {Array<{ course_code?: unknown }>} evaluations
 * @param {Set<string>} catalogIds normalized ids that exist in the catalog
 * @returns {Map<string, string[]>} normalized id -> the other normalized ids it shares a report with
 */
export function deriveEvalPairings(evaluations, catalogIds) {
  const pairs = new Map()
  for (const evaluation of evaluations) {
    const listed = String(evaluation?.course_code || '')
      .split('/')
      .map(part => normalizeCourseId(
        part.trim()
          // "Sp24-MATSCI-184-01" -> "MATSCI184": drop the term prefix and the section suffix.
          .replace(/^[A-Za-z]{1,2}\d{2}-/, '')
          .replace(/-\d+[A-Za-z]?$/, '')
          .replace(/-/g, ''),
      ))
      .filter(id => id && catalogIds.has(id))
    const unique = [...new Set(listed)]
    if (unique.length < 2) continue
    for (const id of unique) {
      if (!pairs.has(id)) pairs.set(id, new Set())
      for (const other of unique) if (other !== id) pairs.get(id).add(other)
    }
  }
  return new Map([...pairs].map(([id, others]) => [id, [...others].sort()]))
}
