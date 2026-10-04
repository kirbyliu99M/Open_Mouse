"use client";

import EasyScanCamera from "@/client/camera/EasyScanCamera";
import {
  MEASUREMENT_MODEL_VERSION,
  scanSubmissionSchema,
} from "@/lib/contracts/measurement";
import type {
  PipelineResult,
  RunPhotoPipelineInput,
} from "@/client/photo/pipeline";
import { checkLandmarkConfidence } from "@/client/photo/gates";
import {
  DEMO_IMAGE_HEIGHT,
  DEMO_IMAGE_WIDTH,
  DEMO_LANDMARKS_PX,
} from "../../demo-photo";

type DemoWindow = Window & {
  __easyScanLiveCalls?: RunPhotoPipelineInput[];
  /** Test hook: while unresolved, the fake pipeline stays "processing". */
  __easyScanLiveHold?: Promise<void>;
};

/**
 * Where the demo paper sits in the photo, as fractions of its width and
 * height: an A4 sheet as the guide rectangle frames it on a 390x844 screen
 * with a 9:16 camera. The screenshot spec draws its scene to match.
 */
const PAPER = { left: 0.151, top: 0.198, right: 0.849, bottom: 0.754 };

const SUBMISSION = scanSubmissionSchema.parse({
  hand: "right",
  measurements: {
    handLengthMm: 190,
    palmLengthMm: 108,
    palmWidthMm: 84,
    thumbLengthMm: 58,
    indexLengthMm: 68,
    middleLengthMm: 74,
    ringLengthMm: 69,
    pinkyLengthMm: 54,
  },
  calibration: {
    method: "paper-edge",
    paperSize: "a4",
    edgeFitResidualMm: 0.6,
    minSideCoverage: 0.92,
    parallaxCorrected: true,
  },
  measurementModelVersion: MEASUREMENT_MODEL_VERSION,
});

/**
 * A pipeline that measures nothing: it looks at how big the photo really is
 * and answers "measured" with the demo hand laid out proportionally on it.
 * With the live camera (the e2e suite's fake one) this reaches the measured
 * sheet from a real capture, which no synthetic photo does through MediaPipe.
 */
async function measuredPipeline(
  input: RunPhotoPipelineInput,
): Promise<PipelineResult> {
  const demoWindow = window as DemoWindow;
  (demoWindow.__easyScanLiveCalls ??= []).push(input);
  await demoWindow.__easyScanLiveHold;
  const bitmap = await createImageBitmap(input.file);
  const { width, height } = bitmap;
  bitmap.close();
  // The demo hand, laid inside the paper.
  const at = (x: number, y: number) => ({
    x:
      width *
      (PAPER.left + (x / DEMO_IMAGE_WIDTH) * (PAPER.right - PAPER.left)),
    y:
      height *
      (PAPER.top + (y / DEMO_IMAGE_HEIGHT) * (PAPER.bottom - PAPER.top)),
  });
  const overlay = {
    imageWidth: width,
    imageHeight: height,
    markers: [],
    card: null,
    landmarksPx: DEMO_LANDMARKS_PX.map((p) => at(p.x, p.y)),
    handedness: "right" as const,
    paperCorners: [
      { x: width * PAPER.left, y: height * PAPER.top },
      { x: width * PAPER.right, y: height * PAPER.top },
      { x: width * PAPER.right, y: height * PAPER.bottom },
      { x: width * PAPER.left, y: height * PAPER.bottom },
    ] as const,
  };
  // `?result=retake`: a problem with the hand that the pipeline located.
  if (new URLSearchParams(window.location.search).get("result") === "retake") {
    return {
      status: "error",
      errors: [
        {
          code: "LOW_LANDMARK_CONFIDENCE",
          message: checkLandmarkConfidence(0)!.message,
        },
      ],
      overlay,
    };
  }
  return {
    status: "ok",
    measurements: SUBMISSION.measurements,
    submission: SUBMISSION,
    warnings: [],
    overlay,
  };
}

export function LiveMeasuredDemoClient() {
  return <EasyScanCamera runPhotoPipelineImpl={measuredPipeline} />;
}
