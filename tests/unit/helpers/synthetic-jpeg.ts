/**
 * Synthetic JPEG byte streams for the error-photo tests: the segment
 * structure only (SOI, optional APPn/COM, SOF0 with a size, SOS with a few
 * entropy bytes, EOI). Nothing decodes them; the marker walker
 * (src/lib/error-photo/jpeg.ts) reads structure, not pixels. No real photo
 * is ever committed.
 */

function segment(marker: number, payload: readonly number[]): number[] {
  const length = payload.length + 2;
  return [0xff, marker, (length >> 8) & 0xff, length & 0xff, ...payload];
}

const JFIF = segment(
  0xe0,
  [0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0],
);

export function sof0(width: number, height: number): number[] {
  return segment(0xc0, [
    8,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    1,
    1,
    0x11,
    0,
  ]);
}

export const EXIF_APP1 = segment(
  0xe1,
  [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x4d, 0x4d, 0, 42, 0, 0, 0, 8],
);
export const XMP_APP1 = segment(0xe1, [
  ...Buffer.from("http://ns.adobe.com/xap/1.0/\0<x/>"),
]);
export const COMMENT = segment(0xfe, [...Buffer.from("hello")]);

/** SOS header + entropy bytes with a stuffed FF 00 and a restart marker. */
const SCAN = [
  ...segment(0xda, [1, 1, 0, 0, 63, 0]),
  0x12,
  0xff,
  0x00,
  0x34,
  0xff,
  0xd0,
  0x56,
];

export function syntheticJpeg(
  options: {
    width?: number;
    height?: number;
    beforeFrame?: readonly number[];
    afterScan?: readonly number[];
    trailer?: readonly number[];
    noFrame?: boolean;
  } = {},
): Uint8Array<ArrayBuffer> {
  const { width = 640, height = 480 } = options;
  return new Uint8Array([
    0xff,
    0xd8,
    ...JFIF,
    ...(options.beforeFrame ?? []),
    ...(options.noFrame ? [] : sof0(width, height)),
    ...SCAN,
    ...(options.afterScan ?? []),
    0xff,
    0xd9,
    ...(options.trailer ?? []),
  ]);
}
