import { describe, expect, it } from "vitest";
import descriptorsJson from "../../src/db/seed/logitech-descriptors.json";
import seedJson from "../../src/db/seed/logitech.json";
import type { GripStyle } from "../../src/lib/contracts/fit";
import type { HandMeasurements } from "../../src/lib/contracts/measurement";
import {
  type DescriptorRecord,
  partitionByDescriptors,
  type SpecRecord,
  toMouseRow,
} from "../../src/server/catalogue/seed-rows";
import { scoreFit } from "../../src/server/fit/score";
import type { CatalogueMouse } from "../../src/server/fit/types";
import goldenWithoutHump from "./fixtures/fit-golden.json";
import goldenWithHump from "./fixtures/fit-golden-hump.json";

/**
 * The same four synthetic hands as fit-golden.test.ts, run against the catalogue
 * as the seed now writes it: the checked-in 38-model seed with the descriptors
 * file applied, so 34 models carry a hump and flare, curvature, thumb, shape
 * and hand are still unknown. fit-golden.test.ts keeps pinning the rankings
 * with every descriptor null; this pins them with the hump. Any change to the
 * descriptors file or to a coefficient shows up as a diff here.
 *
 * The catalogue is built through `partitionByDescriptors`, the function the
 * seed uses, so a model the file does not list (the four with no shell) has no
 * hump, as it has none in the database.
 */
const specs = seedJson as unknown as SpecRecord[];
const descriptors = descriptorsJson as unknown as DescriptorRecord[];

const { withDescriptors, withoutDescriptors } = partitionByDescriptors(
  specs.map(toMouseRow).filter((r) => r !== null),
  new Map(descriptors.map((d) => [d.model, d])),
);

const catalogue: CatalogueMouse[] = [
  ...withDescriptors,
  ...withoutDescriptors.map((row) => ({
    ...row,
    handCompatibility: null,
    shape: null,
    humpPlacement: null,
    frontFlare: null,
    sideCurvature: null,
    thumbRest: null,
    ringFingerRest: null,
  })),
].map((m) => ({
  slug: m.slug,
  brand: m.brand,
  model: m.model,
  lengthMm: m.lengthMm,
  widthMm: m.widthMm,
  heightMm: m.heightMm,
  weightG: m.weightG,
  size: m.size,
  handCompatibility: m.handCompatibility,
  shape: m.shape,
  humpPlacement: m.humpPlacement,
  frontFlare: m.frontFlare,
  sideCurvature: m.sideCurvature,
  thumbRest: m.thumbRest,
  ringFingerRest: null,
}));

interface GoldenProfile {
  hand: "left" | "right";
  measurements: HandMeasurements;
  predictedGrip: GripStyle;
  top5: { slug: string; total: number }[];
}

const golden = goldenWithHump as Record<string, GoldenProfile>;
const goldenBefore = goldenWithoutHump as Record<string, GoldenProfile>;

describe("fit-golden with the geometry hump", () => {
  it("uses the same four hands as fit-golden.test.ts", () => {
    expect(Object.keys(golden)).toEqual(Object.keys(goldenBefore));
    for (const [name, profile] of Object.entries(golden)) {
      expect(profile.hand).toBe(goldenBefore[name]!.hand);
      expect(profile.measurements).toEqual(goldenBefore[name]!.measurements);
      expect(profile.predictedGrip).toBe(goldenBefore[name]!.predictedGrip);
    }
  });

  it("scores the 38-model catalogue with 34 humps and nothing else known", () => {
    expect(catalogue).toHaveLength(38);
    expect(catalogue.filter((m) => m.humpPlacement !== null)).toHaveLength(34);
    expect(
      catalogue.filter(
        (m) =>
          m.shape !== null ||
          m.handCompatibility !== null ||
          m.frontFlare !== null ||
          m.sideCurvature !== null ||
          m.thumbRest !== null,
      ),
    ).toEqual([]);
  });

  it.each(Object.entries(golden))(
    "%s matches the snapshot",
    (_name, profile) => {
      const r = scoreFit(
        profile.measurements,
        catalogue,
        { includeVertical: false },
        profile.hand,
      );
      expect(r.gripStyle.predicted).toBe(profile.predictedGrip);
      expect(r.gripStyle.used).toBe(profile.predictedGrip);
      expect(
        r.results
          .slice(0, 5)
          .map((e) => ({ slug: e.mouse.slug, total: e.total })),
      ).toEqual(profile.top5);
    },
  );

  it("moves at least one ranking away from the hump-less snapshot, so it is not the same test twice", () => {
    expect(
      Object.keys(golden).filter(
        (name) =>
          JSON.stringify(golden[name]!.top5) !==
          JSON.stringify(goldenBefore[name]!.top5),
      ).length,
    ).toBeGreaterThan(0);
  });
});
