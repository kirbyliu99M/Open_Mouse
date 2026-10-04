"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { AccountScan } from "../../server/account/repo";
import { clearScanDisclosures } from "../../components/results/userLengthDisclosure";

type Status = "idle" | "working" | "done" | "error";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * `/account`'s interactive half: list, export, delete-everything. The
 * server component (`page.tsx`) fetches the initial list so the page
 * renders with data on first paint; export re-fetches the same
 * `GET /api/account/scans` response and turns it into a client-built
 * download (issue #17 — "a download built client-side from an API
 * response"), which also doubles as this page staying correct if scans
 * changed since the initial server render.
 */
export function AccountView({ scans }: { scans: AccountScan[] }) {
  const [visibleScans, setVisibleScans] = useState(scans);
  const [exportStatus, setExportStatus] = useState<Status>("idle");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteStatus, setDeleteStatus] = useState<Status>("idle");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!confirmOpen) return;
    const dialog = dialogRef.current;
    const trigger = triggerRef.current;
    dialog?.showModal();
    cancelRef.current?.focus();
    return () => {
      dialog?.close();
      trigger?.focus();
    };
  }, [confirmOpen]);

  async function handleExport() {
    setExportStatus("working");
    try {
      const res = await fetch("/api/account/scans");
      if (!res.ok) throw new Error("export failed");
      const data: unknown = await res.json();
      downloadJson(`open-mouse-scans-${Date.now()}.json`, data);
      setExportStatus("done");
    } catch {
      setExportStatus("error");
    }
  }

  async function handleDeleteAll() {
    setDeleteStatus("working");
    try {
      const res = await fetch("/api/account/scans", { method: "DELETE" });
      if (!res.ok) throw new Error("delete failed");
      try {
        clearScanDisclosures(
          localStorage,
          visibleScans.map((scan) => scan.scanId),
        );
      } catch {
        // Browser storage may be unavailable; server deletion succeeded.
      }
      setVisibleScans([]);
      setDeleteStatus("done");
      setConfirmOpen(false);
    } catch {
      setDeleteStatus("error");
    }
  }

  return (
    <section>
      <div className="account-actions">
        <button
          type="button"
          className="button-secondary"
          onClick={handleExport}
          disabled={exportStatus === "working" || visibleScans.length === 0}
        >
          {exportStatus === "working" ? "Preparing export…" : "Export as JSON"}
        </button>
        <button
          type="button"
          className="button-danger"
          ref={triggerRef}
          onClick={() => setConfirmOpen(true)}
          disabled={visibleScans.length === 0}
        >
          Delete everything
        </button>
      </div>
      {exportStatus === "error" && (
        <p className="status-error" role="status">
          Couldn&apos;t export — check your connection and try again.
        </p>
      )}

      {visibleScans.length === 0 ? (
        <div>
          <p className="note">No scans yet.</p>
          <Link className="account-empty-link" href="/scan/easy">
            Start measuring
          </Link>
        </div>
      ) : (
        <ul className="scan-list" aria-label="Your scans">
          {visibleScans.map((scan) => (
            <li key={scan.scanId} className="scan-card">
              <div className="scan-card-header">
                <span>{formatDate(scan.createdAt)}</span>
                <span>{scan.hand === "left" ? "Left hand" : "Right hand"}</span>
              </div>
              <dl className="measurements">
                <div>
                  <dt>Hand length</dt>
                  <dd>{scan.measurements.handLengthMm}&nbsp;mm</dd>
                </div>
                <div>
                  <dt>Palm length</dt>
                  <dd>{scan.measurements.palmLengthMm}&nbsp;mm</dd>
                </div>
                <div>
                  <dt>Palm width</dt>
                  <dd>{scan.measurements.palmWidthMm}&nbsp;mm</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      )}

      {confirmOpen && (
        <dialog
          ref={dialogRef}
          onClose={() => setConfirmOpen(false)}
          role="alertdialog"
          aria-labelledby="delete-all-title"
          aria-describedby="delete-all-body"
          className="dialog"
        >
          <h2 id="delete-all-title">Delete everything?</h2>
          <p id="delete-all-body">
            This permanently deletes all {visibleScans.length} of your scans.
            This can&apos;t be undone.
          </p>
          {deleteStatus === "error" && (
            <p className="status-error" role="status">
              Couldn&apos;t delete — check your connection and try again.
            </p>
          )}
          <div className="dialog-actions">
            <button
              type="button"
              className="button-secondary"
              ref={cancelRef}
              onClick={() => setConfirmOpen(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="button-danger"
              onClick={handleDeleteAll}
              disabled={deleteStatus === "working"}
            >
              {deleteStatus === "working" ? "Deleting…" : "Delete everything"}
            </button>
          </div>
        </dialog>
      )}
    </section>
  );
}
