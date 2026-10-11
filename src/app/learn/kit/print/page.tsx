import type { Metadata } from "next";
import Link from "next/link";
import { TopBar } from "@/components/nav/TopBar";
import { KitPageSvg } from "@/components/learning/KitSvg";
import { KitSheetSvg } from "@/components/learning/KitV2Svg";
import { guardDemoRouteFromProduction } from "@/app/scan/demo-guard";
import { learnCopy } from "@/lib/copy/learn";
import { getLocale } from "@/server/i18n/getLocale";
import {
  GESTURES,
  KIT_V1_VERSION,
  kitCodeToken,
  type HandSide,
} from "@/lib/learning/kit";
import { KIT_V2_SHEETS, type KitV2Sheet } from "@/lib/learning/session";
import { PrintButton } from "../PrintButton";
import "../learn.css";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: learnCopy(await getLocale()).printMetaTitle,
    robots: { index: false, follow: false },
  };
}

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

export default async function LearnPrintPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  guardDemoRouteFromProduction();
  const locale = await getLocale();
  const copy = learnCopy(locale);
  const params = await searchParams;
  const sheet = sheetFrom(params.sheet);
  if (sheet) {
    return (
      <main className="learn-print-main">
        <div className="learn noPrint">
          <TopBar
            backHref="/learn/kit"
            backLabel={copy.learningKit}
            stepLabel={copy.step}
          />
          <h1>{copy.printKitV2Sheet(sheet, sheet === "B")}</h1>
          <p className="learn-lead">
            {copy.join([
              sheet === "A" ? copy.sheetNameA : copy.sheetNameB,
              copy.printDialogV2,
              sheet === "A" ? copy.checkRulerA : copy.checkRulerB,
              copy.cardsPageBefore,
            ])}{" "}
            <Link href="/learn/kit/slates?kit=2">{copy.cardsPageLink}</Link>
            {copy.stop}
          </p>
          <PrintButton label={copy.print1Page} />
          <p className="learn-note">
            {copy.otherSheet}{" "}
            <Link href={`/learn/kit/print?sheet=${sheet === "A" ? "B" : "A"}`}>
              {copy.sheetLabel(sheet === "A" ? "B" : "A", sheet === "A")}
            </Link>
            {copy.stop}
          </p>
        </div>
        <div className="learn-print-pages">
          <section className="learn-print-page learn-print-page-a4">
            <p className="learn-print-label">{copy.kitSheetLabel(sheet)}</p>
            <KitSheetSvg sheet={sheet} locale={locale} />
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
      ? copy.handsBoth
      : hands[0] === "right"
        ? copy.handsRight
        : copy.handsLeft;

  return (
    <main className="learn-print-main">
      <div className="learn noPrint">
        <TopBar
          backHref="/learn/kit"
          backLabel={copy.learningKit}
          stepLabel={copy.step}
        />
        <h1>{copy.printTheKit}</h1>
        <p className="learn-lead">
          {copy.join([
            copy.printKitLead(pages.length, label),
            copy.printKitLeadAfter,
          ])}
        </p>
        <PrintButton label={copy.printPages(pages.length)} />
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
                {token} · {copy.gestures[gesture.code].name}
              </p>
              <KitPageSvg gesture={gesture} hand={hand} locale={locale} />
            </section>
          );
        })}
      </div>
    </main>
  );
}
