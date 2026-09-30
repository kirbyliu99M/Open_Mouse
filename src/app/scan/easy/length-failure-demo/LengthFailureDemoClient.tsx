"use client";

import EasyScanCamera from "@/client/camera/EasyScanCamera";
import type {
  PipelineResult,
  RunPhotoPipelineInput,
} from "@/client/photo/pipeline";
import { userLengthRetakeMessage } from "@/client/photo/user-length";

/**
 * A pipeline that always fails the way a palm that does not fit the typed
 * hand length does. No synthetic photo makes MediaPipe detect a hand, so this
 * is the only deterministic way to reach that failure sheet in e2e.
 */
async function lengthFailurePipeline(
  input: RunPhotoPipelineInput,
): Promise<PipelineResult> {
  const typed =
    input.calibration?.method === "user-length"
      ? input.calibration.handLengthMm
      : 0;
  return {
    status: "error",
    errors: [
      {
        code: "MEASUREMENT_OUT_OF_RANGE",
        message: userLengthRetakeMessage(typed),
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

export function LengthFailureDemoClient() {
  return <EasyScanCamera runPhotoPipelineImpl={lengthFailurePipeline} />;
}
