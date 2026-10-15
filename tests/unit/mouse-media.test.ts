import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { httpsUrlSchema } from "../../src/lib/contracts/commerce";
import {
  LARGE_PHOTO_HEIGHT,
  LARGE_PHOTO_WIDTH,
  largePhotoPath,
  mediaForSlug,
  parseMouseMedia,
} from "../../src/lib/results/mouseMedia";
import bundled from "../../src/data/mouse-media.json";
import catalogue from "../../src/db/seed/catalogue.json";
import descriptors from "../../src/db/seed/logitech-descriptors.json";
import facts from "../../src/db/seed/logitech-facts.json";
import logitech from "../../src/db/seed/logitech.json";
import type { CatalogueEntry } from "../../src/server/catalogue/candidate-map";
import {
  buildSeedRows,
  type FactsFile,
} from "../../src/server/catalogue/catalogue-rows";
import type {
  DescriptorRecord,
  SpecRecord,
} from "../../src/server/catalogue/seed-rows";

const firstPartyAdditions = [
  "logitech-g903-hero",
  "logitech-mx-anywhere-3s",
  "logitech-mx-ergo-s",
  "logitech-mx-master-3s",
  "logitech-mx-master-4",
  "logitech-mx-vertical",
];

const VALID = {
  "logitech-g-pro-x-superlight-2": {
    officialUrl: "https://www.logitechg.com/en-us/products/gaming-mice.html",
    officialKind: "product",
    image: "/images/mice/logitech-g-pro-x-superlight-2.webp",
  },
  "some-lineup-mouse": {
    officialUrl: "https://example.com/lineup",
    officialKind: "brand",
    image: null,
  },
};

describe("parseMouseMedia", () => {
  it("keeps a valid file as is", () => {
    expect(parseMouseMedia(VALID)).toEqual(VALID);
  });

  it.each([
    ["null", null],
    ["an array", []],
    ["a string", "x"],
    [
      "an http url",
      {
        a: {
          officialUrl: "http://x.test/",
          officialKind: "product",
          image: null,
        },
      },
    ],
    [
      "an unknown kind",
      {
        a: {
          officialUrl: "https://x.test/",
          officialKind: "shop",
          image: null,
        },
      },
    ],
    [
      "an image that is not a site path",
      {
        a: {
          officialUrl: "https://x.test/",
          officialKind: "product",
          image: "https://x.test/a.webp",
        },
      },
    ],
    [
      "a bad slug",
      {
        "Bad Slug": {
          officialUrl: "https://x.test/",
          officialKind: "product",
          image: null,
        },
      },
    ],
    ["a missing field", { a: { officialUrl: "https://x.test/" } }],
    ...[
      "//host.example/x.webp",
      "/../x.webp",
      "/images/mice/../x.webp",
      "/images/mice/a.png",
      "/images/mice/A.webp",
      "/images/mice/a b.webp",
      "/images/other/a.webp",
      "/images/mice/sub/a.webp",
      "\\images\\mice\\a.webp",
      "/images/mice/a.webp?x=1",
    ].map((image): [string, unknown] => [
      `the image ${image}`,
      {
        a: { officialUrl: "https://x.test/", officialKind: "product", image },
      },
    ]),
  ] as [string, unknown][])(
    "returns {} for %s, without throwing",
    (_label, raw) => {
      expect(parseMouseMedia(raw)).toEqual({});
    },
  );

  it("is all-or-nothing: one bad entry voids the file", () => {
    expect(parseMouseMedia({ ...VALID, bad: { officialUrl: "nope" } })).toEqual(
      {},
    );
  });
});

describe("mediaForSlug", () => {
  it("returns the entry for a known slug", () => {
    expect(mediaForSlug(VALID, "some-lineup-mouse")).toEqual(
      VALID["some-lineup-mouse"],
    );
  });

  it("returns null for a missing slug", () => {
    expect(mediaForSlug(VALID, "not-there")).toBeNull();
  });

  it("returns null for any slug when the file is invalid", () => {
    expect(mediaForSlug("garbage", "some-lineup-mouse")).toBeNull();
  });

  it.each(["constructor", "__proto__", "toString", "hasOwnProperty"])(
    "reads nothing for the prototype-like slug %s",
    (slug) => {
      expect(mediaForSlug(VALID, slug)).toBeNull();
      expect(mediaForSlug({}, slug)).toBeNull();
    },
  );
});

describe("the bundled mouse-media.json", () => {
  const entries = Object.entries(bundled);
  const slugs = catalogue.map((e) => e.slug);

  it("is a valid file with catalogue and photographed first-party mice", () => {
    expect(Object.keys(parseMouseMedia(bundled))).toHaveLength(412);
    expect(entries).toHaveLength(412);
    expect(slugs).toHaveLength(406);
  });

  it("covers the catalogue and only the six first-party additions", () => {
    const media = new Set(Object.keys(bundled));
    const cat = new Set(slugs);
    expect(slugs.filter((s) => !media.has(s))).toEqual([]);
    expect(
      Object.keys(bundled)
        .filter((s) => !cat.has(s))
        .sort(),
    ).toEqual(firstPartyAdditions);
    for (const slug of firstPartyAdditions) {
      expect(bundled[slug as keyof typeof bundled].image).toBe(
        `/images/mice/${slug}.webp`,
      );
    }
  });

  it("gives every listed seed mouse except unresolved VUK Medium a photo", () => {
    const media = bundled as Record<string, { image: string | null }>;
    const built = buildSeedRows(
      logitech as SpecRecord[],
      descriptors as DescriptorRecord[],
      {
        entries: catalogue as CatalogueEntry[],
        facts: facts as FactsFile,
        imageExists: (slug) => media[slug]?.image != null,
      },
    );
    const rows = [...built.withDescriptors, ...built.withoutDescriptors];
    expect(
      rows
        .filter((row) => row.listed && row.imagePath === null)
        .map((row) => row.slug),
    ).toEqual(["g-wolves-vuk-medium"]);
  });

  it("has only https official links", () => {
    const bad = entries.filter(
      ([, v]) => !httpsUrlSchema.safeParse(v.officialUrl).success,
    );
    expect(bad.map(([s]) => s)).toEqual([]);
  });

  it("has 408 product links and 4 brand links", () => {
    const count = (k: string) =>
      entries.filter(([, v]) => v.officialKind === k).length;
    expect(count("product")).toBe(408);
    expect(count("brand")).toBe(4);
  });

  it("points every image at a real WebP of at most 30 KB, 10 MB in total", () => {
    let total = 0;
    const problems: string[] = [];
    for (const [slug, v] of entries) {
      if (v.image === null) continue;
      expect(v.image).toBe(`/images/mice/${slug}.webp`);
      const file = join(process.cwd(), "public", v.image);
      if (!existsSync(file)) {
        problems.push(`${slug}: missing file`);
        continue;
      }
      const bytes = readFileSync(file);
      total += statSync(file).size;
      const riff = bytes.subarray(0, 4).toString("latin1");
      const webp = bytes.subarray(8, 12).toString("latin1");
      if (riff !== "RIFF" || webp !== "WEBP")
        problems.push(`${slug}: not WebP`);
      if (bytes.length > 30 * 1024) problems.push(`${slug}: over 30 KB`);
    }
    expect(problems).toEqual([]);
    expect(total).toBeLessThanOrEqual(10 * 1024 * 1024);
  });

  it("keeps only VUK Medium without a verified photo", () => {
    const nulls = entries.filter(([, v]) => v.image === null);
    expect(nulls.map(([slug]) => slug)).toEqual(["g-wolves-vuk-medium"]);
    expect(entries.length - nulls.length).toBe(411);
  });
});

describe("largePhotoPath", () => {
  it("maps a small photo path to its enlarged file", () => {
    expect(
      largePhotoPath("/images/mice/logitech-g-pro-x-superlight-2.webp"),
    ).toBe("/images/mice/l/logitech-g-pro-x-superlight-2.webp");
  });

  it("maps every bundled image, and only into /images/mice/l/", () => {
    for (const [slug, v] of Object.entries(bundled)) {
      if (v.image === null) continue;
      expect(largePhotoPath(v.image)).toBe(`/images/mice/l/${slug}.webp`);
    }
  });

  it.each([
    "/images/mice/l/a.webp",
    "/images/mice/a.png",
    "/images/mice/A.webp",
    "/images/mice/sub/a.webp",
    "/images/mice/../a.webp",
    "/images/mice/a.webp?x=1",
    "/images/other/a.webp",
    "https://x.test/images/mice/a.webp",
    "",
  ])("returns %j unchanged", (input) => {
    expect(largePhotoPath(input)).toBe(input);
  });

  it("is idempotent", () => {
    const once = largePhotoPath("/images/mice/a.webp");
    expect(largePhotoPath(once)).toBe(once);
  });
});

/** Canvas size from a WebP header: lossy with alpha is VP8X, plain lossy VP8. */
function webpSize(bytes: Buffer): { width: number; height: number } {
  const fourcc = bytes.subarray(12, 16).toString("latin1");
  if (fourcc === "VP8X") {
    return {
      width: 1 + bytes.readUIntLE(24, 3),
      height: 1 + bytes.readUIntLE(27, 3),
    };
  }
  if (fourcc === "VP8 ") {
    return {
      width: bytes.readUInt16LE(26) & 0x3fff,
      height: bytes.readUInt16LE(28) & 0x3fff,
    };
  }
  throw new Error(`unsupported WebP chunk ${fourcc}`);
}

describe("the enlarged photos (public/images/mice/l)", () => {
  const dir = join(process.cwd(), "public", "images", "mice", "l");
  const MAX_FILE = 75 * 1024;
  const MAX_TOTAL = 30 * 1024 * 1024;
  const wanted = Object.entries(bundled)
    .filter(([, v]) => v.image !== null)
    .map(([slug]) => `${slug}.webp`)
    .sort();
  const have = existsSync(dir) ? readdirSync(dir).sort() : [];

  it("has a file for every non-null image and no other file", () => {
    expect(wanted.filter((f) => !have.includes(f))).toEqual([]);
    expect(have.filter((f) => !wanted.includes(f))).toEqual([]);
    expect(have).toHaveLength(411);
  });

  it("keeps each file at most 75 KB and the total at most 30 MB", () => {
    let total = 0;
    const over: string[] = [];
    for (const f of have) {
      const size = statSync(join(dir, f)).size;
      total += size;
      if (size > MAX_FILE) over.push(`${f}: ${size}`);
    }
    expect(over).toEqual([]);
    expect(total).toBeLessThanOrEqual(MAX_TOTAL);
  });

  it("holds real WebP files whose header size equals the constants", () => {
    const wrong: string[] = [];
    for (const f of have) {
      const bytes = readFileSync(join(dir, f));
      const riff = bytes.subarray(0, 4).toString("latin1");
      const webp = bytes.subarray(8, 12).toString("latin1");
      if (riff !== "RIFF" || webp !== "WEBP") {
        wrong.push(`${f}: not WebP`);
        continue;
      }
      const { width, height } = webpSize(bytes);
      if (width !== LARGE_PHOTO_WIDTH || height !== LARGE_PHOTO_HEIGHT)
        wrong.push(`${f}: ${width}x${height}`);
    }
    expect(wrong).toEqual([]);
  });

  it("has the same aspect ratio as the 480 px photos (within one pixel of width)", () => {
    const small = readFileSync(
      join(process.cwd(), "public", "images", "mice", wanted[0]),
    );
    const { width, height } = webpSize(small);
    expect(
      Math.abs((width * LARGE_PHOTO_HEIGHT) / height - LARGE_PHOTO_WIDTH),
    ).toBeLessThanOrEqual(1);
  });
});
