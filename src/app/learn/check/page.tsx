import type { Metadata } from "next";
import { TopBar } from "@/components/nav/TopBar";
import { guardDemoRouteFromProduction } from "@/app/scan/demo-guard";
import { PAPER_SIZES_MM, type PaperSize } from "@/lib/contracts/measurement";
import { KIT_V2_SHEETS, type KitV2Sheet } from "@/lib/learning/session";
import { learnCopy } from "@/lib/copy/learn";
import { getLocale } from "@/server/i18n/getLocale";
import { CheckClient } from "./CheckClient";
import "../learn.css";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: learnCopy(await getLocale()).checkMetaTitle,
    robots: { index: false, follow: false },
  };
}

/** `?paper=letter` presets the sheet size (the folder sorter uses it); anything else is A4. */
function paperFrom(value: string | string[] | undefined): PaperSize {
  const v = Array.isArray(value) ? value[0] : value;
  return v !== undefined && Object.hasOwn(PAPER_SIZES_MM, v)
    ? (v as PaperSize)
    : "a4";
}

/**
 * The kit the page starts in: sheet A unless `?sheet=B` (built, not used) or
 * `?sheet=v1` (the earlier kit's pose pages) says otherwise. Anything else is A.
 */
function sheetFrom(value: string | string[] | undefined): KitV2Sheet | null {
  const v = Array.isArray(value) ? value[0] : value;
  if (v === "v1") return null;
  return KIT_V2_SHEETS.find((s) => s === v) ?? "A";
}

export default async function LearnCheckPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  guardDemoRouteFromProduction();
  const copy = learnCopy(await getLocale());
  const params = await searchParams;
  const paper = paperFrom(params.paper);
  const sheet = sheetFrom(params.sheet);
  return (
    <main className="learn">
      <TopBar
        backHref="/learn"
        backLabel={copy.learningKit}
        stepLabel={copy.checkPhotos}
      />
      <h1>{copy.checkPhotos}</h1>
      <p className="learn-lead">{copy.checkLead}</p>
      <CheckClient initialPaperSize={paper} initialSheet={sheet} />
    </main>
  );
}
