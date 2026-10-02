/**
 * Metadata stripping for the filed copies of kit v2 photos.
 *
 * `learn:sort` copies each photo to the output folder before anything is sent
 * to a third-party AI service (the consent says photos may be). A phone's EXIF
 * carries GPS position, the time, the device's serial number and more, so the
 * filed copy is stripped. The original in the input folder is never touched:
 * this module only turns bytes into bytes.
 *
 * What a filed copy keeps and drops, segment by segment:
 *
 *  - APP1 (Exif, XMP, anything else), APP13 (Photoshop/IPTC), and every
 *    comment (COM): dropped.
 *  - Three application segments may stay, each by its CONTENT and not its
 *    name, byte for byte: APP0 only as a plain 18-byte JFIF header with no
 *    thumbnail (a JFXX extension, or any JFIF that embeds a thumbnail, is
 *    dropped); APP2 only when it begins `ICC_PROFILE\0`; APP14 only as the
 *    12-byte Adobe colour-transform header. Every other APPn (maker notes, the
 *    multi-picture index, ...) is dropped, and so is every JPGn extension
 *    marker (0xF0 to 0xFD) and any reserved marker: nothing but these three is
 *    needed to decode the picture, so private-by-default is the safer rule.
 *  - Everything that makes the picture (quantisation and Huffman tables, the
 *    frame header, every scan) is copied byte for byte.
 *  - Anything after the end-of-image marker is dropped. Phones append whole
 *    other files there (a gain map, a motion-photo video) that carry their own
 *    metadata.
 *
 * ORIENTATION. A phone often stores a portrait photo sideways with an
 * Orientation tag that turns it upright. The checker decodes it upright, and
 * every pixel coordinate in the run log is in the upright frame, so a filed
 * copy must decode upright too or it would not match its own record. This
 * module therefore REBUILDS a minimal EXIF holding only the Orientation tag
 * (36 bytes: no GPS, no time, no device, nothing else) at the place the
 * original Exif was. That is the mode `learn:sort` reports,
 * `EXIF_STRIP_MODE`. The alternative (drop it and record the orientation in the
 * run log) would leave the copy sideways for every other tool.
 *
 * The EXIF white-list (focal length, pixel dimensions) is read from the
 * ORIGINAL before stripping (`prepareFiledCopy`): after stripping it is gone.
 *
 * Pure and dependency-free. Refuses what is not a complete JPEG.
 */
import { readExifWhitelist, type ExifWhitelist } from "./exif";

/** The strip mode `learn:sort` prints and records: only Orientation survives, in a rebuilt minimal EXIF. */
export const EXIF_STRIP_MODE = "orientation-only" as const;

export type StripRefusal = "not-a-jpeg" | "malformed";

const SOI = 0xd8;
const EOI = 0xd9;
const SOS = 0xda;
const APP0 = 0xe0;
const APP1 = 0xe1;
const APP2 = 0xe2;
const APP13 = 0xed;
const APP14 = 0xee;
const COM = 0xfe;

const EXIF_ID = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"
const ICC_ID = [
  0x49, 0x43, 0x43, 0x5f, 0x50, 0x52, 0x4f, 0x46, 0x49, 0x4c, 0x45, 0x00,
]; // "ICC_PROFILE\0"

const TAG_ORIENTATION = 0x0112;
const TYPE_SHORT = 3;

/** One segment of a JPEG: its marker byte and the byte range it occupies (marker and length included). */
interface Segment {
  readonly marker: number;
  readonly start: number;
  readonly end: number;
}

interface Walk {
  /** Header segments and in-scan segments, in file order. The SOI and the EOI are not listed. */
  readonly segments: readonly Segment[];
  /** Offset just past the EOI marker. */
  readonly eoiEnd: number;
}

class JpegFormatError extends Error {
  constructor(readonly reason: StripRefusal) {
    super(reason);
  }
}

function startsWith(
  bytes: Uint8Array,
  at: number,
  id: readonly number[],
): boolean {
  if (at + id.length > bytes.length) return false;
  return id.every((b, i) => bytes[at + i] === b);
}

/**
 * Split a JPEG into its segments, entropy-coded scan data and EOI. Throws
 * `JpegFormatError` for anything that is not one complete JPEG.
 */
function walk(bytes: Uint8Array): Walk {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== SOI) {
    throw new JpegFormatError("not-a-jpeg");
  }
  const segments: Segment[] = [];
  let i = 2;
  let inScan = false;

  for (;;) {
    // Find the next marker. Inside a scan, the bytes up to it are entropy data
    // (FF 00 is a stuffed FF, FF D0..D7 a restart, extra FFs are fill).
    let p = i;
    if (inScan) {
      for (;;) {
        if (p + 1 >= bytes.length) throw new JpegFormatError("malformed");
        if (bytes[p] !== 0xff) {
          p++;
          continue;
        }
        const next = bytes[p + 1]!;
        if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
          p += 2;
          continue;
        }
        if (next === 0xff) {
          p++;
          continue;
        }
        break;
      }
    } else {
      while (bytes[p] === 0xff && bytes[p + 1] === 0xff) p++; // fill bytes
      if (p + 1 >= bytes.length || bytes[p] !== 0xff) {
        throw new JpegFormatError("malformed");
      }
    }
    const marker = bytes[p + 1]!;

    if (marker === EOI) return { segments, eoiEnd: p + 2 };
    // Markers with no length: TEM and the restart markers.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i = p + 2;
      continue;
    }
    if (marker === SOI || marker === 0x00)
      throw new JpegFormatError("malformed");

    if (p + 4 > bytes.length) throw new JpegFormatError("malformed");
    const length = (bytes[p + 2]! << 8) | bytes[p + 3]!;
    const end = p + 2 + length;
    if (length < 2 || end > bytes.length)
      throw new JpegFormatError("malformed");
    segments.push({ marker, start: p, end });
    if (marker === SOS) inScan = true;
    i = end;
  }
}

const JFIF_ID = [0x4a, 0x46, 0x49, 0x46, 0x00]; // "JFIF\0"
const ADOBE_ID = [0x41, 0x64, 0x6f, 0x62, 0x65]; // "Adobe"
/** A plain JFIF header is marker (2) + length (2) + 14 payload bytes. */
const JFIF_SEGMENT_BYTES = 18;
/** The Adobe colour-transform header is marker (2) + length (2) + 12 payload bytes. */
const ADOBE_SEGMENT_BYTES = 16;

/** APP0 as a plain JFIF header: the right size, and a 0 x 0 thumbnail (so no embedded picture). */
function isPlainJfif(bytes: Uint8Array, s: Segment): boolean {
  if (s.end - s.start !== JFIF_SEGMENT_BYTES) return false;
  const payload = s.start + 4;
  // After "JFIF\0": version (2), units (1), X and Y density (4), X and Y thumbnail size (2).
  return (
    startsWith(bytes, payload, JFIF_ID) &&
    bytes[payload + 12] === 0 &&
    bytes[payload + 13] === 0
  );
}

function isAdobe(bytes: Uint8Array, s: Segment): boolean {
  return (
    s.end - s.start === ADOBE_SEGMENT_BYTES &&
    startsWith(bytes, s.start + 4, ADOBE_ID)
  );
}

/** Markers that make up the picture itself: tables, frame headers, scan headers, restart interval. */
function isImageMarker(marker: number): boolean {
  return (
    marker === 0xdb || // DQT
    marker === 0xc4 || // DHT
    marker === 0xcc || // DAC
    marker === SOS ||
    marker === 0xdd || // DRI
    marker === 0xdc || // DNL
    marker === 0xdf || // EXP
    (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc8) // SOFn
  );
}

/** What a segment is, for the keep-or-drop rule. Decided by content, not only by marker. */
function classify(bytes: Uint8Array, s: Segment): "exif" | "keep" | "drop" {
  const payload = s.start + 4;
  switch (s.marker) {
    case APP1:
      return startsWith(bytes, payload, EXIF_ID) ? "exif" : "drop";
    case APP0:
      return isPlainJfif(bytes, s) ? "keep" : "drop";
    case APP14:
      return isAdobe(bytes, s) ? "keep" : "drop";
    case APP2:
      return startsWith(bytes, payload, ICC_ID) ? "keep" : "drop";
    default:
      // The picture's own segments stay. Anything else is dropped: the other
      // APPn, COM, the JPGn extensions (0xF0 to 0xFD) and reserved markers.
      return isImageMarker(s.marker) ? "keep" : "drop";
  }
}

/** The Orientation tag (1 to 8) of an Exif APP1 segment, or `null`. Reads that one tag and nothing else. */
function orientationOf(bytes: Uint8Array, s: Segment): number | null {
  try {
    const base = s.start + 4 + EXIF_ID.length; // the TIFF header
    if (base + 8 > s.end) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const order = view.getUint16(base, false);
    if (order !== 0x4949 && order !== 0x4d4d) return null;
    const little = order === 0x4949;
    if (view.getUint16(base + 2, little) !== 42) return null;
    const ifd = base + view.getUint32(base + 4, little);
    if (ifd < base || ifd + 2 > s.end) return null;
    const count = view.getUint16(ifd, little);
    // A well-formed IFD0 lies inside the segment: its entries and the offset of
    // the next IFD. A count that claims more is damage, not an Exif to trust.
    if (ifd + 2 + count * 12 + 4 > s.end) return null;
    for (let k = 0; k < count; k++) {
      const entry = ifd + 2 + k * 12;
      if (entry + 12 > s.end) return null;
      if (view.getUint16(entry, little) !== TAG_ORIENTATION) continue;
      if (
        view.getUint16(entry + 2, little) !== TYPE_SHORT ||
        view.getUint32(entry + 4, little) !== 1
      ) {
        return null;
      }
      const value = view.getUint16(entry + 8, little);
      return value >= 1 && value <= 8 ? value : null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * The 36-byte APP1 segment that holds only the Orientation tag: marker,
 * length, "Exif\0\0", a big-endian TIFF header, an IFD0 with one entry, and no
 * next IFD.
 */
export function orientationOnlyExifSegment(orientation: number): Uint8Array {
  if (!Number.isInteger(orientation) || orientation < 1 || orientation > 8) {
    throw new RangeError(`Orientation must be 1 to 8, got ${orientation}.`);
  }
  const out = new Uint8Array(36);
  const view = new DataView(out.buffer);
  out[0] = 0xff;
  out[1] = APP1;
  view.setUint16(2, 34, false); // length: itself (2) + "Exif\0\0" (6) + TIFF (26)
  out.set(EXIF_ID, 4);
  const tiff = 10;
  out[tiff] = out[tiff + 1] = 0x4d; // "MM": big-endian
  view.setUint16(tiff + 2, 42, false);
  view.setUint32(tiff + 4, 8, false); // IFD0 follows the header
  view.setUint16(tiff + 8, 1, false); // one entry
  view.setUint16(tiff + 10, TAG_ORIENTATION, false);
  view.setUint16(tiff + 12, TYPE_SHORT, false);
  view.setUint32(tiff + 14, 1, false);
  view.setUint16(tiff + 18, orientation, false); // a SHORT sits at the start of the value field
  view.setUint32(tiff + 22, 0, false); // no next IFD
  return out;
}

export interface StripSummary {
  readonly exifSegments: number;
  readonly otherApp1Segments: number;
  readonly app13Segments: number;
  readonly commentSegments: number;
  readonly otherAppSegments: number;
  /** Bytes after the end-of-image marker that were dropped. */
  readonly trailerBytes: number;
}

export type StripResult =
  | {
      readonly ok: true;
      readonly bytes: Uint8Array;
      /** The orientation the original carried (1 to 8) and the copy keeps, or `null` if it had none. */
      readonly orientation: number | null;
      readonly summary: StripSummary;
    }
  | { readonly ok: false; readonly reason: StripRefusal };

/**
 * A copy of the JPEG without its metadata (see the file header), keeping
 * Orientation in a rebuilt minimal EXIF. Refuses a file that is not a complete
 * JPEG: a PNG, a HEIC, a truncated or damaged file.
 */
export function stripJpegMetadata(input: Uint8Array): StripResult {
  let w: Walk;
  try {
    w = walk(input);
  } catch (err) {
    if (err instanceof JpegFormatError)
      return { ok: false, reason: err.reason };
    throw err;
  }

  const chunks: Uint8Array[] = [input.subarray(0, 2)];
  const summary = {
    exifSegments: 0,
    otherApp1Segments: 0,
    app13Segments: 0,
    commentSegments: 0,
    otherAppSegments: 0,
    trailerBytes: input.length - w.eoiEnd,
  };
  let orientation: number | null = null;
  let orientationWritten = false;
  let inScan = false;
  let cursor = 2; // end of what has been copied or dropped, in the input

  // Copy `input[from, to)` (a kept stretch) as one chunk.
  const copy = (from: number, to: number) => {
    if (to > from) chunks.push(input.subarray(from, to));
  };

  for (const s of w.segments) {
    // The bytes between the last segment and this one are scan data or fill:
    // image data, kept.
    copy(cursor, s.start);
    cursor = s.start;
    const kind = classify(input, s);
    if (s.marker === SOS) inScan = true;
    if (kind === "keep") {
      copy(s.start, s.end);
    } else if (kind === "exif") {
      summary.exifSegments++;
      // Only the first Exif block before the first scan can name the orientation.
      if (!inScan && !orientationWritten) {
        orientation = orientationOf(input, s);
        if (orientation !== null) {
          chunks.push(orientationOnlyExifSegment(orientation));
          orientationWritten = true;
        }
      }
    } else if (s.marker === APP1) {
      summary.otherApp1Segments++;
    } else if (s.marker === APP13) {
      summary.app13Segments++;
    } else if (s.marker === COM) {
      summary.commentSegments++;
    } else {
      summary.otherAppSegments++;
    }
    cursor = s.end;
  }
  // The rest, up to and including the EOI marker, is scan data: kept. What
  // follows the EOI is dropped.
  copy(cursor, w.eoiEnd);

  return { ok: true, bytes: concat(chunks), orientation, summary };
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** What is left in a JPEG's metadata, for the post-condition check and for tests. */
export interface MetadataInventory {
  /** Marker names of every APPn and COM segment present, in order, e.g. "APP0", "APP1:exif", "APP2:icc", "COM". */
  readonly segments: readonly string[];
  /** The Exif segment's bytes, if there is one. */
  readonly exif: Uint8Array | null;
  /** Bytes after the end-of-image marker. */
  readonly trailerBytes: number;
}

function nameOf(bytes: Uint8Array, s: Segment): string | null {
  if (s.marker === COM) return "COM";
  if (s.marker >= 0xf0 && s.marker <= 0xfd) return `JPG${s.marker - 0xf0}`;
  if (s.marker < 0xe0 || s.marker > 0xef) {
    return isImageMarker(s.marker) ? null : `marker 0x${s.marker.toString(16)}`;
  }
  const base = `APP${s.marker - 0xe0}`;
  if (s.marker === APP0) return isPlainJfif(bytes, s) ? base : `${base}:other`;
  if (s.marker === APP14) return isAdobe(bytes, s) ? base : `${base}:other`;
  if (s.marker === APP1) {
    return startsWith(bytes, s.start + 4, EXIF_ID) ? `${base}:exif` : base;
  }
  if (s.marker === APP2) {
    return startsWith(bytes, s.start + 4, ICC_ID) ? `${base}:icc` : base;
  }
  return base;
}

/** Inventory of a JPEG's application and comment segments. Throws `RangeError` if it is not a complete JPEG. */
export function inventoryJpegMetadata(bytes: Uint8Array): MetadataInventory {
  let w: Walk;
  try {
    w = walk(bytes);
  } catch (err) {
    if (err instanceof JpegFormatError) {
      throw new RangeError(`Not a complete JPEG (${err.reason}).`);
    }
    throw err;
  }
  const segments: string[] = [];
  let exif: Uint8Array | null = null;
  for (const s of w.segments) {
    const name = nameOf(bytes, s);
    if (name === null) continue;
    segments.push(name);
    if (name === "APP1:exif" && exif === null) {
      exif = bytes.subarray(s.start, s.end);
    }
  }
  return { segments, exif, trailerBytes: bytes.length - w.eoiEnd };
}

/**
 * Is this a clean filed copy? Every segment is checked by its CONTENT: the
 * header segments that may stay must be exactly a plain JFIF header, an ICC
 * profile or an Adobe header; any other application, comment, extension or
 * reserved segment is a problem; an Exif block must be byte for byte one of
 * the eight minimal Orientation-only ones (so an IFD that claims more entries
 * fails); and nothing may follow the end-of-image marker. Returns the
 * reasons it is not clean, empty when it is.
 */
export function problemsInFiledCopy(bytes: Uint8Array): string[] {
  let w: Walk;
  try {
    w = walk(bytes);
  } catch {
    return ["not a complete JPEG"];
  }
  const problems: string[] = [];
  let exifCount = 0;
  for (const s of w.segments) {
    const kind = classify(bytes, s);
    if (kind === "drop") {
      problems.push(`${nameOf(bytes, s) ?? "unknown"} segment present`);
    } else if (kind === "exif") {
      exifCount++;
      const exif = bytes.subarray(s.start, s.end);
      const minimal = [1, 2, 3, 4, 5, 6, 7, 8].some((o) => {
        const expected = orientationOnlyExifSegment(o);
        return (
          expected.length === exif.length &&
          expected.every((b, i) => b === exif[i])
        );
      });
      if (!minimal) problems.push("Exif holds more than the Orientation tag");
    }
  }
  if (exifCount > 1) problems.push("more than one Exif segment");
  if (bytes.length > w.eoiEnd) problems.push("bytes after the end of image");
  return problems;
}

export type FiledCopy =
  | {
      readonly ok: true;
      readonly bytes: Uint8Array;
      /** The EXIF white-list of the ORIGINAL, read before stripping (the copy has none). */
      readonly whitelist: ExifWhitelist;
      readonly orientation: number | null;
      readonly summary: StripSummary;
    }
  | {
      readonly ok: false;
      readonly reason: StripRefusal | "verification-failed";
    };

/**
 * The bytes to write as a filed copy. Reads the EXIF white-list from the
 * original first, strips, then checks the result (`problemsInFiledCopy`): a
 * copy that is not clean is refused, never written.
 */
export function prepareFiledCopy(original: Uint8Array): FiledCopy {
  // Before stripping: the white-list needs the very tags stripping removes.
  const whitelist = readExifWhitelist(original);
  const stripped = stripJpegMetadata(original);
  if (!stripped.ok) return stripped;
  if (problemsInFiledCopy(stripped.bytes).length > 0) {
    return { ok: false, reason: "verification-failed" };
  }
  return {
    ok: true,
    bytes: stripped.bytes,
    whitelist,
    orientation: stripped.orientation,
    summary: stripped.summary,
  };
}
