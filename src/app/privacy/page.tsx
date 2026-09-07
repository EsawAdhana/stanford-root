import Link from 'next/link'
import { Suspense } from 'react'
import { Metadata } from 'next'
import { SiteHeader } from '@/components/site-header'

export const metadata: Metadata = {
  title: 'Privacy Policy — Stanford Root',
  alternates: { canonical: '/privacy' },
};

export default function PrivacyPage() {
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
            <h1 className="text-4xl font-bold tracking-tight mb-4">Privacy Policy</h1>
            <p className="text-muted-foreground">Last Updated: August 8, 2026</p>
          </section>

          <section className="prose prose-neutral dark:prose-invert max-w-none">
            <h2 className="text-lg font-semibold text-foreground mb-2">Overview</h2>
            <p>
              Stanford Root (&quot;We&quot;, &quot;us&quot;, or &quot;the Service&quot;) is a course discovery and scheduling tool
              built for Stanford University students. We are committed to protecting your privacy and being
              transparent about how we handle your data.
            </p>
          </section>

          <section className="prose prose-neutral dark:prose-invert max-w-none">
            <h2 className="text-lg font-semibold text-foreground mb-2">Information We Collect</h2>
            <p>When you sign in with your Stanford Google account, we receive:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li><strong>Email address</strong> — used to verify you are a Stanford student (@stanford.edu).</li>
              <li><strong>Profile photo</strong> — shown in the app interface.</li>
            </ul>
            <p className="mt-2">
              We do not request access to your Google Drive, Gmail, Calendar, or any other Google services
              beyond basic profile information.
            </p>
          </section>

          <section className="prose prose-neutral dark:prose-invert max-w-none">
            <h2 className="text-lg font-semibold text-foreground mb-2">How We Use Your Information</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>To authenticate your identity and restrict access to Stanford students.</li>
              <li>To associate your course schedule and preferences with your account.</li>
            </ul>
          </section>

          <section className="prose prose-neutral dark:prose-invert max-w-none">
            <h2 className="text-lg font-semibold text-foreground mb-2">Data Storage</h2>
            <p>
              Your data is stored securely using Supabase, a hosted database platform with
              row-level security policies. Your schedule selections are also stored locally in
              your browser via localStorage.
            </p>
          </section>

          <section className="prose prose-neutral dark:prose-invert max-w-none">
            <h2 className="text-lg font-semibold text-foreground mb-2">Data Sharing</h2>
            <p>
              We do not sell or rent your personal information. We share usage and interaction
              data with our analytics provider, Human Behavior, solely to help us understand and
              improve how the Service is used (see &quot;Usage Analytics&quot; below).
            </p>
          </section>

          <section className="prose prose-neutral dark:prose-invert max-w-none">
            <h2 className="text-lg font-semibold text-foreground mb-2">Cookies &amp; Local Storage</h2>
            <p>
              We use browser localStorage to persist your course schedule across sessions.
              Authentication tokens are managed by Supabase and stored as secure cookies.
              We do not use advertising cookies or sell your data. We do use a third-party
              product analytics provider (Human Behavior) to understand usage, as described
              under &quot;Usage Analytics&quot; below.
            </p>
          </section>

          <section className="prose prose-neutral dark:prose-invert max-w-none">
            <h2 className="text-lg font-semibold text-foreground mb-2">Usage Analytics</h2>
            <p>
              To understand how the Service is used and improve it, we collect usage analytics
              through two channels. First, we store first-party events in our own database
              (Supabase) &mdash; high-level actions such as page views, searches, adding a course
              to a schedule, and signing in, along with a randomly generated device identifier
              kept in your browser&apos;s localStorage. Second, we use Human Behavior, a
              third-party product analytics provider, which records how users interact with the
              Service (such as clicks, navigation, and session activity) and sends this data to
              Human Behavior&apos;s servers on our behalf. We do not use advertising trackers,
              and we never sell this data. This information is used only to measure engagement
              and improve the Service.
            </p>
          </section>

          <section className="prose prose-neutral dark:prose-invert max-w-none">
            <h2 className="text-lg font-semibold text-foreground mb-2">Your Rights</h2>
            <p>
              You may sign out at any time to end your session. If you wish to delete your
              account and all associated data, please contact us and we will process your
              request promptly.
            </p>
          </section>

          <section className="prose prose-neutral dark:prose-invert max-w-none">
            <h2 className="text-lg font-semibold text-foreground mb-2">Changes to This Policy</h2>
            <p>
              We may update this Privacy Policy from time to time. Any changes will be reflected
              on this page with an updated &quot;Last updated&quot; date.
            </p>
          </section>

          <section className="prose prose-neutral dark:prose-invert max-w-none">
            <h2 className="text-lg font-semibold text-foreground mb-2">Contact</h2>
            <p>
              If you have questions about this Privacy Policy, please reach out to us at{' '}
              <a href="mailto:adhanaesaw@gmail.com" className="text-primary hover:underline">
                adhanaesaw@gmail.com
              </a>.
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
