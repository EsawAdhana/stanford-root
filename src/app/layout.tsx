import type { Metadata } from "next";
import { Inter, Outfit } from "next/font/google";
import { NuqsAdapter } from 'nuqs/adapters/next/app'
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });
const outfit = Outfit({ subsets: ["latin"], variable: '--font-outfit' });

export const metadata: Metadata = {
  title: "NaviGreater",
  description: "A better way to browse Stanford courses",
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
          </NuqsAdapter>
      </body>
    </html>
  );
}
