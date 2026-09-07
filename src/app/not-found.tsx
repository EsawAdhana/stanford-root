import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/site-header';
import { Button } from '@/components/ui/button';
import { Suspense } from 'react';

// notFound() resolves softly here: this page is served with a 200, which the
// live site already does for an unknown /courses or /instructors path. That
// mattered less when junk had to sit under a known prefix. Course and
// department pages now live at the root, so every mistyped path in the
// namespace lands here, and without this Google would be free to index all of
// them as real pages.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function NotFound() {
    return (
        <div className="min-h-screen flex flex-col bg-background">
            <Suspense>
                <SiteHeader />
            </Suspense>
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
                <h1 className="text-6xl font-extrabold text-foreground tracking-tight mb-2">
                    404
                </h1>
                <p className="text-lg text-muted-foreground mb-8 max-w-md">
                    The page you&apos;re looking for doesn&apos;t exist or has been moved.
                </p>
                <Button asChild size="lg" className="font-bold">
                    <Link href="/">Return Home</Link>
                </Button>
            </div>
        </div>
    );
}
