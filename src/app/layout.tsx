import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppShell } from "@/components/layout/AppShell";

export const metadata: Metadata = {
  title: "DENJEH AI — Autonomous Multi-Agent Creative Studio",
  description:
    "Platform produksi kreatif otonom berbasis multi-agen AI di cloud. Ringan, modular, dan siap untuk desktop maupun mobile.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "DENJEH AI",
  },
};

export const viewport: Viewport = {
  themeColor: "#060B19",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id" className="dark" suppressHydrationWarning>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}