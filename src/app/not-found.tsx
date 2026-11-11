import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/site-header';
import { Button } from '@/components/ui/button';
import { Suspense } from 'react';

// Next.js adds its own `<meta name="robots" content="noindex">` to this page,
// so it sets no robots of its own: a second, different robots tag is noise.
// Unknown course, department and instructor paths now get a real 404 status
// (dynamicParams = false on those routes), which is what keeps them out of
// Google's index.
export const metadata: Metadata = {
  title: 'Page Not Found — Stanford Root',
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
