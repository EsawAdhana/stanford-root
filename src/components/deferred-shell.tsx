'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const FeedbackDialog = dynamic(
  () => import('@/components/feedback-dialog').then(m => ({ default: m.FeedbackDialog })),
  { ssr: false }
);

export function DeferredShell() {
  const pathname = usePathname();
  // Hide the feedback button on the landing page for a clean first impression.
  const showFeedback = pathname !== '/';

  // The way in to /connect: laptop and desktop only, beside the feedback button when there is one.
  const showMcp = pathname !== '/connect' && !pathname.startsWith('/oauth');

  return (
    <>
      {showMcp && (
        <Link
          href="/connect"
          title="Use Stanford Root from Claude, Codex, or any MCP client"
          className={`fixed bottom-6 z-40 hidden lg:flex h-10 items-center rounded-full px-4 text-sm font-medium bg-white/90 text-muted-foreground border border-border/60 shadow-sm hover:bg-white hover:text-foreground hover:border-border hover:shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 transition-colors dark:bg-white/10 dark:border-white/20 dark:hover:bg-white/20 ${showFeedback ? 'right-[4.5rem]' : 'right-6'}`}
        >
          MCP
        </Link>
      )}
      {showFeedback ? <FeedbackDialog /> : null}
    </>
  );
}
