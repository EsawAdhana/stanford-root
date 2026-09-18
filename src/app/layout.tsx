import type { Metadata } from "next";
import { Suspense } from "react";
import { Inter, Instrument_Serif } from "next/font/google";
import { NuqsAdapter } from 'nuqs/adapters/next/app'
import { ThemeProvider } from '@/components/theme-provider';
import { AuthProvider } from '@/components/auth-provider';
import { AnalyticsProvider } from '@/components/analytics-provider';
import { DeferredShell } from '@/components/deferred-shell';
import { NavProgress } from '@/components/nav-progress';
import { ThemedToaster } from '@/components/themed-toaster';
import { SITE_URL } from '@/lib/site';
import { HumanBehaviorInit } from "./HumanBehaviorInit";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });
const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-display",
  adjustFontFallback: true,
});

const siteUrl = SITE_URL;

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Stanford Root — Search every Stanford course and evaluation",
  description: "Browse Stanford's full course catalog, read real student course evaluations, and build a conflict-free weekly schedule.",
  applicationName: "Stanford Root",
  openGraph: {
    title: "Stanford Root — Search every Stanford course and evaluation",
    description: "Browse Stanford's full course catalog, read real student course evaluations, and build a conflict-free weekly schedule.",
    url: siteUrl,
    siteName: "Stanford Root",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Stanford Root — Search every Stanford course and evaluation",
    description: "Browse Stanford's full course catalog, read real student course evaluations, and build a conflict-free weekly schedule.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const supabaseOrigin = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '')

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Warm OAuth hop: click → supabase authorize → Google → Stanford SSO */}
        {supabaseOrigin ? <link rel="preconnect" href={supabaseOrigin} crossOrigin="anonymous" /> : null}
        <link rel="preconnect" href="https://accounts.google.com" />
        <link rel="preconnect" href="https://login.stanford.edu" />
        {/* Recording loader is fetched from the CDN, not bundled — see HumanBehaviorInit */}
        <link rel="preconnect" href="https://cdn.humanbehavior.co" />
        <link rel="dns-prefetch" href="https://accounts.google.com" />
        <link rel="dns-prefetch" href="https://login.stanford.edu" />
      </head>
      <body className={`${inter.className} ${instrumentSerif.variable}`}>
        <HumanBehaviorInit />
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <NuqsAdapter>
            <Suspense fallback={null}>
              <NavProgress />
            </Suspense>
            <Suspense fallback={null}>
              <AuthProvider>
                {children}
              </AuthProvider>
            </Suspense>
            <AnalyticsProvider />
            <ThemedToaster />
            <DeferredShell />
          </NuqsAdapter>
        </ThemeProvider>
      </body>
    </html>
  );
}
