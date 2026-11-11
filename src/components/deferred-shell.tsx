'use client';

import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';

const FeedbackDialog = dynamic(
  () => import('@/components/feedback-dialog').then(m => ({ default: m.FeedbackDialog })),
  { ssr: false }
);

export function DeferredShell() {
  const pathname = usePathname();
  // Hide the feedback button on the landing page for a clean first impression.
  const showFeedback = pathname !== '/';

  return showFeedback ? <FeedbackDialog /> : null;
}
