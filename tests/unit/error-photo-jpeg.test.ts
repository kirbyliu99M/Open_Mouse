import { describe, expect, it } from "vitest";
import {
  DELETE_CODE_ALPHABET,
  DELETE_CODE_LENGTH,
  generateDeleteCode,
} from "../../src/lib/error-photo/code";
import {
  checkErrorPhotoJpeg,
  inspectJpeg,
} from "../../src/lib/error-photo/jpeg";
import { errorPhotoResponseSchema } from "../../src/lib/contracts/error-photo";
import {
  COMMENT,
  EXIF_APP1,
  XMP_APP1,
  syntheticJpeg,
} from "./helpers/synthetic-jpeg";

describe("inspectJpeg", () => {
  it("reads the frame size and the APPn markers of a clean JPEG", () => {
    const found = inspectJpeg(syntheticJpeg({ width: 1234, height: 567 }));
    expect(found).toEqual({
      ok: true,
      width: 1234,
      height: 567,
      appMarkers: [0xe0],
      app1Segments: 0,
      commentSegments: 0,
      trailerBytes: 0,
    });
  });

  it("refuses what does not start with SOI", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]);
    expect(inspectJpeg(png)).toEqual({ ok: false, reason: "not-a-jpeg" });
    expect(inspectJpeg(new Uint8Array([0xff, 0xd8]))).toEqual({
      ok: false,
      reason: "not-a-jpeg",
    });
  });

  it("refuses a truncated file and a segment that runs past the end", () => {
    const full = syntheticJpeg();
    expect(inspectJpeg(full.subarray(0, full.length - 2)).ok).toBe(false);
    const bad = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x40, 0x00, 1, 2]);
    expect(inspectJpeg(bad)).toEqual({ ok: false, reason: "malformed" });
  });

  it("refuses a file with no frame header or two of them", () => {
    expect(inspectJpeg(syntheticJpeg({ noFrame: true }))).toEqual({
      ok: false,
      reason: "no-frame",
    });
    const twoFrames = syntheticJpeg({
      beforeFrame: [0xff, 0xc0, 0, 11, 8, 0, 10, 0, 10, 1, 1, 0x11, 0],
    });
    expect(inspectJpeg(twoFrames)).toEqual({ ok: false, reason: "no-frame" });
  });

  it("finds APP1 before the frame, after the scan, and counts the trailer", () => {
    expect(
      inspectJpeg(syntheticJpeg({ beforeFrame: EXIF_APP1 })),
    ).toMatchObject({ ok: true, app1Segments: 1 });
    expect(inspectJpeg(syntheticJpeg({ afterScan: XMP_APP1 }))).toMatchObject({
      ok: true,
      app1Segments: 1,
    });
    expect(inspectJpeg(syntheticJpeg({ trailer: [1, 2, 3] }))).toMatchObject({
      ok: true,
      trailerBytes: 3,
    });
  });
});

describe("checkErrorPhotoJpeg", () => {
  const size = { widthPx: 640, heightPx: 480 };

  it("passes a clean JPEG of the stated size", () => {
    expect(checkErrorPhotoJpeg(syntheticJpeg(), size, 2048)).toBeNull();
  });

  it("refuses Exif or XMP anywhere, comments and trailing bytes", () => {
    expect(
      checkErrorPhotoJpeg(
        syntheticJpeg({ beforeFrame: EXIF_APP1 }),
        size,
        2048,
      ),
    ).toBe("has-app1");
    expect(
      checkErrorPhotoJpeg(syntheticJpeg({ afterScan: XMP_APP1 }), size, 2048),
    ).toBe("has-app1");
    expect(
      checkErrorPhotoJpeg(syntheticJpeg({ beforeFrame: COMMENT }), size, 2048),
    ).toBe("has-comment");
    expect(
      checkErrorPhotoJpeg(syntheticJpeg({ trailer: [0xff, 0xd8] }), size, 2048),
    ).toBe("trailing-data");
  });

  it("refuses a frame of another size than stated, or over the limit", () => {
    expect(checkErrorPhotoJpeg(syntheticJpeg({ width: 641 }), size, 2048)).toBe(
      "size-mismatch",
    );
    expect(
      checkErrorPhotoJpeg(
        syntheticJpeg({ width: 2049, height: 100 }),
        { widthPx: 2049, heightPx: 100 },
        2048,
      ),
    ).toBe("too-large");
  });

  it("refuses what is not a JPEG", () => {
    expect(checkErrorPhotoJpeg(new Uint8Array(10), size, 2048)).toBe(
      "not-a-jpeg",
    );
  });
});

describe("generateDeleteCode", () => {
  it("draws 12 letters of the contract's alphabet from the random bytes", () => {
    const bytes = Uint8Array.from({ length: 12 }, (_, k) => k * 23);
    const code = generateDeleteCode(() => bytes);
    expect(code).toHaveLength(DELETE_CODE_LENGTH);
    expect(errorPhotoResponseSchema.parse({ deleteCode: code })).toEqual({
      deleteCode: code,
    });
  });

  it("maps every byte value into the alphabet (32 letters, no look-alikes)", () => {
    expect(DELETE_CODE_ALPHABET).toHaveLength(32);
    expect(new Set(DELETE_CODE_ALPHABET).size).toBe(32);
    expect(DELETE_CODE_ALPHABET).not.toMatch(/[IO01]/);
    for (let b = 0; b < 256; b += 1) {
      const code = generateDeleteCode(() => new Uint8Array(12).fill(b));
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]{12}$/);
      expect(code[0]).toBe(DELETE_CODE_ALPHABET[b % 32]);
    }
  });

  it("refuses a short random source", () => {
    expect(() => generateDeleteCode(() => new Uint8Array(4))).toThrow(
      RangeError,
    );
  });
});
