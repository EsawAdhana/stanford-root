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
            <p className="text-muted-foreground">Last Updated: September 21, 2026</p>
          </section>

          <section className="prose prose-neutral dark:prose-invert max-w-none">
            <h2 className="text-lg font-semibold text-foreground mb-2">Overview</h2>
            <p>
              Stanford Root (&quot;We&quot;, &quot;us&quot;, or &quot;the Service&quot;) is a free course search and
              schedule planning website for Stanford University students, run at{' '}
              <a href="https://stanfordroot.com" className="text-primary hover:underline">stanfordroot.com</a>. It
              lets anyone browse Stanford&apos;s course catalog and build a weekly schedule, and lets signed-in
              Stanford students read published student course evaluations and sync their schedule across devices.
              Stanford Root is an independent project and is not operated by or affiliated with Stanford University.
            </p>
            <p className="mt-2">
              This policy explains what data we collect, why we collect it, who it is shared with, how long we
              keep it, and how you can delete it.
            </p>
          </section>

          <section className="prose prose-neutral dark:prose-invert max-w-none">
            <h2 className="text-lg font-semibold text-foreground mb-2">Information We Collect</h2>
            <p>When you sign in with your Stanford Google account, we receive:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li><strong>Email address</strong> — used to verify you are a Stanford student (@stanford.edu).</li>
              <li><strong>Name</strong> — Google sends it with your sign-in. It is not displayed anywhere in the
                app; it is passed to our analytics provider so your sessions can be linked to one person (see
                &quot;Usage Analytics&quot; below).</li>
              <li><strong>Profile photo</strong> — shown in the app interface.</li>
            </ul>
            <p className="mt-2">
              We do not request access to your Google Drive, Gmail, Calendar, or any other Google services
              beyond basic profile information.
            </p>
            <p className="mt-2">
              Feedback you send through the in-app feedback form is stored as the message text and its category
              and nothing else, even when you are signed in: your account, name, and email are deliberately not
              attached to it. Your IP address is used for a moment to rate-limit submissions and is not stored
              with the feedback.
            </p>
          </section>

          <section className="prose prose-neutral dark:prose-invert max-w-none">
            <h2 className="text-lg font-semibold text-foreground mb-2">How We Use Your Information</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>To authenticate your identity and restrict access to Stanford students.</li>
              <li>To associate your course schedule and preferences with your account.</li>
              <li>To gate published Stanford course evaluations to the Stanford community, as Stanford requires.</li>
              <li>To reply to you if you email us.</li>
            </ul>
            <p className="mt-2">
              We do not use your information for advertising, we do not build advertising profiles, and we do not
              use it to train machine learning or AI models.
            </p>
          </section>

          <section className="prose prose-neutral dark:prose-invert max-w-none">
            <h2 className="text-lg font-semibold text-foreground mb-2">Google User Data</h2>
            <p>
              Signing in is handled by Google OAuth through Supabase Auth. We request only the basic sign-in
              scopes &mdash; <code>openid</code>, <code>email</code>, and <code>profile</code> &mdash; which give us
              your email address, your name, and your profile photo URL. We never receive your Google password.
            </p>
            <p className="mt-2">
              We use that data for exactly one thing: creating and identifying your Stanford Root account so your
              schedule follows you between devices and so evaluations can be shown to Stanford students. We do not
              request, read, or store data from Gmail, Google Drive, Google Calendar, Google Contacts, or any other
              Google service.
            </p>
            <p className="mt-2">
              Stanford Root&apos;s use and transfer of information received from Google APIs adheres to the{' '}
              <a
                href="https://developers.google.com/terms/api-services-user-data-policy"
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline"
              >
                Google API Services User Data Policy
              </a>
              , including the Limited Use requirements. We do not sell Google user data, we do not transfer it to
              third parties except to the service providers listed below that operate the Service on our behalf,
              and we do not use it for advertising.
            </p>
          </section>

          <section className="prose prose-neutral dark:prose-invert max-w-none">
            <h2 className="text-lg font-semibold text-foreground mb-2">Data Storage</h2>
            <p>
              Your data is stored securely using Supabase, a hosted database platform with
              row-level security policies, on servers in the United States. Traffic to the Service is
              encrypted in transit with HTTPS. Your schedule selections are also stored locally in
              your browser via localStorage.
            </p>
          </section>

          <section className="prose prose-neutral dark:prose-invert max-w-none">
            <h2 className="text-lg font-semibold text-foreground mb-2">Data Retention</h2>
            <p>
              We keep your account record and saved schedule for as long as your account exists, so that your
              schedule is there the next time you sign in. Usage analytics events are kept only for as long as they are
              useful for understanding and improving the Service, and are deleted when they no longer are. When you ask us to delete your account, we delete your account record, your saved
              schedules, and your analytics events, as described under &quot;Your Rights and Deleting Your Data&quot;.
              Data you have stored only in your own browser is cleared when you clear your browser storage.
            </p>
          </section>

          <section className="prose prose-neutral dark:prose-invert max-w-none">
            <h2 className="text-lg font-semibold text-foreground mb-2">Data Sharing</h2>
            <p>
              We do not sell or rent your personal information, and we do not share it with advertisers.
              We share data only with the service providers that run the Service on our behalf:
            </p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li><strong>Supabase</strong> — authentication and database hosting.</li>
              <li><strong>Vercel</strong> — website hosting and request logs.</li>
              <li><strong>Human Behavior</strong> — product analytics (see &quot;Usage Analytics&quot; below).</li>
              <li><strong>Resend</strong> — delivers the notification email we get when someone submits feedback.</li>
            </ul>
            <p className="mt-2">
              We may also disclose information if we are legally required to do so.
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
              Human Behavior&apos;s servers on our behalf. When you are signed in, we also send
              Human Behavior your email address, the name on your Google account, and your
              Stanford Root account ID, so that sessions from the same person are recognised as
              one person rather than a series of strangers. We do not use advertising trackers,
              and we never sell this data. This information is used only to measure engagement
              and improve the Service.
            </p>
          </section>

          <section className="prose prose-neutral dark:prose-invert max-w-none">
            <h2 className="text-lg font-semibold text-foreground mb-2">Your Rights and Deleting Your Data</h2>
            <p>
              You can browse the catalog and build a schedule without an account at all, and you may sign out at
              any time to end your session. You may also ask us for a copy of the data we hold about you, ask us to
              correct it, or ask us to delete it.
            </p>
            <p className="mt-2">
              To delete your account and everything associated with it, email{' '}
              <a href="mailto:adhanaesaw@gmail.com" className="text-primary hover:underline">
                adhanaesaw@gmail.com
              </a>{' '}
              from your Stanford address with the subject &quot;Delete my account&quot;. We delete your account
              record, saved schedules, and analytics events within 30 days and confirm by email when it is done.
              You can also revoke Stanford Root&apos;s access to your Google account at any time from{' '}
              <a
                href="https://myaccount.google.com/permissions"
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline"
              >
                your Google account permissions page
              </a>
              .
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
