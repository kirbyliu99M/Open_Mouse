/**
 * landmark-heights-v2: the ratio table and `landmarkHeightsMm`.
 *
 * The expected numbers below are typed in from the candidate table that
 * documents this method (docs/research/landmark-heights-v2.md), not computed
 * by the code under test, so a slip in the source data or in the mapping shows
 * up here. Candidate (未拍板): the table is a best estimate, not a calibration.
 */
import { describe, expect, it } from "vitest";
import {
  GARRETT_DEPTHS_CM,
  GARRETT_SOURCES,
  LANDMARK_HEIGHTS_MM_VERSION,
  LANDMARK_HEIGHT_BASIS,
  LANDMARK_HEIGHT_RATIOS,
  REFERENCE_HAND_LENGTH_MM,
  REFERENCE_LANDMARK_HEIGHTS_MM,
  landmarkHeightsMm,
} from "../../src/client/geometry/parallax";

/**
 * One row of the table per landmark: where it comes from (a Garrett variable
 * number, or "kept" from v1), the male and female ratios, the pooled ratio and
 * the height at a hand length of 190 mm. Ratios are printed to 6 decimals,
 * heights to 2.
 */
interface Row {
  readonly name: string;
  readonly variable: number | "kept";
  readonly proxy: boolean;
  readonly kM: number | null;
  readonly kF: number | null;
  readonly k: number;
  readonly h190: number;
}

const DEPTH_8 = { kM: 0.083418, kF: 0.076966, k: 0.080192, h190: 15.24 };
const DEPTH_11 = { kM: 0.051217, kF: 0.046291, k: 0.048754, h190: 9.26 };
const TIP = { kM: null, kF: null, k: 6 / 190, h190: 6.0 };

const TABLE: readonly Row[] = [
  {
    name: "0 wrist",
    variable: "kept",
    proxy: false,
    kM: null,
    kF: null,
    k: 20 / 190,
    h190: 20.0,
  },
  {
    name: "1 thumb CMC",
    variable: "kept",
    proxy: false,
    kM: null,
    kF: null,
    k: 18 / 190,
    h190: 18.0,
  },
  { name: "2 thumb MCP", variable: 11, proxy: true, ...DEPTH_11 },
  { name: "3 thumb IP", variable: 11, proxy: false, ...DEPTH_11 },
  { name: "4 thumb TIP", variable: "kept", proxy: false, ...TIP },
  { name: "5 index MCP", variable: 8, proxy: true, ...DEPTH_8 },
  {
    name: "6 index PIP",
    variable: 17,
    proxy: false,
    kM: 0.049189,
    kF: 0.045176,
    k: 0.047182,
    h190: 8.96,
  },
  {
    name: "7 index DIP",
    variable: 14,
    proxy: false,
    kM: 0.0393,
    kF: 0.035694,
    k: 0.037497,
    h190: 7.12,
  },
  { name: "8 index TIP", variable: "kept", proxy: false, ...TIP },
  { name: "9 middle MCP", variable: 8, proxy: false, ...DEPTH_8 },
  {
    name: "10 middle PIP",
    variable: 23,
    proxy: false,
    kM: 0.050963,
    kF: 0.04657,
    k: 0.048766,
    h190: 9.27,
  },
  {
    name: "11 middle DIP",
    variable: 20,
    proxy: false,
    kM: 0.040568,
    kF: 0.036531,
    k: 0.038549,
    h190: 7.32,
  },
  { name: "12 middle TIP", variable: "kept", proxy: false, ...TIP },
  { name: "13 ring MCP", variable: 8, proxy: true, ...DEPTH_8 },
  {
    name: "14 ring PIP",
    variable: 29,
    proxy: false,
    kM: 0.047921,
    kF: 0.043781,
    k: 0.045851,
    h190: 8.71,
  },
  {
    name: "15 ring DIP",
    variable: 26,
    proxy: false,
    kM: 0.038286,
    kF: 0.034858,
    k: 0.036572,
    h190: 6.95,
  },
  { name: "16 ring TIP", variable: "kept", proxy: false, ...TIP },
  { name: "17 little MCP", variable: 8, proxy: true, ...DEPTH_8 },
  {
    name: "18 little PIP",
    variable: 35,
    proxy: false,
    kM: 0.042343,
    kF: 0.038762,
    k: 0.040552,
    h190: 7.7,
  },
  {
    name: "19 little DIP",
    variable: 32,
    proxy: false,
    kM: 0.034736,
    kF: 0.031511,
    k: 0.033124,
    h190: 6.29,
  },
  { name: "20 little TIP", variable: "kept", proxy: false, ...TIP },
];

// The table's ratios are rounded to 6 decimals, so they can sit 1e-6 from the
// exact value; allow 2e-6.
const RATIO_TOLERANCE = 2e-6;

describe("landmark-heights-v2: version", () => {
  it("is landmark-heights-v2", () => {
    expect(LANDMARK_HEIGHTS_MM_VERSION).toBe("landmark-heights-v2");
  });
});

describe("landmark-heights-v2: source data", () => {
  it("names both reports, with the mean hand lengths the ratios divide by", () => {
    expect(GARRETT_SOURCES.male).toMatchObject({
      dtic: "AD0709883",
      n: 148,
      meanHandLengthCm: 19.72,
      handLengthPdfPage: 11,
    });
    expect(GARRETT_SOURCES.male.report).toContain("AMRL-TR-69-42");
    expect(GARRETT_SOURCES.female).toMatchObject({
      dtic: "AD0710202",
      n: 211,
      meanHandLengthCm: 17.93,
      handLengthPdfPage: 15,
    });
  });

  it("holds the ten depth variables the table uses, each with a page in both reports", () => {
    expect(GARRETT_DEPTHS_CM.map((d) => d.variable)).toEqual([
      8, 11, 14, 17, 20, 23, 26, 29, 32, 35,
    ]);
    for (const d of GARRETT_DEPTHS_CM) {
      expect(d.maleCm).toBeGreaterThan(1);
      expect(d.femaleCm).toBeGreaterThan(1);
      // A woman's joint is thinner than a man's, in every variable.
      expect(d.femaleCm).toBeLessThan(d.maleCm);
      expect(d.malePdfPage).toBeGreaterThan(1);
      expect(d.femalePdfPage).toBeGreaterThan(1);
    }
  });

  it("uses 1.28 cm for the female index DIP depth, the corrected reading (not 1.23)", () => {
    const depth = GARRETT_DEPTHS_CM.find((d) => d.variable === 14)!;
    expect(depth.femaleCm).toBe(1.28);
    expect(depth.maleCm).toBe(1.55);
  });
});

describe("landmark-heights-v2: each ratio is worked out from the source depths", () => {
  it("has 21 ratios and 21 basis entries, one per landmark", () => {
    expect(LANDMARK_HEIGHT_RATIOS).toHaveLength(21);
    expect(LANDMARK_HEIGHT_BASIS).toHaveLength(21);
    expect(TABLE).toHaveLength(21);
  });

  it("maps each landmark to the variable the table says, with the same proxies", () => {
    TABLE.forEach((row, i) => {
      const basis = LANDMARK_HEIGHT_BASIS[i]!;
      if (row.variable === "kept") {
        expect(basis.kind, row.name).toBe("kept");
      } else {
        expect(basis, row.name).toEqual({
          kind: "garrett",
          variable: row.variable,
          proxy: row.proxy,
        });
      }
    });
  });

  it("recomputes every ratio as ((male depth / 2) / male hand length + (female depth / 2) / female hand length) / 2", () => {
    const male = GARRETT_SOURCES.male.meanHandLengthCm;
    const female = GARRETT_SOURCES.female.meanHandLengthCm;
    LANDMARK_HEIGHT_BASIS.forEach((basis, i) => {
      if (basis.kind === "kept") {
        // Kept from v1: the old millimetres over the reference hand length.
        expect(LANDMARK_HEIGHT_RATIOS[i]).toBe(basis.mm / 190);
        return;
      }
      const depth = GARRETT_DEPTHS_CM.find(
        (d) => d.variable === basis.variable,
      )!;
      const expected =
        (depth.maleCm / 2 / male + depth.femaleCm / 2 / female) / 2;
      expect(LANDMARK_HEIGHT_RATIOS[i], `landmark ${i}`).toBeCloseTo(
        expected,
        12,
      );
    });
  });

  it("recomputes the male and female ratios of the table from the depths", () => {
    const male = GARRETT_SOURCES.male.meanHandLengthCm;
    const female = GARRETT_SOURCES.female.meanHandLengthCm;
    TABLE.forEach((row) => {
      if (row.variable === "kept") return;
      const depth = GARRETT_DEPTHS_CM.find((d) => d.variable === row.variable)!;
      expect(depth.maleCm / 2 / male, `${row.name} male`).toBeCloseTo(
        row.kM!,
        5,
      );
      expect(depth.femaleCm / 2 / female, `${row.name} female`).toBeCloseTo(
        row.kF!,
        5,
      );
    });
  });

  it("gives the pooled ratios of the table", () => {
    TABLE.forEach((row, i) => {
      expect(
        Math.abs(LANDMARK_HEIGHT_RATIOS[i]! - row.k),
        `${row.name}: ${LANDMARK_HEIGHT_RATIOS[i]} vs ${row.k}`,
      ).toBeLessThanOrEqual(RATIO_TOLERANCE);
    });
  });

  it("keeps the wrist, thumb CMC and every fingertip at the v1 values: 20/190, 18/190 and 6/190", () => {
    expect(LANDMARK_HEIGHT_RATIOS[0]).toBe(20 / 190);
    expect(LANDMARK_HEIGHT_RATIOS[1]).toBe(18 / 190);
    for (const tip of [4, 8, 12, 16, 20]) {
      expect(LANDMARK_HEIGHT_RATIOS[tip]).toBe(6 / 190);
    }
  });
});

describe("landmarkHeightsMm", () => {
  it("at a hand length of 190 mm gives the 21 heights of the table, within 0.01 mm", () => {
    expect(REFERENCE_HAND_LENGTH_MM).toBe(190);
    const heights = landmarkHeightsMm(190);
    expect(heights).toHaveLength(21);
    TABLE.forEach((row, i) => {
      expect(
        Math.abs(heights[i]! - row.h190),
        `${row.name}: ${heights[i]} vs ${row.h190}`,
      ).toBeLessThanOrEqual(0.01);
    });
  });

  it("has the reference heights equal to the heights at 190 mm", () => {
    expect(REFERENCE_LANDMARK_HEIGHTS_MM).toEqual(landmarkHeightsMm(190));
    expect(REFERENCE_LANDMARK_HEIGHTS_MM).toHaveLength(21);
  });

  it("is linear in the hand length: height = ratio x length", () => {
    for (const length of [100, 160, 190, 220, 280]) {
      const heights = landmarkHeightsMm(length);
      heights.forEach((h, i) => {
        expect(h / length).toBeCloseTo(LANDMARK_HEIGHT_RATIOS[i]!, 12);
      });
    }
    const a = landmarkHeightsMm(150);
    const b = landmarkHeightsMm(40);
    const sum = landmarkHeightsMm(190);
    const double = landmarkHeightsMm(300);
    const single = landmarkHeightsMm(150);
    a.forEach((h, i) => {
      expect(h + b[i]!).toBeCloseTo(sum[i]!, 10);
      expect(double[i]).toBeCloseTo(2 * single[i]!, 10);
    });
  });

  it("gives a taller hand taller joints, and a smaller hand smaller ones", () => {
    const small = landmarkHeightsMm(160);
    const big = landmarkHeightsMm(220);
    small.forEach((h, i) => expect(big[i]).toBeGreaterThan(h));
  });

  it("throws a RangeError for a length that is zero, negative, NaN or infinite", () => {
    for (const bad of [
      0,
      -0,
      -1,
      -190,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]) {
      expect(() => landmarkHeightsMm(bad), String(bad)).toThrow(RangeError);
    }
  });

  it("gives a fresh array each call, so a caller cannot change the next answer", () => {
    const first = landmarkHeightsMm(190);
    first[0] = 999;
    expect(landmarkHeightsMm(190)[0]).toBeCloseTo(20, 10);
    expect(REFERENCE_LANDMARK_HEIGHTS_MM[0]).toBeCloseTo(20, 10);
  });
});
