import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { httpsUrlSchema } from "../../src/lib/contracts/commerce";
import {
  mediaForSlug,
  parseMouseMedia,
} from "../../src/lib/results/mouseMedia";
import bundled from "../../src/data/mouse-media.json";
import catalogue from "../../src/db/seed/catalogue.json";

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

  it("is a valid file with one entry per catalogue mouse", () => {
    expect(Object.keys(parseMouseMedia(bundled))).toHaveLength(406);
    expect(entries).toHaveLength(406);
    expect(slugs).toHaveLength(406);
  });

  it("matches the catalogue slugs both ways", () => {
    const media = new Set(Object.keys(bundled));
    const cat = new Set(slugs);
    expect(slugs.filter((s) => !media.has(s))).toEqual([]);
    expect(Object.keys(bundled).filter((s) => !cat.has(s))).toEqual([]);
  });

  it("has only https official links", () => {
    const bad = entries.filter(
      ([, v]) => !httpsUrlSchema.safeParse(v.officialUrl).success,
    );
    expect(bad.map(([s]) => s)).toEqual([]);
  });

  it("has 402 product links and 4 brand links", () => {
    const count = (k: string) =>
      entries.filter(([, v]) => v.officialKind === k).length;
    expect(count("product")).toBe(402);
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

  it("has no photo for exactly the two mice whose maker lists none", () => {
    const nulls = entries.filter(([, v]) => v.image === null);
    expect(nulls.map(([slug]) => slug).sort()).toEqual([
      "fantech-yari-e",
      "g-wolves-vuk-medium",
    ]);
    expect(entries.length - nulls.length).toBe(404);
  });
});
