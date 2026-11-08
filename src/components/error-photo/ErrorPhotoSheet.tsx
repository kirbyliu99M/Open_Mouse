"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useModalDialog } from "@/app/account/modal";
import type { Locale } from "@/lib/contracts/locale";
import { DELETE_PHOTO_HREF, errorPhotoCopy } from "@/lib/copy/error-photo";
import type {
  ErrorPhotoMode,
  PreparedErrorPhoto,
} from "@/client/error-photo/prepare";
import {
  buildErrorPhotoMeta,
  parseExpectedCm,
  sendErrorPhoto,
  type ErrorPhotoMetaInput,
} from "@/client/error-photo/send";
import "./error-photo.css";

type Phase =
  | { readonly kind: "form" }
  | { readonly kind: "sending" }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "sent"; readonly code: string };

/**
 * The consent sheet of the error photo (candidate 未拍板; contract
 * src/lib/contracts/error-photo.ts). Reached only through the lazy
 * ErrorPhotoAction (flag on). A native modal `<dialog>` in a portal: the page
 * behind is inert, so focus stays in it. It shows EXACTLY the prepared copy
 * that will be sent, the notice, a consent checkbox the send waits for, and,
 * for "numbers look wrong?", two optional typed values (checked on blur and
 * on send). Esc / back closes it before sending; while sending, and once the
 * deletion code is shown, only 「完成」 closes it (review F2), so the code is
 * never lost to a stray gesture. Nothing is sent before 傳送; nothing is
 * stored on the device; the code is shown once and never logged.
 */
export function ErrorPhotoSheet({
  locale,
  photo,
  mode,
  meta,
  leaving,
  returnFocusTo,
  onClose,
}: {
  readonly locale: Locale;
  readonly photo: PreparedErrorPhoto;
  readonly mode: ErrorPhotoMode;
  /** Everything but the size (from `photo`) and the typed values (asked here). */
  readonly meta: Omit<ErrorPhotoMetaInput, "widthPx" | "heightPx" | "expected">;
  /** Sliding out (useLeaving): inert, then unmounted by the owner. */
  readonly leaving: boolean;
  /** The link that opened it (iOS Safari does not focus a tapped button). */
  readonly returnFocusTo: () => HTMLElement | null;
  readonly onClose: () => void;
}) {
  const copy = errorPhotoCopy(locale);
  const titleId = useId();
  const lengthId = useId();
  const widthId = useId();
  const numbersErrorId = useId();
  const consentId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const sendRef = useRef<HTMLButtonElement>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "form" });
  const [consent, setConsent] = useState(false);
  const [lengthCm, setLengthCm] = useState("");
  const [widthCm, setWidthCm] = useState("");
  const [checked, setChecked] = useState({ length: false, width: false });
  const [copied, setCopied] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const sending = phase.kind === "sending";
  const sent = phase.kind === "sent";
  // Esc / back close the sheet only before a send (review F2).
  const closableRef = useRef(true);
  closableRef.current = !sending && !sent;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const {
    dialogRef,
    onCancel,
    onClose: onDialogClosed,
  } = useModalDialog({
    onClose: () => {
      if (closableRef.current) closeRef.current();
    },
    initialFocus: titleRef,
    returnFocusTo,
  });

  // The preview is the very bytes that will be sent (review F8: made and
  // revoked by one effect, so a StrictMode double run cannot revoke a live URL).
  useEffect(() => {
    const url = URL.createObjectURL(photo.jpeg);
    setPreviewUrl(url);
    return () => {
      URL.revokeObjectURL(url);
      setPreviewUrl(null);
    };
  }, [photo]);

  // Review F6: the new title takes focus once sent; a failed send goes back
  // to the send button.
  useEffect(() => {
    if (phase.kind === "sent") titleRef.current?.focus();
    if (phase.kind === "failed") sendRef.current?.focus();
  }, [phase.kind]);

  const asksNumbers = meta.trigger === "numbers-wrong";
  const length = asksNumbers ? parseExpectedCm(lengthCm) : null;
  const width = asksNumbers ? parseExpectedCm(widthCm) : null;
  const lengthShownInvalid = checked.length && length === "invalid";
  const widthShownInvalid = checked.width && width === "invalid";
  const numbersError = lengthShownInvalid || widthShownInvalid;

  async function send() {
    if (!consent || sending || sent) return;
    if (asksNumbers && (length === "invalid" || width === "invalid")) {
      setChecked({ length: true, width: true });
      document
        .getElementById(length === "invalid" ? lengthId : widthId)
        ?.focus();
      return;
    }
    const built = buildErrorPhotoMeta({
      ...meta,
      ...(asksNumbers
        ? {
            expected: {
              ...(typeof length === "number" ? { handLengthMm: length } : {}),
              ...(typeof width === "number" ? { palmWidthMm: width } : {}),
            },
          }
        : {}),
      widthPx: photo.widthPx,
      heightPx: photo.heightPx,
    });
    if (!built) {
      setPhase({ kind: "failed", message: copy.failGeneric });
      return;
    }
    setPhase({ kind: "sending" });
    const outcome = await sendErrorPhoto(photo.jpeg, built);
    if (outcome.ok) {
      setPhase({ kind: "sent", code: outcome.deleteCode });
      return;
    }
    setPhase({
      kind: "failed",
      message:
        outcome.reason === "too-many"
          ? copy.failTooMany
          : outcome.reason === "unavailable"
            ? copy.failUnavailable
            : copy.failGeneric,
    });
  }

  async function copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      // No clipboard (permission, an old browser): the code stays selectable.
      setCopied(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="errorPhotoSheet"
      aria-labelledby={titleId}
      data-testid="error-photo-sheet"
      data-leaving={leaving ? "true" : undefined}
      inert={leaving}
      aria-hidden={leaving || undefined}
      onCancel={(event) => {
        event.preventDefault();
        if (closableRef.current) onCancel(event);
      }}
      onClose={() => {
        // A browser that closes a modal regardless of a prevented cancel (a
        // repeated back gesture): once the code is shown, open it again.
        const dialog = dialogRef.current;
        if (!dialog || dialog.open || leaving) return;
        if (closableRef.current) {
          onDialogClosed();
        } else {
          try {
            dialog.showModal();
          } catch {
            // Detached or not allowed: nothing more to do.
          }
        }
      }}
    >
      <h2 className="errorPhotoTitle" id={titleId} ref={titleRef} tabIndex={-1}>
        {sent ? copy.sentTitle : copy.title}
      </h2>
      {phase.kind === "sent" ? (
        <>
          <p className="errorPhotoSuccess">
            {copy.successBefore}
            <strong className="errorPhotoCode" data-testid="error-photo-code">
              {phase.code}
            </strong>
            {copy.successMiddle}
            <a href={DELETE_PHOTO_HREF} target="_blank" rel="noopener">
              {copy.successLink}
            </a>
            {copy.successAfter}
          </p>
          <div className="errorPhotoActions">
            <button
              type="button"
              className="errorPhotoCancel"
              onClick={() => void copyCode(phase.code)}
            >
              {copy.copyCode}
            </button>
            <button
              type="button"
              className="errorPhotoPrimary"
              onClick={() => onClose()}
            >
              {copy.done}
            </button>
          </div>
          <p className="errorPhotoStatus" role="status" aria-live="polite">
            {copied ? copy.copied : ""}
          </p>
        </>
      ) : (
        <>
          {previewUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- a blob: URL of the prepared copy, not an asset
            <img
              className="errorPhotoPreview"
              src={previewUrl}
              alt={copy.previewAlt}
              width={photo.widthPx}
              height={photo.heightPx}
            />
          )}
          <ul className="errorPhotoPoints">
            {copy.points.map((point) => (
              <li key={point}>{point}</li>
            ))}
            {mode === "paper" && <li>{copy.paperModeNote}</li>}
          </ul>
          {asksNumbers && (
            <fieldset className="errorPhotoNumbers" disabled={sending}>
              <legend>{copy.expectedHeading}</legend>
              <div className="errorPhotoNumberRow">
                <label htmlFor={lengthId}>{copy.expectedLength}</label>
                <input
                  id={lengthId}
                  inputMode="decimal"
                  autoComplete="off"
                  value={lengthCm}
                  aria-invalid={lengthShownInvalid || undefined}
                  aria-describedby={
                    lengthShownInvalid ? numbersErrorId : undefined
                  }
                  onChange={(e) => setLengthCm(e.target.value)}
                  onBlur={() => setChecked((c) => ({ ...c, length: true }))}
                />
              </div>
              <div className="errorPhotoNumberRow">
                <label htmlFor={widthId}>{copy.expectedWidth}</label>
                <input
                  id={widthId}
                  inputMode="decimal"
                  autoComplete="off"
                  value={widthCm}
                  aria-invalid={widthShownInvalid || undefined}
                  aria-describedby={
                    widthShownInvalid ? numbersErrorId : undefined
                  }
                  onChange={(e) => setWidthCm(e.target.value)}
                  onBlur={() => setChecked((c) => ({ ...c, width: true }))}
                />
              </div>
              {numbersError && (
                <p id={numbersErrorId} className="errorPhotoError">
                  {copy.expectedInvalid}
                </p>
              )}
            </fieldset>
          )}
          <div className="errorPhotoConsent">
            <input
              id={consentId}
              type="checkbox"
              checked={consent}
              disabled={sending}
              onChange={(e) => setConsent(e.target.checked)}
            />
            <label htmlFor={consentId}>{copy.checkbox}</label>
          </div>
          <p className="errorPhotoStatus" role="status" aria-live="polite">
            {sending ? copy.sending : ""}
          </p>
          {phase.kind === "failed" && (
            <p className="errorPhotoError" role="alert">
              {phase.message}
            </p>
          )}
          <div className="errorPhotoActions">
            <button
              type="button"
              className="errorPhotoCancel"
              disabled={sending}
              onClick={() => onClose()}
            >
              {copy.cancel}
            </button>
            <button
              ref={sendRef}
              type="button"
              className="errorPhotoPrimary"
              disabled={!consent || sending}
              data-testid="error-photo-send"
              onClick={() => void send()}
            >
              {sending ? copy.sending : copy.send}
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}
