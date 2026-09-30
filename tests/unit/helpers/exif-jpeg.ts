/**
 * Builds minimal JPEG files whose EXIF block holds whatever tags a test
 * asks for, in IFD0, the Exif sub-IFD and the GPS IFD, in either byte order.
 * NOT a test file (vitest only collects `*.test.ts`).
 *
 * `tests/unit/exif-focal.test.ts` has its own smaller builder for the
 * product's focal-length reader; this one exists to put the things a run log
 * must never keep (GPS position, time, serial numbers) next to the things it
 * may keep, and check which ones come out.
 */

export type ExifValue =
  | { readonly type: "short"; readonly value: number }
  | { readonly type: "long"; readonly value: number }
  | { readonly type: "ascii"; readonly value: string }
  /** One or more rationals: [numerator, denominator]. */
  | {
      readonly type: "rational";
      readonly values: readonly (readonly [number, number])[];
    };

export interface ExifTag {
  readonly tag: number;
  readonly value: ExifValue;
}

export interface ExifSpec {
  readonly littleEndian?: boolean;
  readonly ifd0?: readonly ExifTag[];
  readonly exif?: readonly ExifTag[];
  readonly gps?: readonly ExifTag[];
}

const TYPE_ASCII = 2;
const TYPE_SHORT = 3;
const TYPE_LONG = 4;
const TYPE_RATIONAL = 5;

export const TAG = {
  make: 0x010f,
  model: 0x0110,
  orientation: 0x0112,
  software: 0x0131,
  dateTime: 0x0132,
  exifIfdPointer: 0x8769,
  gpsIfdPointer: 0x8825,
  exposureTime: 0x829a,
  isoSpeed: 0x8827,
  dateTimeOriginal: 0x9003,
  focalLength: 0x920a,
  pixelXDimension: 0xa002,
  pixelYDimension: 0xa003,
  focalLengthIn35mmFilm: 0xa405,
  bodySerialNumber: 0xa431,
  lensModel: 0xa434,
  imageUniqueId: 0xa420,
  gpsLatitudeRef: 0x0001,
  gpsLatitude: 0x0002,
  gpsLongitudeRef: 0x0003,
  gpsLongitude: 0x0004,
  gpsAltitude: 0x0006,
} as const;

interface Encoded {
  readonly tag: number;
  readonly type: number;
  readonly count: number;
  /** The value's bytes, big-endian-agnostic: built by `encode` for the chosen order. */
  readonly bytes: Uint8Array;
}

function encode(tag: ExifTag, little: boolean): Encoded {
  const v = tag.value;
  if (v.type === "short") {
    const bytes = new Uint8Array(2);
    new DataView(bytes.buffer).setUint16(0, v.value, little);
    return { tag: tag.tag, type: TYPE_SHORT, count: 1, bytes };
  }
  if (v.type === "long") {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, v.value, little);
    return { tag: tag.tag, type: TYPE_LONG, count: 1, bytes };
  }
  if (v.type === "ascii") {
    const text = new TextEncoder().encode(v.value);
    const bytes = new Uint8Array(text.length + 1); // NUL-terminated
    bytes.set(text);
    return { tag: tag.tag, type: TYPE_ASCII, count: bytes.length, bytes };
  }
  const bytes = new Uint8Array(v.values.length * 8);
  const view = new DataView(bytes.buffer);
  v.values.forEach(([n, d], i) => {
    view.setUint32(i * 8, n, little);
    view.setUint32(i * 8 + 4, d, little);
  });
  return { tag: tag.tag, type: TYPE_RATIONAL, count: v.values.length, bytes };
}

interface Ifd {
  readonly entries: readonly Encoded[];
  /** Absolute offset (from the TIFF header) this IFD is written at. */
  offset: number;
}

/** Build the TIFF blob: header, IFD0, then Exif and GPS IFDs, then out-of-line values. */
function buildTiff(spec: ExifSpec): Uint8Array {
  const little = spec.littleEndian ?? true;
  const pointerTag = (tag: number): ExifTag => ({
    tag,
    value: { type: "long", value: 0 }, // patched below
  });
  const ifd0Tags = [
    ...(spec.ifd0 ?? []),
    ...(spec.exif ? [pointerTag(TAG.exifIfdPointer)] : []),
    ...(spec.gps ? [pointerTag(TAG.gpsIfdPointer)] : []),
  ];
  const ifds: { name: "ifd0" | "exif" | "gps"; ifd: Ifd }[] = [
    {
      name: "ifd0",
      ifd: { entries: ifd0Tags.map((t) => encode(t, little)), offset: 8 },
    },
  ];
  if (spec.exif)
    ifds.push({
      name: "exif",
      ifd: { entries: spec.exif.map((t) => encode(t, little)), offset: 0 },
    });
  if (spec.gps)
    ifds.push({
      name: "gps",
      ifd: { entries: spec.gps.map((t) => encode(t, little)), offset: 0 },
    });

  // Lay out the IFDs one after another, then the out-of-line values.
  let cursor = 8;
  for (const { ifd } of ifds) {
    ifd.offset = cursor;
    cursor += 2 + ifd.entries.length * 12 + 4;
  }
  const valueOffsets = new Map<Encoded, number>();
  for (const { ifd } of ifds) {
    for (const e of ifd.entries) {
      if (e.bytes.length > 4) {
        valueOffsets.set(e, cursor);
        cursor += e.bytes.length + (e.bytes.length % 2);
      }
    }
  }

  const out = new Uint8Array(cursor);
  const view = new DataView(out.buffer);
  out[0] = out[1] = little ? 0x49 : 0x4d;
  view.setUint16(2, 42, little);
  view.setUint32(4, 8, little);

  const offsetOf = (name: string) =>
    ifds.find((i) => i.name === name)?.ifd.offset ?? 0;
  for (const { ifd } of ifds) {
    view.setUint16(ifd.offset, ifd.entries.length, little);
    ifd.entries.forEach((e, i) => {
      const at = ifd.offset + 2 + i * 12;
      view.setUint16(at, e.tag, little);
      view.setUint16(at + 2, e.type, little);
      view.setUint32(at + 4, e.count, little);
      const outOfLine = valueOffsets.get(e);
      if (outOfLine !== undefined) {
        view.setUint32(at + 8, outOfLine, little);
        out.set(e.bytes, outOfLine);
      } else if (e.tag === TAG.exifIfdPointer && e.type === TYPE_LONG) {
        view.setUint32(at + 8, offsetOf("exif"), little);
      } else if (e.tag === TAG.gpsIfdPointer && e.type === TYPE_LONG) {
        view.setUint32(at + 8, offsetOf("gps"), little);
      } else {
        out.set(e.bytes, at + 8); // inline; a SHORT sits at the start of the field
      }
    });
    view.setUint32(ifd.offset + 2 + ifd.entries.length * 12, 0, little);
  }
  return out;
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

function segment(marker: number, payload: Uint8Array): Uint8Array {
  const length = payload.length + 2;
  return concat([
    new Uint8Array([0xff, marker, (length >> 8) & 0xff, length & 0xff]),
    payload,
  ]);
}

export interface JpegOptions {
  /** Extra segments written before the Exif APP1 (a JFIF APP0 and an XMP APP1 are typical). */
  readonly leadingSegments?: readonly Uint8Array[];
}

/** The Exif APP1 segment alone (marker, length, "Exif\0\0", TIFF), to splice into a real JPEG. */
export function exifSegment(spec: ExifSpec): Uint8Array {
  return segment(
    0xe1,
    concat([
      new Uint8Array([0x45, 0x78, 0x69, 0x66, 0x00, 0x00]), // "Exif\0\0"
      buildTiff(spec),
    ]),
  );
}

/** SOI, optional leading segments, one Exif APP1, EOI. */
export function buildExifJpeg(
  spec: ExifSpec,
  options: JpegOptions = {},
): Uint8Array {
  return concat([
    new Uint8Array([0xff, 0xd8]),
    ...(options.leadingSegments ?? []),
    exifSegment(spec),
    new Uint8Array([0xff, 0xd9]),
  ]);
}

/** A JFIF APP0 segment. */
export const JFIF_SEGMENT = segment(
  0xe0,
  new Uint8Array([0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0]),
);

/** An XMP APP1 segment (an APP1 that is not Exif). */
export const XMP_SEGMENT = segment(
  0xe1,
  new TextEncoder().encode("http://ns.adobe.com/xap/1.0/\0<x:xmpmeta/>"),
);

/**
 * A phone-like photo: every white-listed tag, plus everything a run log must
 * never keep. The private values are distinctive on purpose, so a test can
 * search a serialised log for them.
 */
export const PRIVATE = {
  make: "Zetaphone Corp",
  model: "ZP-9000 Ultra",
  serial: "SN-QX7731-ZK",
  lens: "Zeta back camera 6.7mm f/1.7",
  uniqueId: "c0ffee1234deadbeef5678",
  dateTime: "2031:08:17 04:55:31",
  software: "ZetaOS 99.4",
  latitudeSeconds: 33.3141,
  longitudeSeconds: 44.4152,
  altitude: 137.2519,
} as const;

export function phoneSpec(littleEndian = true): ExifSpec {
  return {
    littleEndian,
    ifd0: [
      { tag: TAG.make, value: { type: "ascii", value: PRIVATE.make } },
      { tag: TAG.model, value: { type: "ascii", value: PRIVATE.model } },
      { tag: TAG.orientation, value: { type: "short", value: 6 } },
      { tag: TAG.software, value: { type: "ascii", value: PRIVATE.software } },
      { tag: TAG.dateTime, value: { type: "ascii", value: PRIVATE.dateTime } },
    ],
    exif: [
      {
        tag: TAG.exposureTime,
        value: { type: "rational", values: [[1, 120]] },
      },
      { tag: TAG.isoSpeed, value: { type: "short", value: 125 } },
      {
        tag: TAG.dateTimeOriginal,
        value: { type: "ascii", value: PRIVATE.dateTime },
      },
      {
        tag: TAG.focalLength,
        value: { type: "rational", values: [[6765, 1000]] },
      },
      { tag: TAG.pixelXDimension, value: { type: "long", value: 4032 } },
      { tag: TAG.pixelYDimension, value: { type: "long", value: 3024 } },
      {
        tag: TAG.imageUniqueId,
        value: { type: "ascii", value: PRIVATE.uniqueId },
      },
      { tag: TAG.focalLengthIn35mmFilm, value: { type: "short", value: 24 } },
      {
        tag: TAG.bodySerialNumber,
        value: { type: "ascii", value: PRIVATE.serial },
      },
      { tag: TAG.lensModel, value: { type: "ascii", value: PRIVATE.lens } },
    ],
    gps: [
      { tag: TAG.gpsLatitudeRef, value: { type: "ascii", value: "N" } },
      {
        tag: TAG.gpsLatitude,
        value: {
          type: "rational",
          values: [
            [25, 1],
            [2, 1],
            [Math.round(PRIVATE.latitudeSeconds * 10000), 10000],
          ],
        },
      },
      { tag: TAG.gpsLongitudeRef, value: { type: "ascii", value: "E" } },
      {
        tag: TAG.gpsLongitude,
        value: {
          type: "rational",
          values: [
            [121, 1],
            [33, 1],
            [Math.round(PRIVATE.longitudeSeconds * 10000), 10000],
          ],
        },
      },
      {
        tag: TAG.gpsAltitude,
        value: {
          type: "rational",
          values: [[Math.round(PRIVATE.altitude * 10000), 10000]],
        },
      },
    ],
  };
}
