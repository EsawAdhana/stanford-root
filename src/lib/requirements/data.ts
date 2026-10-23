import { buildCourseIndex, type CourseIndex } from './course-index'
import type { ProgramData, ProgramIndex } from './types'

/**
 * Loads the Bulletin data built by scripts/build-requirements.mjs. The index
 * is always revalidated; every other file is requested with the index's
 * version, so it can be cached for good and still update after a rebuild.
 */

let indexPromise: Promise<ProgramIndex> | null = null
let coursesPromise: Promise<CourseIndex> | null = null
const programPromises = new Map<string, Promise<ProgramData>>()

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  return res.json() as Promise<T>
}

export function loadProgramIndex(): Promise<ProgramIndex> {
  if (!indexPromise) {
    indexPromise = getJson<ProgramIndex>('/requirements/index.json').catch(err => {
      indexPromise = null
      throw err
    })
  }
  return indexPromise
}

export function loadCourseIndex(version: string): Promise<CourseIndex> {
  if (!coursesPromise) {
    coursesPromise = getJson<{ rows: never[] }>(`/requirements/courses.json?v=${version}`)
      .then(buildCourseIndex)
      .catch(err => {
        coursesPromise = null
        throw err
      })
  }
  return coursesPromise
}

export function loadProgram(code: string, version: string): Promise<ProgramData> {
  let p = programPromises.get(code)
  if (!p) {
    p = getJson<ProgramData>(`/requirements/programs/${encodeURIComponent(code)}.json?v=${version}`).catch(err => {
      programPromises.delete(code)
      throw err
    })
    programPromises.set(code, p)
  }
  return p
}
