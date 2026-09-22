/**
 * Minimal, pure, dependency-free JPEG EXIF focal-length reader.
 *
 * Reads exactly what parallax correction needs (issue #16):
 *  - Primary: `FocalLengthIn35mmFilm` (Exif tag 0xA405) — the camera/phone
 *    has already normalised this for its own sensor size, so converting it
 *    to pixels only needs the DECODED, ORIENTED, DOWNSCALED bitmap's own
 *    diagonal (the bitmap MediaPipe actually runs on, which is very rarely
 *    the camera's native resolution):
 *      fPx = f35mm / 43.27 × diagonalPx(decodedBitmap)
 *    (43.27 mm is the diagonal of 35 mm film / a full-frame sensor.)
 *  - Fallback, when that tag is absent: `FocalLength` (tag 0x920A, mm)
 *    combined with the focal-plane resolution tags (0xA20E/0xA20F/0xA210)
 *    and EXIF's OWN pixel dimensions (0xA002/0xA003, the resolution those
 *    focal-plane values were defined against — NOT necessarily the decoded
 *    bitmap's dimensions). Together those give the physical sensor
 *    diagonal, from which an equivalent 35 mm focal length is derived and
 *    then run through the exact same formula above. All four fallback tags
 *    must be present, or this returns null rather than guessing.
 *
 * Handles both TIFF byte orders (Intel "II" / Motorola "MM"). No image
 * decoding — walks the JPEG segment structure just far enough to find the
 * APP1 Exif block and its TIFF IFDs.
 */

const APP1_MARKER = 0xffe1;
const EXIF_SIGNATURE = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"

// 35 mm film / full-frame sensor diagonal, mm — the basis of the
// "35mm-equivalent focal length" EXIF tag.
const FULL_FRAME_DIAGONAL_MM = 43.27;

const TAG_EXIF_IFD_POINTER = 0x8769;
const TAG_FOCAL_LENGTH_IN_35MM_FILM = 0xa405;
const TAG_FOCAL_LENGTH_MM = 0x920a;
const TAG_FOCAL_PLANE_X_RESOLUTION = 0xa20e;
const TAG_FOCAL_PLANE_Y_RESOLUTION = 0xa20f;
const TAG_FOCAL_PLANE_RESOLUTION_UNIT = 0xa210;
const TAG_PIXEL_X_DIMENSION = 0xa002;
const TAG_PIXEL_Y_DIMENSION = 0xa003;

const TYPE_SHORT = 3;
const TYPE_LONG = 4;
const TYPE_RATIONAL = 5;

/** FocalPlaneResolutionUnit values, in mm per unit. 2 = inches (the EXIF default), 3 = centimetres. */
const RESOLUTION_UNIT_TO_MM: Record<number, number> = { 2: 25.4, 3: 10 };

export interface DecodedBitmapSize {
  readonly widthPx: number;
  readonly heightPx: number;
}

export type ExifFocalSource = "exif-35mm" | "exif-focal-plane";

export interface ExifFocalResult {
  readonly fPx: number;
  readonly source: ExifFocalSource;
}

function diagonalPx(size: DecodedBitmapSize): number {
  return Math.hypot(size.widthPx, size.heightPx);
}

interface Rational {
  readonly numerator: number;
  readonly denominator: number;
}

function rationalToNumber(r: Rational): number {
  return r.denominator === 0 ? NaN : r.numerator / r.denominator;
}

interface IfdEntry {
  readonly tag: number;
  readonly type: number;
  readonly count: number;
  /** Raw 4-byte value/offset field, not yet resolved to its final type. */
  readonly valueOffsetBytes: number;
}

/**
 * Find the APP1 "Exif\0\0" segment's payload (everything after the 6-byte
 * signature, i.e. starting at the TIFF header) within raw JPEG bytes. Walks
 * JFIF/JPEG markers from the SOI; returns null if there's no JPEG SOI, no
 * APP1 Exif segment, or the file ends before a segment's declared length.
 */
function findTiffHeaderOffset(bytes: Uint8Array): number | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null; // not a JPEG (no SOI marker)
  }
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      return null; // not a valid marker — malformed/truncated segment stream
    }
    const marker = (bytes[offset] << 8) | bytes[offset + 1];
    // SOS (start of scan) and below have no length-prefixed payload in the
    // same way; the Exif APP1 segment always comes before it, so stop.
    if (marker === 0xffda || marker === 0xffd9) {
      return null;
    }
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    const payloadStart = offset + 4;
    if (marker === APP1_MARKER) {
      const sigEnd = payloadStart + EXIF_SIGNATURE.length;
      if (
        sigEnd <= bytes.length &&
        EXIF_SIGNATURE.every((b, i) => bytes[payloadStart + i] === b)
      ) {
        return sigEnd;
      }
    }
    offset = payloadStart + length - 2;
  }
  return null;
}

interface TiffContext {
  readonly view: DataView;
  readonly base: number; // byte offset of the TIFF header (bytes[base] is 'I'/'I' or 'M'/'M')
  readonly littleEndian: boolean;
}

function readIfd(ctx: TiffContext, ifdOffset: number): IfdEntry[] {
  const { view, base, littleEndian } = ctx;
  const absolute = base + ifdOffset;
  if (absolute + 2 > view.byteLength) return [];
  const count = view.getUint16(absolute, littleEndian);
  const entries: IfdEntry[] = [];
  for (let i = 0; i < count; i++) {
    const entryOffset = absolute + 2 + i * 12;
    if (entryOffset + 12 > view.byteLength) break;
    entries.push({
      tag: view.getUint16(entryOffset, littleEndian),
      type: view.getUint16(entryOffset + 2, littleEndian),
      count: view.getUint32(entryOffset + 4, littleEndian),
      valueOffsetBytes: entryOffset + 8,
    });
  }
  return entries;
}

function readShort(ctx: TiffContext, entry: IfdEntry): number | null {
  if (entry.type !== TYPE_SHORT) return null;
  // A SHORT with count 1 is stored inline at the start of the 4-byte field.
  // Big-endian ("MM") files place the 2-byte value at the START of the
  // 4-byte field, same as little-endian — only the multi-byte value's own
  // byte order differs, not its position. getUint16 with the right
  // littleEndian flag handles both correctly.
  return ctx.view.getUint16(entry.valueOffsetBytes, ctx.littleEndian);
}

function readLongInline(ctx: TiffContext, entry: IfdEntry): number | null {
  if (entry.type !== TYPE_LONG) return null;
  return ctx.view.getUint32(entry.valueOffsetBytes, ctx.littleEndian);
}

/**
 * Read a SHORT- or LONG-typed integer entry, dispatching on `entry.type` so
 * a LONG-typed tag (4 bytes) is never mistakenly read as if it were a
 * 2-byte SHORT. For a big-endian ("MM") LONG whose value fits in 16 bits,
 * the low-order bytes come LAST in the 4-byte field, so reading only the
 * first 2 bytes (as a naive SHORT read would) yields 0 instead of the
 * actual value. Returns null for any other type.
 */
function readShortOrLong(ctx: TiffContext, entry: IfdEntry): number | null {
  if (entry.type === TYPE_SHORT) return readShort(ctx, entry);
  if (entry.type === TYPE_LONG) return readLongInline(ctx, entry);
  return null;
}

function readRational(ctx: TiffContext, entry: IfdEntry): Rational | null {
  if (entry.type !== TYPE_RATIONAL) return null;
  // RATIONAL never fits inline (8 bytes): valueOffsetBytes holds an offset
  // (relative to the TIFF header) to the two LONGs.
  const pointer = ctx.view.getUint32(entry.valueOffsetBytes, ctx.littleEndian);
  const absolute = ctx.base + pointer;
  if (absolute + 8 > ctx.view.byteLength) return null;
  return {
    numerator: ctx.view.getUint32(absolute, ctx.littleEndian),
    denominator: ctx.view.getUint32(absolute + 4, ctx.littleEndian),
  };
}

function findEntry(
  entries: readonly IfdEntry[],
  tag: number,
): IfdEntry | undefined {
  return entries.find((e) => e.tag === tag);
}

/**
 * Read a JPEG's EXIF focal length and convert it to pixels for the given
 * DECODED bitmap (post-decode, post-orientation, post any downscaling —
 * whatever MediaPipe actually runs on). Returns null if the JPEG has no
 * EXIF, no TIFF/Exif IFD, or neither the primary nor fallback tag set.
 */
export function estimateFocalFromExif(
  jpegBytes: Uint8Array,
  decodedBitmap: DecodedBitmapSize,
): ExifFocalResult | null {
  const tiffOffset = findTiffHeaderOffset(jpegBytes);
  if (tiffOffset === null || tiffOffset + 8 > jpegBytes.length) return null;

  const view = new DataView(
    jpegBytes.buffer,
    jpegBytes.byteOffset,
    jpegBytes.byteLength,
  );
  const b0 = view.getUint8(tiffOffset);
  const b1 = view.getUint8(tiffOffset + 1);
  let littleEndian: boolean;
  if (b0 === 0x49 && b1 === 0x49) {
    littleEndian = true; // "II"
  } else if (b0 === 0x4d && b1 === 0x4d) {
    littleEndian = false; // "MM"
  } else {
    return null; // not a valid TIFF header
  }
  const magic = view.getUint16(tiffOffset + 2, littleEndian);
  if (magic !== 42) return null;

  const ctx: TiffContext = { view, base: tiffOffset, littleEndian };
  const ifd0Offset = view.getUint32(tiffOffset + 4, littleEndian);
  const ifd0 = readIfd(ctx, ifd0Offset);

  const exifPointerEntry = findEntry(ifd0, TAG_EXIF_IFD_POINTER);
  if (!exifPointerEntry) return null;
  const exifIfdOffset = readLongInline(ctx, exifPointerEntry);
  if (exifIfdOffset === null) return null;
  const exifIfd = readIfd(ctx, exifIfdOffset);

  const diagPx = diagonalPx(decodedBitmap);

  // Primary path.
  const f35Entry = findEntry(exifIfd, TAG_FOCAL_LENGTH_IN_35MM_FILM);
  if (f35Entry) {
    const f35 = readShort(ctx, f35Entry);
    if (f35 !== null && f35 > 0) {
      return {
        fPx: (f35 / FULL_FRAME_DIAGONAL_MM) * diagPx,
        source: "exif-35mm",
      };
    }
  }

  // Fallback path: FocalLength + focal-plane resolution + EXIF's own pixel
  // dimensions, all required.
  const focalLengthEntry = findEntry(exifIfd, TAG_FOCAL_LENGTH_MM);
  const fpXResEntry = findEntry(exifIfd, TAG_FOCAL_PLANE_X_RESOLUTION);
  const fpYResEntry = findEntry(exifIfd, TAG_FOCAL_PLANE_Y_RESOLUTION);
  const unitEntry = findEntry(exifIfd, TAG_FOCAL_PLANE_RESOLUTION_UNIT);
  const pxXEntry = findEntry(exifIfd, TAG_PIXEL_X_DIMENSION);
  const pxYEntry = findEntry(exifIfd, TAG_PIXEL_Y_DIMENSION);
  if (
    !focalLengthEntry ||
    !fpXResEntry ||
    !fpYResEntry ||
    !unitEntry ||
    !pxXEntry ||
    !pxYEntry
  ) {
    return null;
  }

  const focalLengthMm = rationalToNumber(
    readRational(ctx, focalLengthEntry) ?? { numerator: 0, denominator: 0 },
  );
  const fpXRes = rationalToNumber(
    readRational(ctx, fpXResEntry) ?? { numerator: 0, denominator: 0 },
  );
  const fpYRes = rationalToNumber(
    readRational(ctx, fpYResEntry) ?? { numerator: 0, denominator: 0 },
  );
  const unit = readShort(ctx, unitEntry);
  const pixelXDim = readShortOrLong(ctx, pxXEntry);
  const pixelYDim = readShortOrLong(ctx, pxYEntry);

  if (
    unit === null ||
    !(unit in RESOLUTION_UNIT_TO_MM) ||
    pixelXDim === null ||
    pixelYDim === null ||
    !(focalLengthMm > 0) ||
    !(fpXRes > 0) ||
    !(fpYRes > 0)
  ) {
    return null;
  }
  const mmPerUnit = RESOLUTION_UNIT_TO_MM[unit];
  const sensorWidthMm = (pixelXDim / fpXRes) * mmPerUnit;
  const sensorHeightMm = (pixelYDim / fpYRes) * mmPerUnit;
  const nativeDiagonalMm = Math.hypot(sensorWidthMm, sensorHeightMm);
  if (!(nativeDiagonalMm > 0)) return null;

  const f35Equivalent =
    (focalLengthMm * FULL_FRAME_DIAGONAL_MM) / nativeDiagonalMm;
  return {
    fPx: (f35Equivalent / FULL_FRAME_DIAGONAL_MM) * diagPx,
    source: "exif-focal-plane",
  };
}
