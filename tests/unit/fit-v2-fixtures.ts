import seedRows from "../../src/db/seed/logitech.json";
import factsJson from "../../src/db/seed/logitech-facts.json";
import type { HandMeasurements } from "../../src/lib/contracts/measurement";
import { buildSeedCatalogue } from "../../src/server/fit/seed-catalogue";
import type { CatalogueMouse } from "../../src/server/fit/types";
import golden from "./fixtures/fit-golden.json";

/** The 38-row seed with every descriptor unknown (what the golden fixtures use). */
export const seedCatalogue = buildSeedCatalogue(
  seedRows as Parameters<typeof buildSeedCatalogue>[0],
  factsJson as Parameters<typeof buildSeedCatalogue>[1],
);

export const goldenHands = golden as unknown as Record<
  string,
  { hand: "left" | "right"; measurements: HandMeasurements }
>;

const base: CatalogueMouse = {
  slug: "acme-alpha",
  brand: "Acme",
  model: "Alpha",
  lengthMm: 118,
  widthMm: 66,
  heightMm: 38,
  weightG: 80,
  size: "medium",
  handCompatibility: null,
  shape: null,
  humpPlacement: null,
  frontFlare: null,
  sideCurvature: null,
  thumbRest: null,
  ringFingerRest: null,
};

export const mouse = (patch: Partial<CatalogueMouse>): CatalogueMouse => ({
  ...base,
  ...patch,
});

/**
 * Synthetic rows that exercise every descriptor path v2 must keep from v1:
 * hump, side curvature, ergonomic thumb rest (wide and narrow), flare, weight.
 */
export const describedCatalogue: CatalogueMouse[] = [
  mouse({
    slug: "a-flat",
    model: "Flat",
    lengthMm: 116,
    widthMm: 62,
    heightMm: 37,
    humpPlacement: "center",
    sideCurvature: "flat",
    frontFlare: "flat",
    thumbRest: false,
    shape: "symmetrical",
  }),
  mouse({
    slug: "a-ergo",
    model: "Ergo",
    lengthMm: 124,
    widthMm: 86,
    heightMm: 44,
    weightG: 105,
    humpPlacement: "back_aggressive",
    sideCurvature: "inward",
    frontFlare: "outward_slight",
    thumbRest: true,
    shape: "ergonomic",
    handCompatibility: "right",
  }),
  mouse({
    slug: "a-ergo-narrow",
    model: "ErgoNarrow",
    lengthMm: 120,
    widthMm: 74,
    heightMm: 41,
    weightG: 95,
    humpPlacement: "back_moderate",
    sideCurvature: "outward",
    frontFlare: "outward_moderate",
    thumbRest: true,
    shape: "ergonomic",
    handCompatibility: "right",
  }),
  mouse({
    slug: "a-small",
    model: "Small",
    lengthMm: 104,
    widthMm: 56,
    heightMm: 32,
    weightG: 60,
    humpPlacement: "back_minimal",
    sideCurvature: "inward_aggressive",
    frontFlare: "inward_slight",
    thumbRest: false,
  }),
  mouse({
    slug: "a-unknown",
    model: "Unknown",
    lengthMm: 112,
    widthMm: 64,
    heightMm: 36,
    weightG: null,
  }),
  mouse({
    slug: "a-tall",
    model: "Tall",
    lengthMm: 128,
    widthMm: 70,
    heightMm: 46,
    humpPlacement: "back_aggressive",
    sideCurvature: "outward_aggressive",
    frontFlare: "outward_aggressive",
    thumbRest: false,
  }),
];
