import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AnalyticsProvider } from "@/client/analytics/AnalyticsProvider";
import { SiteFooter } from "@/components/SiteFooter";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import "./tokens.css";
import "./globals.css";

/** The same sentence as `description` below, for the share cards. */
const SHARE_DESCRIPTION =
  "Finding a mouse that fits your hand. Currently in development.";

export const metadata: Metadata = {
  // Each page gives its own title; the template adds the site name after it.
  // The home page has none, so it shows the default.
  title: { default: SITE_NAME, template: `%s · ${SITE_NAME}` },
  description: "Finding a mouse that fits your hand. Currently in development.",
  robots: { index: false, follow: false },

  // Share previews. The images come from the file convention in this folder
  // (icon.png, apple-icon.png, opengraph-image.png, twitter-image.png), so no
  // image URL is written here; `metadataBase` makes them absolute URLs.
  metadataBase: new URL(SITE_URL),
  openGraph: {
    title: SITE_NAME,
    siteName: SITE_NAME,
    type: "website",
    description: SHARE_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_NAME,
    description: SHARE_DESCRIPTION,
  },
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
