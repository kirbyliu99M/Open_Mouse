"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale } from "@/client/i18n/LocaleProvider";
import { useBlankTap } from "@/components/dialog/useBlankTap";
import { usePresence } from "@/components/motion/Presence";
import { resultsScreensCopy } from "@/lib/copy/results-screens";
import { deleteScan } from "./fetchResults";
import { clearScanDisclosures } from "./userLengthDisclosure";
import { clearAttempts } from "../../client/camera/easyScanPreferences";

type Status = "idle" | "confirming" | "deleting" | "error";

/**
 * Anonymous-only "Delete this scan now" action on `/results/[scanId]`
 * (issue #42, acceptance criterion 2 — "deleting is the user's choice").
 * Not rendered at all for a signed-in caller — `ResultsScanProvider` decides
 * that from the server-verified `anonymous` prop, so this component itself
 * never has to guess.
 *
 * Follows docs/design-guidelines.md's review checklist:
 *  - feedback on press: the trigger opens a confirmation immediately, and
 *    the confirm button shows a visible "Deleting…" state while the
 *    request is in flight;
 *  - an error names the problem and the one fix ("check your connection
 *    and try again"), and leaves the dialog open so the user can retry
 *    without re-confirming;
 *  - focus management: opening the dialog moves focus to Cancel (the
 *    non-destructive default), and closing it — Cancel, Escape, or a
 *    successful delete — returns focus to the button that opened it;
 *  - the backdrop dims the page (a modal task, per Materials) and the
 *    dialog reuses the same `.dialog` styling `/account`'s own confirm
 *    dialog uses, so reduced-motion/-transparency/-contrast variants are
 *    already covered by `globals.css`.
 */
export function DeleteScanAction({
  scanId,
  onDeleted,
}: {
  scanId: string;
  onDeleted: () => void;
}) {
  const copy = resultsScreensCopy(useLocale()).deleteScan;
  const [status, setStatus] = useState<Status>("idle");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const open = status !== "idle";
  // Closing fades the confirmation and the dimmed page out (V3.2 motion pass
  // #25) before it unmounts; focus still goes back at once (below).
  const presence = usePresence(open, "fade");
  // While it fades out it keeps showing what it showed last (the error too).
  const lastStatus = useRef<Status>(status);
  if (open) lastStatus.current = status;
  const shown = open ? status : lastStatus.current;

  useEffect(() => {
    if (open) cancelRef.current?.focus();
  }, [open]);

  function close() {
    setStatus("idle");
    triggerRef.current?.focus();
  }
  // A tap on the dimmed page around the card cancels, as 取消 does (Kirby
  // 2026-10-26, candidate / 未拍板); not while it is deleting.
  const blankTap = useBlankTap(close, {
    panel: "child",
    enabled: open && shown !== "deleting",
  });

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  async function confirmDelete() {
    setStatus("deleting");
    const outcome = await deleteScan(scanId);
    // A 404 means the scan is already gone; the honest end state is the
    // same "deleted" screen, not a "check your connection" retry loop.
    if (outcome === "deleted" || outcome === "notFound") {
      try {
        clearScanDisclosures(localStorage, [scanId]);
        // The scan attempt log kept on this device goes with it.
        clearAttempts(localStorage);
      } catch {
        // Storage may be blocked; deletion on the server still succeeded.
      }
      onDeleted();
      return;
    }
    setStatus("error");
  }

  return (
    <div className="delete-scan-action">
      <button
        type="button"
        ref={triggerRef}
        className="button-secondary"
        onClick={() => setStatus("confirming")}
      >
        {copy.trigger}
      </button>

      {presence.mounted && (
        <div
          className="dialog-backdrop"
          role="presentation"
          {...blankTap}
          data-leaving={presence.leaving ? "true" : undefined}
          // On its way out it is already closed: out of the accessibility
          // tree and the tab order, as it was when it unmounted at once.
          inert={presence.leaving}
          aria-hidden={presence.leaving ? true : undefined}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-scan-title"
            aria-describedby="delete-scan-body"
            className="dialog"
            data-leaving={presence.leaving ? "true" : undefined}
            inert={presence.leaving}
            aria-hidden={presence.leaving ? true : undefined}
          >
            <h2 id="delete-scan-title">{copy.title}</h2>
            <p id="delete-scan-body">{copy.body}</p>
            {shown === "error" && (
              <p className="status-error" role="alert">
                {copy.error}
              </p>
            )}
            <div className="dialog-actions">
              <button
                type="button"
                ref={cancelRef}
                className="button-secondary"
                onClick={close}
                disabled={shown === "deleting"}
              >
                {copy.cancel}
              </button>
              <button
                type="button"
                className="button-danger"
                onClick={() => void confirmDelete()}
                disabled={shown === "deleting"}
              >
                {shown === "deleting" ? copy.deleting : copy.confirm}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
