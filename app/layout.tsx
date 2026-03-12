import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import "./globals.css";

const mono = Geist_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Den Outdoors — Retreat Planner",
  description: "3D parametric retreat home planner with Japandi design principles",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${mono.variable} font-mono antialiased bg-[#faf8f5] text-stone-800`}>
        {children}
      </body>
    </html>
  );
}
