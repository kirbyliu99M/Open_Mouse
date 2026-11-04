/**
 * v3.4 card reference (2026-11-05, candidate 未拍板): one card-mode photo,
 * from pixels and the hand to a result in the paper pipeline's shape
 * (`PipelineResult`), so the easy scan shows it, asks the grip and
 * thickness and sends it exactly as a paper scan.
 *
 * Order (as the lab's L14 hand shot): the full-resolution hand first, then
 * the card, searched in the G-M2 card slot and, when the slot has none,
 * the whole frame and the box beside the hand (`detectCardInPasses`); then
 * the hand gates the paper path runs (detected, handedness, confidence;
 * sharpness as a warning); then the card-only homography at the nominal
 * focal, and the measurements. The phone's tilt (when the sensor gives one)
 * is recorded only; nothing waits for it.
 *
 * Nothing here leaves the browser: the photo is read here and only the
 * millimetre values reach the submission.
 *
 * `analyseCardPhoto` is pure (the detector, the gates and the measures
 * are); `runCardPhoto` decodes the file and runs MediaPipe around it.
 */
import type { Locale } from "../../lib/contracts/locale";
import { cardReferenceCopy } from "../../lib/copy/card-reference";
import type { Intrinsics } from "../geometry/camera-pose";
import type { Point2 } from "../geometry/homography";
import { nominalFocalPxFromLongEdge } from "../geometry/nominalFocalShadow";
import { NOMINAL_FOCAL_EQUIV_MM } from "../geometry/nominalFocalShadow";
import { runPaperEdgeHandGates } from "../photo/gates";
import { resolvePipelineHand } from "../photo/hand";
import type { PipelineIssue, PipelineResult } from "../photo/pipeline";
import { computeLaplacianVariance, rgbaToGrayscale } from "../photo/sharpness";
import { measureHandWithCard } from "./cardHandMeasure";
import { cardFailureText } from "./cardLive";
import {
  cropPrincipalPoint,
  detectCardInPasses,
  type CardSearchPass,
} from "./cardReference";
import { buildCardSubmission } from "./cardSubmission";
import { ID1_CARD_SIZE_MM } from "./detect/cardMeasure";
import {
  detectCard,
  type CardFailureCode,
  type Quad,
  type RgbaImage,
} from "./detect/detectCard";
import { cardSlotSearchRegion } from "./hand/cardSlot";
import { gm2 } from "./hand/guides/gm2";
import { handCardSearchRegion } from "./hand/handCardRegion";
import type { SensorSnapshot } from "./tilt";

/** The full-resolution hand, as `detectHandLandmarks` returns it. */
export interface CardPhotoHand {
  readonly landmarksPx: readonly Point2[];
  readonly handedness: "left" | "right" | null;
  readonly confidence: number;
}

/** Where the photo came from in the stream (a frame of the video, cut to the screen). */
export interface CardPhotoFrame {
  /** The whole stream's size, px. */
  readonly stream: { readonly width: number; readonly height: number };
  /** The cut, in stream px (the photo is this rectangle 1:1). */
  readonly crop: { readonly x: number; readonly y: number };
}

export interface CardPhotoInput {
  readonly image: RgbaImage;
  readonly hand: CardPhotoHand | null;
  readonly selectedHand: "left" | "right";
  readonly handExplicit: boolean;
  readonly handednessFixInstruction?: string;
  readonly sensor: SensorSnapshot | null;
  /** `null` for a photo that is not a cut of the stream (its own centre and long edge are used). */
  readonly frame: CardPhotoFrame | null;
  readonly locale: Locale;
}

/** What the attempt log / debug keep of a card shot (no pixels). */
export interface CardPhotoDiagnostics {
  readonly found: boolean;
  readonly failure: CardFailureCode | null;
  readonly searchPass: CardSearchPass | null;
  readonly slotFailure: CardFailureCode | null;
  readonly cardCorners: readonly Point2[] | null;
  readonly tiltDeg: number | null;
  readonly focalPx: number | null;
  readonly cameraHeightMm: number | null;
  readonly correctedLengthMm: number | null;
  readonly correctedWidthMm: number | null;
  readonly detectMs: number | null;
}

export interface CardPhotoOutcome {
  readonly result: PipelineResult;
  readonly diagnostics: CardPhotoDiagnostics;
}

/** The nominal intrinsics for a card photo: 18 mm on the stream's long edge, principal point at the stream's centre. */
export function cardPhotoIntrinsics(
  image: { readonly width: number; readonly height: number },
  frame: CardPhotoFrame | null,
): Intrinsics | null {
  const longEdge = frame
    ? Math.max(frame.stream.width, frame.stream.height)
    : Math.max(image.width, image.height);
  const fPx = nominalFocalPxFromLongEdge(longEdge, NOMINAL_FOCAL_EQUIV_MM);
  if (fPx === null || !Number.isFinite(fPx) || !(fPx > 0)) return null;
  const p = frame
    ? cropPrincipalPoint(frame.stream, frame.crop)
    : { cx: image.width / 2, cy: image.height / 2 };
  return { fPx, cx: p.cx, cy: p.cy };
}

const NO_DIAGNOSTICS: CardPhotoDiagnostics = {
  found: false,
  failure: null,
  searchPass: null,
  slotFailure: null,
  cardCorners: null,
  tiltDeg: null,
  focalPx: null,
  cameraHeightMm: null,
  correctedLengthMm: null,
  correctedWidthMm: null,
  detectMs: null,
};

/** One card-mode photo, judged and measured. Pure (apart from the clock it reads for `detectMs`); never throws. */
export function analyseCardPhoto(input: CardPhotoInput): CardPhotoOutcome {
  const copy = cardReferenceCopy(input.locale);
  const { image } = input;
  const size = { width: image.width, height: image.height };
  const tiltDeg = input.sensor?.motion.around?.tiltDeg ?? null;
  const overlayBase = {
    imageWidth: image.width,
    imageHeight: image.height,
    markers: [],
    card: null,
  };
  const fail = (
    errors: readonly PipelineIssue[],
    extra: Partial<CardPhotoDiagnostics> = {},
    cardCorners: Quad | null = null,
  ): CardPhotoOutcome => ({
    result: {
      status: "error",
      errors,
      overlay: {
        ...overlayBase,
        landmarksPx: input.hand?.landmarksPx ?? null,
        ...(input.hand ? { handedness: input.hand.handedness } : {}),
        ...(cardCorners ? { paperCorners: cardCorners } : {}),
      },
    },
    diagnostics: { ...NO_DIAGNOSTICS, tiltDeg, ...extra },
  });

  if (!input.hand) {
    return fail([
      {
        code: "HAND_NOT_DETECTED",
        message:
          "We couldn't find a hand in this photo — lay your hand flat beside the card, and retake.",
        detail: { kind: "handNotDetected", on: "nothing" },
      },
    ]);
  }
  const hand = input.hand;
  const intrinsics = cardPhotoIntrinsics(size, input.frame);

  // The card: the G-M2 slot first, then the whole frame and the box beside
  // the hand (lab L14).
  const slot = cardSlotSearchRegion(gm2.layout(input.selectedHand), size);
  const handSide = handCardSearchRegion(hand.landmarksPx, size);
  const started = Date.now();
  let passes: ReturnType<typeof detectCardInPasses>;
  try {
    passes = detectCardInPasses(
      (boxes) =>
        detectCard(image, {
          paperCorners: null,
          cardSizeMm: {
            longMm: ID1_CARD_SIZE_MM.longMm,
            shortMm: ID1_CARD_SIZE_MM.shortMm,
          },
          focalPx: intrinsics?.fPx ?? null,
          searchRegion: boxes.searchRegion,
          linesRegion: boxes.linesRegion,
        }),
      slot,
      handSide,
    );
  } catch {
    return fail([{ code: "CARD_NOT_FOUND", message: copy.failNoCard }]);
  }
  const detectMs = Date.now() - started;
  const d = passes.detection;
  const searchInfo = {
    searchPass: passes.searchPass,
    slotFailure: passes.slotFailure,
    detectMs,
    focalPx: intrinsics?.fPx ?? null,
  };
  if (!d.ok) {
    return fail(
      [{ code: "CARD_NOT_FOUND", message: cardFailureText(d.failure, copy) }],
      { ...searchInfo, failure: d.failure },
    );
  }
  const corners = d.corners;
  const cardDiag = {
    ...searchInfo,
    found: true,
    cardCorners: corners.map((p) => ({ x: p.x, y: p.y })),
  };

  // The paper path's hand gates (no sheet: no bounds check).
  const decision = resolvePipelineHand({
    selected: input.selectedHand,
    detected: hand.handedness,
    explicit: input.handExplicit,
  });
  let laplacianVariance = 0;
  try {
    laplacianVariance = computeLaplacianVariance(
      rgbaToGrayscale(image.data, image.width * image.height),
      image.width,
      image.height,
    );
  } catch {
    laplacianVariance = 0;
  }
  const report = runPaperEdgeHandGates({
    paperFound: false,
    landmarkCount: hand.landmarksPx.length,
    handedness: hand.handedness,
    handStated: decision.stated,
    handednessFixInstruction: input.handednessFixInstruction,
    landmarkConfidence: hand.confidence,
    landmarksMm: [],
    paperCornersMm: [],
    laplacianVariance,
  });
  if (!report.ok) return fail(report.errors, cardDiag, corners);

  if (!intrinsics) {
    return fail(
      [{ code: "MEASUREMENT_OUT_OF_RANGE", message: copy.failMeasure }],
      cardDiag,
      corners,
    );
  }
  const m = measureHandWithCard({
    landmarksPx: hand.landmarksPx,
    cardCorners: corners,
    intrinsics,
    cardSize: ID1_CARD_SIZE_MM,
  });
  const measureDiag = {
    ...cardDiag,
    cameraHeightMm: m.cameraHeightMm,
    correctedLengthMm: m.correctedLengthMm,
    correctedWidthMm: m.correctedWidthMm,
  };
  if (!m.measurements) {
    return fail(
      [{ code: "MEASUREMENT_OUT_OF_RANGE", message: copy.failMeasure }],
      measureDiag,
      corners,
    );
  }
  let submission;
  try {
    submission = buildCardSubmission({
      hand: decision.submitted,
      measurements: m.measurements,
    });
  } catch {
    return fail(
      [{ code: "MEASUREMENT_OUT_OF_RANGE", message: copy.failMeasure }],
      measureDiag,
      corners,
    );
  }
  return {
    result: {
      status: "ok",
      measurements: m.measurements,
      submission,
      warnings: report.warnings,
      overlay: {
        ...overlayBase,
        landmarksPx: hand.landmarksPx,
        handedness: hand.handedness,
        // The card's outline is drawn where the paper's would be: the
        // person checks it frames the card they placed.
        paperCorners: corners,
      },
    },
    diagnostics: { ...NO_DIAGNOSTICS, tiltDeg, ...measureDiag },
  };
}
