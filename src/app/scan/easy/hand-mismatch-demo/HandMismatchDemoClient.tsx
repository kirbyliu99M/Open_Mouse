"use client";

import EasyScanCamera from "@/client/camera/EasyScanCamera";
import type {
  PipelineResult,
  RunPhotoPipelineInput,
} from "@/client/photo/pipeline";

type DemoWindow = Window & {
  __easyScanMismatchCalls?: RunPhotoPipelineInput[];
};

async function mismatchPipeline(
  input: RunPhotoPipelineInput,
): Promise<PipelineResult> {
  const demoWindow = window as DemoWindow;
  const calls = (demoWindow.__easyScanMismatchCalls ??= []);
  calls.push(input);
  return {
    status: "error",
    errors: [
      calls.length === 1
        ? {
            code: "HANDEDNESS_MISMATCH",
            message:
              "This looks like your left hand. Tap the hand button below.",
          }
        : {
            code: "LOW_LANDMARK_CONFIDENCE",
            message: "Hand choice updated. Retake in brighter light.",
          },
    ],
    overlay: {
      imageWidth: 1,
      imageHeight: 1,
      markers: [],
      card: null,
      landmarksPx: null,
      handedness: null,
    },
  };
}

export function HandMismatchDemoClient() {
  return <EasyScanCamera runPhotoPipelineImpl={mismatchPipeline} />;
}
