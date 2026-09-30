import type { Metadata } from "next";
import { TopBar } from "@/components/nav/TopBar";
import { guardDemoRouteFromProduction } from "@/app/scan/demo-guard";
import { SLATES_PER_PAGE, SlatePageSvg } from "@/components/learning/KitSvg";
import { formatParticipantId } from "@/lib/learning/kit";
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

export default async function LearnSlatesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  guardDemoRouteFromProduction();
  const params = await searchParams;
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
