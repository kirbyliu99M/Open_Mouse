/**
 * The tester scripts' pure parts (scripts/tester-lib.ts, candidate): code
 * generation, the export folder refusal, the participant argument and the
 * CSV.
 */
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  testerCodeSchema,
  TESTER_CODE_ALPHABET,
} from "../../src/lib/contracts/tester";
import {
  DEFAULT_EXPORT_DIR,
  csvCell,
  generateTesterCodes,
  isInside,
  parseParticipantArg,
  resolveExportDir,
  shotsCsv,
} from "../../scripts/tester-lib";

describe("generateTesterCodes", () => {
  it("numbers P01..PNN with contract-valid random suffixes", () => {
    let k = 0;
    const codes = generateTesterCodes(12, (size) =>
      Uint8Array.from({ length: size }, () => k++),
    );
    expect(codes).toHaveLength(12);
    expect(codes[0]).toBe(`P01-${TESTER_CODE_ALPHABET.slice(0, 6)}`);
    expect(codes[11]!.startsWith("P12-")).toBe(true);
    for (const code of codes)
      expect(testerCodeSchema.safeParse(code).success).toBe(true);
  });

  it("uses three digits past 99 and refuses silly counts", () => {
    const codes = generateTesterCodes(100, (size) => new Uint8Array(size));
    expect(codes[0]!.startsWith("P001-")).toBe(true);
    expect(codes[99]!.startsWith("P100-")).toBe(true);
    for (const bad of [0, -1, 1.5, Number.NaN, 1000])
      expect(() =>
        generateTesterCodes(bad, (s) => new Uint8Array(s)),
      ).toThrow();
  });
});

describe("resolveExportDir", () => {
  const repo = resolve("/work/Mouse Shape Project/wt-tester");

  it("defaults to the folder beside the repository", () => {
    expect(resolveExportDir(undefined, repo)).toBe(
      resolve(repo, DEFAULT_EXPORT_DIR),
    );
    expect(isInside(repo, resolveExportDir(undefined, repo))).toBe(false);
  });

  it("refuses the repository itself and anything inside it", () => {
    for (const inside of [
      ".",
      "./export",
      "tests/../data",
      join(repo, "x"),
      repo,
    ])
      expect(() => resolveExportDir(inside, repo)).toThrow(
        /inside the repository/,
      );
  });

  it("accepts a sibling whose name starts like the repo's", () => {
    expect(resolveExportDir("../wt-tester-export", repo)).toBe(
      resolve(repo, "../wt-tester-export"),
    );
  });
});

describe("parseParticipantArg", () => {
  it("takes P07 in any case and refuses anything else", () => {
    expect(parseParticipantArg(" p07 ")).toBe("P07");
    for (const bad of [undefined, "", "P7", "P07-K7Q2M9", "7"])
      expect(() => parseParticipantArg(bad)).toThrow();
  });
});

describe("shotsCsv", () => {
  it("quotes, defuses formulas, joins codes, and names exported photos", () => {
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell("=HYPERLINK()")).toBe("'=HYPERLINK()");
    expect(csvCell(-1.5)).toBe("-1.5");
    const row = {
      shotId: "s1",
      participant: "P07",
      failureCodes: ["NO_HAND", "LOW_LIGHT"],
      phoneModel: "Pixel 8",
      cardType: null,
    } as unknown as Parameters<typeof shotsCsv>[0][number];
    const csv = shotsCsv([row], new Set(["s1"]));
    const [header, line] = csv.trim().split("\n");
    const cols = header!.split(",");
    const cells = line!.split(",");
    expect(cells[cols.indexOf("failureCodes")]).toBe("NO_HAND|LOW_LIGHT");
    expect(cells[cols.indexOf("photoFile")]).toBe("photos/s1.jpg");
    expect(cells[cols.indexOf("cardType")]).toBe("");
  });
});
