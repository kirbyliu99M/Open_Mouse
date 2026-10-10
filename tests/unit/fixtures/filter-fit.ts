import type { Shape, Size } from "../../../src/lib/contracts/descriptors";
import type { FitEntry, FitResponse } from "../../../src/lib/contracts/fit";
import { makeEntry, makeFit } from "../analysis-fixtures";

/** One ranked mouse for a filter test; every field has a default. */
export interface FilterSpec {
  slug: string;
  brand?: string;
  size?: Size;
  weightG?: number | null;
  shape?: Shape | null;
  connectivity?: "wired" | "wireless" | null;
  variants?: {
    slug: string;
    weightG: number | null;
    connectivity?: "wired" | "wireless" | null;
  }[];
}

/** A response whose results are ranked in the order of `specs` (the first is rank 1). */
export function filterFit(
  specs: FilterSpec[],
  over: Partial<FitResponse> = {},
): FitResponse {
  const results: FitEntry[] = specs.map((s, i) => {
    const base = makeEntry();
    return {
      ...base,
      rank: i + 1,
      total: 90 - i,
      mouse: {
        ...base.mouse,
        slug: s.slug,
        brand: s.brand ?? "Acme",
        model: s.slug.toUpperCase(),
        size: s.size ?? "medium",
        weightG: s.weightG === undefined ? 60 : s.weightG,
        shape: s.shape === undefined ? "ergonomic" : s.shape,
        connectivity:
          s.connectivity === undefined ? "wireless" : s.connectivity,
      },
      ...(s.variants
        ? {
            variants: s.variants.map((v) => ({
              slug: v.slug,
              model: v.slug.toUpperCase(),
              weightG: v.weightG,
              ...(v.connectivity !== undefined
                ? { connectivity: v.connectivity }
                : {}),
            })),
          }
        : {}),
    };
  });
  return makeFit({ results, excluded: [], ...over });
}
