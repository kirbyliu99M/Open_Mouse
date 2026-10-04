import {
  FRONT_FLARES,
  HUMP_PLACEMENTS,
  SIDE_CURVATURES,
} from "../../../src/lib/contracts/descriptors";
import { models } from "../models";
import type { ShellSpec } from "../shell-parameters";

// Authored synthetic fixtures, deliberately independent of catalogue labels.
const base = {
  ...models[0],
  sourceUrl: "synthetic-test-fixture",
  referenceUrl: "",
  model: "Descriptor coverage",
};
const variations: Partial<ShellSpec>[] = [
  ...HUMP_PLACEMENTS.map((humpPlacement) => ({ humpPlacement })),
  ...FRONT_FLARES.map((frontFlare) => ({ frontFlare })),
  ...SIDE_CURVATURES.map((sideCurvature) => ({ sideCurvature })),
  { shape: "hybrid", handCompatibility: "left" },
  { shape: "symmetrical", handCompatibility: "ambidextrous" },
  {
    shape: "ergonomic",
    handCompatibility: "right",
    thumbRest: true,
    ringFingerRest: true,
  },
  {
    shape: "ergonomic",
    handCompatibility: "left",
    thumbRest: true,
    ringFingerRest: true,
  },
];
export const coverage = variations.map((variation, index) => ({
  ...base,
  ...variation,
  id: `fixture-${index.toString().padStart(2, "0")}`,
}));
