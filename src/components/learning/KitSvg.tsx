import { MarkerGlyph } from "@/components/sheet/MarkerGlyph";
import {
  KIT_V1_VERSION,
  formatParticipantId,
  kitCodeToken,
  kitCodeUrl,
  type Gesture,
  type HandSide,
  type KitCode,
} from "@/lib/learning/kit";
import { computeKitLayout, type Line, type Rect } from "@/lib/learning/layout";
import { QR_QUIET_MODULES, qrDarkRuns, qrMatrix } from "@/lib/learning/qr";

const INK = "black";
const GUIDE = "#8a8a92";
const RULER_TICK_MM = 10;

const handWord = (hand: HandSide) => (hand === "right" ? "Right" : "Left");

/** A QR code filling `box` including its quiet zone, on white. */
export function QrGlyph({ text, box }: { text: string; box: Rect }) {
  const matrix = qrMatrix(text);
  const moduleMm = box.w / (matrix.size + 2 * QR_QUIET_MODULES);
  const ox = box.x + QR_QUIET_MODULES * moduleMm;
  const oy = box.y + QR_QUIET_MODULES * moduleMm;
  return (
    <g>
      <rect x={box.x} y={box.y} width={box.w} height={box.h} fill="white" />
      {qrDarkRuns(matrix).map((r) => (
        <rect
          key={`${r.x}-${r.y}`}
          x={ox + r.x * moduleMm}
          y={oy + r.y * moduleMm}
          // A hair of overlap closes the anti-aliasing seams between runs.
          width={r.w * moduleMm + 0.01}
          height={moduleMm + 0.01}
          fill={INK}
        />
      ))}
    </g>
  );
}

function Ruler({ line }: { line: Line }) {
  const length = line.end.x - line.start.x;
  const ticks = Array.from(
    { length: length / RULER_TICK_MM + 1 },
    (_, i) => i * RULER_TICK_MM,
  );
  return (
    <g>
      <line
        x1={line.start.x}
        y1={line.start.y}
        x2={line.end.x}
        y2={line.end.y}
        stroke={INK}
        strokeWidth={0.3}
      />
      {ticks.map((mm) => (
        <line
          key={mm}
          x1={line.start.x + mm}
          y1={line.start.y - 1.5}
          x2={line.start.x + mm}
          y2={line.start.y + 1.5}
          stroke={INK}
          strokeWidth={0.3}
        />
      ))}
    </g>
  );
}

/**
 * One printed page of the learning kit: a pose for one hand. Drawn at
 * exactly 210 × 265 mm; `/learn/print` sizes the SVG in mm for print.
 */
export function KitPageSvg({
  gesture,
  hand,
  baseUrl,
}: {
  gesture: Gesture;
  hand: HandSide;
  baseUrl?: string;
}) {
  const code: KitCode = {
    kind: "gesture",
    version: KIT_V1_VERSION,
    gesture: gesture.code,
    hand,
  };
  const token = kitCodeToken(code);
  const url = kitCodeUrl(code, baseUrl);
  const layout = computeKitLayout(gesture.camera);
  const side = layout.camera === "side";
  const title = layout.titleBox;
  const midX = layout.widthMm / 2;
  const shots = `${gesture.shots} photos`;

  return (
    <svg
      width={`${layout.widthMm}mm`}
      height={`${layout.heightMm}mm`}
      viewBox={`0 0 ${layout.widthMm} ${layout.heightMm}`}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={`Learning kit page ${token}: ${gesture.name}, ${handWord(hand).toLowerCase()} hand`}
      fontFamily="system-ui, sans-serif"
    >
      <rect width={layout.widthMm} height={layout.heightMm} fill="white" />

      {side ? (
        <g>
          <text
            x={midX}
            y={title.y + 6}
            fontSize={4.6}
            fontWeight={700}
            textAnchor="middle"
          >
            {token} · {gesture.name} · {handWord(hand)} hand · {shots}
          </text>
          <text x={midX} y={title.y + 11.5} fontSize={3} textAnchor="middle">
            Open Mouse learning kit v{KIT_V1_VERSION}. Print at 100%. Fold along
            the dashed line and stand the flap up.
          </text>
        </g>
      ) : (
        <g>
          <text x={midX} y={8} fontSize={3} textAnchor="middle">
            Open Mouse learning kit v{KIT_V1_VERSION}. Print at 100% / Actual
            size.
          </text>
          <text
            x={midX}
            y={title.y + 12}
            fontSize={10}
            fontWeight={700}
            textAnchor="middle"
          >
            {token}
          </text>
          <text
            x={midX}
            y={title.y + 19}
            fontSize={3.8}
            fontWeight={600}
            textAnchor="middle"
          >
            {gesture.name}
          </text>
          <text x={midX} y={title.y + 24.5} fontSize={3.2} textAnchor="middle">
            {handWord(hand)} hand · {shots}
          </text>
        </g>
      )}

      {layout.qr.map((box, i) => (
        <g key={i}>
          <QrGlyph text={url} box={box} />
          <text
            x={box.x + box.w / 2}
            y={box.y + box.h + 3.6}
            fontSize={3.2}
            fontWeight={600}
            textAnchor="middle"
          >
            {token}
          </text>
        </g>
      ))}

      {layout.markers.map((m) => (
        <MarkerGlyph key={m.id} marker={m} />
      ))}

      {/* Fold line */}
      <line
        x1={15}
        y1={layout.foldY}
        x2={layout.widthMm - 15}
        y2={layout.foldY}
        stroke={INK}
        strokeWidth={0.4}
        strokeDasharray="4 2"
      />
      <text x={15} y={layout.foldY - 3} fontSize={3.4} fontWeight={700}>
        {side
          ? "▲ fold this flap up and stand it against a book"
          : "Keep this flap flat for this pose"}
      </text>

      {side ? (
        <g>
          <text x={15} y={layout.guideLine.start.y} fontSize={3.4}>
            Lay the hand along the fold, its little-finger edge touching the
            folded-up strip.
          </text>
          {/* Finger direction: right hand points left, left hand points right. */}
          <g stroke={GUIDE} strokeWidth={0.8} fill="none">
            {hand === "right" ? (
              <>
                <line x1={150} y1={140} x2={62} y2={140} />
                <polyline points="68,135 62,140 68,145" />
              </>
            ) : (
              <>
                <line x1={60} y1={140} x2={148} y2={140} />
                <polyline points="142,135 148,140 142,145" />
              </>
            )}
          </g>
          <text
            x={midX}
            y={151}
            fontSize={3.4}
            textAnchor="middle"
            fill={GUIDE}
          >
            Fingers point this way ({handWord(hand).toLowerCase()} hand)
          </text>
          <text x={midX} y={170} fontSize={3.4} textAnchor="middle">
            Camera: lens at table height, facing the upright strip, about 40 cm
            away.
          </text>
        </g>
      ) : (
        <g>
          <line
            x1={layout.guideLine.start.x}
            y1={layout.guideLine.start.y}
            x2={layout.guideLine.end.x}
            y2={layout.guideLine.end.y}
            stroke={GUIDE}
            strokeWidth={0.35}
            strokeDasharray="3 2"
          />
          <text
            x={layout.guideLine.start.x + 2}
            y={layout.guideLine.start.y + 4}
            fontSize={3}
            fill={GUIDE}
          >
            middle finger along this line
          </text>
          {layout.wristLine && (
            <g>
              <line
                x1={layout.wristLine.start.x}
                y1={layout.wristLine.start.y}
                x2={layout.wristLine.end.x}
                y2={layout.wristLine.end.y}
                stroke={INK}
                strokeWidth={0.5}
              />
              <text
                x={midX}
                y={layout.wristLine.start.y + 5}
                fontSize={3}
                textAnchor="middle"
              >
                wrist crease on this line
              </text>
            </g>
          )}
        </g>
      )}

      <Ruler line={layout.ruler} />
      <text
        x={midX}
        y={layout.ruler.start.y + 6.5}
        fontSize={3.2}
        textAnchor="middle"
      >
        Check with a real ruler: this line is exactly 100 mm.
      </text>
    </svg>
  );
}

const SLATE_COLS = 2;
const SLATE_ROWS = 4;
export const SLATES_PER_PAGE = SLATE_COLS * SLATE_ROWS;
const SLATE_W = 88;
const SLATE_H = 60;
const SLATE_GAP = 4;
const SLATE_QR = 34;
/** Where the Right and Left write-in columns sit inside a card (mm from its left edge). */
const SLATE_HANDS = [
  { label: "Right", x0: 27, x1: 54 },
  { label: "Left", x0: 58, x1: 85 },
] as const;

/** One A4 page of participant slates: cut out, write the ruler values, photograph first. */
export function SlatePageSvg({
  first,
  count,
  baseUrl,
}: {
  first: number;
  count: number;
  baseUrl?: string;
}) {
  const ids = Array.from(
    { length: Math.min(count, SLATES_PER_PAGE) },
    (_, i) => first + i,
  ).filter((n) => n <= 999);
  return (
    <svg
      width="210mm"
      height="265mm"
      viewBox="0 0 210 265"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={`Participant slates ${ids.map(formatParticipantId).join(", ")}`}
      fontFamily="system-ui, sans-serif"
    >
      <rect width={210} height={265} fill="white" />
      {ids.map((n, i) => {
        const id = formatParticipantId(n);
        const x = 15 + (i % SLATE_COLS) * (SLATE_W + SLATE_GAP);
        const y = 6 + Math.floor(i / SLATE_COLS) * (SLATE_H + SLATE_GAP);
        const url = kitCodeUrl(
          {
            kind: "participant",
            version: KIT_V1_VERSION,
            participant: id,
          },
          baseUrl,
        );
        const tx = x + SLATE_QR + 6;
        return (
          <g key={id}>
            <rect
              x={x}
              y={y}
              width={SLATE_W}
              height={SLATE_H}
              fill="none"
              stroke={GUIDE}
              strokeWidth={0.3}
              strokeDasharray="2 1.5"
            />
            <QrGlyph
              text={url}
              box={{ x: x + 3, y: y + 3, w: SLATE_QR, h: SLATE_QR }}
            />
            <text x={tx} y={y + 15} fontSize={10} fontWeight={700}>
              {id}
            </text>
            <text x={tx} y={y + 29} fontSize={2.6} fill={GUIDE}>
              No names.
            </text>
            <text x={tx} y={y + 33} fontSize={2.6} fill={GUIDE}>
              Photograph this card first.
            </text>
            {/* Ruler values, one set per hand (docs/learning/README.md, "Ruler protocol"). */}
            <text x={x + 3} y={y + 41} fontSize={3.2} fontWeight={600}>
              Ruler, in mm
            </text>
            {SLATE_HANDS.map((hand) => (
              <text
                key={hand.label}
                x={x + hand.x0}
                y={y + 41}
                fontSize={3.2}
                fontWeight={600}
              >
                {hand.label}
              </text>
            ))}
            {["Hand length", "Palm width"].map((label, k) => (
              <g key={label}>
                <text x={x + 3} y={y + 49 + k * 8} fontSize={3.2}>
                  {label}
                </text>
                {SLATE_HANDS.map((hand) => (
                  <line
                    key={hand.label}
                    x1={x + hand.x0}
                    y1={y + 50 + k * 8}
                    x2={x + hand.x1}
                    y2={y + 50 + k * 8}
                    stroke={GUIDE}
                    strokeWidth={0.25}
                  />
                ))}
              </g>
            ))}
          </g>
        );
      })}
    </svg>
  );
}
