/**
 * The only EXIF the learning kit keeps.
 *
 * A phone photo's EXIF carries GPS position, the time it was taken, the
 * device's serial number and more (Kirby, 2026-09-30: the run log takes a
 * white-list only). This reader is that white-list by construction: it walks
 * to the Exif sub-IFD and looks up exactly four tags. Every other tag, and
 * the GPS and maker-note blocks, are never read, so they cannot reach a run
 * log even by mistake.
 *
 * | Key                    | Tag    | Why it is kept                              |
 * | ---------------------- | ------ | ------------------------------------------- |
 * | focalLengthMm          | 0x920A | lens, for parallax correction diagnostics   |
 * | focalLengthIn35mmFilm  | 0xA405 | the focal length the product converts to px |
 * | pixelXDimension        | 0xA002 | the frame the focal length was defined for  |
 * | pixelYDimension        | 0xA003 | (the decoded size is recorded separately)   |
 *
 * Pure, dependency-free, and forgiving: anything unreadable gives `null`.
 * `src/client/geometry/exif-focal.ts` reads the same file for the product's
 * own focal-length policy; the two are kept apart on purpose, because that
 * one reads more tags than this file may.
 */

export interface ExifWhitelist {
  readonly focalLengthMm: number | null;
  readonly focalLengthIn35mmFilm: number | null;
  readonly pixelXDimension: number | null;
  readonly pixelYDimension: number | null;
}

/** The complete list of keys a run log may hold from EXIF. */
export const EXIF_WHITELIST_KEYS = [
  "focalLengthMm",
  "focalLengthIn35mmFilm",
  "pixelXDimension",
  "pixelYDimension",
] as const satisfies readonly (keyof ExifWhitelist)[];

export const NO_EXIF: ExifWhitelist = {
  focalLengthMm: null,
  focalLengthIn35mmFilm: null,
  pixelXDimension: null,
  pixelYDimension: null,
};

const TAG_EXIF_IFD_POINTER = 0x8769;
const TAG_FOCAL_LENGTH = 0x920a;
const TAG_FOCAL_LENGTH_IN_35MM = 0xa405;
const TAG_PIXEL_X_DIMENSION = 0xa002;
const TAG_PIXEL_Y_DIMENSION = 0xa003;

const TYPE_SHORT = 3;
const TYPE_LONG = 4;
const TYPE_RATIONAL = 5;

const MAX_IFD_ENTRIES = 512;

interface Tiff {
  readonly view: DataView;
  readonly base: number;
  readonly little: boolean;
}

interface Entry {
  readonly tag: number;
  readonly type: number;
  readonly count: number;
  /** Absolute offset of the entry's 4-byte value/offset field. */
  readonly field: number;
}

/** Offset of the TIFF header inside the first APP1 "Exif" segment, or null. */
function tiffOffsetOf(bytes: Uint8Array): number | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1] ?? 0;
    if (marker === 0xff) {
      offset += 1; // fill byte
      continue;
    }
    // Start of scan or end of image: the Exif block always comes first.
    if (marker === 0xda || marker === 0xd9) return null;
    // Markers with no length field.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      offset += 2;
      continue;
    }
    const length = ((bytes[offset + 2] ?? 0) << 8) | (bytes[offset + 3] ?? 0);
    if (length < 2) return null;
    const payload = offset + 4;
    if (
      marker === 0xe1 &&
      bytes[payload] === 0x45 && // E
      bytes[payload + 1] === 0x78 && // x
      bytes[payload + 2] === 0x69 && // i
      bytes[payload + 3] === 0x66 && // f
      bytes[payload + 4] === 0x00 &&
      bytes[payload + 5] === 0x00
    ) {
      return payload + 6;
    }
    offset = offset + 2 + length;
  }
  return null;
}

function readIfd(tiff: Tiff, ifdOffset: number): Entry[] {
  const { view, base, little } = tiff;
  const at = base + ifdOffset;
  if (at < 0 || at + 2 > view.byteLength) return [];
  const count = Math.min(view.getUint16(at, little), MAX_IFD_ENTRIES);
  const entries: Entry[] = [];
  for (let i = 0; i < count; i++) {
    const entry = at + 2 + i * 12;
    if (entry + 12 > view.byteLength) break;
    entries.push({
      tag: view.getUint16(entry, little),
      type: view.getUint16(entry + 2, little),
      count: view.getUint32(entry + 4, little),
      field: entry + 8,
    });
  }
  return entries;
}

function integerOf(tiff: Tiff, e: Entry | undefined): number | null {
  if (!e || e.count !== 1) return null;
  if (e.type === TYPE_SHORT) return tiff.view.getUint16(e.field, tiff.little);
  if (e.type === TYPE_LONG) return tiff.view.getUint32(e.field, tiff.little);
  return null;
}

function rationalOf(tiff: Tiff, e: Entry | undefined): number | null {
  if (!e || e.count !== 1 || e.type !== TYPE_RATIONAL) return null;
  const at = tiff.base + tiff.view.getUint32(e.field, tiff.little);
  if (at < 0 || at + 8 > tiff.view.byteLength) return null;
  const numerator = tiff.view.getUint32(at, tiff.little);
  const denominator = tiff.view.getUint32(at + 4, tiff.little);
  return denominator === 0 ? null : numerator / denominator;
}

/** A positive, finite number no larger than `max`, else null. */
function within(value: number | null, max: number): number | null {
  return value !== null && Number.isFinite(value) && value > 0 && value <= max
    ? value
    : null;
}

/** Read the four white-listed EXIF values from a JPEG. Never throws. */
export function readExifWhitelist(bytes: Uint8Array): ExifWhitelist {
  try {
    const base = tiffOffsetOf(bytes);
    if (base === null || base + 8 > bytes.length) return NO_EXIF;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const order = view.getUint16(base, false);
    if (order !== 0x4949 && order !== 0x4d4d) return NO_EXIF;
    const little = order === 0x4949;
    if (view.getUint16(base + 2, little) !== 42) return NO_EXIF;
    const tiff: Tiff = { view, base, little };

    const ifd0 = readIfd(tiff, view.getUint32(base + 4, little));
    const pointer = integerOf(
      tiff,
      ifd0.find((e) => e.tag === TAG_EXIF_IFD_POINTER),
    );
    if (pointer === null) return NO_EXIF;
    const exif = readIfd(tiff, pointer);
    const find = (tag: number) => exif.find((e) => e.tag === tag);

    return {
      focalLengthMm: within(rationalOf(tiff, find(TAG_FOCAL_LENGTH)), 2000),
      focalLengthIn35mmFilm: within(
        integerOf(tiff, find(TAG_FOCAL_LENGTH_IN_35MM)),
        2000,
      ),
      pixelXDimension: within(
        integerOf(tiff, find(TAG_PIXEL_X_DIMENSION)),
        100_000,
      ),
      pixelYDimension: within(
        integerOf(tiff, find(TAG_PIXEL_Y_DIMENSION)),
        100_000,
      ),
    };
  } catch {
    return NO_EXIF;
  }
}

/**
 * Copy the white-listed keys out of anything. Whatever else the value holds
 * (a wider object, a parsed manifest, a future field) is dropped, and a value
 * that is not a positive finite number becomes `null`. The report assembler
 * runs every EXIF value through this, so a caller cannot widen the log.
 */
export function pickExifWhitelist(value: unknown): ExifWhitelist {
  const source =
    value !== null && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const pick = (key: keyof ExifWhitelist): number | null => {
    const v = source[key];
    return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
  };
  return {
    focalLengthMm: pick("focalLengthMm"),
    focalLengthIn35mmFilm: pick("focalLengthIn35mmFilm"),
    pixelXDimension: pick("pixelXDimension"),
    pixelYDimension: pick("pixelYDimension"),
  };
}
