import type { Metadata } from "next";
import { Inter, Outfit } from "next/font/google";
import { NuqsAdapter } from 'nuqs/adapters/next/app'
import { LoadingToast } from "@/components/loading-toast";
import { Toaster } from 'sonner';
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });
const outfit = Outfit({ subsets: ["latin"], variable: '--font-outfit' });

export const metadata: Metadata = {
  title: "CHANGING THIS",
  description: "CHANGING THIS — A better way to browse Stanford courses",
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
        </NuqsAdapter>
      </body>
    </html>
  );
}
