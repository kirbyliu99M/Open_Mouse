import { describe, expect, it } from "vitest";
import seed from "../../src/db/seed/logitech.json";
import { LOGITECH_SOURCES } from "../../src/db/seed/logitech-sources";
import { dimensionWarnings } from "../../src/server/catalogue/logitech-specs";
import {
  applyDescriptors,
  type DescriptorRecord,
  partitionByDescriptors,
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

describe("applyDescriptors", () => {
  const row = toMouseRow(record)!;
  const classified: DescriptorRecord = {
    model: record.model,
    shape: "symmetrical",
    handCompatibility: "ambidextrous",
    humpPlacement: "back_minimal",
    frontFlare: "flat",
    sideCurvature: "inward",
    thumbRest: false,
    ringFingerRest: false,
    sourceImageUrls: ["https://resource.logitechg.com/x.png"],
    descriptorModel: "gemini-3.8-flash",
    classifiedAt: "2026-09-21T00:00:00.000Z",
    needsReview: false,
  };

  it("applies a classified, non-needsReview record with descriptorMethod rubric_vision", () => {
    const merged = applyDescriptors(row, classified);
    expect(merged.shape).toBe("symmetrical");
    expect(merged.handCompatibility).toBe("ambidextrous");
    expect(merged.humpPlacement).toBe("back_minimal");
    expect(merged.frontFlare).toBe("flat");
    expect(merged.sideCurvature).toBe("inward");
    expect(merged.thumbRest).toBe(false);
    expect(merged.ringFingerRest).toBe(false);
    expect(merged.descriptorMethod).toBe("rubric_vision");
    expect(merged.descriptorModel).toBe("gemini-3.8-flash");
    expect(merged.descriptorSourceUrls).toEqual([
      "https://resource.logitechg.com/x.png",
    ]);
    expect(merged.classifiedAt).toEqual(new Date("2026-09-21T00:00:00.000Z"));
    // Dimension fields from the base row are preserved.
    expect(merged.slug).toBe(row.slug);
  });

  it("leaves descriptor fields null when there is no matching record", () => {
    const merged = applyDescriptors(row, undefined);
    expect(merged.shape).toBeNull();
    expect(merged.descriptorMethod).toBeNull();
    expect(merged.descriptorSourceUrls).toBeNull();
    expect(merged.classifiedAt).toBeNull();
  });

  it("leaves descriptor fields null for a needsReview record — kept out of the seed", () => {
    const merged = applyDescriptors(row, { ...classified, needsReview: true });
    expect(merged.shape).toBeNull();
    expect(merged.descriptorMethod).toBeNull();
  });
});

describe("partitionByDescriptors", () => {
  const row = toMouseRow(record)!;
  const otherRow = toMouseRow({ ...record, model: "Other Mouse" })!;
  const classified: DescriptorRecord = {
    model: record.model,
    shape: "symmetrical",
    handCompatibility: "ambidextrous",
    humpPlacement: "back_minimal",
    frontFlare: "flat",
    sideCurvature: "inward",
    thumbRest: false,
    ringFingerRest: false,
    sourceImageUrls: ["https://resource.logitechg.com/x.png"],
    descriptorModel: "gemini-3.8-flash",
    classifiedAt: "2026-09-21T00:00:00.000Z",
    needsReview: false,
  };

  it("routes a row with no matching entry to withoutDescriptors, untouched", () => {
    const { withDescriptors, withoutDescriptors } = partitionByDescriptors(
      [row],
      new Map(),
    );
    expect(withDescriptors).toEqual([]);
    expect(withoutDescriptors).toEqual([row]);
  });

  it("routes a row with a classified entry to withDescriptors, merged in", () => {
    const { withDescriptors, withoutDescriptors } = partitionByDescriptors(
      [row],
      new Map([[classified.model, classified]]),
    );
    expect(withoutDescriptors).toEqual([]);
    expect(withDescriptors).toHaveLength(1);
    expect(withDescriptors[0]!.shape).toBe("symmetrical");
    expect(withDescriptors[0]!.descriptorMethod).toBe("rubric_vision");
  });

  it("a needsReview entry clears a previously stored value: routed to withDescriptors with null fields, not left alone", () => {
    const { withDescriptors, withoutDescriptors } = partitionByDescriptors(
      [row],
      new Map([[classified.model, { ...classified, needsReview: true }]]),
    );
    // Critically NOT in withoutDescriptors — that bucket's upsert never
    // touches descriptor columns, which would leave a stale value in place.
    expect(withoutDescriptors).toEqual([]);
    expect(withDescriptors).toHaveLength(1);
    expect(withDescriptors[0]!.shape).toBeNull();
    expect(withDescriptors[0]!.descriptorMethod).toBeNull();
    expect(withDescriptors[0]!.descriptorSourceUrls).toBeNull();
    expect(withDescriptors[0]!.classifiedAt).toBeNull();
  });

  it("splits a mixed batch correctly, by model", () => {
    const { withDescriptors, withoutDescriptors } = partitionByDescriptors(
      [row, otherRow],
      new Map([[classified.model, classified]]),
    );
    expect(withDescriptors.map((r) => r.model)).toEqual([record.model]);
    expect(withoutDescriptors.map((r) => r.model)).toEqual(["Other Mouse"]);
  });
});
