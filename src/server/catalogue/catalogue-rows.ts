/**
 * Builds the rows `seedCatalogue` writes from the four checked-in files:
 * `logitech.json` (first-party specs), `logitech-descriptors.json` (hump,
 * measured from the 3D shells), `logitech-facts.json` (hand, shape and form
 * factor read from the product pages) and `catalogue.json` (the 409 approved
 * candidates). Pure: no database, no file system (the seed passes `imageExists`).
 *
 * Precedence for a Logitech seed row's descriptors, per column, first non-null
 * wins:
 *   hand, shape:  facts, then the geometry file, then the matching candidate
 *   the rest:     the geometry file, then the matching candidate
 * so the candidate only ever fills a gap, and the seed row keeps its own
 * dimensions and weight.
 */
import {
  FORM_FACTORS,
  HAND_COMPATIBILITY,
  SHAPES,
  type CatalogueCategory,
  type DataSource,
  type FormFactor,
  type HandCompatibility,
  type Shape,
} from "../../lib/contracts/descriptors";
import type { CatalogueMouse } from "../fit/types";
import { deriveFormFactor, type CatalogueEntry } from "./candidate-map";
import {
  applyDescriptors,
  type DescriptorFields,
  type DescriptorRecord,
  type MouseRow,
  type SpecRecord,
  toMouseRow,
} from "./seed-rows";
import { computeSize } from "./size";

/** The slice of `logitech-facts.json` the seed reads. */
export type FactsFile = Record<
  string,
  {
    handCompatibility?: { value?: string | null };
    shape?: { value?: string | null };
    formFactor?: { value?: string | null };
  }
>;

export interface CatalogueColumns {
  category: CatalogueCategory;
  listed: boolean;
  formFactor: FormFactor;
  imagePath: string | null;
  dataSource: DataSource;
}

/** A `mice` insert before descriptors. Imported rows have no known connectivity. */
export type SeedRow = Omit<MouseRow, "connectivity"> & {
  connectivity: MouseRow["connectivity"] | null;
} & CatalogueColumns;

export type SeedRowWithDescriptors = SeedRow & DescriptorFields;

export interface CatalogueSeedInput {
  /** `logitech-facts.json`; absent means no facts. */
  facts?: FactsFile;
  /** `catalogue.json`; absent means no candidates. */
  entries?: readonly CatalogueEntry[];
  /** True when `public/images/mice/<slug>.webp` exists. Absent means no images. */
  imageExists?: (slug: string) => boolean;
}

/** Logitech G series: "G502 X", "G Pro X Superlight 2". */
export const isGSeries = (model: string): boolean => /^G(\d|\s)/.test(model);
/** Logitech MX series: "MX Master 4". */
export const isMxSeries = (model: string): boolean => /^MX\s/.test(model);

/**
 * Kirby, 2026-10-08: every Logitech mouse that is neither G series nor MX
 * series is hidden. G series is gaming; everything else Logitech makes here is
 * office. Other brands in the seed (none today) are gaming and listed.
 */
export function logitechVisibility(
  brand: string,
  model: string,
): { category: CatalogueCategory; listed: boolean } {
  if (brand !== "Logitech") return { category: "gaming", listed: true };
  return {
    category: isGSeries(model) ? "gaming" : "office",
    listed: isGSeries(model) || isMxSeries(model),
  };
}

export const imagePathFor = (slug: string): string =>
  `/images/mice/${slug}.webp`;

function factValue<T extends string>(
  facts: FactsFile,
  slug: string,
  key: "handCompatibility" | "shape" | "formFactor",
  allowed: readonly T[],
): T | null {
  const value = facts[slug]?.[key]?.value;
  if (value === undefined || value === null) return null;
  if (!(allowed as readonly string[]).includes(value)) {
    throw new RangeError(`logitech-facts.json ${slug}.${key}: "${value}"`);
  }
  return value as T;
}

/** The two CHECK constraints a merge could break; throws instead of letting the insert fail late. */
export function assertConsistent(label: string, f: DescriptorFields): void {
  if (
    f.handCompatibility === "ambidextrous" &&
    f.shape !== null &&
    f.shape !== "symmetrical"
  ) {
    throw new Error(`${label}: ambidextrous but shape is ${f.shape}`);
  }
  if (f.thumbRest === true && f.shape !== "ergonomic") {
    throw new Error(`${label}: thumb rest but shape is ${String(f.shape)}`);
  }
  if (f.ringFingerRest === true && f.shape !== "ergonomic") {
    throw new Error(
      `${label}: ring-finger rest but shape is ${String(f.shape)}`,
    );
  }
}

const NO_FIELDS: DescriptorFields = {
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

/** Descriptor columns carried by a catalogue entry; the model string records that they came from EloShapes. */
function entryFields(entry: CatalogueEntry): DescriptorFields {
  return {
    ...NO_FIELDS,
    shape: entry.shape,
    handCompatibility: entry.handCompatibility,
    humpPlacement: entry.humpPlacement,
    frontFlare: entry.frontFlare,
    sideCurvature: entry.sideCurvature,
    thumbRest: entry.thumbRest,
    descriptorModel: entry.descriptorsInferred
      ? "eloshapes-inferred"
      : "eloshapes",
  };
}

const first = <T>(...values: (T | null)[]): T | null =>
  values.find((v) => v !== null) ?? null;

/** Merges the three sources onto one Logitech seed row (see the file header). */
export function mergeSeedDescriptors(
  label: string,
  geometry: DescriptorFields,
  facts: { handCompatibility: HandCompatibility | null; shape: Shape | null },
  entry: CatalogueEntry | undefined,
): DescriptorFields {
  const e = entry ? entryFields(entry) : NO_FIELDS;
  const geometryHasProvenance = geometry.descriptorModel !== null;
  const merged: DescriptorFields = {
    shape: first(facts.shape, geometry.shape, e.shape),
    handCompatibility: first(
      facts.handCompatibility,
      geometry.handCompatibility,
      e.handCompatibility,
    ),
    humpPlacement: first(geometry.humpPlacement, e.humpPlacement),
    frontFlare: first(geometry.frontFlare, e.frontFlare),
    sideCurvature: first(geometry.sideCurvature, e.sideCurvature),
    thumbRest: first(geometry.thumbRest, e.thumbRest),
    ringFingerRest: geometry.ringFingerRest,
    // Provenance stays the geometry file's when it has one; otherwise it names
    // EloShapes when a candidate contributed.
    descriptorMethod: geometryHasProvenance ? geometry.descriptorMethod : null,
    descriptorModel: geometryHasProvenance
      ? geometry.descriptorModel
      : e.descriptorModel,
    descriptorSourceUrls: geometryHasProvenance
      ? geometry.descriptorSourceUrls
      : null,
    classifiedAt: geometryHasProvenance ? geometry.classifiedAt : null,
  };
  assertConsistent(label, merged);
  return merged;
}

export interface BuiltSeedRows {
  /** Rows whose descriptor columns the upsert overwrites (nulls included). */
  withDescriptors: SeedRowWithDescriptors[];
  /** Rows no source speaks for: the upsert leaves their descriptor columns alone. */
  withoutDescriptors: SeedRow[];
  /** Candidate entries merged into a `logitech.json` row. */
  merged: number;
  /** Candidate entries that became rows of their own. */
  imported: number;
  /** Spec records dropped for a missing dimension. */
  skipped: number;
}

const catalogueColumns = (
  row: Pick<MouseRow, "slug" | "lengthMm" | "heightMm" | "brand" | "model">,
  formFactor: FormFactor | null,
  dataSource: DataSource,
  imageExists: (slug: string) => boolean,
): CatalogueColumns => ({
  ...logitechVisibility(row.brand, row.model),
  formFactor: formFactor ?? deriveFormFactor(row),
  imagePath: imageExists(row.slug) ? imagePathFor(row.slug) : null,
  dataSource,
});

export function buildSeedRows(
  specs: readonly SpecRecord[],
  descriptors: readonly DescriptorRecord[],
  input: CatalogueSeedInput = {},
): BuiltSeedRows {
  const facts = input.facts ?? {};
  const entries = input.entries ?? [];
  const imageExists = input.imageExists ?? (() => false);
  const geometryByModel = new Map(descriptors.map((d) => [d.model, d]));
  const entryBySeedModel = new Map(
    entries.filter((e) => e.mergesInto).map((e) => [e.mergesInto!, e]),
  );

  const withDescriptors: SeedRowWithDescriptors[] = [];
  const withoutDescriptors: SeedRow[] = [];
  const slugs = new Set<string>();
  let skipped = 0;

  for (const spec of specs) {
    const base = toMouseRow(spec);
    if (!base) {
      skipped += 1;
      continue;
    }
    slugs.add(base.slug);
    const factHand = factValue(
      facts,
      base.slug,
      "handCompatibility",
      HAND_COMPATIBILITY,
    );
    const factShape = factValue(facts, base.slug, "shape", SHAPES);
    const factForm = factValue(facts, base.slug, "formFactor", FORM_FACTORS);
    const row: SeedRow = {
      ...base,
      ...catalogueColumns(base, factForm, "first_party", imageExists),
    };
    const geometry = geometryByModel.get(base.model);
    const entry = entryBySeedModel.get(base.model);
    if (!geometry && !entry && factHand === null && factShape === null) {
      withoutDescriptors.push(row);
      continue;
    }
    const geometryFields = geometry
      ? applyDescriptors(base, geometry)
      : { ...base, ...NO_FIELDS };
    withDescriptors.push({
      ...row,
      ...mergeSeedDescriptors(
        `${base.brand} ${base.model}`,
        geometryFields,
        { handCompatibility: factHand, shape: factShape },
        entry,
      ),
    });
  }

  let imported = 0;
  for (const entry of entries) {
    if (entry.mergesInto) continue;
    const slug = entry.slug;
    if (slugs.has(slug)) {
      throw new Error(
        `catalogue.json row ${slug} duplicates a logitech.json row`,
      );
    }
    slugs.add(slug);
    const dims = {
      lengthMm: entry.lengthMm,
      widthMm: entry.widthMm,
      heightMm: entry.heightMm,
    };
    const fields = entryFields(entry);
    assertConsistent(`${entry.brand} ${entry.model}`, fields);
    withDescriptors.push({
      slug,
      brand: entry.brand,
      model: entry.model,
      ...dims,
      weightG: entry.weightG,
      connectivity: null,
      size: computeSize(dims),
      sourceUrl: entry.sourceUrl,
      specRetrievedAt: new Date(entry.retrievedAt),
      category: "gaming",
      listed: true,
      formFactor: deriveFormFactor(dims),
      imagePath: imageExists(slug) ? imagePathFor(slug) : null,
      dataSource: entry.dataSource,
      ...fields,
    });
    imported += 1;
  }

  return {
    withDescriptors,
    withoutDescriptors,
    merged: entries.length - imported,
    imported,
    skipped,
  };
}

/** What the fit engine sees of a built row (for tests and the stability script). */
export function toCatalogueMouse(
  row: SeedRow & Partial<DescriptorFields>,
): CatalogueMouse {
  return {
    slug: row.slug,
    brand: row.brand,
    model: row.model,
    lengthMm: row.lengthMm,
    widthMm: row.widthMm,
    heightMm: row.heightMm,
    weightG: row.weightG,
    size: row.size,
    handCompatibility: row.handCompatibility ?? null,
    shape: row.shape ?? null,
    humpPlacement: row.humpPlacement ?? null,
    frontFlare: row.frontFlare ?? null,
    sideCurvature: row.sideCurvature ?? null,
    thumbRest: row.thumbRest ?? null,
    formFactor: row.formFactor,
    listed: row.listed,
  };
}
