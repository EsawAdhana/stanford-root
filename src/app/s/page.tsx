import type { Metadata } from 'next'
import { Suspense } from 'react'
import { SchedulePageShell } from '@/components/schedule-page-shell'
import { SharedScheduleView } from '@/components/shared-schedule-view'
import { displayCode, readShareLink } from '@/lib/share-link'

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const params = await searchParams
  const shared = readShareLink({
    get: name => {
      const value = params[name]
      return typeof value === 'string' ? value : null
    },
  })
  return {
    title: 'Shared schedule on Stanford Root',
    // What a link preview in a group chat shows.
    description: shared
      ? `${shared.term}: ${shared.entries.map(e => displayCode(e.id)).join(', ')}`
      : 'A Stanford class schedule shared from Stanford Root.',
    // Every link is someone's schedule, and the URL space is unbounded.
    robots: { index: false, follow: false },
  }
}

export default function SharedSchedulePage() {
  return (
    <Suspense fallback={<SchedulePageShell />}>
      <SharedScheduleView />
    </Suspense>
  )
}
