import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import "./globals.css";

import { chronos, chronosDisplay } from "./fonts";
import { AppShell } from "@/components/app-shell";
import { LiveProvider } from "@/components/live-provider";
import { ThemeProvider } from "@/components/theme-provider";

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Orbit Docs",
  description:
    "Enterprise document intelligence: upload, organize, and chat with an AI grounded in your library.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${chronos.variable} ${chronosDisplay.variable} ${geistMono.variable} antialiased`}
    >
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <LiveProvider>
            <AppShell>{children}</AppShell>
          </LiveProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
