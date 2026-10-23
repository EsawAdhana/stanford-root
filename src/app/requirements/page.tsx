import { Suspense } from 'react'
import type { Metadata } from 'next'
import { SiteHeader } from '@/components/site-header'
import { RequirementsApp } from '@/components/requirements/requirements-app'

export const metadata: Metadata = {
  title: 'Degree Requirements — Stanford Root',
  description:
    'Check your courses against the requirements of every Stanford major, minor and coterm in the 2026-27 Bulletin, with Ways and general education.',
  alternates: { canonical: '/requirements' },
}

export default function RequirementsPage() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Suspense fallback={<div className="h-16 border-b border-border/50" />}>
        <SiteHeader />
      </Suspense>
      <RequirementsApp />
    </div>
  )
}
