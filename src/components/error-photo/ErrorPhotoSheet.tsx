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
  afterSend,
  createUploadSession,
  parseExpectedCm,
  type ErrorPhotoMetaInput,
} from "@/client/error-photo/send";
import "./error-photo.css";

type Phase =
  | { readonly kind: "form" }
  | { readonly kind: "sending" }
  | { readonly kind: "failed"; readonly message: string }
  /** No answer in time: maybe stored; the code is shown (review #241 r3). */
  | { readonly kind: "timeout"; readonly code: string }
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
 * never lost to a stray gesture. The deletion code is made on this device
 * when the sheet opens and every try sends the same code with the same bytes
 * (the server keeps one photo per code): after a timeout the code is shown
 * with the copy button, since the photo may have been stored. Nothing is
 * sent before 傳送; nothing is stored on the device; the code is never logged.
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
  // Review K4: which field errors are shown changes only on blur and on
  // send, never while typing, so the alert region speaks only then.
  const [shownErrors, setShownErrors] = useState({
    length: false,
    width: false,
  });
  // One code for this sheet, made on the device (review #241 round 3).
  const [upload] = useState(() => createUploadSession(photo.jpeg));
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const sending = phase.kind === "sending";
  const sent = phase.kind === "sent";
  // Esc / back close the sheet only while no code has been shown (review F2);
  // 不用了 and 完成 always can.
  const closableRef = useRef(true);
  closableRef.current = !sending && !sent && phase.kind !== "timeout";
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
    if (phase.kind === "failed" || phase.kind === "timeout")
      sendRef.current?.focus();
  }, [phase.kind]);

  const asksNumbers = meta.trigger === "numbers-wrong";
  const length = asksNumbers ? parseExpectedCm(lengthCm) : null;
  const width = asksNumbers ? parseExpectedCm(widthCm) : null;
  const lengthShownInvalid = asksNumbers && shownErrors.length;
  const widthShownInvalid = asksNumbers && shownErrors.width;
  // Review H5: the message names the field(s); its container is always there
  // (role="alert"), so a blur error is announced.
  const numbersError = [
    lengthShownInvalid ? copy.expectedLengthInvalid : "",
    widthShownInvalid ? copy.expectedWidthInvalid : "",
  ]
    .filter(Boolean)
    .join(" ");

  async function send() {
    if (!consent || sending || sent) return;
    if (asksNumbers) {
      setShownErrors({
        length: length === "invalid",
        width: width === "invalid",
      });
    }
    if (asksNumbers && (length === "invalid" || width === "invalid")) {
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
    const next = afterSend(await upload.send(built));
    if (next.kind !== "failed") {
      setPhase(next);
      return;
    }
    setPhase({
      kind: "failed",
      message:
        next.reason === "too-many"
          ? copy.failTooMany
          : next.reason === "unavailable"
            ? copy.failUnavailable
            : copy.failGeneric,
    });
  }
  const copyStatus =
    copyState === "copied"
      ? copy.copied
      : copyState === "failed"
        ? copy.copyFailed
        : "";

  async function copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopyState("copied");
    } catch {
      // No clipboard (permission, an old browser): say so; the code stays
      // selectable (user-select: all) and can be screenshotted (review H6).
      setCopyState("failed");
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
            {copyStatus}
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
                  onBlur={() =>
                    setShownErrors((e) => ({
                      ...e,
                      length: parseExpectedCm(lengthCm) === "invalid",
                    }))
                  }
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
                  onBlur={() =>
                    setShownErrors((e) => ({
                      ...e,
                      width: parseExpectedCm(widthCm) === "invalid",
                    }))
                  }
                />
              </div>
              <p
                id={numbersErrorId}
                className="errorPhotoError errorPhotoFieldError"
                role="alert"
              >
                {numbersError}
              </p>
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
          {phase.kind === "timeout" && (
            <div className="errorPhotoTimeout">
              <p className="errorPhotoError" role="alert">
                {copy.failTimeoutBefore}
                <strong
                  className="errorPhotoCode"
                  data-testid="error-photo-timeout-code"
                >
                  {phase.code}
                </strong>
                {copy.failTimeoutAfter}
              </p>
              <button
                type="button"
                className="errorPhotoCancel"
                onClick={() => void copyCode(phase.code)}
              >
                {copy.copyCode}
              </button>
              <p className="errorPhotoStatus" role="status" aria-live="polite">
                {copyStatus}
              </p>
            </div>
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
