import type { Connectivity } from "../../lib/contracts/descriptors";
import { computeSize } from "./size";

export interface SpecRecord {
  brand: string;
  model: string;
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  weightG: number | null;
  connectivity: Connectivity;
  sourceUrl: string;
  retrievedAt: string;
}

export const slugify = (...parts: string[]) =>
  parts
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/**
 * Spec record → `mice` insert. Size is computed here, never read from input.
 * Returns null for records without all three dimensions: we seed nothing we
 * cannot size, rather than inventing a value.
 */
export function toMouseRow(r: SpecRecord) {
  if (r.lengthMm === null || r.widthMm === null || r.heightMm === null)
    return null;
  return {
    slug: slugify(r.brand, r.model),
    brand: r.brand,
    model: r.model,
    lengthMm: r.lengthMm,
    widthMm: r.widthMm,
    heightMm: r.heightMm,
    weightG: r.weightG,
    connectivity: r.connectivity,
    size: computeSize({
      lengthMm: r.lengthMm,
      widthMm: r.widthMm,
      heightMm: r.heightMm,
    }),
    sourceUrl: r.sourceUrl,
    specRetrievedAt: new Date(r.retrievedAt),
  };
}
