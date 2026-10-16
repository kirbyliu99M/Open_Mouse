import { describe, expect, it } from "vitest";
import { buildCompareReportV2 } from "../../src/server/fit/compare-report-v2";
import { goldenHands, seedCatalogue } from "./fit-v2-fixtures";

describe("v1 vs v2 comparison report", () => {
  const report = buildCompareReportV2(seedCatalogue, goldenHands);

  it("is deterministic", () => {
    expect(buildCompareReportV2(seedCatalogue, goldenHands)).toBe(report);
  });

  it("labels itself a candidate with a simulated Sigma_input", () => {
    expect(report).toContain("候選，未拍板");
    expect(report).toContain("SIMULATED");
    expect(report).toContain("fit-v2-structure-candidate.0");
  });

  it("has one section per golden hand and a v1-equivalent tau of 1.00", () => {
    for (const name of Object.keys(goldenHands)) {
      expect(report).toContain(`## ${name}`);
    }
    // Last summary column: v1 vs v2 under the v1-equivalent setting.
    const rows = report
      .split("\n")
      .filter((l) =>
        /^\| (small_fingertip|medium_claw|large_palm|left_handed) \|/.test(l),
      );
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      const cells = row.split("|").map((c) => c.trim());
      expect(cells[cells.length - 2]).toBe("1.00");
    }
  });
});
