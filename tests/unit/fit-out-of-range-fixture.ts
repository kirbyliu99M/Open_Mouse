import { FIXTURES } from "../../src/components/results/fixtures";
import type { FitResponse } from "../../src/lib/contracts/fit";

/**
 * The many-results fixture as a v2/v3 engine reports a hand longer than every
 * ranked mouse: `coverage.lengthOutOfRange` true, `total` the value the engine
 * sorted by against the catalogue's edge. Tests use it to prove that no
 * consumer draws a number or a band from `total`.
 */
export function outOfRange(
  base: FitResponse = FIXTURES["many-results"],
): FitResponse {
  return {
    ...base,
    engineVersion: "fit-v3.0-candidate.0",
    coverage: {
      lengthOutOfRange: true,
      direction: "above",
      usedGripLengthTargetMm: 150.2,
      catalogueLengthRangeMm: [70.4, 138.4],
    },
  };
}

/** The same response in range: a v3 response whose hand the catalogue covers. */
export function inRange(
  base: FitResponse = FIXTURES["many-results"],
): FitResponse {
  return {
    ...outOfRange(base),
    coverage: {
      lengthOutOfRange: false,
      direction: null,
      usedGripLengthTargetMm: 120.1,
      catalogueLengthRangeMm: [70.4, 138.4],
    },
  };
}
