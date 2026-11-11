/** A valid tester record (contract src/lib/contracts/tester.ts) for the tester tests. Not a test file. */
import {
  TESTER_CONSENT_VERSION,
  type TesterRecord,
} from "../../../src/lib/contracts/tester";

export const SHOT = "6c1f3a0e-8a9b-4c2d-9e1f-2a3b4c5d6e7f";

export const RECORD: TesterRecord = {
  consent: TESTER_CONSENT_VERSION,
  shotId: SHOT,
  tape: {
    hand: "right",
    handLength: { a: { first: 188.5, second: 189 } },
    palmWidth: {
      a: { first: 84, second: 84.5 },
      b: { first: 85, second: 84 },
    },
  },
  phoneModel: "Pixel 8",
  surface: "white",
  lighting: "daylight",
  reference: "a4",
  deliberatelyPoor: false,
  captureMode: "camera",
  attempts: 2,
  firstTryOk: false,
  failureCodes: ["LOW_LANDMARK_CONFIDENCE"],
  gaveUp: false,
  measured: {
    handLengthMm: 190.2,
    palmWidthMm: 83.7,
    measurementModelVersion: "landmark-raw-v3",
    calibrationMethod: "paper-edge",
  },
  photo: { widthPx: 640, heightPx: 480 },
};
