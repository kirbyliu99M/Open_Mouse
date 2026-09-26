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
      <p className="easyDeviceUrl">{url}</p>
      <button
        type="button"
        className="easyCopyLink"
        onClick={() => void navigator.clipboard.writeText(url)}
      >
        Copy link
      </button>
      <button type="button" className="easyDeviceUpload" onClick={onUpload}>
        Or upload a photo
      </button>
    </main>
  );
}
