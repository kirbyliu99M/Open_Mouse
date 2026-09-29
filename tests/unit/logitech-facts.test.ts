import { describe, expect, it } from "vitest";
import {
  HAND_COMPATIBILITY,
  SHAPES,
} from "../../src/lib/contracts/descriptors";
import { checkConsistency } from "../../src/server/catalogue/consistency";
import { slugify } from "../../src/server/catalogue/seed-rows";
import facts from "../../src/db/seed/logitech-facts.json";
import seed from "../../src/db/seed/logitech.json";

/**
 * `logitech-facts.json` (G9a) holds three catalogue facts per mouse, read from
 * Logitech's own product pages only: which hand it is for, its shape class, and
 * its form factor. A field the page does not state is null, with the reason: no
 * inference, and shape is only filled when the page uses the word. This test
 * checks the file is well formed and internally consistent. It cannot re-read
 * the pages (no network in tests); every excerpt was cut out of the downloaded
 * page between two exact phrases when the file was made, on `retrievedAt`.
 *
 * The form factor vocabulary is the `FORM_FACTORS` contract added by C1
 * (`src/lib/contracts/descriptors.ts`); it is repeated here until C1 is on
 * `main`, and should then be imported instead.
 */
const FORM_FACTORS = ["standard", "vertical", "trackball"] as const;

const FIELDS = ["handCompatibility", "shape", "formFactor"] as const;
type FieldName = (typeof FIELDS)[number];

const ENUMS: Record<FieldName, readonly string[]> = {
  handCompatibility: HAND_COMPATIBILITY,
  shape: SHAPES,
  formFactor: FORM_FACTORS,
};

interface Field {
  value: string | null;
  source?: string;
  excerpt?: string;
  location?: string;
  reason: string;
}
interface Entry {
  handCompatibility: Field;
  shape: Field;
  formFactor: Field;
  retrievedAt: string;
}

const entries = facts as unknown as Record<string, Entry>;
const seedSlugs = seed.map((r) => slugify(r.brand, r.model));
const seedUrlBySlug = new Map(
  seed.map((r) => [slugify(r.brand, r.model), r.sourceUrl] as const),
);
const slugs = Object.keys(entries);

describe("logitech-facts.json — coverage", () => {
  it("has an entry for exactly the mice in logitech.json, keyed by their slug", () => {
    expect([...slugs].sort()).toEqual([...seedSlugs].sort());
  });

  it.each(slugs)(
    "%s has exactly the three fields and a retrieval date",
    (slug) => {
      const entry = entries[slug]!;
      expect(Object.keys(entry).sort()).toEqual(
        [...FIELDS, "retrievedAt"].sort(),
      );
      expect(entry.retrievedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(entry.retrievedAt))).toBe(false);
    },
  );
});

describe("logitech-facts.json — every value is backed", () => {
  const cases = slugs.flatMap((slug) =>
    FIELDS.map((name) => [slug, name] as const),
  );

  it.each(cases)("%s / %s", (slug, name) => {
    const field = entries[slug]![name];
    expect(Object.keys(field).sort()).toEqual(
      expect.arrayContaining(["reason", "value"]),
    );
    // A reason for every field, null or not: why this value, or why none.
    expect(field.reason.trim().length).toBeGreaterThan(20);

    if (field.value === null) {
      // Optional evidence for a null (a page hint that was not enough) still
      // has to be complete when present.
      if (field.source !== undefined || field.excerpt !== undefined) {
        expect(field.source).toBeTypeOf("string");
        expect(field.excerpt?.trim().length).toBeGreaterThan(0);
      }
      return;
    }

    expect(ENUMS[name]).toContain(field.value);
    // Source: the page this mouse's seed row was read from, on Logitech's own
    // domains, over https.
    expect(field.source).toBe(seedUrlBySlug.get(slug));
    const url = new URL(field.source!);
    expect(url.protocol).toBe("https:");
    expect(url.hostname).toMatch(/^www\.logitech(g)?\.com$/);
    // Excerpt: real text, short enough to be a quotation, not a paraphrase of
    // the page's marketing copy.
    expect(field.excerpt!.trim().length).toBeGreaterThan(8);
    expect(field.excerpt!.length).toBeLessThanOrEqual(240);
    expect(field.location!.trim().length).toBeGreaterThan(0);
  });

  it("no field claims a value outside its contract enum", () => {
    for (const slug of slugs) {
      for (const name of FIELDS) {
        const { value } = entries[slug]![name];
        if (value !== null)
          expect(ENUMS[name], `${slug} ${name}`).toContain(value);
      }
    }
  });
});

describe("logitech-facts.json — the value matches what its excerpt says", () => {
  // A cheap guard against a value pasted onto the wrong excerpt: each value
  // needs its own key word in the quotation.
  const KEYWORD: Record<string, RegExp> = {
    right: /right/i,
    left: /left/i,
    ambidextrous:
      /ambidextrous|both (?:left|right)|right or left|left or right|either hand/i,
    symmetrical: /symmetr/i,
    ergonomic: /ergonomic/i,
    hybrid: /hybrid/i,
    vertical: /vertical/i,
    trackball: /trackball/i,
    standard: /standard/i,
  };

  it("holds for every filled field", () => {
    const mismatches: string[] = [];
    for (const slug of slugs) {
      for (const name of FIELDS) {
        const { value, excerpt } = entries[slug]![name];
        if (value === null) continue;
        if (!KEYWORD[value]!.test(excerpt!)) {
          mismatches.push(`${slug} ${name}=${value}: "${excerpt}"`);
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("an asymmetrical shape is never recorded as symmetrical", () => {
    for (const slug of slugs) {
      const { value, excerpt } = entries[slug]!.shape;
      if (value === "symmetrical") expect(excerpt).not.toMatch(/asymmetric/i);
    }
  });
});

describe("logitech-facts.json — combinations that break the catalogue rules", () => {
  it.each(slugs)(
    "%s breaks no rubric §2 rule (the same rules as the mice CHECKs)",
    (slug) => {
      const entry = entries[slug]!;
      const violations = checkConsistency({
        shape: entry.shape.value as (typeof SHAPES)[number] | null,
        handCompatibility: entry.handCompatibility.value as
          (typeof HAND_COMPATIBILITY)[number] | null,
        thumbRest: null,
        ringFingerRest: null,
      });
      expect(violations).toEqual([]);
    },
  );

  it("no ambidextrous mouse is ergonomic, and no ergonomic mouse is ambidextrous (rubric §2: ergonomic shells are handed)", () => {
    for (const slug of slugs) {
      const { shape, handCompatibility } = entries[slug]!;
      expect(
        shape.value === "ergonomic" &&
          handCompatibility.value === "ambidextrous",
        slug,
      ).toBe(false);
    }
  });

  it("a mouse recorded as ambidextrous has its shape either unstated or symmetrical", () => {
    for (const slug of slugs) {
      const { shape, handCompatibility } = entries[slug]!;
      if (handCompatibility.value === "ambidextrous") {
        expect([null, "symmetrical"], slug).toContain(shape.value);
      }
    }
  });

  it("the `mice_ambidextrous_is_symmetrical` CHECK would accept every row (a null shape passes: absence is not a contradiction)", () => {
    // SQL: hand_compatibility <> 'ambidextrous' OR shape = 'symmetrical'; the
    // check passes when the expression is true or NULL, fails only when false.
    for (const slug of slugs) {
      const { shape, handCompatibility } = entries[slug]!;
      const hand = handCompatibility.value;
      const s = shape.value;
      const passes =
        hand === null ||
        hand !== "ambidextrous" ||
        s === null ||
        s === "symmetrical";
      expect(passes, slug).toBe(true);
    }
  });
});

describe("logitech-facts.json — form factor agrees with the catalogue's own dimensions", () => {
  // Height / length above 0.55 is a vertical mouse (fit engine, exclusions).
  // The page-stated vertical mice must be exactly the ones the engine already
  // treats as vertical, so G9b's new exclusion does not disagree with it.
  const VERTICAL_RATIO = 0.55;
  it("every page-stated vertical mouse is above the vertical ratio, and no other mouse is", () => {
    const stated = slugs.filter(
      (s) => entries[s]!.formFactor.value === "vertical",
    );
    const byRatio = seed
      .filter((r) => r.heightMm / r.lengthMm > VERTICAL_RATIO)
      .map((r) => slugify(r.brand, r.model));
    expect([...stated].sort()).toEqual([...byRatio].sort());
  });
});
