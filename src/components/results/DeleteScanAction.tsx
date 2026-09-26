"use client";

import { useEffect, useRef, useState } from "react";
import { deleteScan } from "./fetchResults";
import { resultLengthKey } from "./userLengthDisclosure";
import { resultHandKey } from "./handDisclosure";

type Status = "idle" | "confirming" | "deleting" | "error";

/**
 * Anonymous-only "Delete this scan now" action on `/results/[scanId]`
 * (issue #42, acceptance criterion 2 — "deleting is the user's choice").
 * Not rendered at all for a signed-in caller — `ResultsPageClient` decides
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
  const [status, setStatus] = useState<Status>("idle");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const open = status !== "idle";

  useEffect(() => {
    if (open) cancelRef.current?.focus();
  }, [open]);

  function close() {
    setStatus("idle");
    triggerRef.current?.focus();
  }

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
        localStorage.removeItem(resultLengthKey(scanId));
        localStorage.removeItem(resultHandKey(scanId));
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
        Delete this scan now
      </button>

      {open && (
        <div className="dialog-backdrop" role="presentation">
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-scan-title"
            aria-describedby="delete-scan-body"
            className="dialog"
          >
            <h2 id="delete-scan-title">Delete this scan now?</h2>
            <p id="delete-scan-body">
              This permanently deletes this scan and its measurements. This
              can&apos;t be undone.
            </p>
            {status === "error" && (
              <p className="status-error" role="alert">
                Couldn&apos;t delete — check your connection and try again.
              </p>
            )}
            <div className="dialog-actions">
              <button
                type="button"
                ref={cancelRef}
                className="button-secondary"
                onClick={close}
                disabled={status === "deleting"}
              >
                Cancel
              </button>
              <button
                type="button"
                className="button-danger"
                onClick={() => void confirmDelete()}
                disabled={status === "deleting"}
              >
                {status === "deleting" ? "Deleting…" : "Delete scan"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
