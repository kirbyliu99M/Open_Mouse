"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Locale } from "@/lib/contracts/locale";
import type { FitResponse } from "@/lib/contracts/fit";
import { RESULTS_PAGE_COPY } from "@/lib/copy/results-page";
import { shareCardCopy } from "@/lib/copy/share-card";
import { shareFileName, topPick } from "./input";
import type { QrStyle } from "./qrStyle";
import type { ShareOutcome } from "./shareDecision";
import {
  CLOSED_PREVIEW,
  createSharePreview,
  type CardCache,
  type SharePreview,
  type SharePreviewState,
} from "./sharePreview";
import { SharePreviewDialog } from "./SharePreviewDialog";
import "./share.css";

export interface ShareCardButtonProps {
  fit: FitResponse;
  lang: Locale;
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
  /** Analytics only; the real results pages pass it, a preview route does not. */
  onShareStarted?: () => void;
  onShareFinished?: (outcome: ShareOutcome) => void;
}

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
 * The last card made on this page, shared by every share entry (top bar, hero,
 * bottom): reopening the preview for the same result reuses it.
 */
const cardCache: CardCache = { current: null };

/**
 * Opens the share-card preview (V3.2 F21, candidate): the card (a 1080 x 1920
 * PNG, drawn in the browser) is made when the preview opens, shown there, and
 * handed to the system share sheet or downloaded from its two buttons.
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
  onShareStarted,
  onShareFinished,
}: ShareCardButtonProps) {
  const [state, setState] = useState<SharePreviewState>(CLOSED_PREVIEW);
  const entryRef = useRef<HTMLButtonElement>(null);
  // The preview reads the latest props through this ref, so the one
  // controller made on first use stays valid across renders.
  const latest = useRef({ fit, lang, qrSize, qrStyle, onShareFinished });
  latest.current = { fit, lang, qrSize, qrStyle, onShareFinished };
  const previewRef = useRef<SharePreview | null>(null);

  useEffect(() => () => previewRef.current?.dispose(), []);

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
  const open = state.phase !== "closed";

  function preview(): SharePreview {
    if (previewRef.current) return previewRef.current;
    previewRef.current = createSharePreview({
      makeFile: async () => {
        const {
          fit: f,
          lang: l,
          qrSize: size,
          qrStyle: style,
        } = latest.current;
        const pick = topPick(f);
        if (pick === null) throw new Error("There is no result to share.");
        // The card code, and with it `qrcode`, loads on the first open.
        const { makeShareCardPng } = await import("./render");
        const blob = await makeShareCardPng(f, l, {
          qrSize: size,
          qrStyle: style,
        });
        return new File([blob], shareFileName(pick.mouse.slug), {
          type: "image/png",
        });
      },
      getNavigator: () =>
        typeof navigator === "undefined" ? undefined : navigator,
      download: downloadFile,
      urls: {
        create: (blob) => URL.createObjectURL(blob),
        revoke: (url) => URL.revokeObjectURL(url),
      },
      timers: {
        set: (fn, ms) => window.setTimeout(fn, ms),
        clear: (id) => window.clearTimeout(id as number),
      },
      cache: cardCache,
      onChange: setState,
      onFinished: (outcome) => latest.current.onShareFinished?.(outcome),
      // After React has removed the dialog: a control behind an open modal
      // can not take focus.
      returnFocus: () => {
        window.setTimeout(() => entryRef.current?.focus(), 0);
      },
    });
    return previewRef.current;
  }

  function onClick() {
    if (open) return;
    onShareStarted?.();
    void preview().open([fit, lang, qrSize, qrStyle]);
  }

  return (
    <span
      className={`shareCard shareCard-${variant}`}
      data-filtering={secondary ? "true" : undefined}
    >
      <button
        type="button"
        className={`shareCard-button shareCard-button-${secondary ? "secondary" : variant}`}
        ref={entryRef}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid="share-card-button"
        onClick={onClick}
      >
        {label}
      </button>
      {secondary ? (
        <span className="shareCard-note" data-testid="share-filter-note">
          {filterCopy.shareNote}
        </span>
      ) : null}
      {/* In <body>, not inside the top bar or the hero: their styles stay
          out of the preview. Only rendered after a click, so never on the
          server. */}
      {open && typeof document !== "undefined"
        ? createPortal(
            <SharePreviewDialog
              state={state}
              copy={copy}
              onClose={() => previewRef.current?.close()}
              onShare={() => void previewRef.current?.share()}
              onDownload={() => void previewRef.current?.download()}
            />,
            document.body,
          )
        : null}
    </span>
  );
}
