import Link from 'next/link'

export const metadata = {
  title: 'Terms of Service — Root',
}

export default function TermsOfService () {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-6 py-16">
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
          &larr; Back to Root
        </Link>

        <h1 className="text-3xl font-bold text-foreground mt-8 mb-2 font-[family-name:var(--font-outfit)]">Terms of Service</h1>
        <p className="text-sm text-muted-foreground mb-10">Last updated: February 9, 2026</p>

        <div className="prose prose-neutral max-w-none space-y-6 text-sm text-foreground/80 leading-relaxed">
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">Acceptance of Terms</h2>
            <p>
              By accessing or using Root (&quot;the Service&quot;), you agree to be bound by these
              Terms of Service. If you do not agree, please do not use the Service.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">Eligibility</h2>
            <p>
              The Service is available exclusively to individuals with a valid @stanford.edu
              email address. By signing in, you represent that you are a current Stanford
              University student, faculty, or staff member authorized to use your Stanford account.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">Description of Service</h2>
            <p>
              Root provides tools for browsing Stanford course catalogs, building schedules,
              viewing course evaluations, and planning degree requirements. Course data is sourced
              from publicly available Stanford University resources.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">User Conduct</h2>
            <p>You agree not to:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>Use the Service for any unlawful purpose.</li>
              <li>Attempt to gain unauthorized access to the Service or its related systems.</li>
              <li>Scrape, crawl, or otherwise extract data from the Service in an automated manner without permission.</li>
              <li>Misrepresent your identity or affiliation with Stanford University.</li>
              <li>Submit false, misleading, or abusive content (including syllabus votes or reviews).</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">Intellectual Property</h2>
            <p>
              Course information displayed in the Service is the property of Stanford University.
              The Service itself, including its design, code, and branding, is the property of its
              creators and is not affiliated with or endorsed by Stanford University.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">Disclaimer</h2>
            <p>
              The Service is provided &quot;as is&quot; without warranty of any kind. We do not guarantee
              the accuracy, completeness, or timeliness of course data. Always verify critical
              information (enrollment status, prerequisites, schedules) through official Stanford
              University channels.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">Limitation of Liability</h2>
            <p>
              In no event shall the creators of Root be liable for any indirect, incidental,
              special, or consequential damages arising from your use of the Service, including
              but not limited to missed enrollment deadlines or incorrect schedule planning.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">Termination</h2>
            <p>
              We reserve the right to suspend or terminate access to the Service at any time,
              for any reason, without prior notice.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">Changes to These Terms</h2>
            <p>
              We may update these Terms from time to time. Continued use of the Service after
              changes constitutes acceptance of the revised Terms.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">Contact</h2>
            <p>
              If you have questions about these Terms, please contact us at{' '}
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
