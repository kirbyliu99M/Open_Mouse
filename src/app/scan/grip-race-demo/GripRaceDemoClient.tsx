"use client";

import ScanClient from "../ScanClient";
import { assembleScanSubmission } from "@/client/photo/submission";
import type {
  PipelineResult,
  RunPhotoPipelineInput,
} from "@/client/photo/pipeline";
import type { HandMeasurements } from "@/lib/contracts/measurement";

/** Same fixture numbers `/scan/measured-demo` uses. */
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

const EMPTY_OVERLAY = {
  imageWidth: 1,
  imageHeight: 1,
  markers: [],
  card: null,
  landmarksPx: null,
};

/**
 * A fake "pipeline" with a controllable delay, standing in for the real
 * MediaPipe one. Exists because no synthetic e2e photo makes MediaPipe
 * detect a hand (tests/e2e/scan.spec.ts), so the real /scan can never
 * reach "ok" from a test-drawn image — which makes the
 * grip-changed-during-processing race (the pipeline call captures whichever
 * grip was current *when it started*, but can still be resolving after the
 * user has since switched grips) untestable there. This fake echoes back
 * whatever grip it was started with — exactly like the real pipeline would
 * — after a delay long enough for a test to reliably click a different
 * grip button first.
 */
async function delayedFixturePipeline(
  input: RunPhotoPipelineInput,
): Promise<PipelineResult> {
  await new Promise((resolve) => setTimeout(resolve, 600));
  const submission = assembleScanSubmission({
    hand: input.hand,
    gripStyleStated: input.gripStyleStated,
    measurements: FIXTURE_MEASUREMENTS,
    markerIds: [0, 1, 2, 3],
    reprojectionErrorMm: 0.4,
    cardScaleRatio: 1,
  });
  return {
    status: "ok",
    measurements: FIXTURE_MEASUREMENTS,
    submission,
    warnings: [],
    overlay: EMPTY_OVERLAY,
  };
}

export function GripRaceDemoClient() {
  return (
    <ScanClient
      demoLabel="Demo — grip-change race fixture"
      runPhotoPipelineImpl={delayedFixturePipeline}
    />
  );
}
