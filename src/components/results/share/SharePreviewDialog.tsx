"use client";

import { useEffect, useId, useRef } from "react";
import type { ShareCardCopy } from "@/lib/copy/share-card";
import { lockModal, type ModalLock } from "@/lib/results/photoDialogControl";
import { onPreviewCancel, type SharePreviewState } from "./sharePreview";

/**
 * The share-card preview (V3.2 F21, Pencil igL9d / DRwjD, candidate): a native
 * modal `<dialog>` (focus stays inside, Esc arrives as `cancel`), full screen
 * on a phone and a centred panel on a wide screen. It only renders
 * `SharePreviewState` from `sharePreview.ts`; the flow lives there.
 * Mounted while the preview is open; unmounting closes the modal.
 */
export function SharePreviewDialog({
  state,
  leaving = false,
  copy,
  onClose,
  onShare,
  onDownload,
}: {
  state: SharePreviewState;
  /**
   * On its way out (V3.2 motion pass #9): the owner keeps it mounted, and
   * open, for leaveMs("fade") while it fades.
   */
  leaving?: boolean;
  copy: ShareCardCopy;
  onClose: () => void;
  onShare: () => void;
  onDownload: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const lock = useRef<ModalLock | null>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const modal = lockModal(dialog, document.body);
    lock.current = modal;
    closeRef.current?.focus();
    return () => {
      lock.current = null;
      modal.dispose();
    };
  }, []);

  const generating = state.phase === "generating";
  const ready = state.phase === "ready";
  const waiting = !ready || state.acting !== null;

  return (
    <dialog
      ref={dialogRef}
      className="sharePreview"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-testid="share-preview"
      data-leaving={leaving ? "true" : undefined}
      onCancel={(event) => onPreviewCancel(event, { close: onClose })}
      // Closed some other way (a form, the browser): tell the owner, unless it
      // is our own unmount or StrictMode's second mount (see `lockModal`).
      onClose={() => {
        if (lock.current?.shouldNotifyClosed() === false) return;
        if (lock.current) onClose();
      }}
    >
      <div className="sharePreview-panel">
        <div className="sharePreview-head">
          <h2 id={titleId} className="sharePreview-title">
            {copy.previewTitle}
          </h2>
          <button
            ref={closeRef}
            type="button"
            className="sharePreview-close"
            aria-label={copy.close}
            onClick={onClose}
          >
            <svg
              viewBox="0 0 24 24"
              width="18"
              height="18"
              focusable="false"
              aria-hidden="true"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        <div className="sharePreview-stage">
          <div
            className="sharePreview-card"
            data-phase={state.phase}
            aria-busy={generating}
          >
            {ready && state.imageUrl !== null ? (
              // An object URL of a PNG made in this browser: next/image can
              // not optimise it and has nothing to add.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                className="sharePreview-image"
                src={state.imageUrl}
                alt={copy.previewAlt}
                width={1080}
                height={1920}
                data-testid="share-preview-image"
              />
            ) : null}
            {generating ? (
              <div className="sharePreview-loading" role="status">
                <span className="sharePreview-spinner" aria-hidden="true" />
                <span className="sharePreview-loadingText">{copy.busy}</span>
              </div>
            ) : null}
            {state.phase === "error" ? (
              <p className="sharePreview-error" role="alert">
                {copy.error}
              </p>
            ) : null}
          </div>
        </div>

        <div className="sharePreview-foot">
          <div className="sharePreview-messages">
            {state.hint !== "hidden" ? (
              <p
                className="sharePreview-hint"
                data-phase={state.hint}
                role="status"
                data-testid="share-preview-saved"
              >
                <svg
                  viewBox="0 0 24 24"
                  width="14"
                  height="14"
                  focusable="false"
                  aria-hidden="true"
                >
                  <path d="M20 6 9 17l-5-5" />
                </svg>
                <span>{copy.saved}</span>
              </p>
            ) : null}
            {state.actionFailed ? (
              <p className="sharePreview-actionError" role="alert">
                {copy.actionError}
              </p>
            ) : null}
          </div>
          <div className="sharePreview-actions">
            {state.canShareFiles ? (
              <button
                type="button"
                className="sharePreview-action"
                disabled={!ready}
                aria-disabled={waiting}
                data-testid="share-preview-share"
                onClick={() => {
                  if (!waiting) onShare();
                }}
              >
                <svg
                  viewBox="0 0 24 24"
                  width="16"
                  height="16"
                  focusable="false"
                  aria-hidden="true"
                >
                  <circle cx="18" cy="5" r="3" />
                  <circle cx="6" cy="12" r="3" />
                  <circle cx="18" cy="19" r="3" />
                  <path d="m8.59 13.51 6.83 3.98" />
                  <path d="m15.41 6.51-6.82 3.98" />
                </svg>
                <span>{copy.share}</span>
              </button>
            ) : null}
            <button
              type="button"
              className="sharePreview-action"
              disabled={!ready}
              aria-disabled={waiting}
              data-testid="share-preview-download"
              onClick={() => {
                if (!waiting) onDownload();
              }}
            >
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                focusable="false"
                aria-hidden="true"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <path d="m7 10 5 5 5-5" />
                <path d="M12 15V3" />
              </svg>
              <span>{copy.download}</span>
            </button>
          </div>
        </div>
      </div>
    </dialog>
  );
}
