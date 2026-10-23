import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AnalyticsProvider } from "@/client/analytics/AnalyticsProvider";
import { LocaleProvider } from "@/client/i18n/LocaleProvider";
import { CookieBanner } from "@/components/consent/CookieBanner";
import { SiteFooter } from "@/components/SiteFooter";
import { siteMetaCopy } from "@/lib/copy/site-meta";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { getLocale } from "@/server/i18n/getLocale";
import { brandFont } from "./brand-font";
import "./tokens.css";
import "./globals.css";

/** The description is one sentence per locale, for the page and both share cards. */
export async function generateMetadata(): Promise<Metadata> {
  const description = siteMetaCopy(await getLocale()).description;
  return {
    // Each page gives its own title; the template adds the site name after it.
    // The home page has none, so it shows the default.
    title: { default: SITE_NAME, template: `%s · ${SITE_NAME}` },
    description,
    robots: { index: false, follow: false },

    // Share previews. The images come from the file convention in this folder
    // (icon.png, apple-icon.png, opengraph-image.png, twitter-image.png), so no
    // image URL is written here; `metadataBase` makes them absolute URLs.
    metadataBase: new URL(SITE_URL),
    openGraph: {
      title: SITE_NAME,
      siteName: SITE_NAME,
      type: "website",
      description,
    },
    twitter: {
      card: "summary_large_image",
      title: SITE_NAME,
      description,
    },
  };
}

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  const locale = await getLocale();
  return (
    <html lang={locale} className={brandFont.variable}>
      <body>
        <LocaleProvider initialLocale={locale}>
          <AnalyticsProvider />
          {children}
          <SiteFooter />
          <CookieBanner />
        </LocaleProvider>
      </body>
    </html>
  );
}
