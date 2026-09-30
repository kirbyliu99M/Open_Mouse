import { describe, expect, it } from "vitest";
import {
  EXIF_WHITELIST_KEYS,
  NO_EXIF,
  pickExifWhitelist,
  readExifWhitelist,
} from "../../src/lib/learning/exif";
import { estimateFocalFromExif } from "../../src/client/geometry/exif-focal";
import {
  JFIF_SEGMENT,
  PRIVATE,
  TAG,
  XMP_SEGMENT,
  buildExifJpeg,
  exifSegment,
  phoneSpec,
} from "./helpers/exif-jpeg";

const WHITE = {
  focalLengthMm: 6.765,
  focalLengthIn35mmFilm: 24,
  pixelXDimension: 4032,
  pixelYDimension: 3024,
};

describe("readExifWhitelist", () => {
  it.each([
    ["little-endian (II)", true],
    ["big-endian (MM)", false],
  ] as const)(
    "keeps the four white-listed values and nothing else — %s",
    (_label, littleEndian) => {
      const out = readExifWhitelist(buildExifJpeg(phoneSpec(littleEndian)));
      expect(out).toEqual(WHITE);
      expect(Object.keys(out).sort()).toEqual([...EXIF_WHITELIST_KEYS].sort());
    },
  );

  it("never surfaces GPS, time, serial number, device or lens, even as a substring of the output", () => {
    const text = JSON.stringify(readExifWhitelist(buildExifJpeg(phoneSpec())));
    for (const secret of [
      PRIVATE.make,
      PRIVATE.model,
      PRIVATE.serial,
      PRIVATE.lens,
      PRIVATE.uniqueId,
      PRIVATE.dateTime,
      PRIVATE.software,
      String(PRIVATE.latitudeSeconds),
      String(PRIVATE.longitudeSeconds),
      String(PRIVATE.altitude),
      "2031",
    ]) {
      expect(text).not.toContain(secret);
    }
  });

  it("returns only nulls for a photo that carries private tags but none of the four", () => {
    const spec = phoneSpec();
    const jpeg = buildExifJpeg({
      ...spec,
      exif: spec.exif!.filter(
        (t) =>
          ![
            TAG.focalLength,
            TAG.focalLengthIn35mmFilm,
            TAG.pixelXDimension,
            TAG.pixelYDimension,
          ].some((w) => w === t.tag),
      ),
    });
    expect(readExifWhitelist(jpeg)).toEqual(NO_EXIF);
  });

  it("reads a white-listed tag only from the Exif sub-IFD, not from a look-alike in the GPS or main IFD", () => {
    const jpeg = buildExifJpeg({
      ifd0: [
        // Same tag numbers, wrong place.
        {
          tag: TAG.focalLength,
          value: { type: "rational", values: [[9999, 1]] },
        },
        {
          tag: TAG.focalLengthIn35mmFilm,
          value: { type: "short", value: 999 },
        },
      ],
      gps: [
        { tag: TAG.pixelXDimension, value: { type: "long", value: 7777 } },
        { tag: TAG.pixelYDimension, value: { type: "long", value: 6666 } },
      ],
      exif: [{ tag: TAG.isoSpeed, value: { type: "short", value: 100 } }],
    });
    expect(readExifWhitelist(jpeg)).toEqual(NO_EXIF);
  });

  it("finds the Exif block behind a JFIF and an XMP segment", () => {
    const jpeg = buildExifJpeg(phoneSpec(), {
      leadingSegments: [JFIF_SEGMENT, XMP_SEGMENT],
    });
    expect(readExifWhitelist(jpeg)).toEqual(WHITE);
  });

  it("agrees with the product's own EXIF reader on the 35 mm focal length", () => {
    const jpeg = buildExifJpeg(phoneSpec());
    const size = { widthPx: 3024, heightPx: 4032 };
    const product = estimateFocalFromExif(jpeg, size);
    const ours = readExifWhitelist(jpeg);
    expect(product?.source).toBe("exif-35mm");
    expect(product?.fPx).toBeCloseTo(
      (ours.focalLengthIn35mmFilm! / 43.27) * Math.hypot(3024, 4032),
      6,
    );
  });

  it.each([
    ["an empty file", new Uint8Array(0)],
    [
      "a file that is not a JPEG",
      new TextEncoder().encode("GIF89a not a jpeg"),
    ],
    ["a JPEG with no EXIF", new Uint8Array([0xff, 0xd8, 0xff, 0xd9])],
    [
      "a JPEG that stops inside a segment",
      buildExifJpeg(phoneSpec()).slice(0, 40),
    ],
    [
      "a JPEG whose Exif pointer points outside the file",
      buildExifJpeg({
        ifd0: [],
        exif: [
          {
            tag: TAG.focalLengthIn35mmFilm,
            value: { type: "short", value: 24 },
          },
        ],
      }).slice(0, 30),
    ],
  ])("gives all nulls for %s", (_label, bytes) => {
    expect(readExifWhitelist(bytes)).toEqual(NO_EXIF);
  });

  it("gives null for values that make no sense (zero, negative-looking, absurd, zero denominator)", () => {
    const jpeg = buildExifJpeg({
      exif: [
        { tag: TAG.focalLength, value: { type: "rational", values: [[5, 0]] } },
        { tag: TAG.focalLengthIn35mmFilm, value: { type: "short", value: 0 } },
        {
          tag: TAG.pixelXDimension,
          value: { type: "long", value: 4_000_000_000 },
        },
        { tag: TAG.pixelYDimension, value: { type: "short", value: 0 } },
      ],
    });
    expect(readExifWhitelist(jpeg)).toEqual(NO_EXIF);
  });

  it("gives null for a tag that is not a single value, or a focal length no lens has", () => {
    const jpeg = buildExifJpeg({
      exif: [
        // Two rationals where one is expected.
        {
          tag: TAG.focalLength,
          value: {
            type: "rational",
            values: [
              [6765, 1000],
              [1, 1],
            ],
          },
        },
        {
          tag: TAG.focalLengthIn35mmFilm,
          value: { type: "short", value: 5000 },
        },
        { tag: TAG.pixelXDimension, value: { type: "ascii", value: "4032" } },
        { tag: TAG.pixelYDimension, value: { type: "short", value: 3024 } },
      ],
    });
    expect(readExifWhitelist(jpeg)).toEqual({
      ...NO_EXIF,
      pixelYDimension: 3024,
    });
    const tooLong = buildExifJpeg({
      exif: [
        {
          tag: TAG.focalLength,
          value: { type: "rational", values: [[5000, 1]] },
        },
      ],
    });
    expect(readExifWhitelist(tooLong).focalLengthMm).toBeNull();
  });

  it("does not read a tag that holds several values as if it held one", () => {
    const jpeg = buildExifJpeg({
      exif: [
        {
          tag: TAG.focalLengthIn35mmFilm,
          value: { type: "shorts", values: [24, 35] },
        },
        { tag: TAG.pixelXDimension, value: { type: "long", value: 4032 } },
      ],
    });
    expect(readExifWhitelist(jpeg)).toEqual({
      ...NO_EXIF,
      pixelXDimension: 4032,
    });
  });

  it("ignores an Exif block that starts after the image data does (or after the end of the image)", () => {
    const soi = [0xff, 0xd8];
    const exif = Array.from(exifSegment(phoneSpec()));
    const startOfScan = [0xff, 0xda, 0x00, 0x02];
    // A zero-length-looking segment after EOI, so a reader that fails to stop walks on to the Exif block.
    const endOfImage = [0xff, 0xd9, 0x00, 0x02];
    expect(readExifWhitelist(new Uint8Array([...soi, ...exif]))).toEqual(WHITE);
    expect(
      readExifWhitelist(new Uint8Array([...soi, ...startOfScan, ...exif])),
    ).toEqual(NO_EXIF);
    expect(
      readExifWhitelist(new Uint8Array([...soi, ...endOfImage, ...exif])),
    ).toEqual(NO_EXIF);
  });

  it("rejects a block whose byte-order mark is neither II nor MM, whichever order the rest is in", () => {
    for (const littleEndian of [true, false]) {
      const good = buildExifJpeg(phoneSpec(littleEndian));
      expect(readExifWhitelist(good)).toEqual(WHITE);
      const at = good.findIndex(
        (_, i) =>
          good[i] === 0x45 &&
          good[i + 1] === 0x78 &&
          good[i + 2] === 0x69 &&
          good[i + 3] === 0x66,
      );
      const bad = good.slice();
      bad[at + 6] = 0x58;
      bad[at + 7] = 0x58;
      expect(readExifWhitelist(bad)).toEqual(NO_EXIF);
    }
  });

  it("rejects a block whose TIFF header is not II or MM, or whose magic number is not 42", () => {
    const good = buildExifJpeg(phoneSpec());
    expect(readExifWhitelist(good)).toEqual(WHITE);
    // The TIFF header follows the six bytes "Exif" + two NULs.
    const at = good.findIndex(
      (_, i) =>
        good[i] === 0x45 &&
        good[i + 1] === 0x78 &&
        good[i + 2] === 0x69 &&
        good[i + 3] === 0x66,
    );
    expect(at).toBeGreaterThan(0);
    const tiff = at + 6;
    const badOrder = good.slice();
    badOrder[tiff] = 0x58;
    badOrder[tiff + 1] = 0x58;
    expect(readExifWhitelist(badOrder)).toEqual(NO_EXIF);
    const badMagic = good.slice();
    badMagic[tiff + 2] = 43; // little-endian: the magic is the next two bytes
    expect(readExifWhitelist(badMagic)).toEqual(NO_EXIF);
  });

  it("does not throw and stays white-listed on 400 randomly damaged copies of a real-looking file", () => {
    let seed = 12345;
    const next = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    const original = buildExifJpeg(phoneSpec());
    for (let i = 0; i < 400; i++) {
      const bytes = original.slice();
      const flips = 1 + Math.floor(next() * 6);
      for (let k = 0; k < flips; k++) {
        bytes[Math.floor(next() * bytes.length)] = Math.floor(next() * 256);
      }
      const cut =
        next() < 0.3 ? Math.floor(next() * bytes.length) : bytes.length;
      const out = readExifWhitelist(bytes.slice(0, cut));
      expect(Object.keys(out).sort()).toEqual([...EXIF_WHITELIST_KEYS].sort());
      for (const v of Object.values(out)) {
        expect(v === null || (Number.isFinite(v) && v > 0)).toBe(true);
      }
    }
  });
});

describe("pickExifWhitelist", () => {
  it("drops every key that is not white-listed, however it got there", () => {
    const wide = {
      ...WHITE,
      gpsLatitude: 25.03,
      dateTimeOriginal: "2031:08:17 04:55:31",
      bodySerialNumber: "SN-QX7731-ZK",
      make: "Zetaphone Corp",
    };
    const out = pickExifWhitelist(wide);
    expect(out).toEqual(WHITE);
    expect(Object.keys(out).sort()).toEqual([...EXIF_WHITELIST_KEYS].sort());
    expect(JSON.stringify(out)).not.toMatch(/25\.03|2031|SN-QX|Zeta/);
  });

  it("turns anything that is not a positive finite number into null", () => {
    expect(
      pickExifWhitelist({
        focalLengthMm: 0,
        focalLengthIn35mmFilm: 0,
        pixelXDimension: "6.7",
        pixelYDimension: 0,
      }),
    ).toEqual(NO_EXIF);
    expect(
      pickExifWhitelist({
        focalLengthMm: "6.7",
        focalLengthIn35mmFilm: -24,
        pixelXDimension: NaN,
        pixelYDimension: Infinity,
      }),
    ).toEqual(NO_EXIF);
    expect(pickExifWhitelist(null)).toEqual(NO_EXIF);
    expect(pickExifWhitelist("text")).toEqual(NO_EXIF);
    expect(pickExifWhitelist(undefined)).toEqual(NO_EXIF);
  });
});
