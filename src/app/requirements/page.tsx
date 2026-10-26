import { Suspense } from 'react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { SiteHeader } from '@/components/site-header'
import { RequirementsApp } from '@/components/requirements/requirements-app'
import { REQUIREMENTS_PUBLIC } from '@/lib/requirements/visibility'

export const metadata: Metadata = REQUIREMENTS_PUBLIC
  ? {
      title: 'Degree Requirements — Stanford Root',
      description:
        'Check your courses against the requirements of every Stanford major, minor and coterm in the 2026-27 Bulletin, with Ways and general education.',
      alternates: { canonical: '/requirements' },
    }
  : { title: 'Page not found — Stanford Root', robots: { index: false, follow: false } }

export default function RequirementsPage() {
  if (!REQUIREMENTS_PUBLIC) notFound()
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Suspense fallback={<div className="h-16 border-b border-border/50" />}>
        <SiteHeader />
      </Suspense>
      <RequirementsApp />
    </div>
  )
}
