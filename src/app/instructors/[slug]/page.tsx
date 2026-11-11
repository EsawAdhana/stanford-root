import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { cache, Suspense } from 'react';
import { getInstructorCoursesFromDump, getInstructorDirectory } from '@/lib/catalog-dump';
import { resolveInstructorSlug, type InstructorResolution } from '@/lib/instructors';
import { SITE_URL } from '@/lib/site';
import { SiteHeader } from '@/components/site-header';
import { InstructorDetailContent } from '@/components/instructor-detail-content';
import { getAllInstructorSlugsFromDump } from '@/lib/catalog-dump'

export const revalidate = 86400;

/** Prerender every instructor page; same reasoning as the course pages. */
export async function generateStaticParams() {
    const slugs = await getAllInstructorSlugsFromDump();
    return slugs.map(slug => ({ slug }));
}

const resolve = cache(async (slug: string): Promise<InstructorResolution> => {
    const directory = await getInstructorDirectory();
    return resolveInstructorSlug(directory, slug);
});

export async function generateMetadata({
    params,
}: {
    params: Promise<{ slug: string }>;
}): Promise<Metadata> {
    const { slug } = await params;
    const resolved = await resolve(decodeURIComponent(slug));

    // Ambiguous initial slugs (clark-s with two people) have no single page.
    if (resolved.kind === 'ambiguous' || resolved.kind === 'missing') {
        return { title: 'Instructor Not Found — Stanford Root' };
    }

    // An initial-only slug redirects, so describe the person it lands on.
    const entry = resolved.kind === 'found'
        ? resolved.entry
        : (await getInstructorDirectory()).bySlug.get(resolved.slug);
    if (!entry) {
        return { title: 'Instructor Not Found — Stanford Root' };
    }

    const { name, slug: canonical } = entry;
    const title = `${name} — Stanford Root`;
    const description =
        `Student ratings, hours per week, reviews, and comments for ${name}'s Stanford courses.`;

    return {
        title,
        description,
        alternates: { canonical: `/instructors/${canonical}` },
        openGraph: {
            title,
            description,
            url: `${SITE_URL}/instructors/${canonical}`,
            type: 'profile',
        },
    };
}

export default async function InstructorPage({
    params,
}: {
    params: Promise<{ slug: string }>;
}) {
    const { slug } = await params;
    const decoded = decodeURIComponent(slug);
    const resolved = await resolve(decoded);

    if (resolved.kind === 'missing' || resolved.kind === 'ambiguous') notFound();
    if (resolved.kind === 'redirect') redirect(`/instructors/${resolved.slug}`);

    return (
        <div className="min-h-screen bg-background flex flex-col">
            {/* SiteHeader reads search params. Without its own boundary that opts the
                whole page out of server rendering, so the name and class links below
                would be missing from the HTML. Same pattern as department-view.tsx. */}
            <Suspense fallback={<div className="h-14 sm:h-16 border-b border-border/50 bg-background/90" />}>
                <SiteHeader />
            </Suspense>
            <main className="flex-1 bg-background">
                <InstructorDetailContent
                    slug={resolved.entry.slug}
                    name={resolved.entry.name}
                    upcoming={await getInstructorCoursesFromDump(resolved.entry)}
                />
            </main>
        </div>
    );
}
