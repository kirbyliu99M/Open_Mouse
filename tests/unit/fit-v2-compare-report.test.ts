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

  it("states the frame scenario and lists what differs between the v2 default and the v1-equivalent setting", () => {
    expect(report).toContain("frame capture = no EXIF");
    expect(report).toContain("## v2 default vs v1-equivalent: what differs");
    expect(report).toMatch(
      /\| biasInput \(mm, subtracted first\) \|.*\*\*yes\*\*/,
    );
    expect(report).toMatch(/\| sigmaInput \(mm\^2\) \|.*\*\*yes\*\*/);
    expect(report).toMatch(/\| tolerance \(mm\) \|.*\| no \|/);
    expect(report).toContain("top-5 prob (frame)");
    expect(report).toContain("+ bias correction");
  });

  it("the first step of the path to the default is v1 itself (top-5 overlap 5/5, tau 1.00)", () => {
    const rows = report
      .split("\n")
      .filter((l) => l.startsWith("| v1-equivalent (= v1) |"));
    expect(rows).toHaveLength(Object.keys(goldenHands).length);
    for (const row of rows) {
      expect(row).toContain("| 5/5 | 1.00 |");
    }
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
