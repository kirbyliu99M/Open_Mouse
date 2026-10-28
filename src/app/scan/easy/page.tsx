import type { Metadata } from "next";
import { requestPageMetadata } from "@/server/seo/pageMetadata";
import { headers } from "next/headers";
import EasyScanCamera from "@/client/camera/EasyScanCamera";
import { detectDeviceFit } from "@/client/camera/deviceFit";
import { easyScanCopy } from "@/lib/copy/easy-scan";

export async function generateMetadata(): Promise<Metadata> {
  return requestPageMetadata((locale) => {
    const copy = easyScanCopy(locale);
    return {
      path: "/scan/easy",
      title: copy.metaTitle,
      description: copy.metaDescription,
    };
  });
}

/**
 * The easy-scan camera (docs/design/easy-scan-shell-2026-09-25/README.md):
 * the main page's "Scan my hand" CTA lands here directly. No setup page —
 * the camera opens immediately. The printed-sheet flow this replaces as
 * the primary path stays reachable, unchanged, at `/scan`.
 *
 * The client only learns what device it is on after it mounts, so the page it
 * shows first has to be a colour that fits the screen that replaces it
 * (a phone: the camera's dark; a desktop or an in-app browser: the entry
 * screen's page background). The server can already classify the user agent
 * with the same function the client uses, and hands that over as a hint for
 * the first paint only; it decides nothing else. Reading the request headers
 * makes this route dynamic (rendered per request instead of prerendered).
 * That changes one response header, `Cache-Control` (private, no-store
 * instead of the static route's long shared `s-maxage`), and none of the
 * security headers: CSP, Referrer-Policy and the rest come from
 * next.config.ts `headers()`, not from rendering.
 */
export default async function ScanEasyPage() {
  const userAgent = (await headers()).get("user-agent") ?? "";
  // The server sees no pointer, so this is the UA-only answer; a coarse
  // pointer on a desktop-looking UA is handled in CSS.
  const deviceHint = detectDeviceFit({ userAgent, coarsePointer: false });
  // Debug photos leave the phone only on a Vercel preview (pre-launch audit
  // 2026-10-28): the query string alone must not send them on production.
  return (
    <EasyScanCamera
      deviceHint={deviceHint}
      debugPhotosAllowed={process.env.VERCEL_ENV === "preview"}
    />
  );
}
