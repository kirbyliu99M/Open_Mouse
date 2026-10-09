import { describe, expect, it } from "vitest";
import seedRows from "../../src/db/seed/logitech.json";
import factsJson from "../../src/db/seed/logitech-facts.json";
import { fitResponseSchema } from "../../src/lib/contracts/fit";
import type { GripStyle, HandType } from "../../src/lib/contracts/fit";
import type { HandMeasurements } from "../../src/lib/contracts/measurement";
import { computePriors } from "../../src/server/fit/priors";
import { buildSeedCatalogue } from "../../src/server/fit/seed-catalogue";
import { scoreFitV1 } from "../../src/server/fit/score-v1";
import goldenFixture from "./fixtures/fit-golden-v1.json";

/**
 * Golden fixtures for the fit-v1 candidate: the same four synthetic hands and
 * the same unclassified 38-model seed as fit-golden.test.ts (which pins v0 and
 * is unchanged), plus the form factors of logitech-facts.json so the trackball
 * and vertical exclusions are exercised. Any coefficient change in
 * src/server/fit/coefficients.ts shows up as a diff here.
 */
const catalogue = buildSeedCatalogue(
  seedRows as Parameters<typeof buildSeedCatalogue>[0],
  factsJson as Parameters<typeof buildSeedCatalogue>[1],
);
const priors = computePriors(catalogue);

interface GoldenProfile {
  hand: "left" | "right";
  measurements: HandMeasurements;
  predictedGrip: GripStyle;
  gripWeights: Record<GripStyle, number>;
  handType: HandType;
  top5: { slug: string; total: number }[];
}

const golden = goldenFixture as Record<string, GoldenProfile>;

describe("fit-golden-v1", () => {
  it.each(Object.entries(golden))("%s matches the snapshot", (_n, profile) => {
    const r = scoreFitV1(
      profile.measurements,
      catalogue,
      { includeVertical: false },
      profile.hand,
      priors,
    );
    expect(r.engineVersion).toBe("fit-v1-candidate.2");
    expect(r.gripStyle.predicted).toBe(profile.predictedGrip);
    expect(r.gripStyle.used).toBe(profile.predictedGrip);
    const w = r.gripStyle.weights!;
    expect({
      palm: +w.palm.toFixed(4),
      claw: +w.claw.toFixed(4),
      fingertip: +w.fingertip.toFixed(4),
    }).toEqual(profile.gripWeights);
    expect(r.handType).toEqual(profile.handType);
    expect(
      r.results
        .slice(0, 5)
        .map((e) => ({ slug: e.mouse.slug, total: e.total })),
    ).toEqual(profile.top5);
  });

  it.each(Object.entries(golden))(
    "%s: the whole response passes the contract schema",
    (_n, profile) => {
      const r = scoreFitV1(
        profile.measurements,
        catalogue,
        { includeVertical: false },
        profile.hand,
        priors,
      );
      const parsed = fitResponseSchema.safeParse({
        scanId: "00000000-0000-4000-8000-000000000000",
        ...r,
      });
      expect(parsed.success).toBe(true);
    },
  );

  it("excludes the three trackballs and two verticals of the seed", () => {
    const r = scoreFitV1(
      golden.medium_claw.measurements,
      catalogue,
      { includeVertical: false },
      "right",
      priors,
    );
    const reasons = Object.fromEntries(
      r.excluded.map((e) => [e.slug, e.reason]),
    );
    expect(reasons).toMatchObject({
      "logitech-ergo-m575": "trackball_form_factor",
      "logitech-mx-ergo-s": "trackball_form_factor",
      "logitech-ergo-m575s": "trackball_form_factor",
      "logitech-mx-vertical": "vertical_form_factor",
      "logitech-lift-vertical": "vertical_form_factor",
    });
  });
});
