#!/usr/bin/env node
/**
 * Checks the prerendered HTML that `next build` wrote, so a page that silently
 * stops server-rendering fails the build instead of shipping an empty document.
 *
 * It has regressed twice: a client component reading search params with no
 * Suspense boundary of its own opts everything up to the nearest boundary out of
 * server rendering, and the page ships as a loading shell with no text, links or
 * JSON-LD. Crawlers, link previews and Google's OAuth branding review all read
 * that shell.
 *
 * For one course, one department, one instructor, /about and /privacy it
 * requires, outside <script> contents: an <h1> and at least one <a href>. The
 * course page must also carry an application/ld+json tag, and the course,
 * department and instructor pages an og:image.
 *
 * Usage: node scripts/check-build-output.mjs [--dir .next/server/app]
 *          [--course AA100] [--department AA] [--instructor arya-manan]
 * Without flags it picks the first course in data/catalog/light.json, that
 * course's department, and an instructor page for that course's first listed
 * instructor. Exits 1 on any failure.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** Removes everything between <script ...> and </script>, keeping the tags. */
export function stripScriptContents(html) {
  return html.replace(/(<script\b[^>]*>)[\s\S]*?(<\/script>)/gi, '$1$2')
}

/** Problems with one page's HTML; an empty list means it passes. */
export function checkPage(html, { jsonLd = false, ogImage = false } = {}) {
  const problems = []
  const body = stripScriptContents(html)
  if (!/<h1[\s>]/i.test(body)) problems.push('no <h1>')
  if (!/<a\s[^>]*\bhref\s*=\s*["'][^"']+["']/i.test(body)) problems.push('no <a href>')
  if (jsonLd && !/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>/i.test(html)) {
    problems.push('no application/ld+json script tag')
  }
  if (ogImage) {
    const metas = body.match(/<meta\b[^>]*>/gi) ?? []
    const hasImage = metas.some((tag) =>
      /\bproperty\s*=\s*["']og:image["']/i.test(tag) && /\bcontent\s*=\s*["'][^"']+["']/i.test(tag))
    if (!hasImage) problems.push('no og:image')
  }
  return problems
}

function slugPart(text) {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const m = argv[i].match(/^--(dir|course|department|instructor)$/)
    if (m && argv[i + 1]) out[m[1]] = argv[++i]
  }
  return out
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const args = parseArgs(process.argv.slice(2))
  const dir = path.resolve(root, args.dir ?? '.next/server/app')
  if (!fs.existsSync(dir)) {
    console.error(`check-build-output: ${dir} does not exist; run next build first.`)
    process.exit(1)
  }

  const rows = JSON.parse(fs.readFileSync(path.join(root, 'data/catalog/light.json'), 'utf8'))
  const course = args.course
    ? rows.find((r) => r.course_id === args.course)
    : rows.find((r) => (r.instructors ?? []).length > 0)
  if (!course) {
    console.error(`check-build-output: course ${args.course} is not in data/catalog/light.json.`)
    process.exit(1)
  }
  const department = args.department ?? course.subject

  // Instructor slugs are surname first ("arya-manan"). Rather than reimplement
  // src/lib/instructors.ts, take the first built page whose slug starts with the
  // surname of the course's first instructor.
  let instructor = args.instructor
  if (!instructor) {
    const surname = slugPart(String(course.instructors[0]).split(',')[0])
    const instructorDir = path.join(dir, 'instructors')
    const built = fs.existsSync(instructorDir)
      ? fs.readdirSync(instructorDir).filter((f) => f.endsWith('.html')).sort()
      : []
    instructor = built.find((f) => f.startsWith(`${surname}-`))?.replace(/\.html$/, '')
    if (!instructor) {
      console.error(`check-build-output: no prerendered instructor page starts with "${surname}-" in ${instructorDir}.`)
      process.exit(1)
    }
  }

  const pages = [
    { label: `course /${course.course_id}`, file: `${encodeURIComponent(course.course_id)}.html`, jsonLd: true, ogImage: true },
    { label: `department /${department}`, file: `${encodeURIComponent(department)}.html`, ogImage: true },
    { label: `instructor /instructors/${instructor}`, file: `instructors/${instructor}.html`, ogImage: true },
    { label: '/about', file: 'about.html' },
    { label: '/privacy', file: 'privacy.html' },
  ]

  let failed = false
  for (const page of pages) {
    const file = path.join(dir, page.file)
    if (!fs.existsSync(file)) {
      console.error(`FAIL ${page.label}: ${file} was not prerendered`)
      failed = true
      continue
    }
    const problems = checkPage(fs.readFileSync(file, 'utf8'), page)
    if (problems.length > 0) {
      console.error(`FAIL ${page.label}: ${problems.join(', ')}`)
      failed = true
    } else {
      console.log(`ok   ${page.label}`)
    }
  }
  if (failed) process.exit(1)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
