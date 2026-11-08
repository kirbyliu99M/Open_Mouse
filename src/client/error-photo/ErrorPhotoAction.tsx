"use client";

/**
 * The error photo's entry on a scan result sheet (candidate 未拍板; contract
 * src/lib/contracts/error-photo.ts): the link, and the consent sheet it opens.
 *
 * This module, and everything it imports from the error-photo lane (offer,
 * prepare, the JPEG walker, send, the sheet, its copy and CSS), is reached
 * ONLY through a guarded `import()` in EasyScanCamera.tsx that the build
 * removes when `NEXT_PUBLIC_ERROR_PHOTO_ENABLED` is not "1"
 * (next.config.ts defines it for every build): with the flag off none of it
 * is in any bundle. The link's own style lives in the camera's eager CSS
 * (easy-scan.css, `.errorPhotoLink`), so it never waits for this chunk.
 *
 * Layout (review F3): when the result can be offered (offer.ts) the link's
 * row is there from the first render, quiet and `aria-disabled` while the
 * copy is prepared, a usable link once it is ready, and an invisible row of
 * the same height if it cannot be prepared, so the buttons around it never
 * move. No offer at all: nothing is drawn.
 */
import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Locale } from "../../lib/contracts/locale";
import { errorPhotoCopy } from "../../lib/copy/error-photo";
import { leaveMs } from "../../lib/motion";
import { ErrorPhotoSheet } from "../../components/error-photo/ErrorPhotoSheet";
import { useLeaving } from "../camera/useLeaving";
import { usePrefersReducedMotion } from "../camera/useReducedMotion";
import { errorPhotoOffer, type OfferInput } from "./offer";
import type { ErrorPhotoMetaInput } from "./send";
import { usePreparedErrorPhoto } from "./usePreparedErrorPhoto";

/** What the scan knows besides the offer, read when the link is tapped. */
export type ErrorPhotoContext = Pick<
  ErrorPhotoMetaInput,
  | "hand"
  | "measured"
  | "measurementModelVersion"
  | "deviceClass"
  | "captureMode"
> & {
  /** The sheet size in use (the card is the offer's own mode). */
  readonly paperSize: "a4" | "letter";
};

export interface ErrorPhotoActionProps {
  readonly locale: Locale;
  readonly result: OfferInput["result"];
  /** The result sheet holding this is the current result's and on screen. */
  readonly active: boolean;
  /** The photo on screen, in memory. */
  readonly file: Blob | null;
  readonly readContext: () => ErrorPhotoContext;
}

type Session = {
  readonly meta: Omit<ErrorPhotoMetaInput, "widthPx" | "heightPx" | "expected">;
};

export function ErrorPhotoAction({
  locale,
  result,
  active,
  file,
  readContext,
}: ErrorPhotoActionProps) {
  const copy = errorPhotoCopy(locale);
  // The offer is worked out from the result the sheet shows, also while it
  // slides out (review H2): the row keeps its height; only an active sheet
  // prepares a copy (an inactive one shows the row invisible).
  const offer = errorPhotoOffer({ enabled: true, result });
  const prepared = usePreparedErrorPhoto(offer && active ? file : null, offer);
  const linkRef = useRef<HTMLButtonElement>(null);
  const reducedMotion = usePrefersReducedMotion();
  const [session, setSession] = useState<Session | null>(null);
  const sheetNow =
    session && offer && prepared.status === "ready"
      ? { session, photo: prepared.photo, mode: offer.mode }
      : null;
  // Review F7: out the way the other sheets go (--motion-sheet-out).
  const sheet = useLeaving(sheetNow, leaveMs("sheet", reducedMotion));

  const open = useCallback(() => {
    if (!offer || prepared.status !== "ready") return;
    const context = readContext();
    setSession({
      meta: {
        trigger: offer.trigger,
        reference: offer.mode === "card" ? "card" : context.paperSize,
        ...(context.hand ? { hand: context.hand } : {}),
        ...(offer.failureCode ? { failureCode: offer.failureCode } : {}),
        ...(offer.trigger === "numbers-wrong" && context.measured
          ? {
              measured: context.measured,
              ...(context.measurementModelVersion
                ? { measurementModelVersion: context.measurementModelVersion }
                : {}),
            }
          : {}),
        ...(context.deviceClass ? { deviceClass: context.deviceClass } : {}),
        ...(context.captureMode ? { captureMode: context.captureMode } : {}),
      },
    });
  }, [offer, prepared.status, readContext]);

  const sheetElement =
    sheet.shown && typeof document !== "undefined"
      ? createPortal(
          <ErrorPhotoSheet
            locale={locale}
            photo={sheet.shown.photo}
            mode={sheet.shown.mode}
            meta={sheet.shown.session.meta}
            leaving={sheet.leaving}
            returnFocusTo={() => linkRef.current}
            onClose={() => setSession(null)}
          />,
          document.body,
        )
      : null;

  // No offer, no row: the camera reserved one only where the same rule
  // (src/lib/error-photo/offerable.ts) said an offer could appear (K2).
  if (!offer) return sheetElement;
  const ready = prepared.status === "ready";
  const gone = prepared.status === "failed";
  return (
    <>
      <button
        ref={linkRef}
        type="button"
        className={
          gone ? "errorPhotoLink errorPhotoLinkGone" : "errorPhotoLink"
        }
        data-testid={
          offer.trigger === "numbers-wrong"
            ? "error-photo-numbers-wrong"
            : "error-photo-send-entry"
        }
        aria-disabled={!ready || undefined}
        aria-hidden={gone || undefined}
        tabIndex={gone ? -1 : undefined}
        onClick={open}
      >
        {offer.trigger === "numbers-wrong"
          ? copy.numbersWrongLink
          : copy.sendButton}
      </button>
      {sheetElement}
    </>
  );
}
