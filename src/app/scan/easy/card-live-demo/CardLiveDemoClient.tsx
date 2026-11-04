"use client";

import EasyScanCamera from "@/client/camera/EasyScanCamera";
import type { CardPhotoOutcome } from "@/client/card/cardPhoto";
import type { runCardPhoto } from "@/client/card/runCardPhoto";
import { buildCardSubmission } from "@/client/card/cardSubmission";
import { ID1_CARD_SIZE_MM } from "@/client/card/detect/cardMeasure";
import {
  DEMO_IMAGE_HEIGHT,
  DEMO_IMAGE_WIDTH,
  DEMO_LANDMARKS_PX,
} from "../../demo-photo";

type CardDemoWindow = Window & {
  /** Every call the camera made, without the photo itself (no pixels kept). */
  __easyScanCardCalls?: { selectedHand: string; size: number }[];
  /** Test hook: while unresolved, the fake analysis stays "processing". */
  __easyScanCardHold?: Promise<void>;
  /** Test hook: "no-card" makes the next runs answer "card not found". */
  __easyScanCardResult?: "no-card";
};

/** Where the demo hand sits in the photo (fractions): the G-M2 hand box. */
const HAND = { left: 0.05, top: 0.1, right: 0.64, bottom: 0.86 };
/** Where the demo card sits (fractions): inside the G-M2 card slot. */
const CARD = { left: 0.72, top: 0.3, right: 0.86, bottom: 0.54 };

const MEASUREMENTS = {
  handLengthMm: 190,
  palmLengthMm: 108,
  palmWidthMm: 84,
  thumbLengthMm: 58,
  indexLengthMm: 68,
  middleLengthMm: 74,
  ringLengthMm: 69,
  pinkyLengthMm: 54,
};

/**
 * A card analysis that measures nothing (v3.4 e2e): it answers "measured"
 * with the demo hand and a card outline laid on the photo's real size, so the
 * card-outline question, the sheet and the send can be driven from a real
 * capture of the fake camera. No synthetic photo makes MediaPipe find a hand.
 */
const fakeRunCardPhoto: typeof runCardPhoto = async (
  file,
  rest,
): Promise<CardPhotoOutcome> => {
  const w = window as CardDemoWindow;
  (w.__easyScanCardCalls ??= []).push({
    selectedHand: rest.selectedHand,
    size: file.size,
  });
  await w.__easyScanCardHold;
  const bitmap = await createImageBitmap(file);
  const { width, height } = bitmap;
  bitmap.close();
  const at = (x: number, y: number) => ({
    x: width * (HAND.left + (x / DEMO_IMAGE_WIDTH) * (HAND.right - HAND.left)),
    y: height * (HAND.top + (y / DEMO_IMAGE_HEIGHT) * (HAND.bottom - HAND.top)),
  });
  const cardCorners = [
    { x: width * CARD.left, y: height * CARD.top },
    { x: width * CARD.right, y: height * CARD.top },
    { x: width * CARD.right, y: height * CARD.bottom },
    { x: width * CARD.left, y: height * CARD.bottom },
  ] as const;
  const overlay = {
    imageWidth: width,
    imageHeight: height,
    markers: [],
    card: null,
    landmarksPx: DEMO_LANDMARKS_PX.map((p) => at(p.x, p.y)),
    handedness: "right" as const,
    paperCorners: cardCorners,
  };
  const diagnostics = {
    found: w.__easyScanCardResult !== "no-card",
    failure: null,
    searchPass: "slot" as const,
    slotFailure: null,
    cardCorners,
    tiltDeg: null,
    focalPx: null,
    cameraHeightMm: null,
    correctedLengthMm: MEASUREMENTS.handLengthMm,
    correctedWidthMm: MEASUREMENTS.palmWidthMm,
    detectMs: 1,
  };
  if (w.__easyScanCardResult === "no-card") {
    return {
      result: {
        status: "error",
        errors: [{ code: "CARD_NOT_FOUND", message: "No card (demo)." }],
        overlay: { ...overlay, paperCorners: undefined },
      },
      diagnostics: { ...diagnostics, failure: null, cardCorners: null },
    } as unknown as CardPhotoOutcome;
  }
  const submission = buildCardSubmission({
    hand: "right",
    measurements: MEASUREMENTS,
    cardSize: ID1_CARD_SIZE_MM,
    searchPass: "slot",
    cardFitRmsMm: 0.4,
  });
  return {
    result: {
      status: "ok",
      measurements: submission.measurements,
      submission,
      warnings: [],
      overlay,
    },
    diagnostics,
  } as CardPhotoOutcome;
};

export function CardLiveDemoClient() {
  return <EasyScanCamera runCardPhotoImpl={fakeRunCardPhoto} />;
}
