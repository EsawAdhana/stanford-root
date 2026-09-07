import { Suspense } from 'react';
import { SiteHeader } from '@/components/site-header';

function HeaderFallback() {
    return <div className="h-14 sm:h-16 border-b border-border/50 bg-background/90" />;
}

/** Route-level loading UI — matches the course page shell so navigations
 *  don't flash a centered spinner before snapping into layout. */
export default function CourseLoading() {
    return (
        <div className="min-h-screen bg-background flex flex-col">
            <Suspense fallback={<HeaderFallback />}>
                <SiteHeader />
            </Suspense>
            <main className="flex-1 bg-background">
                <div className="mx-auto max-w-6xl px-5 py-6 md:py-8">
                    <div className="h-8 w-48 rounded bg-muted/40 mb-2" />
                    <div className="h-10 w-full max-w-2xl rounded bg-muted/30 mb-6" />
                    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
                        <div className="space-y-4">
                            <div className="h-10 w-56 rounded-lg bg-muted/30" />
                            <div className="h-32 rounded-xl bg-muted/20" />
                            <div className="h-48 rounded-xl bg-muted/20" />
                        </div>
                        <div className="space-y-3">
                            <div className="h-6 w-24 rounded bg-muted/30" />
                            <div className="h-40 rounded-xl bg-muted/20" />
                            <div className="h-40 rounded-xl bg-muted/20" />
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}
