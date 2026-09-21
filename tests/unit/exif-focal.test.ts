import { describe, expect, it } from "vitest";
import { estimateFocalFromExif } from "../../src/client/geometry/exif-focal";

// ── Hand-built minimal JPEG/EXIF byte arrays ────────────────────────────
//
// Real JPEG decoders don't care about anything beyond SOI + one APP1 +
// EOI for this purpose, so these are the smallest valid inputs that
// exercise estimateFocalFromExif's actual parsing: JPEG segment walking,
// the "Exif\0\0" signature, a TIFF header (both byte orders), IFD0's
// ExifIFD pointer, and the Exif sub-IFD's tags (SHORT/LONG inline,
// RATIONAL via an offset into a trailing data area).

const TYPE_SHORT = 3;
const TYPE_LONG = 4;
const TYPE_RATIONAL = 5;

type EntrySpec =
  | { tag: number; type: typeof TYPE_SHORT; value: number }
  | { tag: number; type: typeof TYPE_LONG; value: number }
  | {
      tag: number;
      type: typeof TYPE_RATIONAL;
      numerator: number;
      denominator: number;
    };

const TAG_EXIF_IFD_POINTER = 0x8769;

/** Build a minimal TIFF blob: header, IFD0 (just the ExifIFD pointer), and an Exif sub-IFD with the given entries. */
function buildTiff(
  littleEndian: boolean,
  exifEntries: EntrySpec[],
): Uint8Array {
  const ifd0Offset = 8;
  const ifd0EntryCount = 1;
  const ifd0Size = 2 + ifd0EntryCount * 12 + 4;
  const exifIfdOffset = ifd0Offset + ifd0Size;
  const exifEntryCount = exifEntries.length;
  const exifIfdSize = 2 + exifEntryCount * 12 + 4;
  const extraStart = exifIfdOffset + exifIfdSize;

  const extraOffsets: number[] = [];
  let cursor = extraStart;
  for (const e of exifEntries) {
    if (e.type === TYPE_RATIONAL) {
      extraOffsets.push(cursor);
      cursor += 8;
    } else {
      extraOffsets.push(-1);
    }
  }
  const totalSize = cursor;

  const buf = new Uint8Array(totalSize);
  const view = new DataView(buf.buffer);

  if (littleEndian) {
    buf[0] = 0x49;
    buf[1] = 0x49;
  } else {
    buf[0] = 0x4d;
    buf[1] = 0x4d;
  }
  view.setUint16(2, 42, littleEndian);
  view.setUint32(4, ifd0Offset, littleEndian);

  view.setUint16(ifd0Offset, ifd0EntryCount, littleEndian);
  const ifd0EntryOffset = ifd0Offset + 2;
  view.setUint16(ifd0EntryOffset, TAG_EXIF_IFD_POINTER, littleEndian);
  view.setUint16(ifd0EntryOffset + 2, TYPE_LONG, littleEndian);
  view.setUint32(ifd0EntryOffset + 4, 1, littleEndian);
  view.setUint32(ifd0EntryOffset + 8, exifIfdOffset, littleEndian);
  view.setUint32(ifd0Offset + 2 + ifd0EntryCount * 12, 0, littleEndian); // next IFD = 0

  view.setUint16(exifIfdOffset, exifEntryCount, littleEndian);
  exifEntries.forEach((e, i) => {
    const entryOffset = exifIfdOffset + 2 + i * 12;
    view.setUint16(entryOffset, e.tag, littleEndian);
    view.setUint16(entryOffset + 2, e.type, littleEndian);
    view.setUint32(entryOffset + 4, 1, littleEndian); // count = 1 for every tag used here
    if (e.type === TYPE_SHORT) {
      view.setUint16(entryOffset + 8, e.value, littleEndian);
    } else if (e.type === TYPE_LONG) {
      view.setUint32(entryOffset + 8, e.value, littleEndian);
    } else {
      const extraOffset = extraOffsets[i];
      view.setUint32(entryOffset + 8, extraOffset, littleEndian);
      view.setUint32(extraOffset, e.numerator, littleEndian);
      view.setUint32(extraOffset + 4, e.denominator, littleEndian);
    }
  });
  view.setUint32(exifIfdOffset + 2 + exifEntryCount * 12, 0, littleEndian); // next IFD = 0

  return buf;
}

function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/** Wrap a TIFF blob in a minimal JPEG: SOI, one APP1 "Exif\0\0" segment, EOI. */
function buildJpegWithExif(tiff: Uint8Array): Uint8Array {
  const signature = new Uint8Array([0x45, 0x78, 0x69, 0x66, 0x00, 0x00]); // "Exif\0\0"
  const app1Payload = concatBytes([signature, tiff]);
  const app1LengthField = app1Payload.length + 2; // length includes itself, excludes the marker
  const app1Header = new Uint8Array([
    0xff,
    0xe1,
    (app1LengthField >> 8) & 0xff,
    app1LengthField & 0xff,
  ]);
  const soi = new Uint8Array([0xff, 0xd8]);
  const eoi = new Uint8Array([0xff, 0xd9]);
  return concatBytes([soi, app1Header, app1Payload, eoi]);
}

/** A JPEG with no APP1/Exif segment at all — just SOI then EOI. */
function buildJpegWithoutExif(): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
}

const DECODED_BITMAP = { widthPx: 3024, heightPx: 4032 }; // diagonal = 5040 exactly (3-4-5 triangle x1008)

describe("estimateFocalFromExif", () => {
  it.each([
    ["little-endian (II)", true],
    ["big-endian (MM)", false],
  ] as const)(
    "reads FocalLengthIn35mmFilm and converts to fPx — %s",
    (_label, littleEndian) => {
      const tiff = buildTiff(littleEndian, [
        { tag: 0xa405, type: TYPE_SHORT, value: 26 }, // FocalLengthIn35mmFilm = 26mm
      ]);
      const jpeg = buildJpegWithExif(tiff);
      const result = estimateFocalFromExif(jpeg, DECODED_BITMAP);

      expect(result).not.toBeNull();
      expect(result?.source).toBe("exif-35mm");
      expect(result?.fPx).toBeCloseTo((26 / 43.27) * 5040, 6);
    },
  );

  it("falls back to FocalLength + focal-plane resolution + pixel dimensions when the 35mm tag is absent", () => {
    // Native sensor (as EXIF's own PixelXDimension/PixelYDimension +
    // FocalPlaneXResolution/FocalPlaneYResolution describe it):
    // 4032x3024 px at 18288 px/inch (unit=2) => a 5.6mm x 4.2mm sensor,
    // diagonal 7.0mm exactly. FocalLength = 4.25mm.
    const tiff = buildTiff(true, [
      {
        tag: 0x920a,
        type: TYPE_RATIONAL,
        numerator: 425,
        denominator: 100,
      }, // FocalLength = 4.25mm
      {
        tag: 0xa20e,
        type: TYPE_RATIONAL,
        numerator: 18288,
        denominator: 1,
      }, // FocalPlaneXResolution
      {
        tag: 0xa20f,
        type: TYPE_RATIONAL,
        numerator: 18288,
        denominator: 1,
      }, // FocalPlaneYResolution
      { tag: 0xa210, type: TYPE_SHORT, value: 2 }, // FocalPlaneResolutionUnit = inches
      { tag: 0xa002, type: TYPE_SHORT, value: 4032 }, // PixelXDimension
      { tag: 0xa003, type: TYPE_SHORT, value: 3024 }, // PixelYDimension
    ]);
    const jpeg = buildJpegWithExif(tiff);

    // Decoded bitmap is a downscaled, reoriented half-resolution portrait
    // crop of that native 4032x3024 sensor image — diagonal 2520, half of
    // the native 5040 — proving the result actually rescales rather than
    // just reusing the native pixel count.
    const result = estimateFocalFromExif(jpeg, {
      widthPx: 1512,
      heightPx: 2016,
    });

    expect(result).not.toBeNull();
    expect(result?.source).toBe("exif-focal-plane");
    // fPx = focalLengthMm / nativeDiagonalMm * diagonalPx(decoded) = 4.25/7 * 2520 = 1530.
    expect(result?.fPx).toBeCloseTo(1530, 3);
  });

  it("returns null when neither the 35mm tag nor a complete fallback tag set is present", () => {
    const tiff = buildTiff(true, [
      // Only FocalLength present — fallback needs the focal-plane tags too.
      { tag: 0x920a, type: TYPE_RATIONAL, numerator: 425, denominator: 100 },
    ]);
    const jpeg = buildJpegWithExif(tiff);
    expect(estimateFocalFromExif(jpeg, DECODED_BITMAP)).toBeNull();
  });

  it("returns null for a JPEG with no Exif segment at all", () => {
    expect(
      estimateFocalFromExif(buildJpegWithoutExif(), DECODED_BITMAP),
    ).toBeNull();
  });

  it("returns null for bytes that aren't a JPEG", () => {
    const notAJpeg = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(estimateFocalFromExif(notAJpeg, DECODED_BITMAP)).toBeNull();
  });

  it("returns null for an empty Exif IFD (pointer present, no usable tags)", () => {
    const tiff = buildTiff(true, []);
    const jpeg = buildJpegWithExif(tiff);
    expect(estimateFocalFromExif(jpeg, DECODED_BITMAP)).toBeNull();
  });
});
