/**
 * SHADOW MODE (V3.3 WP1b, 2026-10-25, 未拍板 candidate): the hand's placement
 * read off the live viewfinder, for the local attempt log and the debug panel
 * only. Design: F20 DESIGN-placement-guidance §1.2 and §5.1. Nothing here
 * changes a cue, the ring, the auto-shutter, a measurement or an analytics
 * event: the live loop keeps the last few readings and the attempt log copies
 * them when the photo is taken.
 *
 * One reading needs no extra detector call: the hand's 21 points come from
 * the loop's existing hand reading (every `handSampleIntervalMs`), the sheet's
 * four corners from the same sample's detection. The points are
 * parallax-corrected (`placementPointsMm`, handPlacement.ts) with the video
 * frame's nominal focal length (the photo pipeline's own prior for a frame of
 * the video: 18 mm equivalent on the stream's long edge,
 * nominalFocalShadow.ts), scaled to the sample, and the landmark heights of
 * the 190 mm reference hand. Without the correction the wrist would read
 * 7.5-12.5 mm too far out (design §0 item 1, 模擬).
 *
 * `fill` is `computeQuadWidthFraction` (quad.ts), the number the live
 * too-far/too-close cue reads; the photo's `paper.widthFraction` has the same
 * definition (placementDiagnostics.ts).
 */
import type { Point2 } from "../geometry/homography";
import {
  NOMINAL_FOCAL_EQUIV_MM,
  nominalFocalPxFromLongEdge,
} from "../geometry/nominalFocalShadow";
import { buildPaperHomography } from "../paper/homography";
import {
  centredIntrinsics,
  computeHandPlacement,
  placementPointsMm,
} from "../photo/handPlacement";
import type { PaperSize } from "@/lib/contracts/measurement";
import { computeQuadWidthFraction } from "./quad";

/** How many live readings the log keeps (§5.1: "最後 3 次讀數"). */
export const LIVE_PLACEMENT_KEEP = 3;

export interface LivePlacementReading {
  /** performance.now() of the hand reading. */
  readonly atMs: number;
  /** Sheet width over the sample's width (the live 紙占寬). */
  readonly fill: number | null;
  readonly wristToEdgeMm: number | null;
  readonly handAxisDeg: number | null;
  readonly palmOverHand: number | null;
}

/** What made the shutter fire: the ring, the person's tap, or F14's hand-held-still shot. */
export type ShutterKind = "auto" | "manual" | "no-sheet";

export interface LiveGuidance {
  readonly shutter: ShutterKind;
  /** The last readings before the shutter, oldest first (at most `LIVE_PLACEMENT_KEEP`). */
  readonly live: readonly LivePlacementReading[];
}

/**
 * The live sample's focal length in px: the nominal video-frame prior on the
 * whole stream's long edge, scaled from the on-screen part to the sample.
 * `null` for a size that is not positive. Pure.
 */
export function liveNominalFocalPx(
  stream: { readonly width: number; readonly height: number },
  visibleWidth: number,
  sampleWidth: number,
): number | null {
  const f = nominalFocalPxFromLongEdge(
    Math.max(stream.width, stream.height),
    NOMINAL_FOCAL_EQUIV_MM,
  );
  if (f === null) return null;
  if (!(Number.isFinite(visibleWidth) && visibleWidth > 0)) return null;
  if (!(Number.isFinite(sampleWidth) && sampleWidth > 0)) return null;
  return f * (sampleWidth / visibleWidth);
}

function finiteCorners(
  corners: readonly (Point2 | null | undefined)[] | null | undefined,
): corners is readonly [Point2, Point2, Point2, Point2] {
  return (
    Array.isArray(corners) &&
    corners.length === 4 &&
    corners.every(
      (p) =>
        !!p &&
        typeof p.x === "number" &&
        typeof p.y === "number" &&
        Number.isFinite(p.x) &&
        Number.isFinite(p.y),
    )
  );
}

/**
 * One live placement reading, or `null` without a hand, four corners, a
 * focal length or a usable homography. Never throws. Pure.
 */
export function readLivePlacement(input: {
  readonly atMs: number;
  readonly points: readonly Point2[] | null | undefined;
  /** The detection's four corners (TL, TR, BR, BL) in the sample's px, or null. */
  readonly corners: readonly (Point2 | null)[] | null | undefined;
  readonly paperSize: PaperSize;
  readonly focalPx: number | null;
  readonly width: number;
  readonly height: number;
}): LivePlacementReading | null {
  const { corners, focalPx, width, height } = input;
  if (!input.points || !finiteCorners(corners)) return null;
  if (focalPx === null || !(focalPx > 0)) return null;
  if (!(width > 0) || !(height > 0)) return null;
  try {
    const homography = buildPaperHomography(corners, input.paperSize);
    const pointsMm = placementPointsMm(
      input.points,
      homography,
      centredIntrinsics(focalPx, width, height),
    );
    if (!pointsMm) return null;
    const placement = computeHandPlacement(pointsMm, input.paperSize);
    const fill = computeQuadWidthFraction(
      {
        topLeft: corners[0],
        topRight: corners[1],
        bottomRight: corners[2],
        bottomLeft: corners[3],
      },
      width,
    );
    return {
      atMs: input.atMs,
      fill: Number.isFinite(fill) ? fill : null,
      wristToEdgeMm: placement.wristToEdgeMm,
      handAxisDeg: placement.handAxisDeg,
      palmOverHand: placement.palmOverHand,
    };
  } catch {
    return null;
  }
}

/** `list` with `reading` added at the end, only the newest `max` kept. Pure. */
export function pushLivePlacement(
  list: readonly LivePlacementReading[],
  reading: LivePlacementReading,
  max: number = LIVE_PLACEMENT_KEEP,
): LivePlacementReading[] {
  const next = [...list, reading];
  const keep = Math.max(1, Math.floor(max));
  return next.length > keep ? next.slice(next.length - keep) : next;
}

/**
 * Which shutter fired, from the two auto-shutter flags of the sample that
 * fired it; a call that did not come from the loop is the person's tap. The
 * ring wins when both fired on the same sample (the sheet was found). Pure.
 */
export function shutterKindOf(fired: {
  readonly autoCapture: boolean;
  readonly noSheet: boolean;
}): ShutterKind {
  if (fired.autoCapture) return "auto";
  if (fired.noSheet) return "no-sheet";
  return "manual";
}

// ── Experiment tags (debug panel only) ───────────────────────────────────

/**
 * The experiment tags of WP2's real scans (design §5.2): wrist position
 * (aligned / up 2 cm / up 4 cm) × paper fill, plus the four extra scans.
 * Picked by hand in the debug panel (`?debug=1`) and written to the next
 * scan's record; an ordinary visitor never sees or sets one.
 */
export const EXPERIMENT_TAGS = [
  "aligned/0.50",
  "aligned/0.65",
  "aligned/0.80",
  "up2/0.50",
  "up2/0.65",
  "up2/0.80",
  "up4/0.50",
  "up4/0.65",
  "up4/0.80",
  "pencil/0.65",
  "arched/0.65",
  "tilt10/0.65",
] as const;
export type ExperimentTag = (typeof EXPERIMENT_TAGS)[number];

export function isExperimentTag(value: unknown): value is ExperimentTag {
  return (
    typeof value === "string" &&
    (EXPERIMENT_TAGS as readonly string[]).includes(value)
  );
}
