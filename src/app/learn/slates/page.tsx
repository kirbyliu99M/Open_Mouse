import type { Metadata } from "next";
import { TopBar } from "@/components/nav/TopBar";
import { guardDemoRouteFromProduction } from "@/app/scan/demo-guard";
import { SLATES_PER_PAGE, SlatePageSvg } from "@/components/learning/KitSvg";
import { CardPageSvg } from "@/components/learning/KitV2Svg";
import { formatParticipantId } from "@/lib/learning/kit";
import { KIT_V2_CARDS_PER_PAGE } from "@/lib/learning/layoutv2";
import { PrintButton } from "../PrintButton";
import "../learn.css";

export const metadata: Metadata = {
  title: "Participant cards — Open Mouse",
  robots: { index: false, follow: false },
};

function intParam(
  value: string | string[] | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const n = Number(Array.isArray(value) ? value[0] : value);
  return Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

/**
 * Kit v2 participant cards (`?kit=2`): 60 x 30 mm, a `P###` QR code and the
 * number in 9 mm bold type, 24 to an A4 page. `?from=901&count=12` is the S0
 * pilot, `?from=1&count=48` the first two pages of the main run.
 */
function V2Cards({
  params,
}: {
  params: Record<string, string | string[] | undefined>;
}) {
  const from = intParam(params.from, 1, 1, 999);
  const count = Math.min(intParam(params.count, 24, 1, 240), 999 - from + 1);
  const last = from + count - 1;
  const pageStarts = Array.from(
    { length: Math.ceil(count / KIT_V2_CARDS_PER_PAGE) },
    (_, i) => from + i * KIT_V2_CARDS_PER_PAGE,
  );
  return (
    <main className="learn-print-main">
      <div className="learn noPrint">
        <TopBar
          backHref="/learn"
          backLabel="Learning kit"
          stepLabel="Participant cards"
        />
        <h1>Kit v2 participant cards</h1>
        <p className="learn-lead">
          Cards {formatParticipantId(from)} to {formatParticipantId(last)}, 24
          to a page. Print at A4, 100% / Actual size, and cut along the dashed
          lines. Each card is 60 × 30 mm and goes in the sheet&apos;s card slot
          before a person&apos;s first photo; every photo then names its
          participant.
        </p>
        <PrintButton
          label={`Print ${pageStarts.length === 1 ? "1 page" : `${pageStarts.length} pages`}`}
        />
        <p className="learn-note">
          S0 pilot: <code>?kit=2&amp;from=901&amp;count=12</code>. More:{" "}
          <code>?kit=2&amp;from={last + 1}</code>.
        </p>
      </div>
      <div className="learn-print-pages">
        {pageStarts.map((start) => (
          <section key={start} className="learn-print-page learn-print-page-a4">
            <CardPageSvg
              first={start}
              count={Math.min(KIT_V2_CARDS_PER_PAGE, last - start + 1)}
            />
          </section>
        ))}
      </div>
    </main>
  );
}

export default async function LearnSlatesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  guardDemoRouteFromProduction();
  const params = await searchParams;
  const kitParam = Array.isArray(params.kit) ? params.kit[0] : params.kit;
  if (kitParam === "2") return <V2Cards params={params} />;
  const from = intParam(params.from, 1, 1, 999);
  const count = Math.min(intParam(params.count, 8, 1, 96), 999 - from + 1);
  const pageStarts = Array.from(
    { length: Math.ceil(count / SLATES_PER_PAGE) },
    (_, i) => from + i * SLATES_PER_PAGE,
  );
  const last = from + count - 1;

  return (
    <main className="learn-print-main">
      <div className="learn noPrint">
        <TopBar
          backHref="/learn"
          backLabel="Learning kit"
          stepLabel="Participant cards"
        />
        <h1>Participant cards</h1>
        <p className="learn-lead">
          Cards {formatParticipantId(from)} to {formatParticipantId(last)}. Cut
          them out, write one person&apos;s ruler values on a card, and
          photograph it before their first pose. Every photo after it is filed
          under that number until the next card.
        </p>
        <PrintButton
          label={`Print ${pageStarts.length === 1 ? "1 page" : `${pageStarts.length} pages`}`}
        />
        <p className="learn-note">
          Need more? Add <code>?from={last + 1}</code> to this page&apos;s
          address.
        </p>
      </div>
      <div className="learn-print-pages">
        {pageStarts.map((start) => (
          <section key={start} className="learn-print-page">
            <SlatePageSvg
              first={start}
              count={Math.min(SLATES_PER_PAGE, last - start + 1)}
            />
          </section>
        ))}
      </div>
    </main>
  );
}
