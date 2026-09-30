"use client";

import type { PhotoOverlay } from "../photo/pipeline";
import {
  computeDimensionLine,
  separateLabelBoxes,
  type Box,
} from "../geometry/handSilhouette";
import {
  overlayUnitsPerPx,
  type FrozenPhotoLayout,
  type Size,
} from "./photoLayout";
import type { Point, Rect } from "./quad";

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export interface DimensionSpec {
  readonly a: Point;
  readonly b: Point;
  readonly label: string;
  readonly side: 1 | -1;
}

/**
 * The measured photo's two dimension lines (hand length, then palm width): a
 * simpler cousin of ScanClient's DimensionLinesOverlay (no skeleton dots,
 * matching screen 16's plain white lines), built on the same tested pure
 * geometry (computeDimensionLine, separateLabelBoxes).
 *
 * They draw in order, about 350 ms each (scan v2): the main line grows from
 * its start by a `scaleX` on a group laid along the line, and the extension
 * lines and label fade in with it, so the only properties animated are
 * transform and opacity. Which line is which comes from its index (the delay
 * is `--dim-index` in easy-scan.css).
 */
export function DimensionLinesOverlay({
  specs,
  scale,
}: {
  specs: readonly DimensionSpec[];
  /** User-space units per on-screen pixel — an SVG `viewBox` spanning a
   * multi-thousand-pixel photo makes any FIXED user-unit font-size/offset
   * render at wildly different on-screen sizes depending on the photo's own
   * resolution and how big the frame is drawn; `vector-effect:
   * non-scaling-stroke` solves this for line widths but has no text
   * equivalent, so every screen-space size below is converted through this
   * scale instead. */
  scale: number;
}) {
  const offsetPx = 22 * scale;
  const tickLengthPx = 8 * scale;
  const labelOffsetPx = 14 * scale;
  const fontSize = 13 * scale;
  const paddingX = 8 * scale;
  const labelHeight = 22 * scale;

  const geometries = specs.map((s) =>
    computeDimensionLine(
      s.a,
      s.b,
      offsetPx,
      s.side,
      tickLengthPx,
      labelOffsetPx,
    ),
  );
  const rawBoxes: Box[] = geometries.map((g, i) => ({
    x: g.labelAnchor.x,
    y: g.labelAnchor.y,
    width: specs[i].label.length * fontSize * 0.62 + paddingX * 2,
    height: labelHeight,
  }));
  const boxes =
    rawBoxes.length === 2
      ? separateLabelBoxes(rawBoxes[0], rawBoxes[1])
      : rawBoxes;

  return (
    <>
      {geometries.map((g, i) => {
        const dx = g.offsetEnd.x - g.offsetStart.x;
        const dy = g.offsetEnd.y - g.offsetStart.y;
        const length = Math.hypot(dx, dy);
        const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
        return (
          <g
            key={i}
            className="easyDim"
            style={{ "--dim-index": i } as React.CSSProperties}
          >
            <g className="easyDimFade">
              <line
                x1={g.startConnector[0].x}
                y1={g.startConnector[0].y}
                x2={g.startConnector[1].x}
                y2={g.startConnector[1].y}
                className="easyDimExtension"
              />
              <line
                x1={g.endConnector[0].x}
                y1={g.endConnector[0].y}
                x2={g.endConnector[1].x}
                y2={g.endConnector[1].y}
                className="easyDimExtension"
              />
            </g>
            <g
              transform={`translate(${g.offsetStart.x} ${g.offsetStart.y}) rotate(${angle})`}
            >
              <g className="easyDimGrow">
                <line
                  x1={0}
                  y1={0}
                  x2={length}
                  y2={0}
                  className="easyDimLine"
                />
              </g>
            </g>
          </g>
        );
      })}
      {boxes.map((box, i) => (
        <g key={i} transform={`translate(${box.x} ${box.y})`}>
          <g
            className="easyDimLabel"
            style={{ "--dim-index": i } as React.CSSProperties}
          >
            <rect
              x={-box.width / 2}
              y={-box.height / 2}
              width={box.width}
              height={box.height}
              rx={box.height / 2}
              className="easyDimLabelBg"
            />
            <text
              x={0}
              y={fontSize * 0.32}
              textAnchor="middle"
              fontSize={fontSize}
              className="easyDimLabelText"
            >
              {specs[i].label}
            </text>
          </g>
        </g>
      ))}
    </>
  );
}

export interface FrozenPhotoProps {
  readonly previewUrl: string;
  /** The still's own pixel size: the picture is drawn at this size in the SVG's user space. */
  readonly still: Size;
  /** Where the still is drawn in the stage, and which part of it. */
  readonly layout: FrozenPhotoLayout;
  readonly phase: "processing" | "measured" | "gateFailure";
  /** From the pipeline, in ITS pixel space; `null` while processing or when it gave none. */
  readonly overlay: PhotoOverlay | null;
  /** Still pixels per overlay pixel (the pipeline may analyse a scaled-down photo). */
  readonly overlayToStill: number;
  /** The scale the whole layer ends up at (0.9 once measured), so the drawing's fixed-size parts come out at their intended size. */
  readonly layerScale: number;
  /** The two dimension lines, once measured. */
  readonly dimensions: readonly DimensionSpec[] | null;
  /** The area to outline in amber, in overlay pixels. */
  readonly problem: Rect | null;
  readonly ariaLabel: string;
}

/**
 * The captured photo, drawn in the stage's own rectangle: an SVG whose
 * `viewBox` is the part of the still that the live frame showed
 * (`computeFrozenPhotoLayout`), holding the picture and, in the pipeline's
 * coordinates, the paper corners, the amber problem area and the dimension
 * lines. Picture and drawing share one coordinate system, so they cannot
 * drift apart when the layer is scaled and moved.
 */
export function FrozenPhoto({
  previewUrl,
  still,
  layout,
  phase,
  overlay,
  overlayToStill,
  layerScale,
  dimensions,
  problem,
  ariaLabel,
}: FrozenPhotoProps) {
  const { box, crop } = layout;
  // Overlay units per on-screen pixel, for sizes that must not depend on the
  // photo's own resolution (see DimensionLinesOverlay).
  const scale = overlayUnitsPerPx(layout, overlayToStill, layerScale);
  const cornerRadius = 11 * scale;
  const overlayWidth = overlay?.imageWidth || 1;
  const overlayHeight = overlay?.imageHeight || 1;
  return (
    <svg
      className="easyFrozenSvg"
      style={{
        left: box.x,
        top: box.y,
        width: box.width,
        height: box.height,
      }}
      viewBox={`${crop.x} ${crop.y} ${crop.width} ${crop.height}`}
      preserveAspectRatio="none"
      {...(phase === "processing"
        ? { "aria-hidden": true }
        : { role: "img", "aria-label": ariaLabel })}
    >
      <image
        href={previewUrl}
        x={0}
        y={0}
        width={still.width}
        height={still.height}
        preserveAspectRatio="none"
      />
      {overlay && phase !== "processing" && (
        <g transform={`scale(${overlayToStill})`}>
          {problem && (
            <rect
              className="easyProblem"
              x={problem.x}
              y={problem.y}
              width={problem.width}
              height={problem.height}
              rx={14 * scale}
            />
          )}
          {overlay.paperCorners?.map((p, i) => {
            const cx = clamp(p.x, cornerRadius, overlayWidth - cornerRadius);
            const cy = clamp(p.y, cornerRadius, overlayHeight - cornerRadius);
            return (
              <g key={i} transform={`translate(${cx} ${cy})`}>
                <g className="easyCornerCheck">
                  <circle r={cornerRadius} />
                  <path
                    d="M-6 0 L-1.5 5 L7 -6"
                    transform={`scale(${cornerRadius / 14})`}
                  />
                </g>
              </g>
            );
          })}
          {phase === "measured" && dimensions && (
            <DimensionLinesOverlay scale={scale} specs={dimensions} />
          )}
        </g>
      )}
    </svg>
  );
}
