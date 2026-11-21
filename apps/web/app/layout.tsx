import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { SessionProvider } from "@/lib/session";
import { AuthProvider } from "@/lib/auth";
import { BRAND } from "@/lib/brand";

// IBM Plex Sans is the only typeface (headings 600, body 400, numbers 500). The woff2 files are
// committed in app/fonts (OFL, from @fontsource 5.3.0), so builds never fetch from the network.
// Glyphs Plex lacks (← → ●) fall back to system-ui instead of next/font's metric fallback.
const sans = localFont({
  src: [
    { path: "./fonts/ibm-plex-sans-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/ibm-plex-sans-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/ibm-plex-sans-latin-600-normal.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-sans",
  adjustFontFallback: false,
  fallback: ["system-ui", "sans-serif"],
});

export const metadata: Metadata = {
  title: BRAND,
  description: "Pay-as-you-go private USDC payments on an Avalanche L1",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={sans.variable}>
      <body>
        <AuthProvider>
          <SessionProvider>{children}</SessionProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
