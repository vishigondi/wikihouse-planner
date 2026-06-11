import type { Metadata } from "next";
import { Geist_Mono, Playfair_Display, Inter } from "next/font/google";
import "./globals.css";

const mono = Geist_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

const serif = Playfair_Display({
  variable: "--font-serif",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

const sans = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
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
      <body className={`${mono.variable} ${serif.variable} ${sans.variable} font-mono antialiased bg-[#faf8f5] text-stone-800`}>
        {children}
      </body>
    </html>
  );
}
