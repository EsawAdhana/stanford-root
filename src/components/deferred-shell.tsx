'use client';

import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';

const WhatsNew = dynamic(
  () => import('@/components/whats-new').then(m => ({ default: m.WhatsNew })),
  { ssr: false }
);

const FeedbackDialog = dynamic(
  () => import('@/components/feedback-dialog').then(m => ({ default: m.FeedbackDialog })),
  { ssr: false }
);

export function DeferredShell() {
  const pathname = usePathname();
  // Hide the feedback button on the landing page for a clean first impression.
  const showFeedback = pathname !== '/';

  return (
    <>
      <WhatsNew />
      {showFeedback ? <FeedbackDialog /> : null}
    </>
  );
}
