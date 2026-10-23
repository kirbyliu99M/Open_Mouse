"use client";

import { usePathname } from "next/navigation";
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
 * The cookie question, for GA4 only. Shown until a choice is made (and again
 * when the footer reopens it), never on the pages that bring their own
 * full-page layout (the camera, the print pages), and never when no GA4 ID is
 * configured, since there is then nothing to ask about. Accept and Decline are
 * the same size and weight; neither is pre-selected. It does not take focus.
 */
export function CookieBanner() {
  const pathname = usePathname();
  const locale = useLocale();
  const consent = useConsent();
  const reopened = useConsentReopened();
  if (!ga4Configured() || !showsSiteFooter(pathname)) return null;
  // `unknown` is the server render: nothing, so a returning visitor never sees a flash.
  if (consent === "unknown") return null;
  if (consent !== "unset" && !reopened) return null;
  const copy = cookieConsentCopy(locale);

  return (
    <section
      className="cookieBanner"
      role="region"
      aria-label={copy.regionLabel}
      data-testid="cookie-banner"
    >
      <div className="cookieBanner-inner">
        <div className="cookieBanner-text">
          <p className="cookieBanner-title">{copy.title}</p>
          <p>{copy.body}</p>
          {consent !== "unset" ? (
            <p className="cookieBanner-current" data-testid="cookie-current">
              {consent === "granted" ? copy.currentGranted : copy.currentDenied}
            </p>
          ) : null}
          <details className="cookieBanner-details">
            <summary>{copy.detailsToggle}</summary>
            <dl>
              <dt>{copy.detailsWhatLabel}</dt>
              <dd>{copy.detailsWhat}</dd>
              <dt>{copy.detailsSentLabel}</dt>
              <dd>{copy.detailsSent}</dd>
              <dt>{copy.detailsNotLabel}</dt>
              <dd>{copy.detailsNot}</dd>
              <dt>{copy.detailsOtherLabel}</dt>
              <dd>{copy.detailsOther}</dd>
              <dt>{copy.detailsChangeLabel}</dt>
              <dd>{copy.detailsChange}</dd>
            </dl>
          </details>
        </div>
        <div className="cookieBanner-actions">
          <button
            type="button"
            className="cookieBanner-button"
            onClick={() => setConsent("denied")}
          >
            {copy.decline}
          </button>
          <button
            type="button"
            className="cookieBanner-button"
            onClick={() => setConsent("granted")}
          >
            {copy.accept}
          </button>
        </div>
      </div>
    </section>
  );
}
