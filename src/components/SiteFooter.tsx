"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import {
  pickUiLanguage,
  uiLangAttribute,
  type UiLanguage,
} from "@/client/uiLanguage";
import {
  NON_AFFILIATION_STATEMENT,
  siteFooterCopy,
} from "@/lib/copy/site-footer";
import { GITHUB_URL, SITE_NAME } from "@/lib/site";
import "./site-footer.css";

/**
 * Pages that bring their own full-page layout and so get no footer: the
 * learning-kit and sheet print pages (each is a stack of A4 pages and a
 * footer would print on or after them) and the capture flow (a full-screen
 * camera). Matches the path and everything under it.
 */
const NO_FOOTER_PREFIXES = ["/learn/print", "/learn/slates", "/sheet", "/scan"];

export function showsSiteFooter(pathname: string | null): boolean {
  if (pathname === null) return true;
  return !NO_FOOTER_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function subscribeToLanguage(onChange: () => void): () => void {
  window.addEventListener("languagechange", onChange);
  return () => window.removeEventListener("languagechange", onChange);
}

/**
 * The root layout serves static routes, so the language is not known on the
 * server (no `headers()`, no `cookies()`): the server and the first client
 * render are English, and a Chinese-preferring browser switches to zh-TW right
 * after hydration.
 */
function useUiLanguage(): UiLanguage {
  return useSyncExternalStore<UiLanguage>(
    subscribeToLanguage,
    () => pickUiLanguage(navigator.languages, navigator.language),
    () => "en",
  );
}

export function SiteFooter() {
  const pathname = usePathname();
  const lang = useUiLanguage();
  if (!showsSiteFooter(pathname)) return null;
  const copy = siteFooterCopy(lang);
  const langAttr = uiLangAttribute(lang);

  return (
    <footer className="siteFooter" data-testid="site-footer">
      <div className="siteFooter-inner">
        <p className="siteFooter-name">{SITE_NAME}</p>
        <nav
          className="siteFooter-links"
          aria-label={copy.linksLabel}
          lang={langAttr}
        >
          <Link href="/how-it-works">{copy.howItWorks}</Link>
          <Link href="/how-it-works#privacy">{copy.privacy}</Link>
          <Link href="/account">{copy.account}</Link>
          <a href={GITHUB_URL} rel="noopener noreferrer">
            {copy.github}
          </a>
        </nav>
        {/* Kirby has not written the real statement yet, so this is the home
            page's wording unchanged, in English whatever the language. */}
        <p className="siteFooter-statement">{NON_AFFILIATION_STATEMENT}</p>
        <p className="siteFooter-preview" lang={langAttr}>
          {copy.preview}
        </p>
      </div>
    </footer>
  );
}
