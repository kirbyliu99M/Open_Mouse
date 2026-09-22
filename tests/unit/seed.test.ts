import { describe, expect, it } from "vitest";
import seed from "../../src/db/seed/logitech.json";
import { LOGITECH_SOURCES } from "../../src/db/seed/logitech-sources";
import { dimensionWarnings } from "../../src/server/catalogue/logitech-specs";
import {
  type SpecRecord,
  slugify,
  toMouseRow,
} from "../../src/server/catalogue/seed-rows";

const record: SpecRecord = {
  brand: "Logitech",
  model: "G Pro X Superlight 2",
  lengthMm: 125,
  widthMm: 63.5,
  heightMm: 40,
  weightG: 60,
  connectivity: "wireless",
  sourceUrl:
    "https://www.logitechg.com/en-us/shop/p/pro-x2-superlight-wireless-mouse",
  retrievedAt: "2026-09-21T00:00:00.000Z",
};

describe("toMouseRow", () => {
  it("computes size and slug rather than trusting input", () => {
    const row = toMouseRow(record)!;
    expect(row.size).toBe("large"); // 125 + 0.4 × (63.5 − 64) = 124.8
    expect(row.slug).toBe("logitech-g-pro-x-superlight-2");
    expect(row.specRetrievedAt.toISOString()).toBe(record.retrievedAt);
  });

  it.each(["lengthMm", "widthMm", "heightMm"] as const)(
    "skips a record missing %s",
    (k) => {
      expect(toMouseRow({ ...record, [k]: null })).toBeNull();
    },
  );

  it("keeps a record whose only gap is weight", () => {
    expect(toMouseRow({ ...record, weightG: null })?.weightG).toBeNull();
  });

  it("slugifies punctuation and spacing", () => {
    expect(slugify("Logitech", "ERGO M575 (Mac)")).toBe(
      "logitech-ergo-m575-mac",
    );
  });
});

describe("checked-in Logitech seed", () => {
  const rows = seed as unknown as (SpecRecord & { warnings?: string[] })[];

  it("covers every configured source exactly once", () => {
    expect(rows.map((r) => r.model).sort()).toEqual(
      LOGITECH_SOURCES.map((s) => s.model).sort(),
    );
  });

  it("has full, correctly oriented dimensions for every row", () => {
    const problems = rows.flatMap((r) =>
      dimensionWarnings(r)
        .filter((w) => w !== "missing weightG")
        .map((w) => `${r.model}: ${w}`),
    );
    expect(problems).toEqual([]);
  });

  it("sources everything from Logitech's own storefronts", () => {
    for (const r of rows)
      expect(new URL(r.sourceUrl).hostname).toMatch(/^www\.logitechg?\.com$/);
  });

  it("produces unique slugs", () => {
    const slugs = rows.map((r) => slugify(r.brand, r.model));
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});
