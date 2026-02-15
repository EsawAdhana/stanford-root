import type { Metadata } from "next";
import { Inter, Outfit } from "next/font/google";
import { NuqsAdapter } from 'nuqs/adapters/next/app'
import { LoadingToast } from "@/components/loading-toast";
import { OnboardingWrapper } from "@/components/onboarding-wrapper";
import { FeedbackDialog } from "@/components/feedback-dialog";
import { Toaster } from 'sonner';
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });
const outfit = Outfit({ subsets: ["latin"], variable: '--font-outfit' });

export const metadata: Metadata = {
  title: "Stanford Root",
  description: "Stanford Root — A better way to browse Stanford courses",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.className} ${outfit.variable}`}>
        <NuqsAdapter>
          {children}
          <Toaster />
          <LoadingToast />
          <OnboardingWrapper />
          <FeedbackDialog />
        </NuqsAdapter>
      </body>
    </html>
  );
}
