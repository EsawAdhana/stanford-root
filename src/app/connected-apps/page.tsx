import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SiteHeader } from '@/components/site-header';
import { ConnectedApps } from '@/components/connected-apps';

export const metadata: Metadata = {
  title: 'Connected apps',
  robots: { index: false, follow: false },
};

export default function ConnectedAppsPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Suspense>
        <SiteHeader />
      </Suspense>
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
        <ConnectedApps />
      </div>
    </div>
  );
}
