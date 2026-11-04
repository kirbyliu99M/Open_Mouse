/**
 * Scan lab L10 (2026-11-02, candidate 未拍板): the slot every hand-placement
 * guide version fills. A version is one file in this folder
 * (`g0.ts`, `gm2.ts`, `glc.ts`, `ga4.ts`) exporting a `HandGuideVersion`,
 * listed in `index.ts`. The page (`HandLabPanel.tsx`, `LabClient.tsx`) never
 * changes for a version: it samples the hand, calls `evaluate` once per
 * reading, draws what comes back, shows the hint, runs the auto shutter, and
 * after the shot calls `afterShot` and keeps its answer in the record.
 *
 * Frames: everything a version sees and draws is in VIEW coordinates, 0..1
 * across the part of the camera picture that is on screen (x right, y down;
 * coverMap.ts). The phone is held upright, fingers toward the top.
 *
 * A version must be pure: `evaluate` and `afterShot` get everything as
 * arguments, keep no state between calls (the page passes the previous
 * reading), never throw on a missing hand or sheet, and do no I/O.
 */
import type { Homography } from "../../../geometry/homography";
import type { Pt, Rect } from "../handGeometry";

export type HandGuideId = "g0" | "gm2" | "glc" | "ga4";

export type HandSide = "left" | "right";

/** Colour roles; the overlay maps them to its palette (with an icon for status). */
export type Tone = "neutral" | "ok" | "warn" | "fail" | "accent";

/** What a version can draw, in view coordinates (0..1). */
export type OverlayShape =
  | {
      readonly kind: "brackets";
      readonly rect: Rect;
      readonly tone: Tone;
      /** Arm length, as a fraction of the view's width. Default 0.06. */
      readonly arm?: number;
      /** L13: a faint fill inside the brackets. */
      readonly fill?: boolean;
      /** L13: a label in the middle (e.g. 「手放這裡」); a newline breaks lines. */
      readonly label?: string;
    }
  | {
      readonly kind: "line";
      readonly from: Pt;
      readonly to: Pt;
      readonly tone: Tone;
      readonly dashed?: boolean;
      /** Stroke width, css px. Default 3. */
      readonly width?: number;
    }
  | {
      readonly kind: "polyline";
      readonly points: readonly Pt[];
      readonly closed?: boolean;
      readonly tone: Tone;
      readonly dashed?: boolean;
      readonly width?: number;
    }
  | {
      readonly kind: "zone";
      readonly rect: Rect;
      readonly tone: Tone;
      readonly dashed?: boolean;
      /** A newline breaks lines. */
      readonly label?: string;
      /**
       * L13: a card slot: the zone stays a faint search area with a small
       * card icon in it (a sign, not to scale: HandGuideOverlay.cardIconInZone).
       */
      readonly card?: boolean;
      /** L13 review: drawn faint (a hand is in view; the label is dropped too). */
      readonly faded?: boolean;
    }
  | {
      readonly kind: "label";
      readonly at: Pt;
      readonly text: string;
      readonly tone: Tone;
      readonly anchor?: "start" | "middle" | "end";
    }
  | {
      readonly kind: "dot";
      readonly at: Pt;
      readonly tone: Tone;
      /** Radius, css px. Default 6. */
      readonly r?: number;
    }
  | {
      /** The 21-point hand skeleton (MediaPipe's connections). */
      readonly kind: "skeleton";
      readonly points: readonly Pt[];
      readonly tone: Tone;
      /** Only the bones, or the outline of the hand's bounding hull too. */
      readonly outline?: boolean;
    }
  | {
      /** A spirit level: the phone's tilt, at `at` (top-right by default). */
      readonly kind: "level";
      readonly at?: Pt;
      readonly tiltDeg: number | null;
      readonly tone: Tone;
    };

/** One reading of the hand, in view coordinates. */
export interface GuideHand {
  /** The 21 landmarks, view 0..1. */
  readonly points: readonly Pt[];
  /** MediaPipe's per-point relative depth, or null. */
  readonly z: readonly number[] | null;
  /** When it was read, `performance.now()` ms. */
  readonly atMs: number;
}

/** The sheet as the live paper search last found it (only for `livePaper` versions). */
export interface GuidePaper {
  /** TL, TR, BR, BL in view 0..1, or null when not found on the latest search. */
  readonly corners: readonly [Pt, Pt, Pt, Pt] | null;
  readonly atMs: number;
}

export interface GuideInput {
  /** The latest reading; null when no hand was found (or none read yet). */
  readonly hand: GuideHand | null;
  /** The reading before it that found a hand (for steadiness), or null. */
  readonly previousHand: GuideHand | null;
  /**
   * Largest landmark movement between `previousHand` and `hand` over the
   * view's diagonal (`movementFraction`), or null without both.
   */
  readonly movement: number | null;
  /** The hand the person chose. */
  readonly side: HandSide;
  /** The view's size in stream px (its aspect: width / height). */
  readonly view: { readonly width: number; readonly height: number };
  /** The phone's live tilt from the gravity sensor, degrees, or null. */
  readonly tiltDeg: number | null;
  /** Whether the hand detector has loaded. */
  readonly detectorReady: boolean;
  /** `livePaper` versions only (else null). */
  readonly paper: GuidePaper | null;
  readonly nowMs: number;
}

/** One check's outcome on this reading. */
export interface GuideCheck {
  /** Stable id for the record (e.g. "hand", "inFrame", "tilt"). */
  readonly id: string;
  /** ok = passes; warn = shown but does not hold the shutter; fail = fails. */
  readonly level: "ok" | "warn" | "fail";
  /** Whether a `fail` holds the shutter (false: recorded only). */
  readonly blocks: boolean;
  /** The hint shown while this is the first problem (繁中, one sentence). */
  readonly hint: string;
  /** The figure the check judged, for the record (optional). */
  readonly value?: number | null;
  /**
   * Record only: logged like any other check but never chosen as the hint,
   * so it cannot steer the person (record-only G-LC checks, no tilt sensor,
   * left/right mismatch). Optional; default false.
   */
  readonly quiet?: boolean;
}

export interface GuideEvaluation {
  /** In priority order: the first not-ok one gives the hint. */
  readonly checks: readonly GuideCheck[];
  /** What to draw over the camera for this reading. */
  readonly overlay: readonly OverlayShape[];
  /** The hint when every check is ok (e.g. 「很好，保持不動」). */
  readonly okHint: string;
  /**
   * Auto-shutter override. Default (omitted): any blocking `fail` resets the
   * hold, otherwise it fills. `pause` holds the fill where it is (G-LC's
   * yellow light).
   */
  readonly shutter?: "fill" | "pause" | "reset";
}

/** What `afterShot` gets: the full-resolution shot, measured by the page. */
export interface GuideShotInput {
  readonly side: HandSide;
  /** The shot's size, px. */
  readonly image: { readonly width: number; readonly height: number };
  /** The 21 landmarks found in the full-resolution shot, image px, or null. */
  readonly landmarksPx: readonly Pt[] | null;
  /** The sheet's corners in the shot (TL, TR, BR, BL, image px), when found. */
  readonly paperCornersPx: readonly Pt[] | null;
  /**
   * Image px → sheet mm (x along the sheet's short side), orientation
   * resolved, or null without a sheet.
   */
  readonly paperHomography: Homography | null;
  /** The sheet's size, mm. */
  readonly paperMm: { readonly shortMm: number; readonly longMm: number };
  /** The 21 landmarks parallax-corrected on the sheet, mm (nominal focal), or null. */
  readonly correctedPaperMm: readonly Pt[] | null;
}

export interface HandGuideVersion {
  readonly id: HandGuideId;
  /** Button label, e.g. 「G-M2 極簡框＋卡片槽」. */
  readonly label: string;
  /** The reference the version is built for. */
  readonly reference: "card" | "a4";
  /** Whether the page should run the live sheet search and fill `GuideInput.paper`. */
  readonly livePaper: boolean;
  /** The pre-shot instruction card, one line per step (繁中). */
  readonly instructions: readonly string[];
  /** How long every check must pass before the auto shutter fires, ms. */
  readonly holdMs: number;
  /** Hint hysteresis, ms (default 700 when omitted). */
  readonly hintHoldMs?: number;
  /**
   * The layout's numbers (proportions, thresholds), kept in each record as
   * they were; mirrored for the left hand by the version itself.
   */
  layout(side: HandSide): Readonly<Record<string, unknown>>;
  evaluate(input: GuideInput): GuideEvaluation;
  /** Version-specific post-shot figures (G-A4's anchor), kept as `hand.guideExtra`. */
  afterShot?(input: GuideShotInput): Readonly<Record<string, unknown>> | null;
  /** True while the version is the P1 placeholder (shown on the page). */
  readonly placeholder?: boolean;
}
