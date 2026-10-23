import type { CourseInfo, Way } from './types'

/**
 * "cs106b", "CS  106B", "CS106B" -> "CS 106B". Stanford subject codes are
 * letters and "&" only (MS&E), so the number starts at the first digit.
 */
export function normalizeCode(raw: string): string {
  const compact = (raw || '').toUpperCase().replace(/\s+/g, '')
  const m = /^([A-Z&]+)(\d.*)$/.exec(compact)
  return m ? `${m[1]} ${m[2]}` : (raw || '').toUpperCase().trim().replace(/\s+/g, ' ')
}

/** "CS 106B" -> "CS106B", the id Stanford Root's course pages use. */
export function rootCourseId(code: string): string {
  return normalizeCode(code).replace(/\s+/g, '')
}

export interface CourseIndex {
  get(code: string): CourseInfo | undefined
  /** Every listing of the same course, the code itself included. */
  equivalents(code: string): string[]
  search(query: string, limit?: number): CourseInfo[]
  /** Every subject code ("CS", "MS&E"), which tells a course row from a heading. */
  subjects: Set<string>
  size: number
}

type Row = [string, string, number, number, string, string, string, string]

export function buildCourseIndex(json: { rows: Row[] }): CourseIndex {
  const byCode = new Map<string, CourseInfo>()
  const byGroup = new Map<string, string[]>()
  const list: CourseInfo[] = []
  for (const [code, title, min, max, ways, tags, grading, group] of json.rows) {
    const info: CourseInfo = {
      code,
      title,
      min,
      max,
      ways: (ways ? ways.split(' ') : []) as Way[],
      tags: tags ? tags.split(' ') : [],
      grading: (grading || '') as CourseInfo['grading'],
      group: group || '',
    }
    byCode.set(code, info)
    list.push(info)
    if (info.group) {
      const codes = byGroup.get(info.group)
      if (codes) codes.push(code)
      else byGroup.set(info.group, [code])
    }
  }

  const subjects = new Set(list.map(c => c.code.split(' ')[0]))

  return {
    size: list.length,
    subjects,
    get: (code) => byCode.get(normalizeCode(code)),
    equivalents(code) {
      const normal = normalizeCode(code)
      const group = byCode.get(normal)?.group
      return group ? byGroup.get(group) ?? [normal] : [normal]
    },
    search(query, limit = 30) {
      const q = query.trim().toUpperCase()
      if (!q) return []
      const compact = q.replace(/\s+/g, '')
      const codeHits: CourseInfo[] = []
      const titleHits: CourseInfo[] = []
      for (const c of list) {
        const codeCompact = c.code.replace(/\s+/g, '')
        if (codeCompact === compact) codeHits.unshift(c)
        else if (codeCompact.startsWith(compact)) codeHits.push(c)
        else if (q.length >= 3 && c.title.toUpperCase().includes(q)) titleHits.push(c)
        if (codeHits.length >= limit) break
      }
      return [...codeHits, ...titleHits].slice(0, limit)
    },
  }
}
