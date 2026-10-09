import type { Metadata } from "next";
import { guardDemoRouteFromProduction } from "../demo-guard";
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
 * sketch as the product photo) and `longName=1`.
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
    />
  );
}
