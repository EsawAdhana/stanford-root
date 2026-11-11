import type { Metadata, ResolvingMetadata } from 'next'
import { pageMetadata } from '@/lib/page-metadata'

export async function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  return pageMetadata(parent, {
    title: 'Schedule — Stanford Root',
    description: 'Build a conflict-free weekly schedule from Stanford courses.',
    path: '/schedule',
  })
}

export default function ScheduleLayout({ children }: { children: React.ReactNode }) {
  return children
}
