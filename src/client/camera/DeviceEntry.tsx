import QRCode from "qrcode";
import { useEffect, useState } from "react";

export function DeviceEntry({
  kind,
  url,
  onUpload,
}: {
  kind: "desktop" | "in-app";
  url: string;
  onUpload: () => void;
}) {
  const [qr, setQr] = useState("");
  const [copied, setCopied] = useState(false);
  const [showSelectableUrl, setShowSelectableUrl] = useState(false);
  const [lineBrowser, setLineBrowser] = useState(false);
  useEffect(() => {
    setLineBrowser(kind === "in-app" && /LINE\//i.test(navigator.userAgent));
  }, [kind]);
  const externalBrowserUrl = lineBrowser && url ? new URL(url) : null;
  externalBrowserUrl?.searchParams.set("openExternalBrowser", "1");
  useEffect(() => {
    if (kind !== "desktop") return;
    void QRCode.toString(url, {
      type: "svg",
      margin: 2,
      color: { dark: "#1c1c1e", light: "#ffffff" },
    }).then(setQr);
  }, [kind, url]);
  return (
    <main className="easyDeviceEntry">
      <h1>
        {kind === "desktop"
          ? "Scan with your phone"
          : "Open in Safari or Chrome to use the camera"}
      </h1>
      {kind !== "desktop" && (
        <p>
          This app’s built-in browser blocks the camera. Copy the link and open
          it in Safari or Chrome.
        </p>
      )}
      {kind === "desktop" && (
        <>
          <p>Point your phone camera at this code.</p>
          <div
            className="easyQr"
            role="img"
            aria-label="QR code for this scan page"
            dangerouslySetInnerHTML={{ __html: qr }}
          />
        </>
      )}
      {externalBrowserUrl && (
        <a className="easyCopyLink" href={externalBrowserUrl.toString()}>
          Open in browser
        </a>
      )}
      <p className="easyDeviceUrl">{url}</p>
      <button
        type="button"
        className="easyCopyLink"
        onClick={() => {
          if (!navigator.clipboard?.writeText) {
            setShowSelectableUrl(true);
            return;
          }
          void navigator.clipboard.writeText(url).then(
            () => setCopied(true),
            () => setShowSelectableUrl(true),
          );
        }}
      >
        Copy link
      </button>
      <span aria-live="polite">{copied ? "Link copied" : ""}</span>
      {showSelectableUrl && (
        <input
          className="easySelectableUrl"
          aria-label="Select link to copy"
          readOnly
          value={url}
          onFocus={(event) => event.currentTarget.select()}
        />
      )}
      <button type="button" className="easyDeviceUpload" onClick={onUpload}>
        Or upload a photo
      </button>
    </main>
  );
}
