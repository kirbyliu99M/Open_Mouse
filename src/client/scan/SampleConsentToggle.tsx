"use client";

/**
 * The "keep these numbers anonymously" switch (contract:
 * src/lib/contracts/hand-sample.ts, candidate, 未拍板), placed right above the
 * button that sends a scan on every screen that sends one. ON by default;
 * the person's OFF choice is remembered on this device (`sampleConsent.ts`).
 *
 * Mounting tells the screen's `useScanSubmit` that the notice is on screen
 * (`notice()`), and unmounting takes that back: the submission asks for
 * the anonymous copy only while this is visible and on.
 *
 * Accessibility: a native button with `role="switch"` and `aria-checked`,
 * named by the visible label and described by the note; a 44 px tall hit
 * area; the privacy link opens in a new tab so the scan on screen is not lost.
 */
import { useEffect, useId } from "react";
import { useLocale } from "../i18n/LocaleProvider";
import { handSampleCopy } from "../../lib/copy/hand-sample";
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
  const words = handSampleCopy(useLocale());
  const [on, setOn] = useSampleConsent();
  const id = useId();
  const labelId = `${id}-label`;
  const noteId = `${id}-note`;

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
          aria-describedby={noteId}
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
      <p id={noteId} className="sampleConsentNote">
        {words.note}{" "}
        <a href="/privacy" target="_blank" rel="noopener">
          {words.privacyLink}
        </a>
      </p>
    </div>
  );
}
