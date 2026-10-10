import type { Metadata } from "next";
import { guardDemoRouteFromProduction } from "../demo-guard";
import { QR_STYLES_LIST } from "@/components/results/share/qrStyle";
import { ShareCardDemoClient } from "./ShareCardDemoClient";

export const metadata: Metadata = {
  title: "Share card (mock data)",
  description:
    "Dev/demo route mounting the share-card button against fixture data. No fetching, no network calls.",
  robots: { index: false, follow: false },
};

/**
 * Dev-only mount for the share-card button (the results page does not carry it
 * yet; it is wired in after the results-page rebuild lands). Query switches:
 * `lang=zh`, `handType=0` (fit-v0 sends none), `photo=1` (the placeholder
 * sketch as the product photo), `longName=1`, `preset=rog` (the data of Kirby's
 * 2026-10-10 screenshot: ROG Strix Impact III, 92, Medium mouse, Palm grip, Slim)
 * `qr=160` (the QR panel's side in pixels) and `qrStyle=` classic, softLight,
 * darkTile or frameless.
 */
export default async function ShareCardDemoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  guardDemoRouteFromProduction();
  const q = await searchParams;
  const flag = (key: string, fallback: boolean) => {
    const v = q[key];
    return typeof v === "string" ? v === "1" || v === "zh" : fallback;
  };
  return (
    <ShareCardDemoClient
      lang={q.lang === "zh" ? "zh-TW" : "en"}
      withHandType={flag("handType", true)}
      withPhoto={flag("photo", false)}
      longName={flag("longName", false)}
      qrStyle={QR_STYLES_LIST.find((v) => v === q.qrStyle)}
      preset={q.preset === "rog" ? "rog" : null}
      qrSize={
        typeof q.qr === "string" && /^\d{2,3}$/.test(q.qr)
          ? Number(q.qr)
          : undefined
      }
    />
  );
}
