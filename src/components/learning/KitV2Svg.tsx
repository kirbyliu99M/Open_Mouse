import { MarkerGlyph } from "@/components/sheet/MarkerGlyph";
import { QrGlyph } from "@/components/learning/KitSvg";
import {
  LEARNING_KIT_VERSION,
  formatParticipantId,
  kitCodeUrl,
} from "@/lib/learning/kit";
import {
  KIT_V2_CARD,
  KIT_V2_CARDS_PER_PAGE,
  KIT_V2_PAGE_HEIGHT_MM,
  KIT_V2_PAGE_WIDTH_MM,
  cardOrigin,
  computeKitV2Layout,
  type LayoutText,
} from "@/lib/learning/layoutv2";
import type { Line } from "@/lib/learning/layout";
import type { KitV2Sheet } from "@/lib/learning/session";

const INK = "black";
const GREY = "#8c8c8c";

const FONT = "Arial, Helvetica, sans-serif";

function Stroke({
  line,
  width = 0.4,
  colour = INK,
  dash,
}: {
  line: Line;
  width?: number;
  colour?: string;
  dash?: string;
}) {
  return (
    <line
      x1={line.start.x}
      y1={line.start.y}
      x2={line.end.x}
      y2={line.end.y}
      stroke={colour}
      strokeWidth={width}
      strokeDasharray={dash}
    />
  );
}

function Text({ t }: { t: LayoutText }) {
  return (
    <text
      x={t.x}
      y={t.y}
      fontSize={t.fontMm}
      fontWeight={t.bold ? 700 : 400}
      textAnchor={t.anchor}
      fill={t.tone === "grey" ? "#555" : INK}
    >
      {t.text}
    </text>
  );
}

/**
 * One printed kit v2 sheet: A4, left and right hand alike, no QR code of its
 * own (the participant card in the slot carries it). Everything is drawn from
 * `computeKitV2Layout`, in millimetres, so the geometry tests cover what is
 * printed.
 */
export function KitSheetSvg({ sheet }: { sheet: KitV2Sheet }) {
  const layout = computeKitV2Layout(sheet);
  return (
    <svg
      width={`${layout.widthMm}mm`}
      height={`${layout.heightMm}mm`}
      viewBox={`0 0 ${layout.widthMm} ${layout.heightMm}`}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={`Learning kit v${LEARNING_KIT_VERSION} sheet ${sheet}: both hands, participant card slot at the top`}
      fontFamily={FONT}
    >
      <rect width={layout.widthMm} height={layout.heightMm} fill="white" />

      {layout.markers.map((m) => (
        <MarkerGlyph key={m.id} marker={m} label={false} />
      ))}

      {layout.slotTicks.map((l, i) => (
        <Stroke key={`slot-${i}`} line={l} width={0.5} colour="#555" />
      ))}

      {layout.centreLine && (
        <Stroke line={layout.centreLine} colour={GREY} dash="3 2" />
      )}
      {layout.wristLine && (
        <g>
          <Stroke line={layout.wristLine} colour={GREY} dash="3 2" />
          {[layout.wristLine.start, layout.wristLine.end].map((p, i) => (
            <Stroke
              key={`wrist-end-${i}`}
              line={{
                start: { x: p.x, y: p.y - 3 },
                end: { x: p.x, y: p.y + 3 },
              }}
              colour={GREY}
            />
          ))}
        </g>
      )}
      {layout.edgeTicks.map((l, i) => (
        <Stroke key={`edge-${i}`} line={l} width={0.5} colour={GREY} />
      ))}

      {layout.check.lines.map((l, i) => (
        <Stroke
          key={`check-${i}`}
          line={l}
          colour={layout.check.kind === "ruler" ? INK : GREY}
        />
      ))}

      {layout.texts.map((t, i) => (
        <Text key={i} t={t} />
      ))}
    </svg>
  );
}

/** One participant card at `origin` (its top-left, in page mm): the cut-out outline, the QR code and the number. */
function Card({
  participant,
  origin,
  baseUrl,
}: {
  participant: string;
  origin: { x: number; y: number };
  baseUrl?: string;
}) {
  const url = kitCodeUrl(
    {
      kind: "participant",
      version: LEARNING_KIT_VERSION,
      participant,
    },
    baseUrl,
  );
  const n = KIT_V2_CARD.number;
  return (
    <g>
      <rect
        x={origin.x}
        y={origin.y}
        width={KIT_V2_CARD.widthMm}
        height={KIT_V2_CARD.heightMm}
        fill="none"
        stroke={GREY}
        strokeWidth={0.3}
        strokeDasharray="2 1.5"
      />
      <QrGlyph
        text={url}
        box={{
          x: origin.x + KIT_V2_CARD.qr.x,
          y: origin.y + KIT_V2_CARD.qr.y,
          w: KIT_V2_CARD.qr.w,
          h: KIT_V2_CARD.qr.h,
        }}
      />
      <text
        x={origin.x + n.x}
        y={origin.y + n.y}
        fontSize={n.fontMm}
        fontWeight={700}
      >
        {participant}
      </text>
      <text x={origin.x + n.x} y={origin.y + 24} fontSize={2.4} fill="#555">
        Open Mouse · kit v{LEARNING_KIT_VERSION}
      </text>
      <text x={origin.x + n.x} y={origin.y + 27.5} fontSize={2.4} fill="#555">
        No names.
      </text>
    </g>
  );
}

/**
 * One A4 page of participant cards, to cut out and put in the sheet's slot:
 * `first` to `first + count - 1`, at most `KIT_V2_CARDS_PER_PAGE`.
 */
export function CardPageSvg({
  first,
  count,
  baseUrl,
}: {
  first: number;
  count: number;
  baseUrl?: string;
}) {
  const ids = Array.from(
    { length: Math.min(count, KIT_V2_CARDS_PER_PAGE) },
    (_, i) => first + i,
  )
    .filter((n) => n <= 999)
    .map(formatParticipantId);
  return (
    <svg
      width={`${KIT_V2_PAGE_WIDTH_MM}mm`}
      height={`${KIT_V2_PAGE_HEIGHT_MM}mm`}
      viewBox={`0 0 ${KIT_V2_PAGE_WIDTH_MM} ${KIT_V2_PAGE_HEIGHT_MM}`}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={`Kit v${LEARNING_KIT_VERSION} participant cards ${ids.join(", ")}`}
      fontFamily={FONT}
    >
      <rect
        width={KIT_V2_PAGE_WIDTH_MM}
        height={KIT_V2_PAGE_HEIGHT_MM}
        fill="white"
      />
      {ids.map((id, i) => (
        <Card
          key={id}
          participant={id}
          origin={cardOrigin(i)}
          baseUrl={baseUrl}
        />
      ))}
    </svg>
  );
}
