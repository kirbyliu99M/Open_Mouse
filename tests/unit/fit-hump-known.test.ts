import { describe, expect, it } from "vitest";
import type { HandMeasurements } from "../../src/lib/contracts/measurement";
import { scoreFit } from "../../src/server/fit/score";
import type { CatalogueMouse } from "../../src/server/fit/types";

/**
 * G10 puts hump placement into the catalogue while front flare, side curvature,
 * thumb rest, shape and hand compatibility stay unknown. These pin how a mouse
 * in that state scores, so the seed change cannot move the engine unnoticed.
 *
 * r = 110/190 → claw. Targets: length 117.8, gripWidth 70.4, height 38. Best
 * hump levels for claw: back_minimal, back_moderate (HUMP_BEST_INDEX).
 */
const measurements: HandMeasurements = {
  handLengthMm: 190,
  palmLengthMm: 110,
  palmWidthMm: 80,
};

/** Every dimension on target, and only the hump known. */
const humpOnly = (patch: Partial<CatalogueMouse> = {}): CatalogueMouse => ({
  slug: "acme-hump",
  brand: "Acme",
  model: "Hump",
  lengthMm: 117.8,
  widthMm: 70.4,
  heightMm: 38,
  weightG: 80,
  size: "medium",
  handCompatibility: null,
  shape: null,
  humpPlacement: "back_moderate",
  frontFlare: null,
  sideCurvature: null,
  thumbRest: null,
  ringFingerRest: null,
  ...patch,
});

const score = (mouse: CatalogueMouse, prefs = {}) => {
  const result = scoreFit(
    measurements,
    [mouse],
    { includeVertical: false, ...prefs },
    "right",
  );
  const entry = result.results[0];
  if (!entry) throw new Error("the mouse was excluded");
  return { entry, grip: result.gripStyle };
};

describe("a mouse with a known hump and unknown flare, curvature and thumb", () => {
  it("scores heightHump from the hump as well as the height", () => {
    // Height is on target (100). back_moderate is a best hump for claw, so the
    // hump scores 100 too, and a tie names the hump in the reason.
    const { entry } = score(humpOnly());
    expect(entry.subscores.heightHump.score).toBe(100);
    expect(entry.subscores.heightHump.reason.code).toBe("hump_matches_grip");
    expect(entry.subscores.heightHump.reason.params.humpLevelsOff).toBe(0);
  });

  it("marks a hump one level from the best as a mismatch and lowers the subscore and the total", () => {
    // center is one level from back_minimal, the nearest best level for claw:
    // hump 100 * 0.85 = 85; heightHump = round(0.6 * 100 + 0.4 * 85) = 94.
    const { entry } = score(humpOnly({ humpPlacement: "center" }));
    expect(entry.subscores.heightHump.score).toBe(94);
    expect(entry.subscores.heightHump.reason.code).toBe("hump_mismatch_grip");
    expect(entry.subscores.heightHump.reason.params.humpLevelsOff).toBe(1);

    // length 100*.3 + gripWidth 100*.125 (curvature unknown halves it)
    // + heightHump 94*.2 + frontFlare 75*.1 + thumb 75*.1 (neutral prior)
    // = 76.3, over the weights .825 (no weight preference) = 92.48.
    expect(entry.total).toBe(92);
  });

  it("scores the same mouse with no hump by height alone, so a matching hump never scores below it", () => {
    const unknown = score(humpOnly({ humpPlacement: null })).entry;
    const matching = score(humpOnly({ humpPlacement: "back_minimal" })).entry;
    const mismatching = score(humpOnly({ humpPlacement: "center" })).entry;
    expect(unknown.subscores.heightHump.score).toBe(100);
    expect(unknown.subscores.heightHump.reason.code).toBe("height_ideal");
    expect(matching.total).toBeGreaterThanOrEqual(unknown.total);
    expect(mismatching.total).toBeLessThan(unknown.total);
  });

  it("scores hump against the stated grip, not a fixed grip", () => {
    // Palm wants back_moderate or back_aggressive, fingertip wants center.
    // Targets move with the grip, so build the mouse for each.
    const palm = score(
      humpOnly({
        humpPlacement: "back_aggressive",
        lengthMm: 125.4,
        heightMm: 39.9,
      }),
      { gripStyle: "palm" },
    );
    expect(palm.grip.used).toBe("palm");
    expect(palm.entry.subscores.heightHump.reason.code).toBe(
      "hump_matches_grip",
    );

    const fingertip = score(
      humpOnly({
        humpPlacement: "back_aggressive",
        lengthMm: 110.2,
        heightMm: 34.2,
      }),
      { gripStyle: "fingertip" },
    );
    expect(fingertip.grip.used).toBe("fingertip");
    expect(fingertip.entry.subscores.heightHump.reason.code).toBe(
      "hump_mismatch_grip",
    );
    expect(
      fingertip.entry.subscores.heightHump.reason.params.humpLevelsOff,
    ).toBe(3);
  });

  it("leaves flare and thumb unrated, and the height-and-hump subscore rated", () => {
    // What the results page then shows is checked in a browser, on this same
    // engine output: tests/e2e/results-page.spec.ts, "hump rated, flare and
    // thumb unrated".
    const { entry } = score(humpOnly());
    for (const key of ["frontFlare", "thumb"] as const) {
      expect(entry.subscores[key].score).toBeNull();
      expect(entry.subscores[key].reason.code).toBe("descriptor_unknown");
    }
    expect(entry.subscores.heightHump.score).not.toBeNull();
  });

  it("does not raise confidence: heightHump already counted as real input without a hump", () => {
    const withHump = score(humpOnly()).entry;
    const withoutHump = score(humpOnly({ humpPlacement: null })).entry;
    // length .3 + gripWidth .125 + heightHump .2, of .825 applicable weight.
    expect(withHump.confidence).toBeCloseTo(0.625 / 0.825, 10);
    expect(withHump.confidence).toBe(withoutHump.confidence);
  });

  it("still halves the grip-width weight, because side curvature is unknown", () => {
    const { entry } = score(humpOnly());
    expect(entry.subscores.gripWidth.weight).toBeCloseTo(0.125);
    expect(entry.subscores.gripWidth.reason.params.curvatureAdjMm).toBe(0);
  });

  it("ranks a matching hump above a mismatching one on otherwise identical mice", () => {
    const result = scoreFit(
      measurements,
      [
        humpOnly({
          slug: "acme-center",
          model: "Center",
          humpPlacement: "center",
        }),
        humpOnly({ slug: "acme-moderate", model: "Moderate" }),
      ],
      { includeVertical: false },
      "right",
    );
    expect(result.results.map((e) => e.mouse.model)).toEqual([
      "Moderate",
      "Center",
    ]);
  });
});
