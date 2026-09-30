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
  const at = (x: number, y: number) => ({
    x: (x / DEMO_IMAGE_WIDTH) * width,
    y: (y / DEMO_IMAGE_HEIGHT) * height,
  });
  return {
    status: "ok",
    measurements: SUBMISSION.measurements,
    submission: SUBMISSION,
    warnings: [],
    overlay: {
      imageWidth: width,
      imageHeight: height,
      markers: [],
      card: null,
      landmarksPx: DEMO_LANDMARKS_PX.map((p) => at(p.x, p.y)),
      handedness: "right",
      paperCorners: [
        at(200, 160),
        at(1400, 160),
        at(1400, 1840),
        at(200, 1840),
      ],
    },
  };
}

export function LiveMeasuredDemoClient() {
  return <EasyScanCamera runPhotoPipelineImpl={measuredPipeline} />;
}
