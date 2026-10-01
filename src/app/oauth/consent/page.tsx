import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SiteHeader } from '@/components/site-header';
import { OAuthConsent } from '@/components/oauth-consent';

// Supabase's OAuth server sends users here (Authentication > OAuth Server >
// Authorization Path) when an outside app, such as the Stanford Root MCP,
// asks to act on their account.
export const metadata: Metadata = {
  title: 'Connect an app',
  robots: { index: false, follow: false },
};

export default function OAuthConsentPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Suspense>
        <SiteHeader />
      </Suspense>
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
        <Suspense>
          <OAuthConsent />
        </Suspense>
      </div>
    </div>
  );
}
