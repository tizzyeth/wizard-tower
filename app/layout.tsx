import type { Metadata, Viewport } from "next";
import { Geist, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers/Providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
});

// Canonical origin from env (Vercel/production) with a safe local fallback so
// absolute URLs (canonical, og:image) resolve in every environment (§6 env vars).
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://wizard-tower-nu.vercel.app";

const DESCRIPTION =
  "Live due-diligence terminal for Smoking Wizard ($WIZARD) on Solana — price, liquidity, holders, safety wards, trade tape and an auto-computed verdict. Community-built · informational only · not financial advice.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "The Wizard’s Tower · $WIZARD",
    template: "%s · The Wizard’s Tower",
  },
  description: DESCRIPTION,
  applicationName: "The Wizard’s Tower",
  alternates: { canonical: "/" },
  keywords: [
    "WIZARD",
    "Smoking Wizard",
    "Solana",
    "memecoin",
    "Wizardcore",
    "Mimo",
    "token analytics",
    "due diligence",
  ],
  openGraph: {
    type: "website",
    siteName: "The Wizard’s Tower",
    title: "The Wizard’s Tower · $WIZARD",
    description: DESCRIPTION,
    url: "/",
    locale: "en_US",
    // og:image is emitted automatically from app/opengraph-image.tsx.
  },
  twitter: {
    card: "summary_large_image",
    title: "The Wizard’s Tower · $WIZARD",
    description: DESCRIPTION,
    // twitter:image is emitted automatically from app/opengraph-image.tsx.
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#120c15",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
