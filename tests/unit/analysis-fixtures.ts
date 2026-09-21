/** Shared fixtures for `src/server/analysis/**` tests. Not a test file itself. */
import {
  SUBSCORES,
  type FitEntry,
  type FitResponse,
  type Subscore,
} from "../../src/lib/contracts/fit";
import type { HandMeasurements } from "../../src/lib/contracts/measurement";

function sub(
  score: number | null,
  code: FitEntry["subscores"][Subscore]["reason"]["code"],
  params: Record<string, number> = {},
) {
  return { score, weight: 1 / SUBSCORES.length, reason: { code, params } };
}

/** A high-confidence entry — every sub-score has a real reason. */
export function makeEntry(overrides: Partial<FitEntry> = {}): FitEntry {
  return {
    rank: 1,
    mouse: {
      slug: "logitech-g-pro-x-superlight-2",
      brand: "Logitech",
      model: "G Pro X Superlight 2",
      lengthMm: 125,
      widthMm: 63.5,
      heightMm: 40,
      weightG: 60,
      size: "large",
    },
    total: 88,
    confidence: 0.9,
    subscores: {
      length: sub(90, "length_ideal", { deltaMm: 1.5 }),
      gripWidth: sub(85, "width_ideal", { deltaMm: 0.8 }),
      heightHump: sub(80, "hump_matches_grip"),
      frontFlare: sub(70, "flare_crowds_fingers", { deltaMm: 2 }),
      thumb: sub(75, "thumb_rest_supports"),
      weight: sub(95, "weight_in_range", { targetG: 60 }),
    } as FitEntry["subscores"],
    ...overrides,
  };
}

export function makeFit(overrides: Partial<FitResponse> = {}): FitResponse {
  return {
    scanId: "5f0c6f7e-1c2d-4b8a-9d3e-2a1b0c9d8e7f",
    engineVersion: "fit-v0-provisional",
    gripStyle: { stated: null, predicted: "claw", used: "claw" },
    targets: { lengthMm: 118, gripWidthMm: 62, heightMm: 39 },
    excluded: [
      { slug: "logitech-lift-vertical", reason: "vertical_form_factor" },
    ],
    results: [makeEntry()],
    ...overrides,
  };
}

export function makeMeasurements(
  overrides: Partial<HandMeasurements> = {},
): HandMeasurements {
  return {
    handLengthMm: 180.4,
    palmLengthMm: 105.2,
    palmWidthMm: 84.6,
    ...overrides,
  };
}
