import { describe, expect, it } from "vitest";
import type { HandCompatibility } from "../../src/lib/contracts/descriptors";
import type { GripStyle } from "../../src/lib/contracts/fit";
import type { HandMeasurements } from "../../src/lib/contracts/measurement";
import { slugify } from "../../src/server/catalogue/seed-rows";
import { computeSize } from "../../src/server/catalogue/size";
import { scoreFit } from "../../src/server/fit/score";
import type { CatalogueMouse } from "../../src/server/fit/types";
import goldenFixture from "./fixtures/fit-golden.json";
import seedRows from "../../src/db/seed/logitech.json";

/**
 * Golden fixtures (§Tests): 4 synthetic hand profiles run against the
 * checked-in 38-model seed, descriptors null (unclassified — the seed file
 * carries no shape descriptors). Snapshots the top-5 slugs + totals, so any
 * coefficient change in src/server/fit/coefficients.ts shows up as a diff
 * here instead of silently changing rankings. (Catalogue growth can also
 * change a snapshot — that's expected and re-verified against scoreFit
 * before updating, not a coefficient regression.)
 */
interface SeedRow {
  brand: string;
  model: string;
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  weightG: number | null;
}

const catalogue: CatalogueMouse[] = (seedRows as SeedRow[]).map((r) => ({
  slug: slugify(r.brand, r.model),
  brand: r.brand,
  model: r.model,
  lengthMm: r.lengthMm,
  widthMm: r.widthMm,
  heightMm: r.heightMm,
  weightG: r.weightG,
  size: computeSize({
    lengthMm: r.lengthMm,
    widthMm: r.widthMm,
    heightMm: r.heightMm,
  }),
  handCompatibility: null as HandCompatibility | null,
  shape: null,
  humpPlacement: null,
  frontFlare: null,
  sideCurvature: null,
  thumbRest: null,
  ringFingerRest: null,
}));

interface GoldenProfile {
  hand: "left" | "right";
  measurements: HandMeasurements;
  predictedGrip: GripStyle;
  top5: { slug: string; total: number }[];
}

const golden = goldenFixture as Record<string, GoldenProfile>;

describe("fit-golden", () => {
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
      expect(r.gripStyle.used).toBe(profile.predictedGrip); // no stated preference in these fixtures
      const top5 = r.results
        .slice(0, 5)
        .map((e) => ({ slug: e.mouse.slug, total: e.total }));
      expect(top5).toEqual(profile.top5);
    },
  );

  it("catalogue has exactly the 38-model seed, unclassified", () => {
    expect(catalogue).toHaveLength(38);
    expect(catalogue.every((m) => m.shape === null)).toBe(true);
  });
});
