import path from "node:path";
import { describe, expect, it } from "vitest";
import { LEARNING_KIT_VERSION } from "../../src/lib/learning/kit";
import {
  containingRoot,
  isInsideDirectory,
  relativeInputPath,
} from "../../src/lib/learning/paths";
import {
  assembleLearningReport,
  type ReportFindings,
} from "../../src/lib/learning/report";
import {
  NO_PROVENANCE,
  RUN_LOG_FORMAT,
  buildRunLog,
  readGitProvenance,
  sortReports,
} from "../../src/lib/learning/runlog";
import {
  TRUTH_FORMAT,
  TRUTH_PROTOCOL,
  emptyTruth,
  truthSchema,
} from "../../src/lib/learning/truth";

const SHA = "0123456789abcdef0123456789abcdef01234567";

function report(file: string) {
  const findings: ReportFindings = {
    file,
    width: 100,
    height: 100,
    paperSize: "a4",
    exif: null,
    exifFocalPx: null,
    qrText: null,
    code: null,
    markers: [],
    laplacianVariance: 0,
    reference: null,
    paper: null,
    hand: null,
  };
  return assembleLearningReport(findings);
}

describe("buildRunLog", () => {
  const reports = [report("IMG_0001.jpg"), report("IMG_0002.jpg")];
  const sort = sortReports(reports);
  const log = buildRunLog({
    reports,
    sort,
    paperSize: "letter",
    input: "../../Photos/session-1",
    provenance: { gitSha: SHA, gitDirty: true },
    now: new Date("2026-09-30T08:15:30.123Z"),
  });

  it("names its format, kit version, time, sheet size and folder", () => {
    expect(log.format).toBe(RUN_LOG_FORMAT);
    expect(log.format).toBe("open-mouse-learning-run/2");
    expect(log.kitVersion).toBe(LEARNING_KIT_VERSION);
    expect(log.createdAt).toBe("2026-09-30T08:15:30.123Z");
    expect(log.paperSize).toBe("letter");
    expect(log.input).toBe("../../Photos/session-1");
    expect(log.sort).toBe(sort);
  });

  it("puts the kit version and the git commit on the run and on every photo's report", () => {
    expect([log.gitSha, log.gitDirty]).toEqual([SHA, true]);
    expect(log.reports).toHaveLength(2);
    for (const r of log.reports) {
      expect(r.kitVersion).toBe(LEARNING_KIT_VERSION);
      expect(r.gitSha).toBe(SHA);
      expect(r.gitDirty).toBe(true);
    }
  });

  it("leaves the reports' other fields alone", () => {
    expect(
      log.reports.map((r) => ({ ...r, gitSha: null, gitDirty: null })),
    ).toEqual(reports);
  });

  it("with no provenance (a download from the page) records nulls, not a guess", () => {
    const anon = buildRunLog({
      reports,
      sort,
      paperSize: "a4",
      input: null,
      provenance: NO_PROVENANCE,
      now: new Date(0),
    });
    expect([anon.gitSha, anon.gitDirty, anon.input]).toEqual([
      null,
      null,
      null,
    ]);
    expect(anon.reports.every((r) => r.gitSha === null)).toBe(true);
  });
});

describe("readGitProvenance", () => {
  const git =
    (answers: Record<string, string>) => (args: readonly string[]) => {
      const key = args.join(" ");
      if (!(key in answers)) throw new Error(`unexpected git ${key}`);
      return answers[key]!;
    };

  it("reads the commit and whether the checkout is dirty", () => {
    expect(
      readGitProvenance(
        git({
          "rev-parse HEAD": `${SHA}\n`,
          "status --porcelain": " M a.ts\n",
        }),
      ),
    ).toEqual({ gitSha: SHA, gitDirty: true });
    expect(
      readGitProvenance(
        git({ "rev-parse HEAD": SHA, "status --porcelain": "" }),
      ),
    ).toEqual({ gitSha: SHA, gitDirty: false });
  });

  it("gives nulls when git is missing or the output is not a commit hash", () => {
    expect(
      readGitProvenance(() => {
        throw new Error("git: not found");
      }),
    ).toEqual(NO_PROVENANCE);
    expect(
      readGitProvenance(
        git({ "rev-parse HEAD": "HEAD", "status --porcelain": "" }),
      ),
    ).toEqual(NO_PROVENANCE);
    expect(
      readGitProvenance(
        git({
          "rev-parse HEAD": "fatal: not a git repository",
          "status --porcelain": "",
        }),
      ),
    ).toEqual(NO_PROVENANCE);
  });

  it("gives nulls, not a half answer, when only the status call fails", () => {
    expect(readGitProvenance(git({ "rev-parse HEAD": SHA }))).toEqual(
      NO_PROVENANCE,
    );
  });
});

describe("isInsideDirectory", () => {
  const win = path.win32;
  const posix = path.posix;

  it.each([
    ["the directory itself", "C:\\work\\Open_Mouse", true],
    ["a file below it", "C:\\work\\Open_Mouse\\fixtures\\a.jpg", true],
    ["a folder that does not exist yet", "C:\\work\\Open_Mouse\\a\\b\\c", true],
    ["a trailing separator", "C:\\work\\Open_Mouse\\", true],
    ["the same folder in other letter case", "c:\\WORK\\open_mouse\\x", true],
    [
      "a dot-dot that comes back in",
      "C:\\work\\Open_Mouse\\..\\Open_Mouse\\x",
      true,
    ],
    ["a sibling with the same prefix", "C:\\work\\Open_Mouse-data", false],
    ["the parent", "C:\\work", false],
    ["a dot-dot that leaves", "C:\\work\\Open_Mouse\\..\\Fixtures", false],
    ["another drive", "D:\\work\\Open_Mouse\\x", false],
    ["a folder named like a dot-dot", "C:\\work\\Open_Mouse\\..data", true],
  ])("windows: %s", (_label, candidate, expected) => {
    expect(isInsideDirectory(candidate, "C:\\work\\Open_Mouse", win)).toBe(
      expected,
    );
  });

  it.each([
    ["the directory itself", "/home/kirby/Open_Mouse", true],
    ["a file below it", "/home/kirby/Open_Mouse/fixtures/a.jpg", true],
    ["a sibling with the same prefix", "/home/kirby/Open_Mouse-data", false],
    ["the parent", "/home/kirby", false],
    ["other letter case is another folder", "/home/kirby/open_mouse/x", false],
    ["a dot-dot that leaves", "/home/kirby/Open_Mouse/../Fixtures", false],
  ])("posix: %s", (_label, candidate, expected) => {
    expect(isInsideDirectory(candidate, "/home/kirby/Open_Mouse", posix)).toBe(
      expected,
    );
  });

  it("containingRoot names the first root that holds the folder", () => {
    const roots = [
      "C:\\work\\Open_Mouse\\.claude\\worktrees\\a",
      "C:\\work\\Open_Mouse",
    ];
    expect(
      containingRoot(
        "C:\\work\\Open_Mouse\\.claude\\worktrees\\Fixtures",
        roots,
        win,
      ),
    ).toBe("C:\\work\\Open_Mouse");
    expect(
      containingRoot("C:\\work\\Fixtures\\learning", roots, win),
    ).toBeNull();
    expect(containingRoot("C:\\work\\Fixtures\\learning", [], win)).toBeNull();
  });
});

describe("relativeInputPath", () => {
  const win = path.win32;
  const base = "C:\\Users\\kirby\\Desktop\\Mouse Shape Project\\Open_Mouse";

  it("is relative to where the command ran, with forward slashes", () => {
    expect(
      relativeInputPath(
        "C:\\Users\\kirby\\Desktop\\Mouse Shape Project\\Photos\\2026-09-30",
        base,
        { api: win, username: "kirby" },
      ),
    ).toBe("../Photos/2026-09-30");
    expect(relativeInputPath(`${base}\\session`, base, { api: win })).toBe(
      "session",
    );
    expect(relativeInputPath(base, base, { api: win })).toBe(".");
  });

  it("never carries the account name, in any of the ways it could get in", () => {
    const cases = [
      // Another drive: only the folder's own name is kept.
      "D:\\DCIM\\Camera",
      // Under the profile, from a repo that lives elsewhere.
      "C:\\Users\\kirby\\Pictures\\Session",
      "C:\\Users\\kirby",
      // Someone else's profile.
      "C:\\Users\\alice\\Pictures\\Session",
    ];
    for (const input of cases) {
      const out = relativeInputPath(input, "E:\\repos\\Open_Mouse", {
        api: win,
        username: "kirby",
      });
      expect(out).not.toMatch(/kirby|alice/i);
      expect(out).not.toContain("\\");
      expect(out).not.toMatch(/^[A-Za-z]:/);
    }
    expect(
      relativeInputPath("D:\\DCIM\\Camera", "E:\\repos\\Open_Mouse", {
        api: win,
      }),
    ).toBe("Camera");
  });

  it("replaces the segment after Users or home, and a segment equal to the username", () => {
    expect(
      relativeInputPath("/home/kirby/Pictures/S1", "/srv/repo", {
        api: path.posix,
        username: null,
      }),
    ).toBe("../../home/~/Pictures/S1");
    expect(
      relativeInputPath("/mnt/kirby-usb/kirby/S1", "/srv/repo", {
        api: path.posix,
        username: "Kirby",
      }),
    ).toBe("../../mnt/kirby-usb/~/S1");
  });
});

describe("truth.json", () => {
  it("the template has one set of ruler values per hand, all still to measure", () => {
    const truth = emptyTruth("P007");
    expect(truth).toMatchObject({
      format: TRUTH_FORMAT,
      participant: "P007",
      protocol: TRUTH_PROTOCOL,
      right: { handLengthMm: null, palmWidthMm: null },
      left: { handLengthMm: null, palmWidthMm: null },
    });
    expect(truthSchema.parse(truth)).toEqual(truth);
    expect(TRUTH_PROTOCOL).toMatch(/^candidate/);
  });

  it("accepts a filled file, and each hand separately", () => {
    const filled = {
      ...emptyTruth("P012"),
      right: { handLengthMm: 188.5, palmWidthMm: 84 },
      left: { handLengthMm: 187, palmWidthMm: null },
    };
    expect(truthSchema.parse(filled)).toEqual(filled);
  });

  it("rejects the old one-set-for-both-hands layout, typos and stray keys", () => {
    const { right, left, ...rest } = emptyTruth("P007");
    void right;
    void left;
    expect(
      truthSchema.safeParse({ ...rest, handLengthMm: 185, palmWidthMm: 80 })
        .success,
    ).toBe(false);
    const base = emptyTruth("P007");
    const withRight = (r: object) => ({
      ...base,
      right: { ...base.right, ...r },
    });
    expect(
      truthSchema.safeParse(withRight({ handLengthMm: 1850 })).success,
    ).toBe(false);
    expect(truthSchema.safeParse(withRight({ palmWidthMm: 8 })).success).toBe(
      false,
    );
    expect(
      truthSchema.safeParse(withRight({ handLengthMm: "185" })).success,
    ).toBe(false);
    expect(truthSchema.safeParse(withRight({ gripMm: 12 })).success).toBe(
      false,
    );
    expect(truthSchema.safeParse({ ...base, participant: "7" }).success).toBe(
      false,
    );
    expect(truthSchema.safeParse({ ...base, format: "v1" }).success).toBe(
      false,
    );
    expect(truthSchema.safeParse({ ...base, name: "Alice" }).success).toBe(
      false,
    );
  });
});
