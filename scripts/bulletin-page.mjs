/**
 * Prints a program's page as bulletin.stanford.edu renders it, with the
 * Coursedog course ids the page shows turned back into course codes, so an
 * overlay can be checked against the page itself rather than the data the
 * converter read.
 *
 *   node scripts/bulletin-page.mjs ENGL-BA
 */
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const code = process.argv[2]
if (!code) {
  console.error('usage: node scripts/bulletin-page.mjs <PROGRAM CODE>')
  process.exit(1)
}

const courses = JSON.parse(readFileSync(join(root, '.cache', 'requirements', 'courses.json'), 'utf8'))
const byId = new Map(courses.map(c => [String(c.courseGroupId), `${c.subjectCode} ${c.courseNumber}`]))

const res = await fetch(`https://bulletin.stanford.edu/programs/${encodeURIComponent(code)}`)
if (!res.ok) {
  console.error(`HTTP ${res.status}`)
  process.exit(1)
}
const html = await res.text()
const text = html
  // Course links in the prose read "course" in the source; the id names the course.
  .replace(/<a\b[^>]*data-course-id="(\d+)"[^>]*>[\s\S]*?<\/a>/gi, (link, id) => byId.get(id) ?? link)
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<\/(p|div|li|h\d|tr)>/gi, '\n')
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&rsquo;/g, "'").replace(/&quot;|&ldquo;|&rdquo;/g, '"')
  .replace(/[ \t]+/g, ' ')
  .split('\n').map(l => l.trim()).filter(Boolean).join('\n')
  // The page lists courses by Coursedog id (5 to 8 digits); a number that is
  // no course id is left alone.
  .replace(/\b\d{5,8}\b/g, id => byId.get(id) ?? id)
console.log(text)
