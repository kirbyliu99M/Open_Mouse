import type { Metadata } from "next";
import type { Locale } from "@/lib/contracts/locale";
import { TopBar } from "@/components/nav/TopBar";
import { guardDemoRouteFromProduction } from "@/app/scan/demo-guard";
import { SLATES_PER_PAGE, SlatePageSvg } from "@/components/learning/KitSvg";
import { CardPageSvg } from "@/components/learning/KitV2Svg";
import { formatParticipantId } from "@/lib/learning/kit";
import { KIT_V2_CARDS_PER_PAGE } from "@/lib/learning/layoutv2";
import { learnCopy } from "@/lib/copy/learn";
import { getLocale } from "@/server/i18n/getLocale";
import { PrintButton } from "../PrintButton";
import "../learn.css";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: learnCopy(await getLocale()).slatesMetaTitle,
    robots: { index: false, follow: false },
  };
}

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
  locale,
}: {
  params: Record<string, string | string[] | undefined>;
  locale: Locale;
}) {
  const copy = learnCopy(locale);
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
          backLabel={copy.learningKit}
          stepLabel={copy.participantCards}
        />
        <h1>{copy.kitV2Cards}</h1>
        <p className="learn-lead">
          {copy.join([
            copy.cardsLeadV2(
              formatParticipantId(from),
              formatParticipantId(last),
            ),
            copy.cardsLeadV2After,
          ])}
        </p>
        <PrintButton label={copy.printPages(pageStarts.length)} />
        <p className="learn-note">
          {copy.s0Pilot} <code>?kit=2&amp;from=901&amp;count=12</code>
          {copy.stop} {copy.more} <code>?kit=2&amp;from={last + 1}</code>
          {copy.stop}
        </p>
      </div>
      <div className="learn-print-pages">
        {pageStarts.map((start) => (
          <section key={start} className="learn-print-page learn-print-page-a4">
            <CardPageSvg
              locale={locale}
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
  const locale = await getLocale();
  const copy = learnCopy(locale);
  if (kitParam === "2") return <V2Cards params={params} locale={locale} />;
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
          backLabel={copy.learningKit}
          stepLabel={copy.participantCards}
        />
        <h1>{copy.participantCards}</h1>
        <p className="learn-lead">
          {copy.join([
            copy.slatesLead(
              formatParticipantId(from),
              formatParticipantId(last),
            ),
            copy.slatesLeadAfter,
          ])}
        </p>
        <PrintButton label={copy.printPages(pageStarts.length)} />
        <p className="learn-note">
          {copy.needMore} <code>?from={last + 1}</code> {copy.needMoreAfter}
        </p>
      </div>
      <div className="learn-print-pages">
        {pageStarts.map((start) => (
          <section key={start} className="learn-print-page">
            <SlatePageSvg
              locale={locale}
              first={start}
              count={Math.min(SLATES_PER_PAGE, last - start + 1)}
            />
          </section>
        ))}
      </div>
    </main>
  );
}
