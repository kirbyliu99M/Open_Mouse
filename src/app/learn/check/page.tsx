import type { Metadata } from "next";
import { TopBar } from "@/components/nav/TopBar";
import { guardDemoRouteFromProduction } from "@/app/scan/demo-guard";
import { PAPER_SIZES_MM, type PaperSize } from "@/lib/contracts/measurement";
import { KIT_V2_SHEETS, type KitV2Sheet } from "@/lib/learning/session";
import { CheckClient } from "./CheckClient";
import "../learn.css";

export const metadata: Metadata = {
  title: "Check photos — Open Mouse",
  robots: { index: false, follow: false },
};

/** `?paper=letter` presets the sheet size (the folder sorter uses it); anything else is A4. */
function paperFrom(value: string | string[] | undefined): PaperSize {
  const v = Array.isArray(value) ? value[0] : value;
  return v !== undefined && Object.hasOwn(PAPER_SIZES_MM, v)
    ? (v as PaperSize)
    : "a4";
}

/** `?sheet=A` or `?sheet=B` presets a kit v2 sheet (the folder sorter uses it); anything else is kit v1. */
function sheetFrom(value: string | string[] | undefined): KitV2Sheet | null {
  const v = Array.isArray(value) ? value[0] : value;
  return KIT_V2_SHEETS.find((s) => s === v) ?? null;
}

export default async function LearnCheckPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  guardDemoRouteFromProduction();
  const params = await searchParams;
  const paper = paperFrom(params.paper);
  const sheet = sheetFrom(params.sheet);
  return (
    <main className="learn">
      <TopBar
        backHref="/learn"
        backLabel="Learning kit"
        stepLabel="Check photos"
      />
      <h1>Check photos</h1>
      <p className="learn-lead">
        Choose the photos from a session. Each one is checked on this device;
        nothing is uploaded. Keep the camera&apos;s file names: they set the
        capture order.
      </p>
      <CheckClient initialPaperSize={paper} initialSheet={sheet} />
    </main>
  );
}
