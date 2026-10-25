/**
 * landmark-raw-v3 (V3.2 F12, WP4): the documents state the contract's own
 * engine-scale ratios, the manual-entry factor, the prior's range and the
 * measurement version, so a change of a constant cannot leave them behind.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FIT_SCALE_FROM_CORRECTED,
  MANUAL_ENTRY,
  MEASUREMENT_MODEL_VERSION,
} from "../../src/lib/contracts/measurement";
import { FOCAL_PRIOR_RANGE } from "../../src/client/geometry/parallax";
import { NOMINAL_FOCAL_EQUIV_MM } from "../../src/client/geometry/nominalFocalShadow";

const fit = readFileSync("docs/fit-algorithm.md", "utf8");
const r7 = readFileSync("docs/research/nominal-focal-r7.md", "utf8");

describe("docs match the contract", () => {
  it("docs/fit-algorithm.md §1 states k and 0.77", () => {
    expect(fit).toContain(
      `hand length x ${FIT_SCALE_FROM_CORRECTED.handLength}, palm length x ${FIT_SCALE_FROM_CORRECTED.palmLength}, palm width x ${FIT_SCALE_FROM_CORRECTED.palmWidth}`,
    );
    expect(fit).toContain(`typed width x ${MANUAL_ENTRY.widthToLandmarkScale}`);
    expect(fit).toContain(MEASUREMENT_MODEL_VERSION);
  });

  it("the R7 summary states the version, the ratios, the prior and its range", () => {
    expect(r7).toContain(MEASUREMENT_MODEL_VERSION);
    expect(r7).toContain(
      `hand length ${FIT_SCALE_FROM_CORRECTED.handLength}, palm length ${FIT_SCALE_FROM_CORRECTED.palmLength}, palm width ${FIT_SCALE_FROM_CORRECTED.palmWidth}`,
    );
    expect(r7).toContain(`${NOMINAL_FOCAL_EQUIV_MM} mm equivalent`);
    expect(r7).toContain(
      `${FOCAL_PRIOR_RANGE.min}-${FOCAL_PRIOR_RANGE.max}x of the prior`,
    );
  });
});
