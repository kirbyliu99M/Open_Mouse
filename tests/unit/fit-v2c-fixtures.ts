/**
 * Shared fixtures for the fit-v2.0 candidate tests (`fit-v2c-*.test.ts`). Not
 * a test file itself.
 *
 * The real catalogue is the checked-in seed (`src/db/seed/*`) through
 * `buildSeedRows` and `listedOnly`, as `loadOwnedFit` sees it, and the priors
 * are `computePriors` of that listed catalogue, as on the production path.
 */
import catalogueJson from "../../src/db/seed/catalogue.json";
import descriptorsJson from "../../src/db/seed/logitech-descriptors.json";
import factsJson from "../../src/db/seed/logitech-facts.json";
import seedJson from "../../src/db/seed/logitech.json";
import type { FitResponse } from "../../src/lib/contracts/fit";
import type { HandMeasurements } from "../../src/lib/contracts/measurement";
import type { CatalogueEntry } from "../../src/server/catalogue/candidate-map";
import {
  buildSeedRows,
  type FactsFile,
  toCatalogueMouse,
} from "../../src/server/catalogue/catalogue-rows";
import type {
  DescriptorRecord,
  SpecRecord,
} from "../../src/server/catalogue/seed-rows";
import { listedOnly } from "../../src/server/fit/listed";
import { computePriors } from "../../src/server/fit/priors";
import type { CatalogueMouse } from "../../src/server/fit/types";

const built = buildSeedRows(
  seedJson as unknown as SpecRecord[],
  descriptorsJson as unknown as DescriptorRecord[],
  {
    facts: factsJson as unknown as FactsFile,
    entries: catalogueJson as unknown as CatalogueEntry[],
  },
);

/** The listed seed catalogue, as the engines see it in production. */
export const seedCatalogue: readonly CatalogueMouse[] = listedOnly(
  [...built.withDescriptors, ...built.withoutDescriptors].map((r) =>
    toCatalogueMouse(r),
  ),
);

export const seedPriors = computePriors(seedCatalogue);

/** A hand of `handLengthMm` x `palmWidthMm`, palm length `ratio` x the hand length. */
export function hand(
  handLengthMm: number,
  palmWidthMm: number,
  ratio = 0.56,
): HandMeasurements {
  return { handLengthMm, palmLengthMm: handLengthMm * ratio, palmWidthMm };
}

/** Freezes an object graph, so a test can prove a call changes nothing. */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

/** A response without the field that always differs between two engines. */
export function withoutVersion(
  r: Omit<FitResponse, "scanId">,
): Omit<FitResponse, "scanId" | "engineVersion"> {
  const { engineVersion: _version, ...rest } = r;
  void _version;
  return rest;
}

/** A plain catalogue row for synthetic fixtures: symmetrical, ambidextrous, fully described. */
export function mouseRow(patch: Partial<CatalogueMouse>): CatalogueMouse {
  return {
    slug: "acme-alpha",
    brand: "Acme",
    model: "Alpha",
    lengthMm: 120,
    widthMm: 64,
    heightMm: 38,
    weightG: 60,
    size: "medium",
    handCompatibility: "ambidextrous",
    shape: "symmetrical",
    humpPlacement: "back_moderate",
    frontFlare: "outward_slight",
    sideCurvature: "flat",
    thumbRest: false,
    ringFingerRest: null,
    ...patch,
  };
}
