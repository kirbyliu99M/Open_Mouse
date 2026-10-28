import "server-only";
import type { Metadata } from "next";
import { pageMetadata, type PageMetaInput } from "@/lib/seo";
import { getLocale, getUrlLocale } from "@/server/i18n/getLocale";

/**
 * `pageMetadata` for the current request: the locale and the URL's locale
 * are read here, the page passes its path and words (`copy(locale)`).
 */
export async function requestPageMetadata(
  build: (
    locale: PageMetaInput["locale"],
  ) => Omit<PageMetaInput, "locale" | "urlLocale">,
): Promise<Metadata> {
  const [locale, urlLocale] = await Promise.all([getLocale(), getUrlLocale()]);
  return pageMetadata({ ...build(locale), locale, urlLocale });
}
