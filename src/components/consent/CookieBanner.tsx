"use client";

import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { ga4Configured } from "@/client/analytics/ga4";
import { LeaveShield } from "@/client/camera/LeaveShield";
import {
  setConsent,
  useConsent,
  useConsentReopened,
} from "@/client/consent/consent";
import { useLocale } from "@/client/i18n/LocaleProvider";
import { reducedMotionNow } from "@/components/motion/Presence";
import { showsSiteFooter } from "@/components/SiteFooter";
import { cookieConsentCopy } from "@/lib/copy/cookie-consent";
import { leaveMs } from "@/lib/motion";
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
 * It comes in the way it leaves (V3.2 motion pass #27, candidate / 未拍板):
 * up from the bottom edge with a fade over --motion-sheet-in, and after an
 * answer back down over --motion-sheet-out (`leaveMs("sheet")`) instead of
 * vanishing (Kirby, 2026-10-25: it was not smooth), showing what it showed
 * until gone. Reduced motion: a --motion-reduced fade both ways.
 */
export function CookieBanner() {
  const pathname = usePathname();
  const locale = useLocale();
  const consent = useConsent();
  const reopened = useConsentReopened();
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const [, drop] = useState(0);
  // False for the first frames of a showing: the strip is drawn below the
  // edge (data-state "entering") and then moves up, by the same transition
  // that takes it down. A frame later is enough for the browser to have the
  // start; two make sure it was painted.
  const [entered, setEntered] = useState(false);
  // What the strip last showed, for the exit; null once it is gone.
  const last = useRef<{ consent: typeof consent; open: boolean } | null>(null);
  const stripRef = useRef<HTMLElement>(null);
  const shown =
    ga4Configured() &&
    showsSiteFooter(pathname) &&
    // `unknown` is the server render: nothing, so a returning visitor never sees a flash.
    consent !== "unknown" &&
    (consent === "unset" || reopened);
  useEffect(() => {
    if (shown) {
      last.current = { consent, open };
      return;
    }
    if (!last.current) return;
    // An answer was just given: keep the strip for the exit, then drop it.
    const timer = window.setTimeout(
      () => {
        last.current = null;
        setEntered(false);
        drop((n) => n + 1);
      },
      leaveMs("sheet", reducedMotionNow()),
    );
    return () => window.clearTimeout(timer);
  }, [shown, consent, open]);
  useEffect(() => {
    if (!shown || entered) return;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setEntered(true));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [shown, entered]);
  // Not shown and nothing to animate out: render nothing.
  if (!shown && !last.current) return null;
  // While it leaves it keeps the text and buttons of its last open state.
  const view = shown ? { consent, open } : (last.current ?? { consent, open });
  const copy = cookieConsentCopy(locale);
  // The first time, Decline appears once the details are open (Kirby,
  // 2026-10-24). Reopened from the footer it is always there: someone who
  // accepted must be able to take it back without hunting for it.
  const showDecline = view.open || view.consent !== "unset";
  // One toggle, drawn twice: at the end of the sentence on a phone, and left of
  // Accept from 40rem up (Kirby, 2026-10-24). CSS shows one; the other is
  // display:none, so only one is ever in the accessibility tree.
  const detailsButton = (className: string) => (
    <button
      type="button"
      className={className}
      aria-expanded={view.open}
      aria-controls={detailsId}
      onClick={() => setOpen((value) => !value)}
    >
      {copy.detailsToggle}
    </button>
  );

  return (
    <>
      <section
        ref={stripRef}
        className="cookieBanner"
        role="region"
        aria-label={copy.regionLabel}
        data-testid="cookie-banner"
        data-state={shown ? (entered ? "open" : "entering") : "closing"}
        inert={!shown}
        aria-hidden={!shown ? true : undefined}
      >
        <div className="cookieBanner-inner">
          <div className="cookieBanner-text">
            <p className="cookieBanner-sentence">
              {copy.text}
              <span className="cookieBanner-tail">
                {copy.textEnd}{" "}
                {detailsButton("cookieBanner-link cookieBanner-link--inline")}
              </span>
            </p>
            {view.consent !== "unset" ? (
              <p className="cookieBanner-current" data-testid="cookie-current">
                {view.consent === "granted"
                  ? copy.currentGranted
                  : copy.currentDenied}
              </p>
            ) : null}
          </div>
          {detailsButton("cookieBanner-link cookieBanner-link--beside")}
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
          {view.open ? (
            <p id={detailsId} className="cookieBanner-details">
              {copy.details}
            </p>
          ) : null}
        </div>
      </section>
      {/* While it goes down, a second tap on Accept or Decline stops here
        instead of reaching the page under it (LeaveShield.tsx). */}
      {!shown && <LeaveShield target={stripRef} />}
    </>
  );
}
