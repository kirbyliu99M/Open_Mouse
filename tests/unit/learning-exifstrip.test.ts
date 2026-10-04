import { describe, expect, it } from "vitest";
import { NO_EXIF, readExifWhitelist } from "../../src/lib/learning/exif";
import {
  EXIF_STRIP_MODE,
  inventoryJpegMetadata,
  orientationOnlyExifSegment,
  prepareFiledCopy,
  problemsInFiledCopy,
  stripJpegMetadata,
} from "../../src/lib/learning/exifstrip";
import {
  JFIF_SEGMENT,
  PRIVATE,
  TAG,
  XMP_SEGMENT,
  exifSegment,
  phoneSpec,
  type ExifSpec,
} from "./helpers/exif-jpeg";

// ── Synthetic JPEG bytes: segments of invented content, no photo ───────────

const enc = (text: string) => new TextEncoder().encode(text);

function concat(...chunks: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

function seg(marker: number, payload: Uint8Array): Uint8Array {
  const length = payload.length + 2;
  return concat(
    new Uint8Array([0xff, marker, (length >> 8) & 0xff, length & 0xff]),
    payload,
  );
}

const SOI = new Uint8Array([0xff, 0xd8]);
const EOI = new Uint8Array([0xff, 0xd9]);

const DQT = seg(
  0xdb,
  new Uint8Array(65).map((_, i) => (i === 0 ? 0 : i)),
);
const SOF0 = seg(0xc0, new Uint8Array([8, 0, 16, 0, 16, 1, 1, 0x11, 0]));
const DHT = seg(
  0xc4,
  new Uint8Array(20).map((_, i) => 0x10 + i),
);
const SOS = seg(0xda, new Uint8Array([1, 1, 0x00, 0, 63, 0]));
/**
 * Entropy-coded data with the awkward bytes a real scan has: stuffed FFs
 * (FF 00), restart markers (FF D0, FF D1) and the ASCII for "Exif" and a GPS
 * tag name, which must survive because they are image data, not metadata.
 */
const SCAN = concat(
  new Uint8Array([0x12, 0x34, 0xff, 0x00, 0x56]),
  new Uint8Array([0xff, 0xd0]),
  enc("Exif\0\0GPS"),
  new Uint8Array([0xff, 0x00, 0xff, 0x00, 0x9a]),
  new Uint8Array([0xff, 0xd1]),
  new Uint8Array([0x77, 0x88, 0xff, 0x00]),
);

const ICC = seg(
  0xe2,
  concat(enc("ICC_PROFILE\0"), new Uint8Array([1, 1, 9, 8, 7, 6, 5, 4, 3, 2])),
);
const MPF = seg(
  0xe2,
  concat(enc("MPF\0"), new Uint8Array([0x4d, 0x4d, 0, 42])),
);
const IPTC = seg(0xed, enc("Photoshop 3.0\0" + "8BIM caption: Taipei"));
const COMMENT = seg(0xfe, enc("shot at the office, ZP-9000"));
const MAKER = seg(0xec, enc("Ducky\0exposure 1/120 serial SN-1"));
// "Adobe", version 100, flags0 0x8000, flags1 0, transform 0: the 12-byte header.
const ADOBE = seg(
  0xee,
  concat(enc("Adobe"), new Uint8Array([0, 100, 0x80, 0, 0, 0, 0])),
);
/** A JFIF header whose thumbnail is 2 x 1 pixels (6 bytes of RGB after the header). */
const JFIF_WITH_THUMBNAIL = seg(
  0xe0,
  concat(
    enc("JFIF\0"),
    new Uint8Array([1, 1, 0, 0, 1, 0, 1, 2, 1]),
    new Uint8Array([9, 9, 9, 8, 8, 8]),
  ),
);
/** The JFIF extension segment, which carries a thumbnail in its own right. */
const JFXX = seg(0xe0, concat(enc("JFXX\0"), new Uint8Array([0x10, 1, 2, 3])));
/** A JPG13 extension marker, and a reserved one, with text a private reader could use. */
const JPG4 = seg(0xf4, enc("extension with serial SN-9"));
const RESERVED = seg(0x7d, enc("reserved with serial SN-8"));

const jpeg = (...headerSegments: Uint8Array[]) =>
  concat(SOI, ...headerSegments, DQT, SOF0, DHT, SOS, SCAN, EOI);

/** Where the picture's own bytes begin: the first DQT. */
function pictureOf(bytes: Uint8Array): Uint8Array {
  for (let i = 2; i + 1 < bytes.length; i++) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0xdb) return bytes.subarray(i);
  }
  throw new Error("no DQT");
}

const contains = (haystack: Uint8Array, needle: string | Uint8Array) => {
  const n = typeof needle === "string" ? enc(needle) : needle;
  outer: for (let i = 0; i + n.length <= haystack.length; i++) {
    for (let j = 0; j < n.length; j++) {
      if (haystack[i + j] !== n[j]) continue outer;
    }
    return true;
  }
  return false;
};

const phoneExif = (spec: ExifSpec = phoneSpec()) => exifSegment(spec);
const orientationOf = (bytes: Uint8Array): number | null => {
  const exif = inventoryJpegMetadata(bytes).exif;
  if (!exif) return null;
  for (let o = 1; o <= 8; o++) {
    const minimal = orientationOnlyExifSegment(o);
    if (minimal.every((b, i) => exif[i] === b)) return o;
  }
  return null;
};

function strip(input: Uint8Array) {
  const result = stripJpegMetadata(input);
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
  return result;
}

describe("the mode", () => {
  it("is named, so the sorter can print it", () => {
    expect(EXIF_STRIP_MODE).toBe("orientation-only");
  });
});

describe("a phone photo's metadata", () => {
  const original = jpeg(JFIF_SEGMENT, phoneExif(), XMP_SEGMENT, ICC);
  const result = strip(original);

  it("loses the GPS position, the time, the make and model, the serial number and the rest", () => {
    for (const secret of [
      PRIVATE.make,
      PRIVATE.model,
      PRIVATE.serial,
      PRIVATE.lens,
      PRIVATE.uniqueId,
      PRIVATE.dateTime,
      PRIVATE.software,
    ]) {
      expect(contains(original, secret)).toBe(true); // the premise: it was there
      expect(contains(result.bytes, secret)).toBe(false);
    }
    // No GPS block (its IFD pointer tag is 0x8825) and no Exif sub-IFD pointer (0x8769).
    const exif = inventoryJpegMetadata(result.bytes).exif!;
    const hex = Array.from(exif, (b) => b.toString(16).padStart(2, "0")).join(
      "",
    );
    expect(hex).not.toContain("8825");
    expect(hex).not.toContain("8769");
    // The white-list tags (focal length, pixel dimensions) are gone from the copy too.
    expect(readExifWhitelist(result.bytes)).toEqual(NO_EXIF);
  });

  it("keeps Orientation, and only Orientation, in a rebuilt 36-byte Exif", () => {
    expect(result.orientation).toBe(6);
    const exif = inventoryJpegMetadata(result.bytes).exif!;
    expect(exif).toHaveLength(36);
    expect(Array.from(exif)).toEqual(Array.from(orientationOnlyExifSegment(6)));
    expect(orientationOf(result.bytes)).toBe(6);
  });

  it("drops the XMP, keeps JFIF and the ICC profile, in the original order", () => {
    expect(inventoryJpegMetadata(original).segments).toEqual([
      "APP0",
      "APP1:exif",
      "APP1",
      "APP2:icc",
    ]);
    expect(inventoryJpegMetadata(result.bytes).segments).toEqual([
      "APP0",
      "APP1:exif",
      "APP2:icc",
    ]);
    expect(contains(result.bytes, ICC)).toBe(true);
    expect(contains(result.bytes, JFIF_SEGMENT)).toBe(true);
    expect(contains(result.bytes, "xmpmeta")).toBe(false);
  });

  it("passes its own post-condition", () => {
    expect(problemsInFiledCopy(result.bytes)).toEqual([]);
  });

  it("does not touch the bytes it is given", () => {
    const given = jpeg(phoneExif(), ICC);
    const before = Array.from(given);
    const out = strip(given);
    expect(Array.from(given)).toEqual(before);
    expect(out.bytes).not.toBe(given);
    expect(out.bytes.buffer).not.toBe(given.buffer);
  });
});

describe("orientation", () => {
  const withOrientation = (value: number, littleEndian = true) =>
    exifSegment({
      littleEndian,
      ifd0: [
        { tag: TAG.make, value: { type: "ascii", value: PRIVATE.make } },
        { tag: TAG.orientation, value: { type: "short", value } },
      ],
    });

  it.each([1, 2, 3, 4, 5, 6, 7, 8])(
    "keeps orientation %i, from a little-endian and a big-endian original",
    (value) => {
      for (const little of [true, false]) {
        const out = strip(jpeg(withOrientation(value, little)));
        expect(out.orientation).toBe(value);
        expect(orientationOf(out.bytes)).toBe(value);
        expect(problemsInFiledCopy(out.bytes)).toEqual([]);
      }
    },
  );

  it("writes no Exif at all when the original has no Orientation tag", () => {
    const spec = phoneSpec();
    const noOrientation: ExifSpec = {
      ...spec,
      ifd0: spec.ifd0!.filter((t) => t.tag !== TAG.orientation),
    };
    const out = strip(jpeg(exifSegment(noOrientation)));
    expect(out.orientation).toBeNull();
    expect(inventoryJpegMetadata(out.bytes).segments).toEqual([]);
  });

  it.each([0, 9, 65535])(
    "writes no Exif when the Orientation value %i is not one of 1 to 8",
    (value) => {
      const out = strip(jpeg(withOrientation(value)));
      expect(out.orientation).toBeNull();
      expect(inventoryJpegMetadata(out.bytes).exif).toBeNull();
    },
  );

  it("takes the orientation from the first Exif block and drops the others", () => {
    const out = strip(jpeg(withOrientation(3), withOrientation(8)));
    expect(out.orientation).toBe(3);
    expect(inventoryJpegMetadata(out.bytes).segments).toEqual(["APP1:exif"]);
    expect(out.summary.exifSegments).toBe(2);
  });

  it("builds the minimal segment byte for byte as hand-written here (orientation 6)", () => {
    // Written out from the TIFF and Exif specs, not produced by the code under test:
    // FF E1, length 34, "Exif\0\0", "MM" 002A, IFD0 at 8, one entry
    // (tag 0112, SHORT, count 1, value 6, padded), no next IFD.
    const expected = [
      0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x4d, 0x4d,
      0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, 0x00, 0x01, 0x01, 0x12, 0x00, 0x03,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ];
    expect(Array.from(orientationOnlyExifSegment(6))).toEqual(expected);
    // Only the value changes with the orientation.
    for (let o = 1; o <= 8; o++) {
      const bytes = Array.from(orientationOnlyExifSegment(o));
      expect(bytes.slice(0, 28)).toEqual(expected.slice(0, 28));
      expect(bytes.slice(28, 30)).toEqual([0, o]);
      expect(bytes.slice(30)).toEqual(expected.slice(30));
    }
  });

  it("is read back by a separate reader that parses the IFD itself", () => {
    // An independent minimal TIFF reader, big-endian only, written for this test.
    const read = (segment: Uint8Array) => {
      const v = new DataView(
        segment.buffer,
        segment.byteOffset,
        segment.length,
      );
      expect(v.getUint16(0)).toBe(0xffe1);
      expect(v.getUint16(2)).toBe(segment.length - 2);
      const tiff = 10;
      expect(v.getUint16(tiff)).toBe(0x4d4d);
      expect(v.getUint16(tiff + 2)).toBe(42);
      const ifd = tiff + v.getUint32(tiff + 4);
      const entries = v.getUint16(ifd);
      const found: {
        tag: number;
        type: number;
        count: number;
        value: number;
      }[] = [];
      for (let i = 0; i < entries; i++) {
        const e = ifd + 2 + i * 12;
        found.push({
          tag: v.getUint16(e),
          type: v.getUint16(e + 2),
          count: v.getUint32(e + 4),
          value: v.getUint16(e + 8),
        });
      }
      const next = v.getUint32(ifd + 2 + entries * 12);
      return { found, next, end: ifd + 2 + entries * 12 + 4 };
    };
    for (let o = 1; o <= 8; o++) {
      const segment = orientationOnlyExifSegment(o);
      const r = read(segment);
      expect(r.found).toEqual([{ tag: 0x0112, type: 3, count: 1, value: o }]);
      expect(r.next).toBe(0);
      expect(r.end).toBe(segment.length); // nothing after the IFD
    }
  });

  it("a malformed IFD count fails: more entries claimed than the segment holds gives no orientation and no Exif in the copy", () => {
    const bad = Uint8Array.from(orientationOnlyExifSegment(6));
    bad[19] = 0xff; // IFD0 entry count 0x00ff (255) in a segment that holds one
    const out = strip(jpeg(bad));
    expect(out.orientation).toBeNull();
    expect(inventoryJpegMetadata(out.bytes).exif).toBeNull();
    // As a finished copy it is refused too: it is not the minimal Exif.
    expect(problemsInFiledCopy(jpeg(bad))).toContain(
      "Exif holds more than the Orientation tag",
    );
    // Two entries where one is written: also not the minimal one.
    const two = Uint8Array.from(orientationOnlyExifSegment(6));
    two[19] = 2;
    expect(problemsInFiledCopy(jpeg(two))).toContain(
      "Exif holds more than the Orientation tag",
    );
  });

  it("builds the minimal segment for 1 to 8 only", () => {
    for (const bad of [0, 9, -1, 1.5, Number.NaN]) {
      expect(() => orientationOnlyExifSegment(bad)).toThrow(RangeError);
    }
    const segment = orientationOnlyExifSegment(8);
    expect(segment).toHaveLength(36);
    // marker, length 34, "Exif\0\0"
    expect(Array.from(segment.subarray(0, 4))).toEqual([0xff, 0xe1, 0, 34]);
  });
});

describe("the picture itself", () => {
  it("is byte-identical: tables, frame header, scan data with stuffed FFs and restart markers, and the end marker", () => {
    const original = jpeg(JFIF_SEGMENT, phoneExif(), IPTC, COMMENT, ICC);
    const out = strip(original);
    const before = pictureOf(original);
    const after = pictureOf(out.bytes);
    expect(Array.from(after)).toEqual(Array.from(before));
    // The tail is exactly DQT SOF DHT SOS scan EOI as built.
    expect(Array.from(after)).toEqual(
      Array.from(concat(DQT, SOF0, DHT, SOS, SCAN, EOI)),
    );
  });

  it("keeps scan data that merely looks like metadata (the ASCII Exif and GPS inside it)", () => {
    const out = strip(jpeg(phoneExif()));
    expect(contains(out.bytes, enc("Exif\0\0GPS"))).toBe(true);
  });

  it("a JPEG with nothing to strip comes out byte for byte the same", () => {
    const plain = jpeg(JFIF_SEGMENT, ICC);
    expect(Array.from(strip(plain).bytes)).toEqual(Array.from(plain));
  });

  it("stripping twice changes nothing more", () => {
    const once = strip(jpeg(phoneExif(), XMP_SEGMENT, COMMENT)).bytes;
    expect(Array.from(strip(once).bytes)).toEqual(Array.from(once));
  });

  it("copes with fill bytes between header segments and an empty restart marker", () => {
    const filled = concat(
      SOI,
      new Uint8Array([0xff, 0xff]),
      phoneExif(),
      new Uint8Array([0xff, 0xff, 0xff]),
      DQT,
      SOF0,
      DHT,
      SOS,
      SCAN,
      EOI,
    );
    const out = strip(filled);
    expect(out.orientation).toBe(6);
    expect(Array.from(pictureOf(out.bytes))).toEqual(
      Array.from(pictureOf(filled)),
    );
  });
});

describe("what else is dropped", () => {
  it("APP13 (IPTC), comments, maker segments, the multi-picture index and a second XMP", () => {
    const original = jpeg(JFIF_SEGMENT, IPTC, COMMENT, MAKER, MPF, XMP_SEGMENT);
    const out = strip(original);
    expect(inventoryJpegMetadata(out.bytes).segments).toEqual(["APP0"]);
    for (const text of ["Taipei", "ZP-9000", "serial SN-1", "MPF"]) {
      expect(contains(out.bytes, text)).toBe(false);
    }
    expect(out.summary).toMatchObject({
      app13Segments: 1,
      commentSegments: 1,
      otherAppSegments: 2, // the maker segment and the MPF index
      otherApp1Segments: 1,
      exifSegments: 0,
    });
  });

  it("keeps APP14 only as the 12-byte Adobe colour-transform header", () => {
    const out = strip(jpeg(ADOBE, COMMENT));
    expect(inventoryJpegMetadata(out.bytes).segments).toEqual(["APP14"]);
    // The same marker with another content, or Adobe with extra bytes, is dropped.
    const other = seg(0xee, enc("Other\0camera notes with a serial SN-7"));
    const longer = seg(
      0xee,
      concat(enc("Adobe"), new Uint8Array(7), enc("SN-6 hidden")),
    );
    for (const odd of [other, longer]) {
      const dropped = strip(jpeg(odd));
      expect(inventoryJpegMetadata(dropped.bytes).segments).toEqual([]);
      expect(contains(dropped.bytes, "SN-")).toBe(false);
    }
  });

  it("keeps APP0 only as a plain JFIF header: a JFXX extension and a JFIF with a thumbnail are dropped", () => {
    const plain = strip(jpeg(JFIF_SEGMENT));
    expect(inventoryJpegMetadata(plain.bytes).segments).toEqual(["APP0"]);
    for (const thumb of [JFXX, JFIF_WITH_THUMBNAIL]) {
      const out = strip(jpeg(thumb));
      expect(inventoryJpegMetadata(out.bytes).segments).toEqual([]);
      expect(contains(out.bytes, thumb)).toBe(false);
    }
    expect(inventoryJpegMetadata(jpeg(JFXX)).segments).toEqual(["APP0:other"]);
  });

  it("drops the JPGn extension markers (0xF0 to 0xFD) and reserved markers", () => {
    const out = strip(jpeg(JPG4, RESERVED, JFIF_SEGMENT));
    expect(inventoryJpegMetadata(out.bytes).segments).toEqual(["APP0"]);
    expect(contains(out.bytes, "SN-9")).toBe(false);
    expect(contains(out.bytes, "SN-8")).toBe(false);
    for (let marker = 0xf0; marker <= 0xfd; marker++) {
      const dropped = strip(jpeg(seg(marker, enc("hidden text"))));
      expect(contains(dropped.bytes, "hidden text")).toBe(false);
      expect(Array.from(pictureOf(dropped.bytes))).toEqual(
        Array.from(concat(DQT, SOF0, DHT, SOS, SCAN, EOI)),
      );
    }
  });

  it("drops whatever follows the end-of-image marker (a gain map or a motion-photo video with its own metadata)", () => {
    const trailer = enc("ftypmp42 ..GPS 25.0330N 121.5654E.. second jpeg");
    const original = concat(jpeg(phoneExif()), trailer);
    const out = strip(original);
    expect(out.summary.trailerBytes).toBe(trailer.length);
    expect(contains(out.bytes, "GPS 25.0330N")).toBe(false);
    expect(Array.from(out.bytes.subarray(out.bytes.length - 2))).toEqual([
      0xff, 0xd9,
    ]);
  });

  it("drops metadata that sits between scans, and keeps both scans", () => {
    const original = concat(
      SOI,
      DQT,
      SOF0,
      DHT,
      SOS,
      SCAN,
      phoneExif(),
      COMMENT,
      DHT,
      SOS,
      SCAN,
      EOI,
    );
    const out = strip(original);
    expect(inventoryJpegMetadata(out.bytes).segments).toEqual([]);
    expect(contains(out.bytes, PRIVATE.make)).toBe(false);
    expect(Array.from(out.bytes)).toEqual(
      Array.from(concat(SOI, DQT, SOF0, DHT, SOS, SCAN, DHT, SOS, SCAN, EOI)),
    );
  });
});

describe("what it refuses", () => {
  const PNG = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13,
  ]);
  const HEIC = concat(
    new Uint8Array([0, 0, 0, 24]),
    enc("ftypheic"),
    new Uint8Array(12),
  );

  it.each([
    ["a PNG", PNG],
    ["a HEIC", HEIC],
    ["text", enc("this is not a jpeg at all")],
    ["nothing", new Uint8Array(0)],
    ["a single byte", new Uint8Array([0xff])],
    ["the start-of-image marker alone", SOI],
  ])("a non-JPEG: %s", (_name, bytes) => {
    expect(stripJpegMetadata(bytes)).toEqual({
      ok: false,
      reason: "not-a-jpeg",
    });
    expect(prepareFiledCopy(bytes)).toEqual({
      ok: false,
      reason: "not-a-jpeg",
    });
  });

  it("a JPEG cut short (no end-of-image marker)", () => {
    const whole = jpeg(phoneExif());
    for (const cut of [10, 60, whole.length - 3, whole.length - 1]) {
      const r = stripJpegMetadata(whole.subarray(0, cut));
      expect(r.ok).toBe(false);
    }
    expect(stripJpegMetadata(whole.subarray(0, whole.length - 2)).ok).toBe(
      false,
    );
  });

  it("a segment whose length runs past the end of the file, or is below 2", () => {
    const overrun = concat(
      SOI,
      new Uint8Array([0xff, 0xe1, 0xff, 0xff, 1, 2]),
      EOI,
    );
    expect(stripJpegMetadata(overrun)).toEqual({
      ok: false,
      reason: "malformed",
    });
    const tiny = concat(SOI, new Uint8Array([0xff, 0xe1, 0x00, 0x01]), EOI);
    expect(stripJpegMetadata(tiny)).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  it("bytes where a marker must be", () => {
    const junk = concat(SOI, new Uint8Array([0x12, 0x34, 0x56, 0x78]), EOI);
    expect(stripJpegMetadata(junk)).toEqual({ ok: false, reason: "malformed" });
  });
});

describe("prepareFiledCopy, the check after stripping", () => {
  it("refuses a result that still holds metadata, whatever stripper made it", () => {
    const original = jpeg(phoneExif());
    const leaky = (bytes: Uint8Array) => ({
      ok: true as const,
      // "Stripping" that forgot the comment and the Exif.
      bytes: jpeg(COMMENT, phoneExif()),
      orientation: null,
      summary: strip(bytes).summary,
    });
    expect(prepareFiledCopy(original, leaky)).toEqual({
      ok: false,
      reason: "verification-failed",
    });
    const trailing = (bytes: Uint8Array) => ({
      ...leaky(bytes),
      bytes: concat(jpeg(), enc("GPS tail")),
    });
    expect(prepareFiledCopy(original, trailing)).toEqual({
      ok: false,
      reason: "verification-failed",
    });
    // The real stripper passes the same check.
    expect(prepareFiledCopy(original).ok).toBe(true);
  });

  it("passes on a refusal from the stripper untouched", () => {
    expect(
      prepareFiledCopy(enc("not a jpeg"), () => ({
        ok: false,
        reason: "malformed",
      })),
    ).toEqual({ ok: false, reason: "malformed" });
  });
});

describe("prepareFiledCopy", () => {
  const original = jpeg(JFIF_SEGMENT, phoneExif(), XMP_SEGMENT);

  it("reads the white-list from the ORIGINAL, before stripping: the copy has none", () => {
    const copy = prepareFiledCopy(original);
    expect(copy.ok).toBe(true);
    if (!copy.ok) return;
    expect(copy.whitelist).toEqual({
      focalLengthMm: 6.765,
      focalLengthIn35mmFilm: 24,
      pixelXDimension: 4032,
      pixelYDimension: 3024,
    });
    expect(copy.whitelist).toEqual(readExifWhitelist(original));
    // Read after stripping, the same values are gone: that is why the order matters.
    expect(readExifWhitelist(copy.bytes)).toEqual(NO_EXIF);
    expect(copy.orientation).toBe(6);
    expect(problemsInFiledCopy(copy.bytes)).toEqual([]);
  });
});

describe("problemsInFiledCopy", () => {
  it("passes a clean copy and names what is wrong with an unstripped original", () => {
    expect(problemsInFiledCopy(jpeg(JFIF_SEGMENT, ICC))).toEqual([]);
    expect(
      problemsInFiledCopy(jpeg(orientationOnlyExifSegment(3), ICC)),
    ).toEqual([]);
    expect(problemsInFiledCopy(jpeg(phoneExif()))).toContain(
      "Exif holds more than the Orientation tag",
    );
    expect(problemsInFiledCopy(jpeg(COMMENT))).toContain("COM segment present");
    expect(problemsInFiledCopy(jpeg(IPTC))).toContain("APP13 segment present");
    expect(problemsInFiledCopy(jpeg(XMP_SEGMENT))).toContain(
      "APP1 segment present",
    );
    expect(problemsInFiledCopy(jpeg(MPF))).toContain("APP2 segment present");
    // By content, not by segment name: the same markers with the wrong content are problems.
    expect(problemsInFiledCopy(jpeg(JFXX))).toContain(
      "APP0:other segment present",
    );
    expect(problemsInFiledCopy(jpeg(JFIF_WITH_THUMBNAIL))).toContain(
      "APP0:other segment present",
    );
    expect(problemsInFiledCopy(jpeg(seg(0xee, enc("Other\0notes"))))).toContain(
      "APP14:other segment present",
    );
    expect(problemsInFiledCopy(jpeg(JPG4))).toContain("JPG4 segment present");
    expect(problemsInFiledCopy(jpeg(RESERVED))).toEqual([
      "marker 0x7d segment present",
    ]);
    expect(problemsInFiledCopy(jpeg(ADOBE, ICC, JFIF_SEGMENT))).toEqual([]);
    expect(
      problemsInFiledCopy(
        jpeg(orientationOnlyExifSegment(1), orientationOnlyExifSegment(1)),
      ),
    ).toContain("more than one Exif segment");
    expect(problemsInFiledCopy(concat(jpeg(), enc("tail")))).toContain(
      "bytes after the end of image",
    );
    expect(problemsInFiledCopy(enc("not a jpeg"))).toEqual([
      "not a complete JPEG",
    ]);
  });
});
