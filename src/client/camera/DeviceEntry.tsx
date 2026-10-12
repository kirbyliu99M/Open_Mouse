import QRCode from "qrcode";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useLocale } from "@/client/i18n/LocaleProvider";
import { easyScanCopy } from "../../lib/copy/easy-scan";
import { manualEntryCopy } from "../../lib/copy/manualEntry";
import { scanCommonCopy } from "../../lib/copy/scan-common";
import type { ManualEntryDraft } from "../../lib/scan/manualEntry";
import {
  ManualEntrySheet,
  type ManualEntryValues,
} from "../../components/scan/ManualEntrySheet";

/**
 * The desktop's way to type the hand length and width instead of scanning
 * (candidate, 2026-10-12): the form is shown next to the QR card, with no
 * pull-up. The parent keeps the draft and takes the typed pair.
 */
export interface DeviceEntryManual {
  readonly draft: ManualEntryDraft;
  readonly onDraftChange: (draft: ManualEntryDraft) => void;
  readonly onUse: (values: ManualEntryValues) => void;
}

export function DeviceEntry({
  kind,
  url,
  onFilePicked,
  manual,
}: {
  kind: "desktop" | "in-app";
  url: string;
  onFilePicked: (event: ChangeEvent<HTMLInputElement>) => void;
  /** Only the desktop screen takes it. */
  manual?: DeviceEntryManual;
}) {
  const locale = useLocale();
  const words = easyScanCopy(locale).device;
  const common = scanCommonCopy(locale);
  const uploadRef = useRef<HTMLInputElement>(null);
  const [qr, setQr] = useState("");
  // A new `n` each time replaces the message node, so a screen reader
  // announces a repeat ("Link copied" twice) as well as a failure.
  const [copyStatus, setCopyStatus] = useState<{
    n: number;
    text: string;
  } | null>(null);
  const announceCopy = (text: string) =>
    setCopyStatus((prev) => ({ n: (prev?.n ?? 0) + 1, text }));
  const [showSelectableUrl, setShowSelectableUrl] = useState(false);
  const [lineBrowser, setLineBrowser] = useState(false);
  useEffect(() => {
    setLineBrowser(kind === "in-app" && /LINE\//i.test(navigator.userAgent));
  }, [kind]);
  const externalBrowserUrl = lineBrowser && url ? new URL(url) : null;
  externalBrowserUrl?.searchParams.set("openExternalBrowser", "1");
  useEffect(() => {
    if (kind !== "desktop") return;
    let active = true;
    setQr("");
    void QRCode.toString(url, {
      type: "svg",
      margin: 2,
      color: { dark: "#1c1c1e", light: "#ffffff" },
    }).then(
      (svg) => {
        if (active) setQr(svg);
      },
      () => {
        if (active) setQr("");
      },
    );
    return () => {
      active = false;
    };
  }, [kind, url]);
  const showManual = kind === "desktop" && manual !== undefined;
  // Everything about scanning with the phone, as one block: the whole screen
  // when there is no form, the left card when there is.
  const scanBlock = (
    <>
      {kind === "desktop" && (
        <>
          <p>{words.desktopBody}</p>
          {qr && (
            <div
              className="easyQr"
              role="img"
              aria-label={words.qrLabel}
              dangerouslySetInnerHTML={{ __html: qr }}
            />
          )}
        </>
      )}
      {externalBrowserUrl && (
        <a className="easyCopyLink" href={externalBrowserUrl.toString()}>
          {words.openInBrowser}
        </a>
      )}
      <p className="easyDeviceUrl">{url}</p>
      <button
        type="button"
        className="easyCopyLink"
        onClick={() => {
          if (!navigator.clipboard?.writeText) {
            setShowSelectableUrl(true);
            announceCopy(words.copyFailed);
            return;
          }
          void navigator.clipboard.writeText(url).then(
            () => announceCopy(words.linkCopied),
            () => {
              setShowSelectableUrl(true);
              announceCopy(words.copyFailed);
            },
          );
        }}
      >
        {words.copyLink}
      </button>
      <p role="status" aria-live="polite" className="easyCopyStatus">
        {copyStatus && <span key={copyStatus.n}>{copyStatus.text}</span>}
      </p>
      {showSelectableUrl && (
        <input
          className="easySelectableUrl"
          aria-label={words.selectLinkLabel}
          readOnly
          value={url}
          onFocus={(event) => event.currentTarget.select()}
        />
      )}
      <button
        type="button"
        className="easyDeviceUpload"
        onClick={() => uploadRef.current?.click()}
      >
        {words.uploadPhoto}
      </button>
      <p className="easyDevicePrivacy">
        {kind === "desktop" ? common.privacyDevice : common.privacyPhone}
      </p>
      {/* The button above opens this picker; the input itself is not a
          second control, so it stays out of the tab order and the
          accessibility tree. */}
      <input
        ref={uploadRef}
        type="file"
        accept="image/*"
        className="visuallyHidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={onFilePicked}
      />
    </>
  );
  if (showManual) {
    return (
      <main className="easyDeviceEntry easyDeviceEntry-manual">
        <h1>{manualEntryCopy(locale).desktopHeading}</h1>
        <div className="easyDeviceColumns">
          <section className="easyDeviceScanCard">
            <h2>{words.desktopTitle}</h2>
            {scanBlock}
          </section>
          <ManualEntrySheet
            presentation="panel"
            initialDraft={manual.draft}
            onDraftChange={manual.onDraftChange}
            onUse={manual.onUse}
          />
        </div>
      </main>
    );
  }
  return (
    <main className="easyDeviceEntry">
      <h1>{kind === "desktop" ? words.desktopTitle : words.inAppTitle}</h1>
      {kind !== "desktop" && <p>{words.inAppBody}</p>}
      {scanBlock}
    </main>
  );
}
