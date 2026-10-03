import type {
  Connectivity,
  FrontFlare,
  HandCompatibility,
  HumpPlacement,
  Shape,
  SideCurvature,
} from "../../lib/contracts/descriptors";
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

export type MouseRow = NonNullable<ReturnType<typeof toMouseRow>>;

/** The descriptors file scripts/seed.ts reads and both producers write. */
export const DESCRIPTORS_SEED_PATH = "src/db/seed/logitech-descriptors.json";

/**
 * src/db/seed/logitech-descriptors.json's shape. Two scripts write that file:
 * scripts/classify-descriptors.ts (Gemini vision; its run failed the M1 gate)
 * and scripts/descriptors-from-geometry.ts (hump placement measured from the
 * 3D shells; the committed file comes from this one).
 */
export interface DescriptorRecord {
  model: string;
  shape: Shape | null;
  handCompatibility: HandCompatibility | null;
  humpPlacement: HumpPlacement | null;
  frontFlare: FrontFlare | null;
  sideCurvature: SideCurvature | null;
  thumbRest: boolean | null;
  ringFingerRest: boolean | null;
  sourceImageUrls: string[];
  descriptorModel: string;
  classifiedAt: string;
  needsReview: boolean;
  notes?: string[];
}

export interface DescriptorFields {
  shape: Shape | null;
  handCompatibility: HandCompatibility | null;
  humpPlacement: HumpPlacement | null;
  frontFlare: FrontFlare | null;
  sideCurvature: SideCurvature | null;
  thumbRest: boolean | null;
  ringFingerRest: boolean | null;
  descriptorMethod: "rubric_vision" | null;
  descriptorModel: string | null;
  descriptorSourceUrls: string[] | null;
  classifiedAt: Date | null;
}

const NO_DESCRIPTORS: DescriptorFields = {
  shape: null,
  handCompatibility: null,
  humpPlacement: null,
  frontFlare: null,
  sideCurvature: null,
  thumbRest: null,
  ringFingerRest: null,
  descriptorMethod: null,
  descriptorModel: null,
  descriptorSourceUrls: null,
  classifiedAt: null,
};

/**
 * Merges a classified descriptor record onto a spec row. A record flagged
 * `needsReview` (failed consistency review twice) or with no match returns
 * null descriptor fields — never guessed. This is the row `scripts/seed.ts`
 * writes for a model that *has* an entry in logitech-descriptors.json: the
 * caller must overwrite every descriptor column unconditionally with these
 * values (nulls included), so a model that regresses to needsReview clears
 * whatever a previous run classified rather than leaving it stuck. A model
 * with **no** entry at all is a different case — see `partitionByDescriptors`.
 */
export function applyDescriptors(
  row: MouseRow,
  record: DescriptorRecord | undefined,
): MouseRow & DescriptorFields {
  if (!record || record.needsReview) return { ...row, ...NO_DESCRIPTORS };
  return {
    ...row,
    shape: record.shape,
    handCompatibility: record.handCompatibility,
    humpPlacement: record.humpPlacement,
    frontFlare: record.frontFlare,
    sideCurvature: record.sideCurvature,
    thumbRest: record.thumbRest,
    ringFingerRest: record.ringFingerRest,
    descriptorMethod: "rubric_vision",
    descriptorModel: record.descriptorModel,
    descriptorSourceUrls: record.sourceImageUrls,
    classifiedAt: new Date(record.classifiedAt),
  };
}

export interface DescriptorPartition {
  /**
   * Has an entry in logitech-descriptors.json. Every descriptor column
   * must be overwritten unconditionally with these values (nulls included)
   * — a plain `excluded.x` assignment on conflict, never COALESCE, so a
   * needsReview record clears a stale value from an earlier run instead of
   * being unable to touch it.
   */
  withDescriptors: (MouseRow & DescriptorFields)[];
  /**
   * No entry at all — the classifier hasn't run for this model, or this
   * seed run has no descriptors file. The caller's upsert must not
   * reference descriptor columns for these rows at all, so whatever is
   * already in the database (if anything) is left untouched.
   */
  withoutDescriptors: MouseRow[];
}

/** Splits spec rows by whether logitech-descriptors.json has an entry for their model. */
export function partitionByDescriptors(
  rows: readonly MouseRow[],
  descriptorsByModel: ReadonlyMap<string, DescriptorRecord>,
): DescriptorPartition {
  const withDescriptors: (MouseRow & DescriptorFields)[] = [];
  const withoutDescriptors: MouseRow[] = [];
  for (const row of rows) {
    const record = descriptorsByModel.get(row.model);
    if (record) withDescriptors.push(applyDescriptors(row, record));
    else withoutDescriptors.push(row);
  }
  return { withDescriptors, withoutDescriptors };
}
