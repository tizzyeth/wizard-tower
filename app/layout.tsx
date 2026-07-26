import type { Metadata, Viewport } from "next";
import { Geist, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers/Providers";
import { Analytics } from "@vercel/analytics/next";

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
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.smokingwiz.art";

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
        {/* Vercel Web Analytics: page counts only — no cookies, no cross-site
            identifiers, no profile of the visitor. Kept compatible with the
            promise the Buy menu makes about never touching a wallet.

            Opt-in, because the script it pulls (/_vercel/insights/script.js) is
            injected by Vercel's edge and exists nowhere else: in a local
            production build, in CI, or on a self-hosted deploy it is a
            guaranteed 404 and a console error on every page view.

            Gated on our own variable rather than Vercel's `VERCEL` because that
            one only reaches the app when the project has "expose System
            Environment Variables" switched on — this project does not, and
            trusting it silently turned analytics off in production. Set
            WIZARD_ANALYTICS=1 wherever the edge actually serves the script. */}
        {process.env.WIZARD_ANALYTICS ? <Analytics /> : null}
      </body>
    </html>
  );
}
