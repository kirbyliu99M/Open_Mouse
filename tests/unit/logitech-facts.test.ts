import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  FORM_FACTORS,
  HAND_COMPATIBILITY,
  SHAPES,
} from "../../src/lib/contracts/descriptors";
import { checkConsistency } from "../../src/server/catalogue/consistency";
import { slugify } from "../../src/server/catalogue/seed-rows";
import { VERTICAL_FORM_FACTOR_RATIO } from "../../src/server/fit/coefficients";
import facts from "../../src/db/seed/logitech-facts.json";
import seed from "../../src/db/seed/logitech.json";
import { migratedDatabase } from "./fixtures/pglite";

/**
 * `logitech-facts.json` (G9a) holds three catalogue facts per mouse, read from
 * Logitech's own product pages only: which hand it is for, its shape class, and
 * its form factor. A field the page does not state is null, with the reason: no
 * inference, and shape is only filled when the page uses the word. This test
 * checks the file is well formed and internally consistent. It cannot re-read
 * the pages (no network in tests); every excerpt was cut out of the downloaded
 * page between two exact phrases when the file was made, on `retrievedAt`.
 */
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
const cases = slugs.flatMap((slug) =>
  FIELDS.map((name) => [slug, name] as const),
);

const hasEvidence = (field: Field): boolean =>
  field.source !== undefined ||
  field.excerpt !== undefined ||
  field.location !== undefined;

/**
 * Fields that are null on purpose: the page said something about them, but not
 * enough to fill the value (or contradicted itself), so the file keeps the
 * evidence and leaves the value empty. These are the decisions G9b has to
 * make. Turning any of them into a value, or dropping its evidence, means
 * editing this list in the same change, so the decision leaves a trace in the
 * diff. The rule is enforced below: the list must equal exactly the set of
 * fields that are null and still carry page evidence ("the list is exactly the
 * set of null fields that carry page evidence"), so an entry that is missing,
 * stale or misspelled fails that test. It is a different set from the ⚠ list in
 * the PR description, which also marks filled values Kirby is to spot-check.
 */
const DELIBERATE_NULLS: ReadonlyArray<
  readonly [slug: string, field: FieldName, why: string]
> = [
  [
    "logitech-m650",
    "handCompatibility",
    "sells a separate M650 L left-handed model; never says this one is right-handed",
  ],
  [
    "logitech-m750",
    "handCompatibility",
    "FAQ says symmetrical and ambidextrous, then recommends the left-handed version",
  ],
  [
    "logitech-lift-vertical",
    "handCompatibility",
    "page also sells a left-handed Lift; does not say which hand this listing is",
  ],
  [
    "logitech-g502-x-lightspeed",
    "shape",
    "'ERGONOMIC COMFORT' is about comfort, not the shape class",
  ],
  [
    "logitech-g502-x-plus",
    "shape",
    "'ERGONOMIC COMFORT' is about comfort, not the shape class",
  ],
  [
    "logitech-g903-hero",
    "shape",
    "page says ambidextrous but never symmetric; symmetrical would be derived",
  ],
  [
    "logitech-g403-hero",
    "shape",
    "'contoured' is not a shape class in the contract",
  ],
];

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
  it.each(cases)("%s / %s", (slug, name) => {
    const field = entries[slug]![name];
    expect(Object.keys(field).sort()).toEqual(
      expect.arrayContaining(["reason", "value"]),
    );
    // A reason for every field, null or not: why this value, or why none.
    expect(field.reason.trim().length).toBeGreaterThan(20);

    if (field.value !== null) expect(ENUMS[name]).toContain(field.value);

    // A plain null (the page says nothing) carries no evidence at all. A null
    // that does carry some (a page hint that was not enough) is held to the
    // same standard as a value: complete, from Logitech's own page for this
    // mouse, and short enough to be a quotation.
    if (field.value === null && !hasEvidence(field)) return;

    // Source: the page this mouse's seed row was read from, on Logitech's own
    // domains, over https.
    expect(field.source).toBe(seedUrlBySlug.get(slug));
    const url = new URL(field.source!);
    expect(url.protocol).toBe("https:");
    expect(url.hostname).toMatch(/^www\.logitech(g)?\.com$/);
    // Excerpt: real text, short enough to be a quotation, not a paraphrase of
    // the page's marketing copy.
    expect(field.excerpt).toBeTypeOf("string");
    expect(field.excerpt!.trim().length).toBeGreaterThan(8);
    expect(field.excerpt!.length).toBeLessThanOrEqual(240);
    expect(field.location).toBeTypeOf("string");
    expect(field.location!.trim().length).toBeGreaterThan(0);
  });
});

describe("logitech-facts.json — the deliberate nulls stay null until G9b decides", () => {
  it.each(DELIBERATE_NULLS)("%s / %s is null: %s", (slug, name) => {
    // `?.` so a typo'd slug fails here (undefined is not null) instead of
    // silently pinning nothing.
    expect(entries[slug]?.[name].value).toBeNull();
    expect(hasEvidence(entries[slug]![name])).toBe(true);
  });

  it("the list is exactly the set of null fields that carry page evidence", () => {
    const carrying = cases
      .filter(([slug, name]) => {
        const field = entries[slug]![name];
        return field.value === null && hasEvidence(field);
      })
      .map(([slug, name]) => `${slug} / ${name}`)
      .sort();
    const pinned = DELIBERATE_NULLS.map(
      ([slug, name]) => `${slug} / ${name}`,
    ).sort();
    expect(carrying).toEqual(pinned);
  });
});

describe("logitech-facts.json — the M750 decision (Kirby, 2026-09-30)", () => {
  // Kirby decided on 2026-09-30 that the M750's shape is recorded like the
  // M550's: symmetrical, on the strength of the same FAQ sentence ("its
  // physical shape is perfectly symmetrical"). Its hand stays null, because
  // that answer goes on to recommend the left-handed dedicated version.
  // G9b infers neither value: the rubric step "ambidextrous implies
  // symmetrical" is still to be verified and is not applied here, and the rule
  // that excludes left-handed users stays as it is (it does not become "exclude
  // when the page says right-handed").
  const m750 = entries["logitech-m750"]!;
  const m550 = entries["logitech-m550"]!;

  it("records the shape as symmetrical and leaves the hand null", () => {
    expect(m750.shape.value).toBe("symmetrical");
    expect(m750.handCompatibility.value).toBeNull();
  });

  it("the hand keeps its page evidence, so it stays on the deliberate-null list", () => {
    expect(hasEvidence(m750.handCompatibility)).toBe(true);
    expect(
      DELIBERATE_NULLS.some(
        ([slug, name]) =>
          slug === "logitech-m750" && name === "handCompatibility",
      ),
    ).toBe(true);
    expect(
      DELIBERATE_NULLS.some(
        ([slug, name]) => slug === "logitech-m750" && name === "shape",
      ),
    ).toBe(false);
  });

  it("the shape excerpt is a verbatim piece of the FAQ answer recorded for the hand", () => {
    expect(m750.shape.excerpt).toContain(
      "its physical shape is perfectly symmetrical",
    );
    expect(m750.handCompatibility.excerpt).toContain(m750.shape.excerpt!);
    expect(m750.shape.source).toBe(m750.handCompatibility.source);
    expect(m750.shape.location).toBe(m750.handCompatibility.location);
  });

  it("the reasons say what the decision rests on", () => {
    expect(m750.shape.reason).toMatch(/M550/);
    expect(m750.shape.reason).toMatch(/Kirby/);
    expect(m750.shape.reason).toMatch(/2026-09-30/);
    expect(m750.handCompatibility.reason).toMatch(/2026-09-30/);
    expect(m750.handCompatibility.reason).toMatch(/left-handed/);
    // The M550 sentence it follows is filled the same way.
    expect(m550.shape.value).toBe("symmetrical");
  });
});

describe("logitech-facts.json — the value matches what its excerpt says", () => {
  // A cheap guard against a value pasted onto the wrong excerpt: each value
  // needs its own key word in the quotation.
  //
  // Hand is stricter, because an ambidextrous mouse's excerpt naturally names
  // both hands ("left- and right-handed", "right or left hand") and a loose
  // /right/ would accept it as a right-handed mouse. A single-handed value
  // needs "<side>-hand(ed)" and must not mention the other side, both, either
  // or ambidextrous.
  const LEFT = /\bleft\b/i;
  const RIGHT = /\bright\b/i;
  const EITHER = /\b(?:both|either)\b|ambidextrous/i;
  const matches =
    (re: RegExp) =>
    (excerpt: string): boolean =>
      re.test(excerpt);

  const KEYWORD: Record<string, (excerpt: string) => boolean> = {
    right: (t) => /right[- ]hand/i.test(t) && !LEFT.test(t) && !EITHER.test(t),
    left: (t) => /left[- ]hand/i.test(t) && !RIGHT.test(t) && !EITHER.test(t),
    ambidextrous: matches(
      /ambidextrous|both (?:left|right)|right or left|left or right|either hand/i,
    ),
    symmetrical: matches(/symmetr/i),
    ergonomic: matches(/ergonomic/i),
    hybrid: matches(/hybrid/i),
    vertical: matches(/vertical/i),
    trackball: matches(/trackball/i),
    standard: matches(/standard/i),
  };

  it("holds for every filled field", () => {
    const mismatches: string[] = [];
    for (const slug of slugs) {
      for (const name of FIELDS) {
        const { value, excerpt } = entries[slug]![name];
        if (value === null) continue;
        if (!KEYWORD[value]!(excerpt!)) {
          mismatches.push(`${slug} ${name}=${value}: "${excerpt}"`);
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("an excerpt that names both hands (or says both, either, ambidextrous) only ever supports ambidextrous", () => {
    const wrong: string[] = [];
    for (const slug of slugs) {
      const { value, excerpt } = entries[slug]!.handCompatibility;
      if (value === null || value === "ambidextrous") continue;
      if (
        (LEFT.test(excerpt!) && RIGHT.test(excerpt!)) ||
        EITHER.test(excerpt!)
      )
        wrong.push(`${slug} handCompatibility=${value}: "${excerpt}"`);
    }
    expect(wrong).toEqual([]);
  });

  it("an asymmetrical shape is never recorded as symmetrical", () => {
    for (const slug of slugs) {
      const { value, excerpt } = entries[slug]!.shape;
      if (value === "symmetrical") expect(excerpt).not.toMatch(/asymmetric/i);
    }
  });

  it("no quotation is reused across different mice (one mouse may reuse its own line for two fields)", () => {
    const norm = (text: string) =>
      text.toLowerCase().replace(/\s+/g, " ").trim();
    const uses = new Map<string, Array<{ slug: string; filled: boolean }>>();
    for (const slug of slugs) {
      for (const name of FIELDS) {
        const { value, excerpt } = entries[slug]![name];
        if (excerpt === undefined) continue;
        const key = norm(excerpt);
        uses.set(key, [
          ...(uses.get(key) ?? []),
          { slug, filled: value !== null },
        ]);
      }
    }
    // A quotation shared by two mice is a copy-paste unless every use is a
    // null (two listings of one product family, e.g. the G502 X headline).
    const shared = [...uses]
      .filter(
        ([, list]) =>
          new Set(list.map((use) => use.slug)).size > 1 &&
          list.some((use) => use.filled),
      )
      .map(
        ([key, list]) =>
          `${[...new Set(list.map((u) => u.slug))].join(", ")}: "${key}"`,
      );
    expect(shared).toEqual([]);
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
});

describe("logitech-facts.json — the real `mice` table accepts these combinations", () => {
  // The `mice_ambidextrous_is_symmetrical` CHECK is exercised in a real
  // Postgres (PGlite) with the repo's own migrations, not restated in JS:
  // SQL treats a NULL operand as "not false", so an unstated shape must pass.
  let pg: PGlite | undefined;
  let n = 0;

  // One in-process Postgres for this block, with every migration applied
  // (~2.5 s idle, longer under load, see #61). The timeouts cover that setup,
  // not the logic.
  beforeAll(async () => {
    ({ pg } = await migratedDatabase());
  }, 30_000);
  afterAll(async () => {
    // If the setup itself failed there is nothing to close, and a TypeError
    // here would hide the real error.
    await pg?.close();
  });

  const insertMouse = (
    hand: string | null,
    shape: string | null,
  ): Promise<unknown> => {
    n += 1;
    return pg!.query(
      `INSERT INTO mice (slug, brand, model, length_mm, width_mm, height_mm,
         size, hand_compatibility, shape, source_url, spec_retrieved_at)
       VALUES ($1, 'Logitech', $1, 100, 60, 40, 'medium', $2, $3,
         'https://www.logitech.com/', now())`,
      [`facts-check-${n}`, hand, shape],
    );
  };

  it("passes (ambidextrous, no shape) and (ambidextrous, symmetrical); blocks (ambidextrous, ergonomic) and (ambidextrous, hybrid)", async () => {
    await expect(insertMouse("ambidextrous", null)).resolves.toBeDefined();
    await expect(
      insertMouse("ambidextrous", "symmetrical"),
    ).resolves.toBeDefined();
    await expect(insertMouse("ambidextrous", "ergonomic")).rejects.toThrow(
      /mice_ambidextrous_is_symmetrical/,
    );
    await expect(insertMouse("ambidextrous", "hybrid")).rejects.toThrow(
      /mice_ambidextrous_is_symmetrical/,
    );
    // Handed and unstated-hand mice are not restricted by this CHECK.
    await expect(insertMouse("right", "ergonomic")).resolves.toBeDefined();
    await expect(insertMouse(null, "ergonomic")).resolves.toBeDefined();
  }, 30_000);

  it("accepts every (hand, shape) pair in the file, as a row of the real table", async () => {
    for (const slug of slugs) {
      const { handCompatibility, shape } = entries[slug]!;
      await expect(
        insertMouse(handCompatibility.value, shape.value),
        slug,
      ).resolves.toBeDefined();
    }
  }, 30_000);
});

describe("logitech-facts.json — form factor agrees with the catalogue's own dimensions", () => {
  // Height / length above the engine's vertical ratio is a vertical mouse
  // (fit engine, exclusions). The page-stated vertical mice must be exactly
  // the ones the engine already treats as vertical, so G9b's new exclusion
  // does not disagree with it. The threshold is the engine's own constant, so
  // retuning it fails here instead of leaving this test on a stale number.
  it("every page-stated vertical mouse is above the vertical ratio, and no other mouse is", () => {
    const stated = slugs.filter(
      (s) => entries[s]!.formFactor.value === "vertical",
    );
    const byRatio = seed
      .filter((r) => r.heightMm / r.lengthMm > VERTICAL_FORM_FACTOR_RATIO)
      .map((r) => slugify(r.brand, r.model));
    expect([...stated].sort()).toEqual([...byRatio].sort());
  });
});
