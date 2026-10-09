import type { FormFactor } from "../../lib/contracts/descriptors";
import { FORM_FACTORS } from "../../lib/contracts/descriptors";
import { slugify } from "../catalogue/seed-rows";
import { computeSize } from "../catalogue/size";
import type { CatalogueMouse } from "./types";

interface SeedRow {
  brand: string;
  model: string;
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  weightG: number | null;
}

/** The slice of `logitech-facts.json` the fit engine reads. */
export type SeedFacts = Record<
  string,
  { formFactor?: { value?: string | null } }
>;

/**
 * The checked-in 38-model seed as the fit engine sees it with no descriptors
 * (the catalogue the golden fixtures use), plus each model's form factor from
 * `logitech-facts.json` where the facts file names one. Used by the fit tests
 * and `scripts/fit-stability.ts`; the app itself loads the database.
 */
export function buildSeedCatalogue(
  rows: readonly SeedRow[],
  facts: SeedFacts,
): CatalogueMouse[] {
  return rows.map((r) => {
    const slug = slugify(r.brand, r.model);
    const value = facts[slug]?.formFactor?.value;
    const formFactor = (FORM_FACTORS as readonly string[]).includes(value ?? "")
      ? (value as FormFactor)
      : undefined;
    return {
      slug,
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
      handCompatibility: null,
      shape: null,
      humpPlacement: null,
      frontFlare: null,
      sideCurvature: null,
      thumbRest: null,
      ...(formFactor ? { formFactor } : {}),
    };
  });
}
