/**
 * Pure mapping from the approved-candidates CSV (gaming mice currently on
 * sale, adjudicated by Claude and Kirby) to catalogue entries.
 * `scripts/import-catalogue.ts` is the only reader of the CSV and writes the
 * result to `src/db/seed/catalogue.json`; everything here is a pure function
 * of its arguments so it can be unit tested without the (licensed, uncommitted)
 * file.
 *
 * Descriptor wording is EloShapes'. Every value maps to a contract enum or
 * throws: an unknown spelling is a data error to look at, never a silent null.
 * Blank and "-" mean "no value" and become null.
 */
import {
  FRONT_FLARES,
  HAND_COMPATIBILITY,
  HUMP_PLACEMENTS,
  SHAPES,
  SIDE_CURVATURES,
  type DataSource,
  type FormFactor,
  type FrontFlare,
  type HandCompatibility,
  type HumpPlacement,
  type Shape,
  type SideCurvature,
} from "../../lib/contracts/descriptors";
import { toSlug } from "./csv";
import { slugify } from "./seed-rows";

/** One CSV row, every cell still a string. */
export interface CandidateRecord {
  descriptorBasis: string;
  brand: string;
  model: string;
  officialUrl: string;
  source: string;
  lengthMm: string;
  widthMm: string;
  heightMm: string;
  weightG: string;
  size: string;
  shape: string;
  hand: string;
  hump: string;
  flare: string;
  sideCurvature: string;
  thumbRest: string;
}

/** A row of `src/db/seed/catalogue.json`. */
export interface CatalogueEntry {
  slug: string;
  brand: string;
  model: string;
  /** The brand's page when the candidate list has one, else the EloShapes browse page. */
  sourceUrl: string;
  dataSource: DataSource;
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  weightG: number | null;
  shape: Shape | null;
  handCompatibility: HandCompatibility | null;
  humpPlacement: HumpPlacement | null;
  frontFlare: FrontFlare | null;
  sideCurvature: SideCurvature | null;
  thumbRest: boolean | null;
  /** True when the shape values come from a predecessor or a description, not a measurement of this model. */
  descriptorsInferred: boolean;
  /**
   * The model name of the `logitech.json` row this entry is the same product
   * as, or null. The seed keeps that row's numbers and fills only its null
   * descriptors from this entry.
   */
  mergesInto: string | null;
  /** ISO timestamp of the candidate list's adjudication date. */
  retrievedAt: string;
}

/** Where a candidate with no official page of its own points. */
export const ELOSHAPES_BROWSE_URL = "https://www.eloshapes.com/mouse/browse";

/**
 * Candidate model → the `logitech.json` model it is the same product as.
 * Only renames and sensor refreshes of an identical shell; a different
 * product that merely shares a shell (G304 and G305, G502 Lightspeed and
 * G502 X Lightspeed) is not an alias.
 */
export const LOGITECH_ALIASES: Readonly<Record<string, string>> = {
  "G903 Lightspeed": "G903 Hero",
  G403: "G403 Hero",
};

const BRAND_ALIASES: Readonly<Record<string, string>> = {
  "logitech g": "Logitech",
  logitechg: "Logitech",
  "logitech gaming": "Logitech",
};

export function normaliseBrand(raw: string): string {
  const collapsed = raw.trim().replace(/\s+/g, " ");
  if (collapsed === "") throw new RangeError("brand is empty");
  return BRAND_ALIASES[collapsed.toLowerCase()] ?? collapsed;
}

const isBlank = (v: string): boolean => {
  const t = v.trim();
  return t === "" || t === "-" || t === "–";
};

function mapEnum<T extends string>(
  field: string,
  raw: string,
  allowed: readonly T[],
  extra: Readonly<Record<string, T>> = {},
): T | null {
  if (isBlank(raw)) return null;
  const slug = toSlug(raw);
  const viaExtra = extra[slug];
  if (viaExtra) return viaExtra;
  if ((allowed as readonly string[]).includes(slug)) return slug as T;
  throw new RangeError(
    `${field}: "${raw}" does not map to ${allowed.join("|")}`,
  );
}

/**
 * EloShapes also uses "Asymmetrical" for a deliberately handed shell. The
 * contract has no such value; rubric §3 puts a handed shell with an
 * asymmetric hump under Ergonomic, so that is what it maps to.
 */
export const mapShape = (raw: string): Shape | null =>
  mapEnum("shape", raw, SHAPES, { asymmetrical: "ergonomic" });
export const mapHand = (raw: string): HandCompatibility | null =>
  mapEnum("hand", raw, HAND_COMPATIBILITY);
export const mapHump = (raw: string): HumpPlacement | null =>
  mapEnum("hump", raw, HUMP_PLACEMENTS);
export const mapFlare = (raw: string): FrontFlare | null =>
  mapEnum("flare", raw, FRONT_FLARES);
export const mapSideCurvature = (raw: string): SideCurvature | null =>
  mapEnum("sideCurvature", raw, SIDE_CURVATURES);

export function mapYesNo(field: string, raw: string): boolean | null {
  if (isBlank(raw)) return null;
  const v = raw.trim().toLowerCase();
  if (v === "yes") return true;
  if (v === "no") return false;
  throw new RangeError(`${field}: "${raw}" is neither Yes nor No`);
}

export function mapDataSource(raw: string): DataSource {
  const v = raw.trim().toLowerCase();
  if (v === "eloshapes_csv" || v === "eloshapes_site") return "eloshapes";
  if (v === "official") return "first_party";
  throw new RangeError(
    `source: "${raw}" is not eloshapes_csv|eloshapes_site|official`,
  );
}

function mapPositive(field: string, raw: string, required: true): number;
function mapPositive(
  field: string,
  raw: string,
  required: false,
): number | null;
function mapPositive(field: string, raw: string, required: boolean) {
  if (isBlank(raw)) {
    if (required) throw new RangeError(`${field} is empty`);
    return null;
  }
  const n = Number(raw.trim());
  if (!Number.isFinite(n) || n <= 0) {
    throw new RangeError(`${field}: "${raw}" is not a positive number`);
  }
  return n;
}

export function mapSourceUrl(raw: string, dataSource: DataSource): string {
  const url = raw.trim();
  if (url === "") {
    if (dataSource === "eloshapes") return ELOSHAPES_BROWSE_URL;
    throw new RangeError("a first-party row needs an official URL");
  }
  if (!url.startsWith("https://")) {
    throw new RangeError(`officialUrl "${url}" is not an https URL`);
  }
  return url;
}

/** Height over length above this is a vertical mouse (the fit engine's own ratio). */
export const VERTICAL_RATIO = 0.55;

/**
 * Form factor from the measurements alone: vertical when the shell is as tall
 * as the engine's ratio says, else standard. A trackball cannot be told from
 * its dimensions; it comes from a first-party fact (`logitech-facts.json`).
 */
export function deriveFormFactor(dims: {
  lengthMm: number;
  heightMm: number;
}): Exclude<FormFactor, "trackball"> {
  return dims.heightMm / dims.lengthMm > VERTICAL_RATIO
    ? "vertical"
    : "standard";
}

export function mapCandidate(
  record: CandidateRecord,
  retrievedAt: string,
): CatalogueEntry {
  const brand = normaliseBrand(record.brand);
  const model = record.model.trim().replace(/\s+/g, " ");
  if (model === "") throw new RangeError(`${brand}: model is empty`);
  const label = `${brand} ${model}`;
  try {
    const dataSource = mapDataSource(record.source);
    return {
      slug: slugify(brand, model),
      brand,
      model,
      sourceUrl: mapSourceUrl(record.officialUrl, dataSource),
      dataSource,
      lengthMm: mapPositive("lengthMm", record.lengthMm, true),
      widthMm: mapPositive("widthMm", record.widthMm, true),
      heightMm: mapPositive("heightMm", record.heightMm, true),
      weightG: mapPositive("weightG", record.weightG, false),
      shape: mapShape(record.shape),
      handCompatibility: mapHand(record.hand),
      humpPlacement: mapHump(record.hump),
      frontFlare: mapFlare(record.flare),
      sideCurvature: mapSideCurvature(record.sideCurvature),
      thumbRest: mapYesNo("thumbRest", record.thumbRest),
      descriptorsInferred: record.descriptorBasis.trim() !== "",
      mergesInto: null,
      retrievedAt,
    };
  } catch (error) {
    throw new RangeError(
      `${label}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Throws naming every slug (or brand + model) that appears twice. */
export function assertNoDuplicates(
  entries: readonly Pick<CatalogueEntry, "slug" | "brand" | "model">[],
): void {
  const seen = new Map<string, string>();
  const clashes: string[] = [];
  for (const e of entries) {
    const key = e.slug;
    const prior = seen.get(key);
    if (prior !== undefined)
      clashes.push(`${prior} / ${e.brand} ${e.model} -> ${key}`);
    else seen.set(key, `${e.brand} ${e.model}`);
  }
  if (clashes.length > 0) {
    throw new Error(`duplicate catalogue slugs: ${clashes.join("; ")}`);
  }
}

/**
 * Decides, for every Logitech entry, which `logitech.json` row it merges into.
 * An exact model-name match wins; an alias applies only when its target seed
 * model exists and no entry matches that model by name (so with both "G403"
 * and "G403 Hero" in the list, "G403 Hero" merges and "G403" stays a new row).
 * Two entries claiming one seed row is an error.
 */
export function resolveLogitechMerges(
  entries: readonly CatalogueEntry[],
  seedModels: readonly string[],
): CatalogueEntry[] {
  const seed = new Set(seedModels);
  const logitech = entries.filter((e) => e.brand === "Logitech");
  const exact = new Set(
    logitech.filter((e) => seed.has(e.model)).map((e) => e.model),
  );
  const claimed = new Map<string, string>();
  const claim = (target: string, entry: CatalogueEntry): string => {
    const prior = claimed.get(target);
    if (prior !== undefined) {
      throw new Error(
        `${prior} and ${entry.model} both merge into the seed row ${target}`,
      );
    }
    claimed.set(target, entry.model);
    return target;
  };
  return entries.map((entry) => {
    if (entry.brand !== "Logitech") return entry;
    if (seed.has(entry.model)) {
      return { ...entry, mergesInto: claim(entry.model, entry) };
    }
    const alias = LOGITECH_ALIASES[entry.model];
    if (alias && seed.has(alias) && !exact.has(alias)) {
      return { ...entry, mergesInto: claim(alias, entry) };
    }
    return entry;
  });
}

/** The whole import: map, check for duplicates, resolve the Logitech merges. */
export function buildCatalogue(
  records: readonly CandidateRecord[],
  seedModels: readonly string[],
  retrievedAt: string,
): CatalogueEntry[] {
  const mapped = records.map((r) => mapCandidate(r, retrievedAt));
  assertNoDuplicates(mapped);
  return resolveLogitechMerges(mapped, seedModels);
}

/**
 * Names that suggest a trackball, for the import report only. The catalogue's
 * form factor never comes from a name; a hit here is a prompt to look.
 */
export const TRACKBALL_NAME_PATTERN =
  /track\s?ball|\bm575\b|\bmx ergo\b|\bexpert\b|\bslimblade\b|\borbit\b|\bergo m575/i;
