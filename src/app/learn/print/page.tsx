import type { Metadata } from "next";
import Link from "next/link";
import { TopBar } from "@/components/nav/TopBar";
import { KitPageSvg } from "@/components/learning/KitSvg";
import { KitSheetSvg } from "@/components/learning/KitV2Svg";
import { guardDemoRouteFromProduction } from "@/app/scan/demo-guard";
import {
  GESTURES,
  KIT_V1_VERSION,
  kitCodeToken,
  type HandSide,
} from "@/lib/learning/kit";
import { KIT_V2_SHEETS, type KitV2Sheet } from "@/lib/learning/session";
import { PrintButton } from "../PrintButton";
import "../learn.css";

export const metadata: Metadata = {
  title: "Print the learning kit — Open Mouse",
  robots: { index: false, follow: false },
};

function handsFrom(value: string | string[] | undefined): HandSide[] {
  const v = Array.isArray(value) ? value[0] : value;
  if (v === "right") return ["right"];
  if (v === "left") return ["left"];
  return ["right", "left"];
}

/** `?sheet=A` or `?sheet=B` selects a kit v2 sheet; anything else is not a sheet. */
function sheetFrom(value: string | string[] | undefined): KitV2Sheet | null {
  const v = Array.isArray(value) ? value[0] : value;
  return KIT_V2_SHEETS.find((s) => s === v) ?? null;
}

const SHEET_NAME: Record<KitV2Sheet, string> = {
  A: "Sheet A: the product sheet's four markers, centre line, wrist line and a 100 mm ruler",
  B: "Sheet B (not used, Kirby 2026-10-02): six markers on the outer ring and a blank hand area",
};

export default async function LearnPrintPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  guardDemoRouteFromProduction();
  const params = await searchParams;
  const sheet = sheetFrom(params.sheet);
  if (sheet) {
    return (
      <main className="learn-print-main">
        <div className="learn noPrint">
          <TopBar
            backHref="/learn"
            backLabel="Learning kit"
            stepLabel="Print"
          />
          <h1>
            Print kit v2, sheet {sheet}
            {sheet === "B" ? " (not used, Kirby 2026-10-02)" : ""}
          </h1>
          <p className="learn-lead">
            {SHEET_NAME[sheet]}. One A4 page for both hands. In the print dialog
            choose A4, 100% / Actual size, and turn off &ldquo;Fit to
            page&rdquo;.{" "}
            {sheet === "A"
              ? "Then check the 100 mm line with a ruler."
              : "Then check with a ruler that the outer edge of marker 0 to the outer edge of marker 1 is 180 mm."}{" "}
            Participant cards are on the{" "}
            <Link href="/learn/slates?kit=2">cards page</Link>.
          </p>
          <PrintButton label="Print 1 page" />
          <p className="learn-note">
            Other sheet:{" "}
            <Link href={`/learn/print?sheet=${sheet === "A" ? "B" : "A"}`}>
              sheet {sheet === "A" ? "B (not used)" : "A"}
            </Link>
            .
          </p>
        </div>
        <div className="learn-print-pages">
          <section className="learn-print-page learn-print-page-a4">
            <p className="learn-print-label">Kit v2 · sheet {sheet}</p>
            <KitSheetSvg sheet={sheet} />
          </section>
        </div>
      </main>
    );
  }
  const hands = handsFrom(params.hands);
  const pages = hands.flatMap((hand) =>
    GESTURES.map((gesture) => ({ hand, gesture })),
  );
  const label =
    hands.length === 2
      ? "both hands"
      : hands[0] === "right"
        ? "right hand"
        : "left hand";

  return (
    <main className="learn-print-main">
      <div className="learn noPrint">
        <TopBar backHref="/learn" backLabel="Learning kit" stepLabel="Print" />
        <h1>Print the kit</h1>
        <p className="learn-lead">
          {pages.length} pages, {label}. In the print dialog choose A4, 100% /
          Actual size, and turn off &ldquo;Fit to page&rdquo;. Then check the
          100 mm line on one page with a ruler.
        </p>
        <PrintButton label={`Print ${pages.length} pages`} />
      </div>
      <div className="learn-print-pages">
        {pages.map(({ hand, gesture }) => {
          const token = kitCodeToken({
            kind: "gesture",
            version: KIT_V1_VERSION,
            gesture: gesture.code,
            hand,
          });
          return (
            <section key={token} className="learn-print-page">
              <p className="learn-print-label">
                {token} · {gesture.name}
              </p>
              <KitPageSvg gesture={gesture} hand={hand} />
            </section>
          );
        })}
      </div>
    </main>
  );
}
