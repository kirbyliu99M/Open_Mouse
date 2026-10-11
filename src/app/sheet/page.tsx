import type { Metadata } from "next";
import Link from "next/link";
import { TopBar } from "@/components/nav/TopBar";
import { PrintButton } from "./PrintButton";
import { ID1_CARD_MM, SHEET } from "@/lib/contracts/measurement";
import { MarkerGlyph } from "@/components/sheet/MarkerGlyph";
import { computeSheetLayout } from "@/client/sheet/layout";
import { sheetCopy } from "@/lib/copy/sheet";
import { getLocale } from "@/server/i18n/getLocale";
import "./sheet.css";

export async function generateMetadata(): Promise<Metadata> {
  const copy = sheetCopy(await getLocale());
  return { title: copy.metaTitle, description: copy.metaDescription };
}

const TICK_INTERVAL_MM = 10;
const TICK_LENGTH_MM = 3;

export default async function SheetPage() {
  const copy = sheetCopy(await getLocale());
  const layout = computeSheetLayout();
  const ticks = Array.from(
    { length: layout.ruler.lengthMm / TICK_INTERVAL_MM + 1 },
    (_, i) => i * TICK_INTERVAL_MM,
  );

  return (
    <main className="sheetMain">
      <div className="instructions noPrint">
        <TopBar backHref="/" backLabel={copy.home} stepLabel={copy.stepLabel} />
        <h1>{copy.heading}</h1>
        <div className="sheet-callout">
          <h2>{copy.calloutTitle}</h2>
          <p>{copy.calloutBody}</p>
        </div>
      </div>

      <div className="printPage">
        <svg
          width={`${layout.pageWidthMm}mm`}
          height={`${layout.pageHeightMm}mm`}
          viewBox={`0 0 ${layout.pageWidthMm} ${layout.pageHeightMm}`}
          xmlns="http://www.w3.org/2000/svg"
        >
          <rect
            x={0}
            y={0}
            width={layout.pageWidthMm}
            height={layout.pageHeightMm}
            fill="white"
          />

          {/* Upright flap (folds up): the two-marker strip for the side shot. */}
          <text
            x={layout.pageWidthMm / 2}
            y={10}
            fontSize={3.5}
            textAnchor="middle"
          >
            {copy.svgStrip}
          </text>
          {layout.markers
            .filter((m) =>
              (SHEET.uprightMarkerIds as readonly number[]).includes(m.id),
            )
            .map((m) => (
              <MarkerGlyph key={m.id} marker={m} />
            ))}

          {/* Fold line. */}
          <line
            x1={layout.foldLine.start.x}
            y1={layout.foldLine.start.y}
            x2={layout.foldLine.end.x}
            y2={layout.foldLine.end.y}
            stroke="black"
            strokeWidth={0.4}
            strokeDasharray="4 2"
          />
          <text
            x={layout.foldLine.start.x}
            y={layout.foldLine.start.y - 3}
            fontSize={3.5}
            fontWeight="bold"
          >
            {copy.svgFoldUp}
          </text>
          <text
            x={layout.foldLine.start.x}
            y={layout.foldLine.start.y + 6}
            fontSize={3.5}
            fontWeight="bold"
          >
            {copy.svgLayFlat}
          </text>

          {/* Flat flap (lays flat on the table): the 4-marker top-down plane. */}
          {layout.markers
            .filter((m) =>
              (SHEET.flatMarkerIds as readonly number[]).includes(m.id),
            )
            .map((m) => (
              <MarkerGlyph key={m.id} marker={m} />
            ))}

          {/* Verification ruler. */}
          <line
            x1={layout.ruler.start.x}
            y1={layout.ruler.start.y}
            x2={layout.ruler.end.x}
            y2={layout.ruler.end.y}
            stroke="black"
            strokeWidth={0.3}
          />
          {ticks.map((mm) => (
            <line
              key={mm}
              x1={layout.ruler.start.x + mm}
              y1={layout.ruler.start.y - TICK_LENGTH_MM / 2}
              x2={layout.ruler.start.x + mm}
              y2={layout.ruler.start.y + TICK_LENGTH_MM / 2}
              stroke="black"
              strokeWidth={0.3}
            />
          ))}
          <text
            x={(layout.ruler.start.x + layout.ruler.end.x) / 2}
            y={layout.ruler.start.y + 8}
            fontSize={3.5}
            textAnchor="middle"
          >
            {copy.svgRuler(layout.ruler.lengthMm)}
          </text>

          {/* Card placement outline. */}
          <rect
            x={layout.cardOutline.corners[0].x}
            y={layout.cardOutline.corners[0].y}
            width={layout.cardOutline.widthMm}
            height={layout.cardOutline.heightMm}
            fill="none"
            stroke="black"
            strokeWidth={0.4}
            strokeDasharray="3 2"
          />
          <text
            x={
              (layout.cardOutline.corners[0].x +
                layout.cardOutline.corners[1].x) /
              2
            }
            y={layout.cardOutline.corners[0].y - 3}
            fontSize={3.5}
            textAnchor="middle"
          >
            {copy.svgCard(ID1_CARD_MM.width, ID1_CARD_MM.height)}
          </text>

          {/* Prominent print-scale warning, on the printed sheet itself. */}
          <text
            x={layout.pageWidthMm / 2}
            y={layout.pageHeightMm - 6}
            fontSize={6}
            fontWeight="bold"
            textAnchor="middle"
          >
            {copy.svgWarning}
          </text>
        </svg>
      </div>
      <div className="sheet-after noPrint">
        <p>{copy.after}</p>
        <PrintButton />
        <Link className="sheet-secondary" href="/scan">
          {copy.continueLabel}
        </Link>
        <p className="sheet-privacy">{copy.privacy}</p>
      </div>
    </main>
  );
}
