import path from "node:path";
import { describe, expect, it } from "vitest";
import { handMeasurementsSchema } from "../../src/lib/contracts/measurement";
import { LEARNING_KIT_VERSION } from "../../src/lib/learning/kit";
import {
  carriesAccount,
  containingRoot,
  isInsideDirectory,
  mainCheckoutOf,
  redactText,
  relativeInputPath,
  terminalRedaction,
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

describe("sortReports", () => {
  const card = {
    kind: "participant",
    version: 1,
    participant: "P007",
  } as const;
  const pose = {
    kind: "gesture",
    version: 1,
    gesture: "G01",
    hand: "right",
  } as const;
  const named = (file: string, code: typeof card | typeof pose) => ({
    ...report(file),
    code,
    verdict:
      code.kind === "participant" ? ("slate" as const) : ("ready" as const),
  });

  it("goes by camera order (natural file-name order), not the order it was given", () => {
    // Given newest first, and with IMG_10 after IMG_9 only in natural order.
    const sort = sortReports([
      named("IMG_10.jpg", pose),
      named("IMG_9.jpg", pose),
      named("IMG_1.jpg", card),
    ]);
    expect(sort.photos.map((p) => [p.file, p.destination])).toEqual([
      ["IMG_1.jpg", "P007/slate.jpg"],
      ["IMG_9.jpg", "P007/G01R/1.jpg"],
      ["IMG_10.jpg", "P007/G01R/2.jpg"],
    ]);
  });

  it("does not change the reports it is given", () => {
    const given = [named("IMG_2.jpg", pose), named("IMG_1.jpg", card)];
    sortReports(given);
    expect(given.map((r) => r.file)).toEqual(["IMG_2.jpg", "IMG_1.jpg"]);
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

describe("mainCheckoutOf", () => {
  const win = path.win32;

  it("in a worktree, the main checkout is the parent of the common .git", () => {
    expect(
      mainCheckoutOf(
        "C:\\work\\Open_Mouse\\.claude\\worktrees\\learning-kit",
        "C:/work/Open_Mouse/.git",
        win,
      ),
    ).toBe("C:\\work\\Open_Mouse");
  });

  it("in the main checkout (a relative .git), or with no git answer, it is the script's own checkout", () => {
    const root = "C:\\work\\Open_Mouse";
    expect(mainCheckoutOf(root, ".git", win)).toBe(root);
    expect(mainCheckoutOf(root, null, win)).toBe(root);
    expect(mainCheckoutOf(root, "", win)).toBe(root);
  });

  it("so a worktree's usual output folder counts as inside the repo", () => {
    const worktree = "C:\\work\\Open_Mouse\\.claude\\worktrees\\learning-kit";
    const roots = [
      worktree,
      mainCheckoutOf(worktree, "C:/work/Open_Mouse/.git", win),
    ];
    // The old default, "../Fixtures/learning" from the worktree:
    const out = "C:\\work\\Open_Mouse\\.claude\\worktrees\\Fixtures\\learning";
    expect(containingRoot(out, roots, win)).toBe("C:\\work\\Open_Mouse");
    // The new default, next to the main checkout:
    expect(
      containingRoot("C:\\work\\Fixtures\\learning", roots, win),
    ).toBeNull();
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

  it("replaces the segment after Users or home, and every segment that holds the username", () => {
    expect(
      relativeInputPath("/home/kirby/Pictures/S1", "/srv/repo", {
        api: path.posix,
        username: null,
      }),
    ).toBe("../../home/~/Pictures/S1");
    // `kirby-usb` holds the name too, so it goes as well.
    expect(
      relativeInputPath("/mnt/kirby-usb/kirby/S1", "/srv/repo", {
        api: path.posix,
        username: "Kirby",
      }),
    ).toBe("../../mnt/~/~/S1");
  });

  // The verifier found a run log `input` like the first of these: Claude Code
  // names its project folders after the whole path, account name inside.
  it.each([
    [
      "a folder named after a whole path",
      "C--Users-kirby-Desktop-Mouse-Shape-Project",
    ],
    ["a folder with the name and a space", "Kirby Photos"],
    ["a folder starting with the name", "kirby-DCIM"],
    ["a folder ending with the name", "DCIM_KIRBY"],
    ["the name in the middle of a word", "photosKiRbYsession"],
  ])("masks a segment that holds the username: %s", (_label, segment) => {
    const out = relativeInputPath(
      `E:\\data\\${segment}\\2026-09-30`,
      "E:\\repos\\Open_Mouse",
      { api: win, username: "kirby" },
    );
    expect(out).toBe("../../data/~/2026-09-30");
    // The segments that do not carry the name stay.
    expect(
      relativeInputPath(`E:\\data\\photos\\${segment}`, "E:\\data", {
        api: win,
        username: "kirby",
      }),
    ).toBe("photos/~");
  });

  it("keeps a segment that only looks similar", () => {
    expect(
      relativeInputPath("E:\\data\\kirb\\Kirsten\\kiwi", "E:\\repos", {
        api: win,
        username: "kirby",
      }),
    ).toBe("../data/kirb/Kirsten/kiwi");
  });

  it("matches a name of one or two characters only as a whole segment", () => {
    expect(
      relativeInputPath("/data/ab/cabin/sab", "/srv", {
        api: path.posix,
        username: "ab",
      }),
    ).toBe("../data/~/cabin/sab");
  });
});

describe("carriesAccount", () => {
  it.each([
    ["kirby", "kirby", true],
    ["Kirby Photos", "kirby", true],
    ["C--Users-KIRBY-Desktop", "kirby", true],
    ["kirb", "kirby", false],
    ["Pictures", "kirby", false],
    ["Pictures", "", false],
    ["Pictures", null, false],
    ["ab", "ab", true],
    ["cabin", "ab", false],
  ])("%j with the account %j is %s", (segment, username, expected) => {
    expect(carriesAccount(segment, username)).toBe(expected);
  });
});

describe("redactText", () => {
  it("replaces the account name wherever it is and in any letter case", () => {
    expect(
      redactText("open C:\\Users\\Kirby\\x and /home/KIRBY/y and kirby-usb", {
        username: "kirby",
      }),
    ).toBe("open C:\\Users\\~\\x and /home/~/y and ~-usb");
  });

  it("replaces given paths, in either slash style and any letter case, longest first", () => {
    const out = redactText(
      [
        "C:\\repo\\node_modules\\next\\dist\\bin\\next",
        "c:/REPO/tests/x.ts",
        "photos: D:\\shots\\day1 and D:\\shots\\day1\\IMG.jpg",
      ].join("\n"),
      {
        paths: [
          { from: "C:\\repo", to: "." },
          { from: "D:\\shots", to: "SHOTS" },
          { from: "D:\\shots\\day1", to: "day1" },
        ],
      },
    );
    expect(out).toBe(
      [
        ".\\node_modules\\next\\dist\\bin\\next",
        "./tests/x.ts",
        "photos: day1 and day1\\IMG.jpg",
      ].join("\n"),
    );
  });

  it("does not choke on regex characters in a path or the account", () => {
    expect(
      redactText("at C:\\a+b(1)\\[x]\\f.ts by k.rby", {
        username: "k.rby",
        paths: [{ from: "C:\\a+b(1)\\[x]", to: "." }],
      }),
    ).toBe("at .\\f.ts by ~");
    // "." is not a wildcard: kxrby is a different name.
    expect(redactText("kxrby", { username: "k.rby" })).toBe("kxrby");
  });

  it("leaves a name of one or two characters alone (it would match half the text)", () => {
    expect(redactText("a cabin by the sea", { username: "ab" })).toBe(
      "a cabin by the sea",
    );
  });

  it("changes nothing when there is nothing to hide", () => {
    expect(redactText("plain", {})).toBe("plain");
  });
});

describe("terminalRedaction", () => {
  const win = path.win32;
  const main = "C:\\Users\\kirby\\Desktop\\Mouse Shape Project\\Open_Mouse";
  const cwd = `${main}\\.claude\\worktrees\\kit`;
  const base = {
    cwd,
    scriptRoot: cwd,
    checkouts: [main, cwd],
    input: "C:\\Users\\kirby\\Pictures\\Session 1",
    outDir:
      "C:\\Users\\kirby\\Desktop\\Mouse Shape Project\\Fixtures\\learning",
    username: "kirby",
    api: win,
  };
  const show = (text: string, over: Partial<typeof base> = {}) =>
    redactText(text, terminalRedaction({ ...base, ...over }));

  it("shows the working folder and this checkout as '.', the other checkouts as <checkout>", () => {
    expect(show(`${cwd}\\node_modules\\next\\dist\\bin\\next`)).toBe(
      ".\\node_modules\\next\\dist\\bin\\next",
    );
    expect(show(`from ${main}\\.git`)).toBe("from <checkout>\\.git");
  });

  it("shows the photo and output folders the way the run log names them", () => {
    expect(show(`Checking 3 photos from ${base.input} …`)).toBe(
      "Checking 3 photos from ../../../../../../Pictures/Session 1 …",
    );
    expect(show(`Copied 4 to ${base.outDir}.`)).toBe(
      "Copied 4 to ../../../../Fixtures/learning.",
    );
  });

  it("leaves nothing that names the account, whatever the path", () => {
    const texts = [
      `${base.input}\\IMG_0001.jpg`,
      "C:\\Users\\Kirby\\AppData\\Local\\ms-playwright\\chromium\\chrome.exe",
      "/home/kirby/.cache/ms-playwright",
      `ENOENT: no such file or directory, open '${base.outDir}\\P001\\truth.json'`,
    ];
    for (const text of texts) expect(show(text)).not.toMatch(/kirby/i);
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
    const invalid: [string, unknown][] = [
      ["a hand length typo (1850)", withRight({ handLengthMm: 1850 })],
      [
        "a hand length that is too short (18.5)",
        withRight({ handLengthMm: 18.5 }),
      ],
      ["a palm width that is too narrow (8)", withRight({ palmWidthMm: 8 })],
      ["a palm width that is too wide (840)", withRight({ palmWidthMm: 840 })],
      ["an infinite palm width", withRight({ palmWidthMm: Infinity })],
      ["a value written as text", withRight({ handLengthMm: "185" })],
      ["an unknown key inside a hand", withRight({ gripMm: 12 })],
      ["a participant without padding", { ...base, participant: "7" }],
      ["a participant with too few digits", { ...base, participant: "P07" }],
      ["a participant with too many digits", { ...base, participant: "P0007" }],
      ["another format", { ...base, format: "v1" }],
      ["a name", { ...base, name: "Alice" }],
    ];
    for (const [label, value] of invalid) {
      expect(truthSchema.safeParse(value).success, label).toBe(false);
    }
  });
});

describe("truth.json limits", () => {
  const base = emptyTruth("P007");
  const accepts = (right: object) =>
    truthSchema.safeParse({ ...base, right: { ...base.right, ...right } })
      .success;

  it("hand length: 99.9 and 280.1 are refused, 100 and 280 are taken", () => {
    expect(accepts({ handLengthMm: 99.9 })).toBe(false);
    expect(accepts({ handLengthMm: 100 })).toBe(true);
    expect(accepts({ handLengthMm: 280 })).toBe(true);
    expect(accepts({ handLengthMm: 280.1 })).toBe(false);
  });

  it("palm width: 49.9 and 150.1 are refused, 50 and 150 are taken", () => {
    expect(accepts({ palmWidthMm: 49.9 })).toBe(false);
    expect(accepts({ palmWidthMm: 50 })).toBe(true);
    expect(accepts({ palmWidthMm: 150 })).toBe(true);
    expect(accepts({ palmWidthMm: 150.1 })).toBe(false);
  });

  it("the limits are the contract's own: for every value, the truth file agrees with handMeasurementsSchema", () => {
    for (const v of [
      0, 20, 49.9, 50, 80, 99.9, 100, 150, 150.1, 200, 279.9, 280, 280.1, 300,
    ]) {
      expect(accepts({ handLengthMm: v }), `hand length ${v}`).toBe(
        handMeasurementsSchema.shape.handLengthMm.safeParse(v).success,
      );
      expect(accepts({ palmWidthMm: v }), `palm width ${v}`).toBe(
        handMeasurementsSchema.shape.palmWidthMm.safeParse(v).success,
      );
    }
  });

  it("the left hand has the same limits as the right", () => {
    const left = (l: object) =>
      truthSchema.safeParse({ ...base, left: { ...base.left, ...l } }).success;
    expect(left({ handLengthMm: 99.9 })).toBe(false);
    expect(left({ handLengthMm: 100 })).toBe(true);
    expect(left({ palmWidthMm: 150.1 })).toBe(false);
  });

  it("an empty protocol is refused, so a file always says how it was measured", () => {
    expect(truthSchema.safeParse({ ...base, protocol: "" }).success).toBe(
      false,
    );
    expect(
      truthSchema.safeParse({ ...base, protocol: "candidate-v1" }).success,
    ).toBe(true);
  });
});
