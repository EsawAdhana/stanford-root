import Link from 'next/link'
import { Suspense } from 'react'
import { Metadata } from 'next'
import { SiteHeader } from '@/components/site-header'
import { SITE_URL } from '@/lib/site'

export const metadata: Metadata = {
  title: 'About Stanford Root',
  description:
    'Stanford Root is a free course search and schedule planner for Stanford students: the full course catalog, real student course evaluations, and a conflict-free weekly schedule.',
  alternates: { canonical: '/about' },
}

/**
 * The page that says, in words, what this site is. The catalog at `/` is the
 * product and carries no prose, so this is the URL to hand to anything that
 * needs a description of the app: the Google OAuth consent screen's
 * "Application home page" field points here.
 */
export default function AboutPage() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Suspense fallback={<div className="h-16 border-b border-border/50" />}>
        <SiteHeader />
      </Suspense>
      <div className="mx-auto max-w-3xl px-6 py-12 flex-1">
        <div className="mb-12">
          <Link
            href="/"
            className="text-sm text-muted-foreground hover:text-primary transition-colors flex items-center gap-2"
          >
            &larr; Back to Stanford Root
          </Link>
        </div>

        <div className="space-y-12">
          <section>
            <h1 className="text-4xl font-bold tracking-tight mb-4">Stanford Root</h1>
            <p className="text-lg text-muted-foreground">
              A free course search and schedule planner for Stanford students.
            </p>
          </section>

          <section className="prose prose-neutral dark:prose-invert max-w-none">
            <h2 className="text-lg font-semibold text-foreground mb-2">What it does</h2>
            <p>
              Stanford Root puts Stanford&apos;s entire course catalog in one search box. You can filter by
              department, term, units, meeting time, class level, school, and general education requirement, read
              the real student course evaluations for a class, see how many hours a week past students said it
              took, check whether a section still has seats, and drop the classes you are considering onto a weekly
              calendar that tells you when two of them collide.
            </p>
            <p className="mt-2">
              Browsing the catalog and building a schedule need no account at all. It is free, there are no ads,
              and nothing is sold.
            </p>
          </section>

          <section className="prose prose-neutral dark:prose-invert max-w-none">
            <h2 className="text-lg font-semibold text-foreground mb-2">Signing in with Google</h2>
            <p>
              Two things ask you to sign in: reading course evaluations, which Stanford publishes to the Stanford
              community rather than to the public, and syncing your schedule across devices. Sign-in goes through
              Google with your Stanford account, and we ask Google only for the basic sign-in scopes, so all we
              receive is your email address, your name, and your profile photo. We never see your password, and we
              do not touch Gmail, Google Drive, Google Calendar, or anything else in your Google account.
            </p>
            <p className="mt-2">
              The{' '}
              {/* Absolute canonical URL on purpose: Google checks that the privacy link on the
                  home page is the same string as the one in the consent screen config. */}
              <a href={`${SITE_URL}/privacy`} className="text-primary hover:underline">
                privacy policy
              </a>{' '}
              spells out what we store, who processes it, how long it is kept, and how to have it deleted.
            </p>
          </section>

          <section className="prose prose-neutral dark:prose-invert max-w-none">
            <h2 className="text-lg font-semibold text-foreground mb-2">Where the data comes from</h2>
            <p>
              Course titles, descriptions, units, instructors, and meeting times come from Stanford&apos;s official
              catalog and are refreshed daily. Seat counts are fetched the moment you open a course. Evaluations
              come from Stanford&apos;s published course evaluation results. The{' '}
              <Link href="/faq" className="text-primary hover:underline">
                FAQ
              </Link>{' '}
              goes through this in more detail, including why grade distributions are not here.
            </p>
          </section>

          <section className="prose prose-neutral dark:prose-invert max-w-none">
            <h2 className="text-lg font-semibold text-foreground mb-2">Who runs it</h2>
            <p>
              Stanford Root is an independent project built by a Stanford student. It is not operated by,
              endorsed by, or affiliated with Stanford University, and it is not a system of record: confirm
              enrollment, prerequisites, and deadlines in Stanford&apos;s official systems before you rely on them.
              Questions, corrections, and bug reports go to{' '}
              <a href="mailto:adhanaesaw@gmail.com" className="text-primary hover:underline">
                adhanaesaw@gmail.com
              </a>
              .
            </p>
            <p className="mt-2">
              See also the{' '}
              <a href={`${SITE_URL}/terms`} className="text-primary hover:underline">
                terms of service
              </a>
              .
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
