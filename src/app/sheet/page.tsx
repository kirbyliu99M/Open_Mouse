import type { Metadata } from "next";
import { ID1_CARD_MM, SHEET } from "@/lib/contracts/measurement";
import {
  ARUCO_MARKER_MODULES,
  markerBitGrid,
} from "@/client/sheet/aruco-codes";
import { computeSheetLayout, type MarkerLayout } from "@/client/sheet/layout";
import "./sheet.css";

export const metadata: Metadata = {
  title: "Calibration sheet — Open_Mouse",
  description:
    "Printable ArUco calibration sheet for measuring your hand from a photo.",
};

const TICK_INTERVAL_MM = 10;
const TICK_LENGTH_MM = 3;

function MarkerGlyph({ marker }: { marker: MarkerLayout }) {
  const grid = markerBitGrid(marker.id);
  const moduleSizeMm = marker.sizeMm / ARUCO_MARKER_MODULES;
  const outerTopLeft = marker.corners[0];
  const isFlat = (SHEET.flatMarkerIds as readonly number[]).includes(marker.id);
  // Point the id label into the marker square's interior so it never
  // strays into the page margin.
  const labelY = isFlat
    ? marker.id === SHEET.flatMarkerIds[2] ||
      marker.id === SHEET.flatMarkerIds[3]
      ? marker.corners[0].y - 2
      : marker.corners[3].y + 4.5
    : marker.corners[3].y + 4.5;

  return (
    <g>
      <rect
        x={outerTopLeft.x}
        y={outerTopLeft.y}
        width={marker.sizeMm}
        height={marker.sizeMm}
        fill="black"
      />
      {grid.map((row, gy) =>
        row.map(
          (isWhite, gx) =>
            isWhite && (
              <rect
                key={`${marker.id}-${gx}-${gy}`}
                x={outerTopLeft.x + (gx + 1) * moduleSizeMm}
                y={outerTopLeft.y + (gy + 1) * moduleSizeMm}
                width={moduleSizeMm}
                height={moduleSizeMm}
                fill="white"
              />
            ),
        ),
      )}
      <text
        x={marker.centre.x}
        y={labelY}
        fontSize={3.2}
        textAnchor="middle"
        fill="black"
      >
        id {marker.id}
      </text>
    </g>
  );
}

export default function SheetPage() {
  const layout = computeSheetLayout();
  const ticks = Array.from(
    { length: layout.ruler.lengthMm / TICK_INTERVAL_MM + 1 },
    (_, i) => i * TICK_INTERVAL_MM,
  );

  return (
    <main>
      <div className="instructions noPrint">
        <p className="eyebrow">Open_Mouse</p>
        <h1>Calibration sheet</h1>
        <p>
          Print this page, then lay your hand flat on it next to a bank card and
          photograph both together. The sheet, your hand and the card never
          leave your device — only the millimetre measurements computed from the
          photo are sent anywhere.
        </p>
        <p>
          <strong>
            Print at 100% / Actual size — do not &quot;fit to page&quot;.
          </strong>{" "}
          Any browser print dialog&apos;s scale-to-fit option will make every
          measurement wrong.
        </p>
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
            Side-shot strip (fold this flap up against a wall)
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
            ▲ fold up
          </text>
          <text
            x={layout.foldLine.start.x}
            y={layout.foldLine.start.y + 6}
            fontSize={3.5}
            fontWeight="bold"
          >
            ▼ lay flat
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
            Check this is exactly {layout.ruler.lengthMm} mm
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
            Place any bank card here ({ID1_CARD_MM.width} × {ID1_CARD_MM.height}{" "}
            mm)
          </text>

          {/* Prominent print-scale warning, on the printed sheet itself. */}
          <text
            x={layout.pageWidthMm / 2}
            y={layout.pageHeightMm - 6}
            fontSize={6}
            fontWeight="bold"
            textAnchor="middle"
          >
            Print at 100% / Actual size — do not &quot;fit to page&quot;
          </text>
        </svg>
      </div>
    </main>
  );
}
