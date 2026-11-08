/**
 * The tester scripts' pure parts (scripts/tester-lib.ts, candidate): code
 * generation, the export folder refusal, the participant argument and the
 * CSV.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  testerCodeSchema,
  TESTER_CODE_ALPHABET,
} from "../../src/lib/contracts/tester";
import {
  DEFAULT_EXPORT_DIR,
  csvCell,
  generateTesterCodes,
  isInside,
  localPhotoCutoffDay,
  parseDeleteArgs,
  parseExportArgs,
  parseParticipantArg,
  pruneExportFolder,
  parseRecordsJsonl,
  photosToKeep,
  pruneLocalPhotos,
  recordsJsonl,
  removeParticipantLocally,
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
    // Only numbers bypass the guard: text that looks like a number does not.
    expect(csvCell("-1+1")).toBe("'-1+1");
    expect(csvCell("+886")).toBe("'+886");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell(true)).toBe("true");
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

describe("the local export follows the server's rules", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const id = (n: number) =>
    `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const row = (n: number, participant: string, day: string, photo: boolean) =>
    ({
      shotId: id(n),
      participant,
      day,
      photoPathname: photo ? `tester/${id(n)}.jpg` : null,
      failureCodes: [],
    }) as unknown as Parameters<typeof shotsCsv>[0][number];
  function exportFolder(rows: ReturnType<typeof row>[], photos: number[]) {
    const dir = mkdtempSync(join(tmpdir(), "tester-export-"));
    dirs.push(dir);
    mkdirSync(join(dir, "photos"));
    for (const n of photos)
      writeFileSync(join(dir, "photos", `${id(n)}.jpg`), "x");
    writeFileSync(join(dir, "records.jsonl"), recordsJsonl(rows));
    writeFileSync(join(dir, "shots.csv"), shotsCsv(rows, new Set()));
    return dir;
  }

  it("each export keeps only photos the server still has, within 180 Taipei days", () => {
    // 2027-05-08 in Taipei: the cutoff is 2026-11-09.
    const cutoff = localPhotoCutoffDay(new Date("2027-05-07T16:30:00Z"));
    expect(cutoff).toBe("2026-11-09");
    const rows = [
      row(1, "P07", "2026-11-08", true), // past retention
      row(2, "P07", "2026-11-09", true), // last day kept
      row(3, "P08", "2026-12-01", false), // purged on the server
    ];
    const keep = photosToKeep(rows, cutoff);
    expect([...keep]).toEqual([id(2)]);
    // Photo 4 belongs to a shot the server no longer has at all.
    const dir = exportFolder(rows, [1, 2, 3, 4]);
    expect(pruneLocalPhotos(dir, keep)).toBe(3);
    expect(existsSync(join(dir, "photos", `${id(2)}.jpg`))).toBe(true);
    expect(existsSync(join(dir, "photos", `${id(1)}.jpg`))).toBe(false);
  });

  it("deleting a participant removes their rows and photos from the export, nobody else's", () => {
    const rows = [
      row(1, "P07", "2026-11-09", true),
      row(2, "P08", "2026-11-09", true),
      row(3, "P07", "2026-11-10", false),
    ];
    const dir = exportFolder(rows, [1, 2]);
    expect(removeParticipantLocally(dir, "P07", true)).toEqual({
      rows: 2,
      photos: 1,
    });
    // A dry run changes nothing.
    expect(existsSync(join(dir, "photos", `${id(1)}.jpg`))).toBe(true);
    expect(removeParticipantLocally(dir, "P07", false)).toEqual({
      rows: 2,
      photos: 1,
    });
    const left = parseRecordsJsonl(
      readFileSync(join(dir, "records.jsonl"), "utf8"),
    );
    expect(left.map((r) => r.participant)).toEqual(["P08"]);
    const csv = readFileSync(join(dir, "shots.csv"), "utf8");
    expect(csv).not.toContain("P07");
    expect(csv).toContain(`photos/${id(2)}.jpg`);
    expect(existsSync(join(dir, "photos", `${id(1)}.jpg`))).toBe(false);
    expect(existsSync(join(dir, "photos", `${id(2)}.jpg`))).toBe(true);
  });

  it("a folder without an export is left alone", () => {
    const dir = mkdtempSync(join(tmpdir(), "tester-empty-"));
    dirs.push(dir);
    expect(removeParticipantLocally(dir, "P07", false)).toEqual({
      rows: 0,
      photos: 0,
    });
  });
});

describe("script arguments", () => {
  it("tester-delete: the id alone, with --yes, with --out in any order", () => {
    expect(parseDeleteArgs(["P07"])).toEqual({
      participant: "P07",
      yes: false,
      outDir: undefined,
    });
    expect(parseDeleteArgs(["P07", "--yes"])).toEqual({
      participant: "P07",
      yes: true,
      outDir: undefined,
    });
    expect(parseDeleteArgs(["--out", "../x", "p07", "--yes"])).toEqual({
      participant: "P07",
      yes: true,
      outDir: "../x",
    });
    expect(parseDeleteArgs(["P07", "--out", "P08"])).toEqual({
      participant: "P07",
      yes: false,
      outDir: "P08",
    });
  });

  it("tester-delete refuses no id, two ids, --out without a folder, unknown flags", () => {
    for (const bad of [
      [],
      ["--yes"],
      ["P07", "P08"],
      ["P07", "--out"],
      ["P07", "--out", "--yes"],
      ["P07", "--force"],
    ])
      expect(() => parseDeleteArgs(bad), bad.join(" ")).toThrow();
  });

  it("tester-export: an optional folder and --prune-only", () => {
    expect(parseExportArgs([])).toEqual({
      outDir: undefined,
      pruneOnly: false,
    });
    expect(parseExportArgs(["--prune-only", "../e"])).toEqual({
      outDir: "../e",
      pruneOnly: true,
    });
    expect(() => parseExportArgs(["a", "b"])).toThrow();
    expect(() => parseExportArgs(["--yes"])).toThrow();
  });
});

describe("offline prune of an export folder", () => {
  it("deletes photos past retention or without a row, from records.jsonl alone", () => {
    const dir = mkdtempSync(join(tmpdir(), "tester-prune-"));
    try {
      const id = (n: number) =>
        `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
      const rows = [
        {
          shotId: id(1),
          participant: "P07",
          day: "2026-11-08",
          failureCodes: [],
        },
        {
          shotId: id(2),
          participant: "P07",
          day: "2026-11-09",
          failureCodes: [],
        },
      ] as unknown as Parameters<typeof shotsCsv>[0];
      mkdirSync(join(dir, "photos"));
      for (const n of [1, 2, 3])
        writeFileSync(join(dir, "photos", `${id(n)}.jpg`), "x");
      writeFileSync(join(dir, "records.jsonl"), recordsJsonl(rows));
      expect(pruneExportFolder(dir, new Date("2027-05-07T16:30:00Z"))).toBe(2);
      expect(existsSync(join(dir, "photos", `${id(2)}.jpg`))).toBe(true);
      const csv = readFileSync(join(dir, "shots.csv"), "utf8");
      expect(csv).toContain(`photos/${id(2)}.jpg`);
      expect(csv).not.toContain(`photos/${id(1)}.jpg`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
