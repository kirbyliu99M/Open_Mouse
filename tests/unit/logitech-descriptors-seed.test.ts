import { describe, expect, it } from "vitest";
import descriptors from "../../src/db/seed/logitech-descriptors.json";
import seed from "../../src/db/seed/logitech.json";
import { HUMP_PLACEMENTS } from "../../src/lib/contracts/descriptors";
import {
  FORM_FACTOR_NOTES,
  GEOMETRY_CLASSIFIED_AT,
  GEOMETRY_DESCRIPTOR_MODEL,
  LOWER_CONFIDENCE_NOTE,
  NOT_IN_VALIDATION_SAMPLE,
  NOT_IN_VALIDATION_SAMPLE_NOTE,
} from "../../src/server/catalogue/geometry-descriptors";
import {
  type DescriptorRecord,
  partitionByDescriptors,
  type SpecRecord,
  toMouseRow,
} from "../../src/server/catalogue/seed-rows";

/**
 * `logitech-descriptors.json` is written by scripts/descriptors-from-geometry.ts
 * from the GD-1 predictions (hump placement only; see
 * src/server/catalogue/geometry-descriptors.ts). The predictions file lives
 * outside the repo, so this checks the committed result: that it lines up with
 * the seeded catalogue, and that it sets nothing that did not pass its M1 criteria.
 */
const records = descriptors as unknown as DescriptorRecord[];
const specs = seed as unknown as SpecRecord[];

/** GD-1 had no usable shell for these four, so they get no record at all. */
const NO_SHELL = [
  "M100",
  "Mobi Fold",
  "MX Ergo S",
  "Signature Comfort M840L",
] as const;
const LOWER_CONFIDENCE = [
  "M705 Marathon",
  "M325s",
  "Signature Comfort Plus M850L",
] as const;
const TRACKBALL = ["ERGO M575", "ERGO M575S"] as const;
const VERTICAL = ["Lift Vertical", "MX Vertical"] as const;

/**
 * Every model's hump, copied by hand from the pre-registered GD-1 table
 * (tools/blender/DESCRIPTOR-GEOMETRY.md on geo-descriptors, "Our predictions"),
 * not from the JSON under test. Swap two records and this fails.
 */
const EXPECTED_HUMP: Readonly<Record<string, string>> = {
  "ERGO M575": "center",
  "ERGO M575S": "center",
  "G Pro 2 Lightspeed": "center",
  "G Pro X Superlight 2": "center",
  "G Pro X Superlight 2 DEX": "center",
  "G Pro X Superlight 2 SE": "center",
  "G Pro X Superlight 2c": "center",
  "G203 Lightsync": "back_minimal",
  "G305 Lightspeed": "back_moderate",
  G309: "back_minimal",
  "G403 Hero": "center",
  "G502 Hero": "center",
  "G502 X": "center",
  "G502 X Lightspeed": "center",
  "G502 X Plus": "center",
  "G703 Lightspeed": "center",
  "G903 Hero": "back_minimal",
  "Lift Vertical": "back_moderate",
  M190: "back_moderate",
  M196: "back_moderate",
  M240: "back_minimal",
  M550: "back_minimal",
  M650: "back_minimal",
  "M720 Triathlon": "back_minimal",
  M750: "back_minimal",
  "MX Anywhere 3S": "back_minimal",
  "MX Master 3S": "back_minimal",
  "MX Master 4": "back_moderate",
  "MX Vertical": "back_minimal",
  "Pebble 2 M350s": "back_aggressive",
  "POP Mouse": "back_aggressive",
  M325s: "back_moderate",
  "M705 Marathon": "center",
  "Signature Comfort Plus M850L": "back_minimal",
};

const byModel = (model: string) => {
  const record = records.find((r) => r.model === model);
  if (!record) throw new Error(`${model} has no descriptor record`);
  return record;
};

describe("checked-in Logitech descriptors", () => {
  it("has one record for each of the 34 seeded models with a shell, the M575S alias included", () => {
    expect(records).toHaveLength(34);
    expect(new Set(records.map((r) => r.model)).size).toBe(34);
    expect(records.map((r) => r.model)).toContain("ERGO M575S");
  });

  it("names only models that exist in logitech.json, spelt exactly as the seed spells them", () => {
    const seeded = new Set(specs.map((s) => s.model));
    expect(
      records.filter((r) => !seeded.has(r.model)).map((r) => r.model),
    ).toEqual([]);
  });

  it("leaves the four models with no shell without a record, so their columns are untouched", () => {
    const listed = new Set(records.map((r) => r.model));
    for (const model of NO_SHELL) {
      expect(specs.map((s) => s.model)).toContain(model);
      expect(listed.has(model)).toBe(false);
    }
    expect(specs.length - records.length).toBe(NO_SHELL.length);
  });

  it("is applied to a row for every record: no record silently misses the seed", () => {
    const rows = specs.map(toMouseRow).filter((r) => r !== null);
    const { withDescriptors, withoutDescriptors } = partitionByDescriptors(
      rows,
      new Map(records.map((r) => [r.model, r])),
    );
    expect(withDescriptors).toHaveLength(records.length);
    expect(withoutDescriptors.map((r) => r.model).sort()).toEqual(
      [...NO_SHELL].sort(),
    );
  });

  it("sets a valid hump on every record, with this distribution", () => {
    for (const r of records) {
      expect(HUMP_PLACEMENTS as readonly string[]).toContain(r.humpPlacement);
    }
    const counts = Object.fromEntries(
      HUMP_PLACEMENTS.map((level) => [
        level,
        records.filter((r) => r.humpPlacement === level).length,
      ]),
    );
    expect(counts).toEqual({
      center: 14,
      back_minimal: 12,
      back_moderate: 6,
      back_aggressive: 2,
    });
  });

  it("gives every one of the 34 models the hump the pre-registered GD-1 table gives it", () => {
    expect(Object.keys(EXPECTED_HUMP)).toHaveLength(34);
    expect(
      Object.fromEntries(records.map((r) => [r.model, r.humpPlacement])),
    ).toEqual(EXPECTED_HUMP);
  });

  it("copies the hump of the M575 onto the M575S alias", () => {
    expect(byModel("ERGO M575S").humpPlacement).toBe(
      byModel("ERGO M575").humpPlacement,
    );
    expect(byModel("ERGO M575S").notes?.[0]).toMatch(/^Alias of ERGO M575:/);
  });

  it("records provenance, the date, and no source images", () => {
    for (const r of records) {
      expect(r.descriptorModel).toBe(GEOMETRY_DESCRIPTOR_MODEL);
      expect(r.descriptorModel).toBe("geometry-gd1@06cc13d");
      expect(r.classifiedAt).toBe(GEOMETRY_CLASSIFIED_AT);
      expect(r.classifiedAt).toBe("2026-10-02");
      expect(r.sourceImageUrls).toEqual([]);
      expect(r.needsReview).toBe(false);
    }
  });

  describe("only the hump is set", () => {
    // Front flare and side curvature failed their M1 criteria in GD-1 run 1 (coarse
    // 67.9 % and 14.3 % against 85 %); thumb and ring-finger rest are not
    // measured from geometry at all. These stay null for good.
    it.each([
      "frontFlare",
      "sideCurvature",
      "thumbRest",
      "ringFingerRest",
    ] as const)("%s is null on every record", (field) => {
      expect(records.filter((r) => r[field] !== null)).toEqual([]);
    });

    // TRIPWIRE for G9b. Shape and hand compatibility are null here because they
    // are null in the database today. logitech-facts.json (G9a, #89) holds
    // first-party facts for them that nothing applies yet, and scripts/seed.ts
    // writes this file's nulls over whatever the columns hold. G9b must merge
    // its facts into this file, or change the seed's precedence, before it
    // ships. When it does, this test is expected to be changed on purpose.
    it.each(["shape", "handCompatibility"] as const)(
      "%s is null on every record (G9b must merge its facts here before it ships)",
      (field) => {
        expect(records.filter((r) => r[field] !== null)).toEqual([]);
      },
    );

    it("reaches the database rows as a hump and nothing else", () => {
      const rows = specs.map(toMouseRow).filter((r) => r !== null);
      const { withDescriptors } = partitionByDescriptors(
        rows,
        new Map(records.map((r) => [r.model, r])),
      );
      for (const row of withDescriptors) {
        expect(row.humpPlacement).not.toBeNull();
        expect(row.shape).toBeNull();
        expect(row.handCompatibility).toBeNull();
        expect(row.frontFlare).toBeNull();
        expect(row.sideCurvature).toBeNull();
        expect(row.thumbRest).toBeNull();
        expect(row.ringFingerRest).toBeNull();
        expect(row.descriptorModel).toBe("geometry-gd1@06cc13d");
        expect(row.descriptorSourceUrls).toEqual([]);
        expect(row.classifiedAt).toEqual(new Date("2026-10-02"));
      }
    });
  });

  describe("notes", () => {
    it.each(LOWER_CONFIDENCE)(
      "%s says it is limited-view study geometry",
      (model) => {
        expect(byModel(model).notes).toContain(LOWER_CONFIDENCE_NOTE);
      },
    );

    it.each(TRACKBALL)("%s says it is an unusual form factor", (model) => {
      expect(byModel(model).notes).toContain(FORM_FACTOR_NOTES.trackball);
    });

    it.each(VERTICAL)("%s says it is an unusual form factor", (model) => {
      expect(byModel(model).notes).toContain(FORM_FACTOR_NOTES.vertical);
    });

    it("marks the five models with no row in the validation sample, and only them", () => {
      // 34 records less these five is the n = 29 the M1 numbers were measured on.
      expect([...NOT_IN_VALIDATION_SAMPLE].sort()).toEqual(
        [
          "ERGO M575S",
          "G903 Hero",
          "M750",
          "M325s",
          "Signature Comfort Plus M850L",
        ].sort(),
      );
      expect(
        records
          .filter((r) => r.notes?.includes(NOT_IN_VALIDATION_SAMPLE_NOTE))
          .map((r) => r.model)
          .sort(),
      ).toEqual([...NOT_IN_VALIDATION_SAMPLE].sort());
      expect(records.length - NOT_IN_VALIDATION_SAMPLE.length).toBe(29);
    });

    it("is on those nine models and no other", () => {
      expect(
        records
          .filter((r) => r.notes !== undefined)
          .map((r) => r.model)
          .sort(),
      ).toEqual(
        [
          ...new Set([
            ...LOWER_CONFIDENCE,
            ...TRACKBALL,
            ...VERTICAL,
            ...NOT_IN_VALIDATION_SAMPLE,
          ]),
        ].sort(),
      );
    });
  });
});
