"use client";

import { usePathname } from "next/navigation";
import { useId, useState } from "react";
import { ga4Configured } from "@/client/analytics/ga4";
import {
  setConsent,
  useConsent,
  useConsentReopened,
} from "@/client/consent/consent";
import { useLocale } from "@/client/i18n/LocaleProvider";
import { showsSiteFooter } from "@/components/SiteFooter";
import { cookieConsentCopy } from "@/lib/copy/cookie-consent";
import "./cookie-banner.css";

/**
 * The cookie question, for GA4 only: a quiet glass strip across the bottom, in
 * the site's own tokens, laid out like Sony Taiwan's (Kirby, 2026-10-24): one
 * sentence on the left, the answers on the right, one row, a fixed content
 * width. The sentence ends in a "details" link that opens the full statement;
 * the answers are the same outline pill, Accept on the left. At first only
 * Accept shows, and Decline joins it when the details are opened (always, when
 * reopened from the footer). Shown until a choice is made (and again when the
 * footer reopens it), never on the pages that bring their own full-page layout
 * (the camera, the print pages), and never when no GA4 ID is configured, since
 * there is then nothing to ask about. Ignoring the banner loads nothing: GA4
 * starts only on Accept. Neither answer is pre-selected. It does not take focus.
 */
export function CookieBanner() {
  const pathname = usePathname();
  const locale = useLocale();
  const consent = useConsent();
  const reopened = useConsentReopened();
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  if (!ga4Configured() || !showsSiteFooter(pathname)) return null;
  // `unknown` is the server render: nothing, so a returning visitor never sees a flash.
  if (consent === "unknown") return null;
  if (consent !== "unset" && !reopened) return null;
  const copy = cookieConsentCopy(locale);
  // The first time, Decline appears once the details are open (Kirby,
  // 2026-10-24). Reopened from the footer it is always there: someone who
  // accepted must be able to take it back without hunting for it.
  const showDecline = open || consent !== "unset";

  return (
    <section
      className="cookieBanner"
      role="region"
      aria-label={copy.regionLabel}
      data-testid="cookie-banner"
    >
      <div className="cookieBanner-inner">
        <div className="cookieBanner-text">
          <p className="cookieBanner-sentence">
            {copy.text}
            <span className="cookieBanner-tail">
              {copy.textEnd}{" "}
              <button
                type="button"
                className="cookieBanner-link"
                aria-expanded={open}
                aria-controls={detailsId}
                onClick={() => setOpen((value) => !value)}
              >
                {copy.detailsToggle}
              </button>
            </span>
          </p>
          {consent !== "unset" ? (
            <p className="cookieBanner-current" data-testid="cookie-current">
              {consent === "granted" ? copy.currentGranted : copy.currentDenied}
            </p>
          ) : null}
        </div>
        <div className="cookieBanner-actions">
          <button
            type="button"
            className="cookieBanner-button"
            onClick={() => setConsent("granted")}
          >
            {copy.accept}
          </button>
          {showDecline ? (
            <button
              type="button"
              className="cookieBanner-button"
              onClick={() => setConsent("denied")}
            >
              {copy.decline}
            </button>
          ) : null}
        </div>
        {open ? (
          <p id={detailsId} className="cookieBanner-details">
            {copy.details}
          </p>
        ) : null}
      </div>
    </section>
  );
}
