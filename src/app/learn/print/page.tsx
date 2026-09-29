import type { Metadata } from "next";
import { TopBar } from "@/components/nav/TopBar";
import { KitPageSvg } from "@/components/learning/KitSvg";
import {
  GESTURES,
  LEARNING_KIT_VERSION,
  kitCodeToken,
  type HandSide,
} from "@/lib/learning/kit";
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

export default async function LearnPrintPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const hands = handsFrom((await searchParams).hands);
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
            version: LEARNING_KIT_VERSION,
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
