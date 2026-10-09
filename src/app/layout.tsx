import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AnalyticsProvider } from "@/client/analytics/AnalyticsProvider";
import { SiteFooter } from "@/components/SiteFooter";
import { SITE_NAME } from "@/lib/site";
import "./tokens.css";
import "./globals.css";

export const metadata: Metadata = {
  // Each page gives its own title; the template adds the site name after it.
  // The home page has none, so it shows the default.
  title: { default: SITE_NAME, template: `%s · ${SITE_NAME}` },
  description: "Finding a mouse that fits your hand. Currently in development.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AnalyticsProvider />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
