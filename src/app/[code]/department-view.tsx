import Link from 'next/link'
import type { DumpDeptCourse } from '@/lib/catalog-dump'
import { SiteHeader } from '@/components/site-header'
import { decodeHtmlEntities, parseUnitsOptions, unitsLabel } from '@/lib/utils'
import { Suspense } from 'react'

function formatUnits(units: string | null): string | null {
  if (!units) return null
  const opts = parseUnitsOptions(units)
  if (opts.length === 0) return null
  const displayVal = opts.length === 1 ? opts[0] : units
  const label = unitsLabel(typeof displayVal === 'number' ? displayVal : units)
  return `${displayVal} ${label}`
}

function courseMeta(course: DumpDeptCourse): string {
  return [
    formatUnits(course.units),
    course.quality != null && `${course.quality.toFixed(1)}/5 rating`,
    course.hours != null && `${course.hours.toFixed(0)} hrs/wk`,
  ]
    .filter(Boolean)
    .join(' · ')
}

/** The crawlable course list for one department, served at `/<SUBJECT>`. */
export function DepartmentView({
  subject,
  courses,
}: {
  subject: string
  courses: DumpDeptCourse[]
}) {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Suspense fallback={<div className="h-16 border-b border-border/50" />}>
        <SiteHeader />
      </Suspense>
      <main className="mx-auto w-full max-w-3xl px-6 py-12 flex-1">
        {/* MCP is also Molecular and Cellular Physiology, so stanfordroot.com/mcp lands here
            for anyone looking for the MCP server's setup page. */}
        {subject === 'MCP' && (
          <p className="mb-6 rounded-md border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-foreground/90">
            Trying to use Stanford Root with an AI assistant (MCP)? Click{' '}
            <Link href="/connect" className="font-medium text-primary underline underline-offset-2">
              here
            </Link>{' '}
            to set it up.
          </p>
        )}
        <nav className="mb-6 text-sm text-muted-foreground">
          <Link href="/departments" className="hover:text-primary transition-colors">
            &larr; All departments
          </Link>
        </nav>
        <h1 className="text-3xl font-bold tracking-tight">{subject} courses at Stanford</h1>
        <p className="mt-2 text-muted-foreground">
          {courses.length} {subject} {courses.length === 1 ? 'course' : 'courses'}{' '}
          in Stanford&rsquo;s catalog, with ratings and hours per week from real student evaluations.
        </p>
        <ul className="mt-8 divide-y divide-border/40">
          {courses.map((course) => {
            const meta = courseMeta(course)
            return (
              <li key={course.id}>
                <Link
                  href={`/${encodeURIComponent(course.id)}`}
                  prefetch={false}
                  className="block py-3 group"
                >
                  <span className="font-medium group-hover:text-primary transition-colors">
                    {course.subject} {course.code}: {decodeHtmlEntities(course.title)}
                  </span>
                  {meta && (
                    <span className="mt-0.5 block text-sm text-muted-foreground">{meta}</span>
                  )}
                </Link>
              </li>
            )
          })}
        </ul>
        <p className="mt-10 text-sm text-muted-foreground">
          <Link href="/" className="underline hover:text-primary transition-colors">
            Search and filter the full catalog
          </Link>
          {' · '}
          <Link href="/departments" className="underline hover:text-primary transition-colors">
            All departments
          </Link>
        </p>
      </main>
    </div>
  )
}
