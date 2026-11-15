'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { SiteHeader } from '@/components/site-header';
import { AlertCircle, RefreshCcw } from 'lucide-react';
import { track } from '@/lib/analytics';
import { crashProps } from '@/lib/crash-report';
import { isStaleChunkError, reloadForStaleChunk } from '@/lib/stale-chunk-reload';

export default function ErrorBoundary({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    // A tab open from before a deploy asks for code that no longer exists; reload
    // into the new deploy instead of showing an error (lib/stale-chunk-reload).
    // Blank while that reload is decided, so the error page does not flash first.
    const [reloading, setReloading] = useState(() => isStaleChunkError(error));

    useEffect(() => {
        console.error('Unhandled application error:', error);
        let storage: Storage | null = null;
        try { storage = window.sessionStorage; } catch { /* blocked: no reload, see the helper */ }
        const reloaded = reloadForStaleChunk(error, { storage, reload: () => window.location.reload() });
        // Record it too: a crash on someone else's phone is otherwise invisible.
        // Sent with sendBeacon, so it still arrives when the page reloads.
        track('app_crashed', { ...crashProps(error), autoReloaded: reloaded });
        if (!reloaded) setReloading(false);
    }, [error]);

    // Blank for the moment before the reload lands, rather than flashing the error page.
    if (reloading) return <div className="min-h-screen bg-background" />;

    return (
        <div className="min-h-screen flex flex-col bg-background">
            <SiteHeader />
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center animate-in fade-in zoom-in-95 duration-300">
                <div className="bg-destructive/10 text-destructive p-4 rounded-full mb-6 relative">
                    <div className="absolute inset-0 bg-destructive/20 rounded-full animate-ping opacity-25" />
                    <AlertCircle size={48} className="relative z-10" />
                </div>

                <h2 className="text-3xl font-extrabold text-foreground tracking-tight mb-3">
                    Something went wrong!
                </h2>

                <p className="text-muted-foreground text-lg mb-8 max-w-md mx-auto">
                    An unexpected error occurred while running the application. We apologize for the inconvenience.
                </p>

                <div className="flex flex-col sm:flex-row gap-4 items-center justify-center">
                    <Button
                        onClick={() => reset()}
                        size="lg"
                        className="gap-2 font-bold min-w-[160px]"
                    >
                        <RefreshCcw size={18} />
                        Try Again
                    </Button>
                    <Button
                        variant="outline"
                        size="lg"
                        onClick={() => window.location.href = '/'}
                        className="gap-2 font-bold min-w-[160px]"
                    >
                        Return Home
                    </Button>
                </div>

                {process.env.NODE_ENV === 'development' && (
                    <div className="mt-12 text-left bg-secondary/30 p-4 rounded-lg border border-border/50 max-w-2xl w-full overflow-auto text-xs">
                        <p className="font-bold text-destructive mb-2">Developer Error Info:</p>
                        <pre className="text-muted-foreground whitespace-pre-wrap font-mono">
                            {error.message}
                            {'\n'}
                            {error.stack}
                        </pre>
                    </div>
                )}
            </div>
        </div>
    );
}
