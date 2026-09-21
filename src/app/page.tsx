import type { Metadata } from 'next';
import { Suspense } from 'react';
import { CourseList } from '@/components/course-list';
import { SiteHeader } from '@/components/site-header';
import { FilterSidebar } from '@/components/filter-sidebar';
import { BrowsePageShell } from '@/components/browse-page-shell';

// Canonicalize every filtered catalog URL (?depts=..., ?q=...) to the bare
// origin, so search engines don't index thousands of filter permutations.
export const metadata: Metadata = {
  title: 'Stanford Root — Search every Stanford course and evaluation',
  description:
    "Search and filter Stanford's full course catalog by department, term, units, time, GER, and more. See ratings and hours/week from real student evaluations.",
  alternates: { canonical: '/' },
};

/** The catalog is the site: `/` is the search, not a page about the search. */
export default function CatalogPage() {
  return (
    <Suspense fallback={<BrowsePageShell />}>
      <div className="flex flex-col h-screen overflow-hidden bg-background">
        <SiteHeader />

        <div className="flex flex-1 overflow-hidden">
          <aside className="w-[280px] border-r border-border/40 bg-background hidden md:block overflow-y-auto custom-scrollbar shrink-0">
            <FilterSidebar />
          </aside>
          <main className="flex-1 flex flex-col min-w-0 overflow-hidden bg-secondary/20 relative">
            <CourseList />
          </main>
        </div>
      </div>
    </Suspense>
  );
}
