import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

// Technical typeface for the whole tool — labels, dimensions, data, chrome.
// Monospace is the drafting-table identity; everything defaults to it.
const mono = Geist_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
});

// Human-facing display typeface for headlines only (opt in via font-sans).
// A clean grotesk gives presence without breaking the technical character —
// the Geist + Geist Mono pairing the design system calls for on software UIs.
const sans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Floorplan Studio",
  description: "Prompt-to-plan generation, semantic editing, validation, and brochure export",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${mono.variable} ${sans.variable} font-mono antialiased bg-[#faf8f5] text-stone-800`}>
        {children}
      </body>
    </html>
  );
}
