import { describe, expect, it } from "vitest";
import { shellParameters, type ShellSpec } from "../shell-parameters";
import {
  FRONT_FLARES,
  HUMP_PLACEMENTS,
  SIDE_CURVATURES,
} from "../../../src/lib/contracts/descriptors";
import { models } from "../models";

describe("shell parameter authoring", () => {
  const base = models[0];
  it("converts manufacturer millimetres to glTF metres without mutating input", () => {
    const frozen = Object.freeze({ ...base });
    expect(shellParameters(frozen)).toMatchObject({
      length: 0.125,
      width: 0.0635,
      height: 0.04,
      tilt: 0,
    });
    expect(frozen.lengthMm).toBe(125);
  });
  it("orders hump position, flare and sidewall deformation across every rubric level", () => {
    const peaks = HUMP_PLACEMENTS.map(
      (humpPlacement) => shellParameters({ ...base, humpPlacement }).peakU,
    );
    expect(peaks).toEqual([0.52, 0.59, 0.66, 0.74]);
    const flares = FRONT_FLARES.map(
      (frontFlare) => shellParameters({ ...base, frontFlare }).flare,
    );
    expect(flares).toEqual([...flares].sort((a, b) => a - b));
    const curves = SIDE_CURVATURES.map(
      (sideCurvature) => shellParameters({ ...base, sideCurvature }).concavity,
    );
    expect(curves).toEqual([...curves].sort((a, b) => b - a));
  });
  it("mirrors asymmetric shells and provides explicit digit rests", () => {
    const right = shellParameters({
      ...models[2],
      thumbRest: true,
      ringFingerRest: true,
    });
    const left = shellParameters({
      ...models[2],
      handCompatibility: "left",
      thumbRest: true,
      ringFingerRest: true,
    });
    expect(left).toEqual({ ...right, handedness: -1 });
    expect(left.tilt).toBeGreaterThan(0);
    expect(left.thumbShelf).toBeGreaterThan(0);
    expect(left.ringShelf).toBeGreaterThan(0);
  });
  it.each([0, -1, NaN, Infinity])(
    "refuses invalid dimensions (%s)",
    (heightMm) => {
      expect(() => shellParameters({ ...base, heightMm })).toThrow(
        "Dimensions",
      );
    },
  );
  it("refuses vertical mice, invalid descriptors, paths, and contradictory shapes", () => {
    const invalid: ShellSpec[] = [
      { ...base, heightMm: 90 },
      { ...base, id: "../escape" },
      { ...base, thumbRest: true },
      { ...models[2], handCompatibility: "ambidextrous" },
      { ...base, humpPlacement: "unknown" as ShellSpec["humpPlacement"] },
    ];
    for (const spec of invalid) expect(() => shellParameters(spec)).toThrow();
  });
  it("every initial model has traceable first-party provenance and finite geometry", () => {
    for (const model of models) {
      expect(new URL(model.sourceUrl).hostname).toMatch(
        /^(www\.logitechg\.com|support\.logi\.com)$/,
      );
      for (const value of Object.values(shellParameters(model))) {
        if (typeof value === "number")
          expect(Number.isFinite(value)).toBe(true);
      }
    }
  });
});
