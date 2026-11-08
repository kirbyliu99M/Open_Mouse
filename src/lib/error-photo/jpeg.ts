/**
 * A JPEG marker walker for the error-photo upload (candidate 未拍板,
 * src/lib/contracts/error-photo.ts). Pure and dependency-free, so the browser
 * (after it encodes the prepared copy) and the server (before it stores it)
 * run the same check on the same bytes.
 *
 * It reads the file's structure only: which segments it has, the frame
 * header's size, and whether anything follows the end-of-image marker. It
 * never decodes a pixel. Every segment is visited, the ones inside the
 * entropy-coded scans too (a metadata segment hidden after the first scan is
 * still found).
 *
 * `checkErrorPhotoJpeg` is the contract's acceptance rule: it starts with SOI,
 * holds exactly one frame, has NO APP1 segment (Exif and XMP both live in
 * APP1), nothing after EOI, and its frame is the size the metadata says and no
 * larger than the limit.
 */

export type JpegRefusal = "not-a-jpeg" | "malformed" | "no-frame";

export interface JpegStructure {
  /** The frame header's size (SOFn), px. */
  readonly width: number;
  readonly height: number;
  /** Every APPn marker byte present (0xE0 to 0xEF), in file order. */
  readonly appMarkers: readonly number[];
  /** How many APP1 segments (Exif, XMP, or anything else in APP1). */
  readonly app1Segments: number;
  /** How many comment (COM) segments. */
  readonly commentSegments: number;
  /** Bytes after the end-of-image marker. */
  readonly trailerBytes: number;
}

export type JpegInspection =
  | ({ readonly ok: true } & JpegStructure)
  | { readonly ok: false; readonly reason: JpegRefusal };

const SOI = 0xd8;
const EOI = 0xd9;
const SOS = 0xda;
const APP1 = 0xe1;
const COM = 0xfe;

/** SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC). */
function isFrameMarker(marker: number): boolean {
  return (
    marker >= 0xc0 &&
    marker <= 0xcf &&
    marker !== 0xc4 &&
    marker !== 0xc8 &&
    marker !== 0xcc
  );
}

/** Reads a JPEG's segment structure. Never throws. */
export function inspectJpeg(bytes: Uint8Array): JpegInspection {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== SOI) {
    return { ok: false, reason: "not-a-jpeg" };
  }
  const appMarkers: number[] = [];
  let app1Segments = 0;
  let commentSegments = 0;
  let width = 0;
  let height = 0;
  let frames = 0;
  let inScan = false;
  let i = 2;

  for (;;) {
    let p = i;
    if (inScan) {
      // Entropy-coded data up to the next real marker: FF 00 is a stuffed
      // byte, FF D0..D7 a restart, FF FF fill.
      for (;;) {
        if (p + 1 >= bytes.length) return { ok: false, reason: "malformed" };
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
      while (p + 1 < bytes.length && bytes[p] === 0xff && bytes[p + 1] === 0xff)
        p++;
      if (p + 1 >= bytes.length || bytes[p] !== 0xff) {
        return { ok: false, reason: "malformed" };
      }
    }
    const marker = bytes[p + 1]!;
    if (marker === EOI) {
      if (frames !== 1) return { ok: false, reason: "no-frame" };
      return {
        ok: true,
        width,
        height,
        appMarkers,
        app1Segments,
        commentSegments,
        trailerBytes: bytes.length - (p + 2),
      };
    }
    // Markers with no length: TEM and the restart markers.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i = p + 2;
      continue;
    }
    if (marker === SOI || marker === 0x00) {
      return { ok: false, reason: "malformed" };
    }
    if (p + 4 > bytes.length) return { ok: false, reason: "malformed" };
    const length = (bytes[p + 2]! << 8) | bytes[p + 3]!;
    const end = p + 2 + length;
    if (length < 2 || end > bytes.length) {
      return { ok: false, reason: "malformed" };
    }
    if (marker >= 0xe0 && marker <= 0xef) appMarkers.push(marker);
    if (marker === APP1) app1Segments++;
    if (marker === COM) commentSegments++;
    if (isFrameMarker(marker)) {
      // Length (2), precision (1), height (2), width (2), components (1+).
      if (length < 8) return { ok: false, reason: "malformed" };
      frames++;
      height = (bytes[p + 5]! << 8) | bytes[p + 6]!;
      width = (bytes[p + 7]! << 8) | bytes[p + 8]!;
    }
    if (marker === SOS) inScan = true;
    i = end;
  }
}

export type ErrorPhotoJpegProblem =
  | JpegRefusal
  | "has-app1"
  | "has-comment"
  | "trailing-data"
  | "size-mismatch"
  | "too-large";

/**
 * The contract's acceptance rule for an error photo. `expected` is the size
 * the upload's metadata states. Returns `null` when the bytes pass.
 */
export function checkErrorPhotoJpeg(
  bytes: Uint8Array,
  expected: { readonly widthPx: number; readonly heightPx: number },
  maxSidePx: number,
): ErrorPhotoJpegProblem | null {
  const found = inspectJpeg(bytes);
  if (!found.ok) return found.reason;
  if (found.app1Segments > 0) return "has-app1";
  if (found.commentSegments > 0) return "has-comment";
  if (found.trailerBytes > 0) return "trailing-data";
  if (found.width > maxSidePx || found.height > maxSidePx) return "too-large";
  if (found.width !== expected.widthPx || found.height !== expected.heightPx)
    return "size-mismatch";
  return null;
}
