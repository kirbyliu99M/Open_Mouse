import type { Metadata } from "next";
import EasyScanCamera from "@/client/camera/EasyScanCamera";

export const metadata: Metadata = {
  title: "Scan your hand — Open_Mouse",
  description:
    "Lay your hand on any blank sheet of A4 and photograph it — measured entirely on this device.",
};

/**
 * The easy-scan camera (docs/design/easy-scan-shell-2026-09-25/README.md):
 * the main page's "Scan my hand" CTA lands here directly. No setup page —
 * the camera opens immediately. The printed-sheet flow this replaces as
 * the primary path stays reachable, unchanged, at `/scan`.
 */
export default function ScanEasyPage() {
  return <EasyScanCamera />;
}
