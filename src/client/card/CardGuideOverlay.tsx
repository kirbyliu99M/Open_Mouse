"use client";

/**
 * v3.4 card reference (candidate 未拍板): draws the G-M2 v3 overlay
 * (`hand/guides/gm2.ts`: hand brackets, the middle-finger centre tick, the
 * faint wrist line, the card slot, the spirit level, the overflow arrows,
 * the wrist dot) over the live camera. The shapes are in view coordinates
 * (0..1 of the on-screen picture), which is the stage: the stage shows the
 * stream with object-fit: cover and the live sample is that same part.
 *
 * The card slot carries `data-tour="card-slot"` for the scan tour.
 */
import type { CardReferenceCopy } from "../../lib/copy/card-reference";
import { GUIDE_COPY } from "./hand/guideCopy";
import type { OverlayShape, Tone } from "./hand/guides/types";

const TONE: Record<Tone, string> = {
  neutral: "rgba(255,255,255,0.85)",
  ok: "#34c759",
  warn: "#ffcc00",
  fail: "#ff453a",
  accent: "#0a84ff",
};

/** The lab's zh-TW overlay words, swapped for this locale's. */
export function overlayLabel(text: string, copy: CardReferenceCopy): string {
  switch (text) {
    case "中軸":
      return copy.axis;
    case "手腕大約在這附近":
      return copy.wristLine;
    case GUIDE_COPY.handZone:
      return copy.handZone;
    case GUIDE_COPY.cardZone:
      return copy.cardZone;
    default:
      return text;
  }
}

function Lines({
  text,
  x,
  y,
  anchor,
  fill,
  size,
}: {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly anchor: "start" | "middle" | "end";
  readonly fill: string;
  readonly size: number;
}) {
  const lines = text.split("\n");
  const top = y - ((lines.length - 1) * size * 1.2) / 2;
  return (
    <text
      x={x}
      y={top}
      textAnchor={anchor}
      fill={fill}
      fontSize={size}
      fontWeight={600}
      style={{
        paintOrder: "stroke",
        stroke: "rgba(0,0,0,0.55)",
        strokeWidth: 3,
      }}
    >
      {lines.map((line, i) => (
        <tspan key={i} x={x} dy={i === 0 ? 0 : size * 1.2}>
          {line}
        </tspan>
      ))}
    </text>
  );
}

export function CardGuideOverlay({
  shapes,
  width,
  height,
  copy,
}: {
  readonly shapes: readonly OverlayShape[];
  readonly width: number;
  readonly height: number;
  readonly copy: CardReferenceCopy;
}) {
  if (!(width > 0) || !(height > 0)) return null;
  const X = (x: number) => x * width;
  const Y = (y: number) => y * height;
  return (
    <svg
      className="cardGuideOverlay"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        zIndex: 2,
      }}
    >
      {shapes.map((s, i) => {
        switch (s.kind) {
          case "brackets": {
            const x0 = X(s.rect.x);
            const y0 = Y(s.rect.y);
            const x1 = X(s.rect.x + s.rect.width);
            const y1 = Y(s.rect.y + s.rect.height);
            const arm = (s.arm ?? 0.06) * width;
            const c = TONE[s.tone];
            const d = [
              `M${x0} ${y0 + arm}V${y0}H${x0 + arm}`,
              `M${x1 - arm} ${y0}H${x1}V${y0 + arm}`,
              `M${x1} ${y1 - arm}V${y1}H${x1 - arm}`,
              `M${x0 + arm} ${y1}H${x0}V${y1 - arm}`,
            ].join("");
            return (
              <g key={i} data-card-guide="hand-zone">
                {s.fill && (
                  <rect
                    x={x0}
                    y={y0}
                    width={x1 - x0}
                    height={y1 - y0}
                    fill="rgba(255,255,255,0.06)"
                  />
                )}
                <path
                  d={d}
                  fill="none"
                  stroke={c}
                  strokeWidth={4}
                  strokeLinecap="round"
                />
                {s.label && (
                  <Lines
                    text={overlayLabel(s.label, copy)}
                    x={(x0 + x1) / 2}
                    y={(y0 + y1) / 2}
                    anchor="middle"
                    fill={TONE.neutral}
                    size={18}
                  />
                )}
              </g>
            );
          }
          case "line":
            return (
              <line
                key={i}
                x1={X(s.from.x)}
                y1={Y(s.from.y)}
                x2={X(s.to.x)}
                y2={Y(s.to.y)}
                stroke={TONE[s.tone]}
                strokeWidth={s.width ?? 3}
                strokeDasharray={s.dashed ? "6 6" : undefined}
                opacity={0.8}
              />
            );
          case "polyline":
            return (
              <polyline
                key={i}
                points={s.points.map((p) => `${X(p.x)},${Y(p.y)}`).join(" ")}
                fill="none"
                stroke={TONE[s.tone]}
                strokeWidth={s.width ?? 3}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            );
          case "zone": {
            const x = X(s.rect.x);
            const y = Y(s.rect.y);
            const w = s.rect.width * width;
            const h = s.rect.height * height;
            return (
              <g
                key={i}
                data-tour={s.card ? "card-slot" : undefined}
                opacity={s.faded ? 0.55 : 1}
              >
                <rect
                  x={x}
                  y={y}
                  width={w}
                  height={h}
                  rx={10}
                  fill="rgba(255,255,255,0.05)"
                  stroke={TONE[s.tone]}
                  strokeWidth={2}
                  strokeDasharray={s.dashed ? "8 6" : undefined}
                />
                {s.card && (
                  // A small card sign (not to scale).
                  <rect
                    x={x + w / 2 - w * 0.22}
                    y={y + h / 2 - w * 0.35}
                    width={w * 0.44}
                    height={w * 0.7}
                    rx={4}
                    fill="none"
                    stroke={TONE.neutral}
                    strokeWidth={1.5}
                    opacity={0.7}
                  />
                )}
                {s.label && !s.faded && (
                  <Lines
                    text={overlayLabel(s.label, copy)}
                    x={x + w / 2}
                    y={y + h + 22}
                    anchor="middle"
                    fill={TONE.neutral}
                    size={15}
                  />
                )}
              </g>
            );
          }
          case "label":
            return (
              <Lines
                key={i}
                text={overlayLabel(s.text, copy)}
                x={X(s.at.x)}
                y={Y(s.at.y)}
                anchor={s.anchor ?? "start"}
                fill={TONE[s.tone]}
                size={13}
              />
            );
          case "dot":
            return (
              <circle
                key={i}
                cx={X(s.at.x)}
                cy={Y(s.at.y)}
                r={s.r ?? 6}
                fill={TONE[s.tone]}
                stroke="rgba(0,0,0,0.5)"
                strokeWidth={1.5}
              />
            );
          case "skeleton":
            return null;
          case "level": {
            const at = s.at ?? { x: 0.88, y: 0.07 };
            const cx = X(at.x);
            const cy = Y(at.y);
            const r = 18;
            // The bubble moves out with the tilt, at the rim from 8°.
            const t = s.tiltDeg === null ? 0 : Math.min(1, s.tiltDeg / 8);
            return (
              <g key={i}>
                <circle
                  cx={cx}
                  cy={cy}
                  r={r}
                  fill="rgba(0,0,0,0.35)"
                  stroke={TONE[s.tone]}
                  strokeWidth={2}
                />
                <circle
                  cx={cx}
                  cy={cy}
                  r={r * 0.35}
                  fill="none"
                  stroke={TONE.neutral}
                  strokeWidth={1}
                  opacity={0.6}
                />
                {s.tiltDeg !== null && (
                  <circle
                    cx={cx + t * (r - 6)}
                    cy={cy}
                    r={5}
                    fill={TONE[s.tone]}
                  />
                )}
              </g>
            );
          }
          default:
            return null;
        }
      })}
    </svg>
  );
}
