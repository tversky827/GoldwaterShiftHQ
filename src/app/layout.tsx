import "./globals.css";
import type { ReactNode } from "react";

export const metadata = { title: "GoldwaterShiftHQ", description: "SNF Workforce scheduling platform" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="top">
          <strong>GoldwaterShiftHQ</strong>
          <a href="/admin/integrations">Integrations</a>
          <a href="/admin/integrations/reconciliation">Reconciliation &amp; exceptions</a>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
