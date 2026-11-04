/**
 * v3.4 card reference (2026-11-05, candidate 未拍板): the easy scan's live
 * check in card mode, G-M2 v3 (`hand/guides/gm2.ts`, `hand/gm2Rules.ts`,
 * ported from the scan lab). The live loop hands in the hand it read on its
 * sample (sample px) and the phone's live tilt; this returns the G-M2
 * evaluation (checks + overlay, VIEW coordinates 0..1 of the on-screen
 * picture), whether the auto shutter may fill, and which hint to show.
 * The shutter itself is the product's (`advanceAutoCapture`, the same ring
 * as the paper path). Pure.
 */
import type { CardFailureCode } from "./detect/detectCard";
import { GM2_COPY, gm2Layout } from "./hand/gm2Rules";
import { gm2 } from "./hand/guides/gm2";
import type {
  GuideCheck,
  GuideEvaluation,
  GuideHand,
  HandSide,
} from "./hand/guides/types";
import { checksAllowShutter, firstProblem } from "./hand/guideState";
import { movementFraction, type Pt } from "./hand/handGeometry";
import type { CardReferenceCopy } from "../../lib/copy/card-reference";

/** One live hand reading in view coordinates (0..1). */
export interface CardLiveHand {
  readonly points: readonly Pt[];
  readonly atMs: number;
}

/** Sample px → view 0..1 (the sample IS the on-screen picture, scaled). */
export function toViewHand(
  pointsPx: readonly Pt[],
  sample: { readonly width: number; readonly height: number },
  atMs: number,
): CardLiveHand | null {
  if (pointsPx.length !== 21 || !(sample.width > 0) || !(sample.height > 0))
    return null;
  return {
    points: pointsPx.map((p) => ({
      x: p.x / sample.width,
      y: p.y / sample.height,
    })),
    atMs,
  };
}

export interface CardLiveInput {
  readonly hand: CardLiveHand | null;
  readonly previousHand: CardLiveHand | null;
  readonly side: HandSide;
  /** The sample's size, px (its aspect is the view's). */
  readonly view: { readonly width: number; readonly height: number };
  readonly tiltDeg: number | null;
  readonly detectorReady: boolean;
  readonly nowMs: number;
}

export interface CardLiveStep {
  readonly evaluation: GuideEvaluation;
  /** No blocking check fails: the ring may fill. */
  readonly passing: boolean;
  /** The check whose hint is shown, or `null` when everything passes. */
  readonly problem: GuideCheck | null;
}

/** View-0..1 points → view px, for a movement over the view's diagonal. */
function viewPx(
  points: readonly Pt[],
  view: { readonly width: number; readonly height: number },
): Pt[] {
  return points.map((p) => ({ x: p.x * view.width, y: p.y * view.height }));
}

/** One sample's G-M2 v3 judgement. */
export function evaluateCardLive(input: CardLiveInput): CardLiveStep {
  const hand: GuideHand | null = input.hand
    ? { points: input.hand.points, z: null, atMs: input.hand.atMs }
    : null;
  const previousHand: GuideHand | null = input.previousHand
    ? {
        points: input.previousHand.points,
        z: null,
        atMs: input.previousHand.atMs,
      }
    : null;
  const movement =
    hand && previousHand
      ? movementFraction(
          viewPx(previousHand.points, input.view),
          viewPx(hand.points, input.view),
          input.view,
        )
      : null;
  const evaluation = gm2.evaluate({
    hand,
    previousHand,
    movement,
    side: input.side,
    view: input.view,
    tiltDeg: input.tiltDeg,
    detectorReady: input.detectorReady,
    paper: null,
    nowMs: input.nowMs,
  });
  return {
    evaluation,
    passing: checksAllowShutter(evaluation.checks),
    problem: firstProblem(evaluation.checks),
  };
}

export type CardHintKey =
  | "hintLoading"
  | "hintNoHand"
  | "hintInFrame"
  | "hintCloser"
  | "hintHigher"
  | "hintWristUp"
  | "hintWristDown"
  | "hintAxis"
  | "hintFingers"
  | "hintTilt"
  | "hintSteady"
  | "hintOk";

/** The copy key for a G-M2 check's hint (its id, and for two checks its direction). */
export function cardHintKey(problem: GuideCheck | null): CardHintKey {
  if (!problem) return "hintOk";
  switch (problem.id) {
    case "detector":
      return "hintLoading";
    case "hand":
      return "hintNoHand";
    case "inFrame":
      return "hintInFrame";
    case "distance":
      return problem.hint === GM2_COPY.higher ? "hintHigher" : "hintCloser";
    case "wrist":
      return problem.hint === GM2_COPY.wristDown
        ? "hintWristDown"
        : problem.hint === GM2_COPY.inFrame
          ? "hintInFrame"
          : "hintWristUp";
    case "axis":
      return "hintAxis";
    case "fingers":
      return "hintFingers";
    case "tilt":
      return "hintTilt";
    case "steady":
      return "hintSteady";
    default:
      return "hintOk";
  }
}

/** The words for a G-M2 check's hint. */
export function cardHintText(
  problem: GuideCheck | null,
  copy: CardReferenceCopy,
): string {
  return copy[cardHintKey(problem)];
}

/** The retake line for a card the detector did not find (or turned back). */
export function cardFailureText(
  code: CardFailureCode | null,
  copy: CardReferenceCopy,
): string {
  switch (code) {
    case "card_clipped":
      return copy.failCardClipped;
    case "too_small":
      return copy.failCardTooSmall;
    case "edge_fit_failed":
    case "implausible_quad":
      return copy.failCardEdges;
    case "card_blends_background":
      return copy.failCardBlends;
    default:
      return copy.failNoCard;
  }
}

/**
 * The G-M2 v3 layout's whole area for the scan tour (`data-tour=
 * "card-layout"`): the union of the hand brackets and the card slot, view
 * 0..1, mirrored for the left hand with the layout.
 */
export function cardLayoutRect(side: HandSide): {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
} {
  const l = gm2Layout(side);
  const a = l.handZone;
  const b = l.cardZone;
  const x0 = Math.min(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const x1 = Math.max(a.x + a.width, b.x + b.width);
  const y1 = Math.max(a.y + a.height, b.y + b.height);
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}
