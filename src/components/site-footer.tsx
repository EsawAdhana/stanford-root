import Link from 'next/link'

/**
 * One-line statement of what this site is, plus the policy links.
 *
 * Server rendered on purpose: the catalog UI is all client components, so
 * without this the home page ships an HTML document with no prose in it, and
 * anything that reads the page without running JS — Google's OAuth branding
 * review, link previews, plain crawlers — sees a blank page.
 */
export function SiteFooter() {
  return (
    <footer className="flex-none border-t border-border/50 bg-background px-3 py-2 sm:px-4">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-1 text-[11px] leading-relaxed text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <p>
          <span className="font-medium text-foreground">Stanford Root</span> is a free course search and
          schedule planner for Stanford students.
          <span className="hidden md:inline">
            {' '}Browse the full Stanford course catalog, read real student course evaluations, and build a
            conflict-free weekly schedule. Signing in with your Stanford Google account unlocks evaluations
            and syncs your schedule across devices.
          </span>
        </p>
        <nav className="flex shrink-0 items-center gap-3">
          <Link href="/faq" className="hover:text-foreground transition-colors">FAQ</Link>
          <Link href="/privacy" className="hover:text-foreground transition-colors">Privacy</Link>
          <Link href="/terms" className="hover:text-foreground transition-colors">Terms</Link>
        </nav>
      </div>
    </footer>
  )
}
