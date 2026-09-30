"use client";

import ScanClient from "../ScanClient";
import { checkHandedness } from "@/client/photo/gates";
import { resolvePipelineHand } from "@/client/photo/hand";
import { assembleScanSubmission } from "@/client/photo/submission";
import type {
  PipelineResult,
  RunPhotoPipelineInput,
} from "@/client/photo/pipeline";
import type { HandMeasurements } from "@/lib/contracts/measurement";

type DemoWindow = Window & {
  __scanHandCalls?: { hand: string; handExplicit: boolean | undefined }[];
};

/** MediaPipe "sees" a left hand in every photo given to this page. */
const DETECTED = "left" as const;

const FIXTURE_MEASUREMENTS: HandMeasurements = {
  handLengthMm: 190,
  palmLengthMm: 108,
  palmWidthMm: 84,
  thumbLengthMm: 58,
  indexLengthMm: 68,
  middleLengthMm: 74,
  ringLengthMm: 69,
  pinkyLengthMm: 54,
};

const OVERLAY = {
  imageWidth: 1,
  imageHeight: 1,
  markers: [],
  card: null,
  landmarksPx: null,
  handedness: DETECTED,
};

/**
 * A fake printed-sheet pipeline that behaves like the real one where the hand
 * is concerned: the same `resolvePipelineHand` decision and the same
 * handedness gate, with a left hand always "detected". No synthetic photo
 * makes MediaPipe detect a hand, so this is the only deterministic way to
 * check what /scan tells the pipeline about the picker. Every call is
 * recorded on `window.__scanHandCalls` for the e2e.
 */
async function leftHandPipeline(
  input: RunPhotoPipelineInput,
): Promise<PipelineResult> {
  const demoWindow = window as DemoWindow;
  (demoWindow.__scanHandCalls ??= []).push({
    hand: input.hand,
    handExplicit: input.handExplicit,
  });
  const decision = resolvePipelineHand({
    selected: input.hand,
    detected: DETECTED,
    explicit: input.handExplicit !== false,
  });
  const mismatch = checkHandedness(DETECTED, decision.stated);
  if (mismatch)
    return { status: "error", errors: [mismatch], overlay: OVERLAY };
  return {
    status: "ok",
    measurements: FIXTURE_MEASUREMENTS,
    submission: assembleScanSubmission({
      hand: decision.submitted,
      gripStyleStated: input.gripStyleStated,
      measurements: FIXTURE_MEASUREMENTS,
      markerIds: [0, 1, 2, 3],
      reprojectionErrorMm: 0.4,
      cardScaleRatio: 1,
    }),
    warnings: [],
    overlay: OVERLAY,
  };
}

export function HandExplicitDemoClient() {
  return (
    <ScanClient
      demoLabel="Demo — a left hand is always detected"
      runPhotoPipelineImpl={leftHandPipeline}
    />
  );
}
