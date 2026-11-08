"use client";

/**
 * The "keep an unnamed copy" switch (contract:
 * src/lib/contracts/hand-sample.ts, candidate, 未拍板), placed right above the
 * button that sends a scan on every screen that sends one. ON by default;
 * the person's OFF choice is remembered on this device (`sampleConsent.ts`).
 *
 * Two layers (review round 1 of #240): the label, one short sentence and
 * 「詳細說明」 are always shown; the details, with the privacy link, open under
 * them. Mounting this first layer tells the screen's `useScanSubmit` that the
 * notice is on screen (`notice()`), and unmounting takes that back: the
 * submission asks for the copy only while this is visible and on.
 *
 * Accessibility: a native button with `role="switch"` and `aria-checked`,
 * named by the visible label and described by the short sentence; the
 * details button has `aria-expanded` / `aria-controls`; both are 44 px tall.
 * The privacy link opens in a new tab, so the scan on screen is not lost, and
 * says so to a screen reader.
 */
import { useEffect, useId, useState } from "react";
import { useLocale } from "../i18n/LocaleProvider";
import { handSampleCopy } from "../../lib/copy/hand-sample";
import { localizedPath } from "../../lib/i18n/localePath";
import { useSampleConsent } from "./sampleConsent";
import type { SampleNoticeBinding } from "./useScanSubmit";
import "./sample-consent.css";

export interface SampleConsentToggleProps {
  /** From the `useScanSubmit` that sends the scan on this screen. */
  readonly notice: SampleNoticeBinding;
  /** The scan is being sent: the switch can no longer change what is sent. */
  readonly disabled?: boolean;
}

export function SampleConsentToggle({
  notice,
  disabled = false,
}: SampleConsentToggleProps) {
  const locale = useLocale();
  const words = handSampleCopy(locale);
  const [on, setOn] = useSampleConsent();
  const [open, setOpen] = useState(false);
  const id = useId();
  const labelId = `${id}-label`;
  const shortId = `${id}-short`;
  const detailsId = `${id}-details`;

  useEffect(() => notice(), [notice]);

  return (
    <div className="sampleConsent" data-testid="sample-consent">
      <div className="sampleConsentRow">
        <label
          id={labelId}
          htmlFor={`${id}-switch`}
          className="sampleConsentLabel"
        >
          {words.label}
        </label>
        <button
          id={`${id}-switch`}
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby={labelId}
          aria-describedby={shortId}
          className="sampleConsentSwitch"
          disabled={disabled}
          onClick={() => setOn(!on)}
          data-testid="sample-consent-switch"
        >
          <span className="sampleConsentTrack" aria-hidden="true">
            <span className="sampleConsentThumb" />
          </span>
        </button>
      </div>
      <p className="sampleConsentShort">
        <span id={shortId}>{words.short}</span>{" "}
        <button
          type="button"
          className="sampleConsentMore"
          aria-expanded={open}
          aria-controls={detailsId}
          onClick={() => setOpen((v) => !v)}
          data-testid="sample-consent-details-toggle"
        >
          {words.detailsToggle}
        </button>
      </p>
      <p
        id={detailsId}
        className="sampleConsentDetails"
        hidden={!open}
        data-testid="sample-consent-details"
      >
        {words.details}{" "}
        <a
          href={localizedPath("/privacy", locale)}
          target="_blank"
          rel="noopener"
        >
          {words.privacyLink}
          <span className="sampleConsentSr">{words.opensNewTab}</span>
        </a>
      </p>
    </div>
  );
}
