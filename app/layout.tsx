import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import "./globals.css";

const mono = Geist_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Den Outdoors — Modular Component Planner",
  description: "3D modular building components for Den Outdoors homes",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${mono.variable} font-mono antialiased bg-neutral-950 text-neutral-100`}>
        {children}
      </body>
    </html>
  );
}
