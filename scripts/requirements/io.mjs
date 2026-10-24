/**
 * Reading the cached Coursedog responses and the reviewed overlays. Paths
 * are relative to the repo root the caller passes, so the bundled checker
 * (scripts/check-requirements.mjs) can run from a temp file.
 */
import { existsSync, readFileSync, readdirSync } from 'fs'
import { join } from 'path'

export const cacheDir = (root) => join(root, '.cache', 'requirements')
export const overlayDir = (root) => join(root, 'data', 'requirements', 'overlays')

export function readCache(root) {
  const read = (name) => JSON.parse(readFileSync(join(cacheDir(root), `${name}.json`), 'utf8'))
  if (!existsSync(join(cacheDir(root), 'programs.json'))) {
    throw new Error('No cached Bulletin data. Run `node scripts/build-requirements.mjs` once to fetch it.')
  }
  return { programs: read('programs'), courses: read('courses'), courseSets: read('coursesets') }
}

export function readOverlays(root) {
  const overlays = new Map()
  const dir = overlayDir(root)
  if (!existsSync(dir)) return overlays
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue
    let overlay
    try {
      overlay = JSON.parse(readFileSync(join(dir, f), 'utf8'))
    } catch (err) {
      // Reported as that program's error, so one bad file does not stop the others.
      overlay = { parseError: `${f}: ${err.message}` }
    }
    overlays.set(f.replace(/\.json$/, ''), overlay)
  }
  return overlays
}

export function setsByGroupOf(courseSets) {
  const setsByGroup = new Map()
  for (const s of Object.values(courseSets)) {
    setsByGroup.set(s.courseSetGroupId, { name: (s.name || s.description || '').replace(/\s+/g, ' ').trim(), ids: s.dynamicCourseList ?? [] })
  }
  return setsByGroup
}
