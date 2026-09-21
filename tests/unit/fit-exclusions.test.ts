import { describe, expect, it } from "vitest";
import { excludeReason } from "../../src/server/fit/exclusions";
import type { CatalogueMouse } from "../../src/server/fit/types";

const baseMouse: CatalogueMouse = {
  slug: "acme-test",
  brand: "Acme",
  model: "Test",
  lengthMm: 120,
  widthMm: 65,
  heightMm: 40, // ratio 0.333, well under the vertical threshold
  weightG: 80,
  size: "medium",
  handCompatibility: null,
  shape: "symmetrical",
  humpPlacement: null,
  frontFlare: null,
  sideCurvature: null,
  thumbRest: null,
};

const mouse = (patch: Partial<CatalogueMouse>): CatalogueMouse => ({ ...baseMouse, ...patch });
const defaultPrefs = { includeVertical: false } as const;

describe("excludeReason handedness", () => {
  it.each([
    // [hand, handCompatibility, shape, expected]
    ["right", "left", "symmetrical", "wrong_hand"],
    ["right", "right", "symmetrical", null],
    ["right", "ambidextrous", "symmetrical", null],
    ["left", "right", "ergonomic", "wrong_hand"],
    ["left", "right", "symmetrical", null], // symmetric right mice stay
    ["left", "right", "hybrid", null], // spec only names ergonomic; see PR notes
    ["left", "left", "ergonomic", null],
    ["right", null, "ergonomic", null], // unknown handedness never excluded
    ["left", null, "ergonomic", null],
  ] as const)("hand=%s handCompat=%s shape=%s → %s", (hand, handCompatibility, shape, expected) => {
    expect(excludeReason(mouse({ handCompatibility, shape }), hand, defaultPrefs)).toBe(expected);
  });
});

describe("excludeReason vertical form factor", () => {
  it.each([
    // [heightMm, lengthMm, includeVertical, expected]
    [66.1, 120, false, "vertical_form_factor"], // ratio 0.5508 > 0.55
    [65.9, 120, false, null], //                   ratio 0.5492 < 0.55
    [80, 120, true, null], //                       includeVertical suppresses the exclusion
  ] as const)(
    "height=%s length=%s includeVertical=%s → %s",
    (heightMm, lengthMm, includeVertical, expected) => {
      expect(
        excludeReason(mouse({ heightMm, lengthMm, handCompatibility: null }), "right", {
          includeVertical,
        }),
      ).toBe(expected);
    },
  );

  it("ratio exactly 0.55 is not excluded", () => {
    expect(
      excludeReason(mouse({ heightMm: 66, lengthMm: 120, handCompatibility: null }), "right", {
        includeVertical: false,
      }),
    ).toBe(null);
  });
});

describe("excludeReason priority", () => {
  it("reports wrong_hand over vertical_form_factor when both apply", () => {
    const m = mouse({ handCompatibility: "left", heightMm: 80, lengthMm: 120 });
    expect(excludeReason(m, "right", defaultPrefs)).toBe("wrong_hand");
  });
});
