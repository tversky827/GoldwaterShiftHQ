import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { ServiceWorker } from "@/components/nav-link";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "ShiftHQ", template: "%s · ShiftHQ" },
  description: "Workforce scheduling for skilled nursing facilities.",
  applicationName: "ShiftHQ",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "ShiftHQ", statusBarStyle: "default" },
  icons: { icon: "/icons/icon.svg", apple: "/icons/apple-touch-icon.png" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#f5f5f7",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
