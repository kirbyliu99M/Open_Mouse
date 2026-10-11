"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore, type ReactNode } from "react";
import {
  pickUiLanguage,
  uiLangAttribute,
  type UiLanguage,
} from "@/client/uiLanguage";
import { FOOTER_HEADLINE, siteFooterCopy } from "@/lib/copy/site-footer";
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

type IconName = "camera" | "book" | "workflow" | "shield" | "user" | "branch";

/**
 * 16 px line icons (1.75 px stroke, `currentColor`), drawn for this footer.
 * There is no icon package in the repo and none was added; the shapes are
 * plain geometry, not copied from an icon set. Decorative: the link's text
 * names it.
 */
const ICONS: Record<IconName, ReactNode> = {
  camera: (
    <>
      <path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
      <circle cx="12" cy="13" r="3.5" />
    </>
  ),
  book: (
    <>
      <path d="M2 5.5c3-1 7-1 10 1 3-2 7-2 10-1V18c-3-1-7-1-10 1-3-2-7-2-10-1z" />
      <path d="M12 6.5V19" />
    </>
  ),
  workflow: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
      <path d="M6.5 10v4a3 3 0 0 0 3 3H14" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3l8 3v6c0 4.5-3.2 7.8-8 9-4.8-1.2-8-4.5-8-9V6z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 3.6-6 8-6s8 2 8 6" />
    </>
  ),
  branch: (
    <>
      <circle cx="6" cy="5.5" r="2.5" />
      <circle cx="6" cy="18.5" r="2.5" />
      <circle cx="18" cy="9" r="2.5" />
      <path d="M6 8v8M18 11.5c0 3-3 4.5-8 5" />
    </>
  ),
};

function FooterIcon({ name }: { name: IconName }) {
  return (
    <svg
      className="siteFooter-icon"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICONS[name]}
    </svg>
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
      {/* The fade in from the page above, and the horizon line with the glow
          under it. Real elements, not pseudo-elements: axe cannot work out the
          text colour behind a positioned pseudo-element of the footer. */}
      <div className="siteFooter-fade" aria-hidden="true" />
      <div className="siteFooter-horizon" aria-hidden="true" />
      {/* Empty mount point for the star field and meteors (a later PR). */}
      <div
        className="siteFooter-backdrop"
        data-testid="site-footer-backdrop"
        aria-hidden="true"
      />
      <div className="siteFooter-inner">
        <div className="siteFooter-brand">
          <p className="siteFooter-name">{SITE_NAME}</p>
          <p className="siteFooter-headline">{FOOTER_HEADLINE}</p>
        </div>
        <div className="siteFooter-mark" aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element -- our own fixed SVG mark, no next/image config needed */}
          <img
            src="/images/brand/palmate-mark.svg"
            alt=""
            width={220}
            height={220}
          />
        </div>
        <nav
          className="siteFooter-groups"
          aria-label={copy.linksLabel}
          lang={langAttr}
        >
          <div className="siteFooter-group siteFooter-group--product">
            <h2 id="siteFooter-h-product" className="siteFooter-groupTitle">
              {copy.groupProduct}
            </h2>
            <ul aria-labelledby="siteFooter-h-product">
              <li>
                <Link href="/scan/easy">
                  <FooterIcon name="camera" />
                  {copy.scan}
                </Link>
              </li>
              <li>
                <Link href="/learn">
                  <FooterIcon name="book" />
                  {copy.learn}
                </Link>
              </li>
            </ul>
          </div>
          <div className="siteFooter-group siteFooter-group--trust">
            <h2 id="siteFooter-h-trust" className="siteFooter-groupTitle">
              {copy.groupTrust}
            </h2>
            <ul aria-labelledby="siteFooter-h-trust">
              <li>
                <Link href="/how-it-works">
                  <FooterIcon name="workflow" />
                  {copy.howItWorks}
                </Link>
              </li>
              <li>
                <Link href="/how-it-works#privacy">
                  <FooterIcon name="shield" />
                  {copy.privacy}
                </Link>
              </li>
            </ul>
          </div>
          {/* On a phone this group is its own row under a divider, Account on
              the left and GitHub on the right (Kirby, 2026-10-10). */}
          <div className="siteFooter-group siteFooter-group--project">
            <h2 id="siteFooter-h-project" className="siteFooter-groupTitle">
              {copy.groupProject}
            </h2>
            <ul aria-labelledby="siteFooter-h-project">
              <li>
                <Link href="/account">
                  <FooterIcon name="user" />
                  {copy.account}
                </Link>
              </li>
              <li>
                <a href={GITHUB_URL} rel="noopener noreferrer">
                  <FooterIcon name="branch" />
                  {copy.github}
                </a>
              </li>
            </ul>
          </div>
        </nav>
      </div>
    </footer>
  );
}
