import type { Metadata, ResolvingMetadata } from 'next'
import { Suspense } from 'react'
import Link from 'next/link'
import { SiteHeader } from '@/components/site-header'
import { pageMetadata } from '@/lib/page-metadata'

export async function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  return pageMetadata(parent, {
    title: 'FAQ — Stanford Root',
    description: 'Where course data comes from, why evaluations need Stanford sign-in, and how feedback works.',
    path: '/faq',
  })
}

export default function FaqPage() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Suspense fallback={<div className="h-16 border-b border-border/50" />}>
        <SiteHeader />
      </Suspense>
      <div className="mx-auto max-w-3xl px-6 py-12 flex-1">
        <h1 className="text-3xl font-bold text-foreground mb-10">FAQ</h1>

        <div className="prose prose-neutral dark:prose-invert max-w-none space-y-8 text-sm text-foreground/80 leading-relaxed">
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">
              Why does Stanford Root not show grade averages or distributions?
            </h2>
            <p>
              Carta was the only place to get performance review data, and that feature has since been
              removed as of 2020 (you can read The Stanford Daily&apos;s coverage{' '}
              <a
                href="https://stanforddaily.com/2020/05/04/carta-removes-performance-feature-following-grading-policy-changes/"
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline"
              >
                here
              </a>
              ). So technically speaking, grade data is still available through 2019, but it is so
              stale that it was decided not to be worth including.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">
              Where does the course information come from?
            </h2>
            <p>
              Everything comes from Stanford, but not all of it at the same speed. Titles, descriptions,
              units, instructors, and meeting times are copied from the official course catalog once a
              day. Seat counts are asked for the moment you open a course, so they are current to within
              a minute. Evaluations show up whenever Stanford publishes them, which is after a term
              ends. Verify enrollment status, prerequisites, meeting times, and deadlines in official
              Stanford systems before making academic decisions.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">
              Where does a course&apos;s rating come from, and why doesn&apos;t it match the charts?
            </h2>
            <p>
              Ratings are built from the student responses in Stanford&apos;s published course
              evaluations. A course with only a handful of responses is nudged toward the Stanford
              average, so a 5.00 from three students does not outrank a strong rating from four hundred.
              That is why the rating shown can sit a little below what the response charts further down
              would suggest on their own.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">
              Why do I need to sign in with Stanford to view evaluations?
            </h2>
            <p>
              Stanford&apos;s own{' '}
              <a
                href="https://course-evaluations.stanford.edu"
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline"
              >
                Course Evaluation System
              </a>{' '}
              restricts evaluation results to the Stanford community. Stanford Root follows that same
              boundary. Anyone can browse courses and build a schedule without signing in.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">
              Do I need an account to use Stanford Root?
            </h2>
            <p>
              No. As stated above, course browsing and schedule building are available to everyone. A
              Stanford account is only required to view evaluations and sync a schedule across devices.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">
              Can I use Stanford Root from Claude or another AI assistant?
            </h2>
            <p>
              Yes. Stanford Root has an MCP server, so Claude, Codex, or any assistant that supports MCP
              can search courses, read evaluations, and plan your saved schedule after you sign in with
              your Stanford account. It never enrolls you in anything. The{' '}
              <Link href="/connect" className="text-primary hover:underline">
                MCP page
              </Link>{' '}
              shows how to add it, and you can remove an assistant&apos;s access from{' '}
              <Link href="/connected-apps" className="text-primary hover:underline">
                Connected apps
              </Link>
              .
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">
              Is Stanford Root affiliated with Stanford University?
            </h2>
            <p>
              No. Stanford Root is an independent course discovery and scheduling tool. It is not
              affiliated with or endorsed by Stanford University.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">
              Is feedback sent through Stanford Root anonymous?
            </h2>
            <p>
              Yes. Feedback from the help button is never attached to your Stanford account, even when
              you are signed in. We only store the message and whether it is feedback or a request.
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
