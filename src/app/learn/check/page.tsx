import type { Metadata } from "next";
import { TopBar } from "@/components/nav/TopBar";
import { PAPER_SIZES_MM, type PaperSize } from "@/lib/contracts/measurement";
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

export default async function LearnCheckPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const paper = paperFrom((await searchParams).paper);
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
      <CheckClient initialPaperSize={paper} />
    </main>
  );
}
