"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useLocale } from "@/client/i18n/LocaleProvider";
import type { Locale } from "@/lib/contracts/locale";
import { accountCopy } from "@/lib/copy/account";
import type { AccountScan } from "../../server/account/repo";
import { clearScanDisclosures } from "../../components/results/userLengthDisclosure";
import { clearAttempts } from "../../client/camera/easyScanPreferences";

type Status = "idle" | "working" | "done" | "error";

function formatDate(iso: string, locale: Locale): string {
  // English keeps the browser's own format; zh-TW asks for Taiwan's.
  return new Date(iso).toLocaleString(
    locale === "zh-TW" ? "zh-TW" : undefined,
    {
      dateStyle: "medium",
      timeStyle: "short",
    },
  );
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
  const locale = useLocale();
  const copy = accountCopy(locale);
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
      downloadJson(`palmate-scans-${Date.now()}.json`, data);
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
        // The scan attempt log kept on this device goes with the rest.
        clearAttempts(localStorage);
      } catch {
        // Browser storage may be unavailable; server deletion succeeded.
      }
      setVisibleScans([]);
      setDeleteStatus("done");
      setConfirmOpen(false);
      // The account is gone and this browser is signed out: load /account
      // again so the server renders the signed-out state.
      window.location.assign("/account");
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
          {exportStatus === "working" ? copy.preparingExport : copy.exportJson}
        </button>
        <button
          type="button"
          className="button-danger"
          ref={triggerRef}
          onClick={() => setConfirmOpen(true)}
        >
          {copy.deleteEverything}
        </button>
      </div>
      {exportStatus === "error" && (
        <p className="status-error" role="status">
          {copy.exportError}
        </p>
      )}

      {visibleScans.length === 0 ? (
        <div>
          <p className="note">{copy.noScans}</p>
          <Link className="account-empty-link" href="/scan/easy">
            {copy.startMeasuring}
          </Link>
        </div>
      ) : (
        <ul className="scan-list" aria-label={copy.scansLabel}>
          {visibleScans.map((scan) => (
            <li key={scan.scanId} className="scan-card">
              <div className="scan-card-header">
                <span>{formatDate(scan.createdAt, locale)}</span>
                <span>
                  {scan.hand === "left" ? copy.leftHand : copy.rightHand}
                </span>
              </div>
              <dl className="measurements">
                <div>
                  <dt>{copy.handLength}</dt>
                  <dd>{scan.measurements.handLengthMm}&nbsp;mm</dd>
                </div>
                <div>
                  <dt>{copy.palmLength}</dt>
                  <dd>{scan.measurements.palmLengthMm}&nbsp;mm</dd>
                </div>
                <div>
                  <dt>{copy.palmWidth}</dt>
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
          <h2 id="delete-all-title">{copy.deleteTitle}</h2>
          <p id="delete-all-body">{copy.deleteBody(visibleScans.length)}</p>
          {deleteStatus === "error" && (
            <p className="status-error" role="status">
              {copy.deleteError}
            </p>
          )}
          <div className="dialog-actions">
            <button
              type="button"
              className="button-secondary"
              ref={cancelRef}
              onClick={() => setConfirmOpen(false)}
            >
              {copy.cancel}
            </button>
            <button
              type="button"
              className="button-danger"
              onClick={handleDeleteAll}
              disabled={deleteStatus === "working"}
            >
              {deleteStatus === "working"
                ? copy.deleting
                : copy.deleteEverything}
            </button>
          </div>
        </dialog>
      )}
    </section>
  );
}
