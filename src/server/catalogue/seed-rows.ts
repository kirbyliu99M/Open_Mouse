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

/** src/db/seed/logitech-descriptors.json's shape — scripts/classify-descriptors.ts writes it. */
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
 * `needsReview` (failed consistency review twice) or with no match is kept
 * out of the seed — descriptor fields stay null rather than guessed. Never
 * wipes an already-seeded mouse's descriptors: when there is no record at
 * all (the classifier hasn't run), the caller's upsert must leave existing
 * columns alone rather than trust these nulls — see scripts/seed.ts.
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
