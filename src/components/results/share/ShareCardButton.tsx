"use client";

import { useRef, useState } from "react";
import { uiLangAttribute, type UiLanguage } from "@/client/uiLanguage";
import type { FitResponse } from "@/lib/contracts/fit";
import { RESULTS_PAGE_COPY } from "@/lib/copy/results-page";
import { shareCardCopy } from "@/lib/copy/share-card";
import { shareFileName, topPick } from "./input";
import type { QrStyle } from "./qrStyle";
import { deliverShareFile } from "./shareDecision";
import "./share.css";

export interface ShareCardButtonProps {
  fit: FitResponse;
  lang: UiLanguage;
  /** "link" is the small 分享 in the top bar; "primary" is the big 製作我的分享圖. */
  variant: "link" | "primary";
  /**
   * The results are filtered (FILTER-1, candidate): a "primary" button turns
   * into a secondary text link saying it shares the overall #1, with a note.
   * The card itself never changes: it is made from `fit`, which is never
   * filtered.
   */
  filtering?: boolean;
  /** The QR size in pixels: the panel's side, or for the frameless style the module step it gives (the box grows by its quiet zone). Only a preview route passes it. */
  qrSize?: number;
  /** The QR code's style; only a preview route passes it (default frameless, `DEFAULT_QR_STYLE`). */
  qrStyle?: QrStyle;
}

type Status = "idle" | "busy" | "error";

function downloadFile(file: File): void {
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Let the download start before the URL goes away.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Makes the share card (a 1080 x 1920 PNG, drawn in the browser) and hands it
 * to the system share sheet, or downloads it where files can not be shared.
 * Renders nothing when there is no result to share. The card draws only the
 * top pick, the hand type and the site's QR code: no photo of the hand, no
 * measurement, no scan id.
 */
export function ShareCardButton({
  fit,
  lang,
  variant,
  filtering = false,
  qrSize,
  qrStyle,
}: ShareCardButtonProps) {
  const [status, setStatus] = useState<Status>("idle");
  const running = useRef(false);
  const top = topPick(fit);
  if (top === null) return null;

  const copy = shareCardCopy(lang);
  const secondary = variant === "primary" && filtering;
  const filterCopy = RESULTS_PAGE_COPY[lang].filter;
  const label = secondary
    ? filterCopy.shareOverall
    : variant === "primary"
      ? copy.buttonPrimary
      : copy.buttonLink;
  const busy = status === "busy";

  async function onClick() {
    if (running.current || top === null) return;
    running.current = true;
    setStatus("busy");
    try {
      // The card code, and with it `qrcode`, loads on the first click.
      const { makeShareCardPng } = await import("./render");
      const blob = await makeShareCardPng(fit, lang, { qrSize, qrStyle });
      const file = new File([blob], shareFileName(top.mouse.slug), {
        type: "image/png",
      });
      const outcome = await deliverShareFile(
        file,
        typeof navigator === "undefined" ? undefined : navigator,
        downloadFile,
      );
      setStatus(outcome === "failed" ? "error" : "idle");
    } catch {
      setStatus("error");
    } finally {
      running.current = false;
    }
  }

  return (
    <span
      className={`shareCard shareCard-${variant}`}
      data-filtering={secondary ? "true" : undefined}
    >
      <button
        type="button"
        className={`shareCard-button shareCard-button-${secondary ? "secondary" : variant}`}
        aria-disabled={busy}
        aria-busy={busy}
        lang={uiLangAttribute(lang)}
        data-testid="share-card-button"
        onClick={onClick}
      >
        {busy ? copy.busy : label}
      </button>
      {secondary ? (
        <span
          className="shareCard-note"
          lang={uiLangAttribute(lang)}
          data-testid="share-filter-note"
        >
          {filterCopy.shareNote}
        </span>
      ) : null}
      {status === "error" ? (
        <span
          className="shareCard-error"
          role="alert"
          lang={uiLangAttribute(lang)}
        >
          {copy.error}
        </span>
      ) : null}
    </span>
  );
}
