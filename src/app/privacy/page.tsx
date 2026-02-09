import Link from 'next/link'

export const metadata = {
  title: 'Privacy Policy — Root',
}

export default function PrivacyPolicy () {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-6 py-16">
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
          &larr; Back to Root
        </Link>

        <h1 className="text-3xl font-bold text-foreground mt-8 mb-2 font-[family-name:var(--font-outfit)]">Privacy Policy</h1>
        <p className="text-sm text-muted-foreground mb-10">Last updated: February 9, 2026</p>

        <div className="prose prose-neutral max-w-none space-y-6 text-sm text-foreground/80 leading-relaxed">
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">Overview</h2>
            <p>
              Root (&quot;I&quot;, &quot;me&quot;, or &quot;the Service&quot;) is a course discovery and scheduling tool
              built for Stanford University students. I am committed to protecting your privacy and being
              transparent about how I handle your data.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">Information I Collect</h2>
            <p>When you sign in with your Stanford Google account, I receive:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li><strong>Email address</strong> — used to verify you are a Stanford student (@stanford.edu).</li>
              <li><strong>Profile photo</strong> — shown in the app interface.</li>
            </ul>
            <p className="mt-2">
              I do not request access to your Google Drive, Gmail, Calendar, or any other Google services
              beyond basic profile information.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">How I Use Your Information</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>To authenticate your identity and restrict access to Stanford students.</li>
              <li>To associate your course schedule, preferences, and votes with your account.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">Data Storage</h2>
            <p>
              Your data is stored securely using Supabase, a hosted database platform with
              row-level security policies. Your schedule selections are also stored locally in
              your browser via localStorage.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">Data Sharing</h2>
            <p>
              I do not sell, rent, or share your personal information with third parties.
              Aggregated, anonymized data (such as total votes on a syllabus) may be visible
              to other authenticated users of the Service.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">Cookies &amp; Local Storage</h2>
            <p>
              I use browser localStorage to persist your course schedule across sessions.
              Authentication tokens are managed by Supabase and stored as secure cookies.
              I do not use third-party tracking cookies or analytics.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">Your Rights</h2>
            <p>
              You may sign out at any time to end your session. If you wish to delete your
              account and all associated data, please contact me and I will process your
              request promptly.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">Changes to This Policy</h2>
            <p>
              I may update this Privacy Policy from time to time. Any changes will be reflected
              on this page with an updated &quot;Last updated&quot; date.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">Contact</h2>
            <p>
              If you have questions about this Privacy Policy, please reach out to me at{' '}
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
