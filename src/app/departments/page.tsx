import Link from 'next/link'
import { Suspense } from 'react'
import type { Metadata } from 'next'
import { SiteHeader } from '@/components/site-header'
import { getDepartments } from '@/lib/departments'

// Do not make deployments depend on production database availability.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Stanford Departments — Browse Courses by Department — Stanford Root',
  description:
    "Browse Stanford's course catalog by department. Every department's full course list with student evaluation ratings and hours per week.",
  alternates: { canonical: '/departments' },
}

export default async function DepartmentsPage() {
  const departments = await getDepartments()

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Suspense fallback={<div className="h-16 border-b border-border/50" />}>
        <SiteHeader />
      </Suspense>
      <main className="mx-auto w-full max-w-5xl px-6 py-12 flex-1">
        <h1 className="text-3xl font-bold tracking-tight">Stanford departments</h1>
        <p className="mt-2 text-muted-foreground">
          Every department in Stanford&rsquo;s course catalog. Open a department to see its full
          course list with student evaluation ratings.
        </p>
        <ul className="mt-8 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3 md:grid-cols-4">
          {departments.map(({ subject }) => (
            <li key={subject}>
              <Link
                href={`/${encodeURIComponent(subject)}`}
                prefetch={false}
                className="text-sm hover:text-primary transition-colors"
              >
                {subject}
              </Link>
            </li>
          ))}
        </ul>
        <p className="mt-10 text-sm text-muted-foreground">
          Prefer search?{' '}
          <Link href="/" className="underline hover:text-primary transition-colors">
            Browse and filter the full catalog
          </Link>
          .
        </p>
      </main>
    </div>
  )
}
