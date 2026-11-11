import type { Metadata, ResolvingMetadata } from 'next';
import { Suspense } from 'react';
import { SiteHeader } from '@/components/site-header';
import { ConnectedApps } from '@/components/connected-apps';
import { pageMetadata } from '@/lib/page-metadata';

export async function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
    return pageMetadata(parent, {
        title: 'Connected apps',
        description: 'See and revoke the apps you have connected to your Stanford Root account.',
        path: '/connected-apps',
        robots: { index: false, follow: false },
    });
}

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
