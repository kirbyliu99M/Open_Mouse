/**
 * `npm run m2:evaluate` reads landmarks of real people, so its refusals and
 * its output are tested by running the real script on synthetic files in a
 * throwaway folder.
 */
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  rmdirSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir, userInfo } from "node:os";
import { dirname, join, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { parseWorktreeList } from "../../src/lib/learning/paths";
import { runLogOf, truthOf } from "./helpers/m2-synth";
import { expectNoLeak } from "./helpers/no-absolute-paths";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TSX = join(REPO, "node_modules", "tsx", "dist", "cli.mjs");
const SCRIPT = join(REPO, "scripts", "m2-evaluate.ts");

// Every test here starts the real script through `tsx` (a second or two of
// start-up, more while the whole suite is running in parallel), and the child
// process has its own 60 s limit. vitest's default of 5 s per test is for
// code that does not spawn anything: without this the file passes alone and
// times out in the full run.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

function evaluator(args: readonly string[], env: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, [TSX, SCRIPT, ...args], {
    cwd: REPO,
    encoding: "utf8",
    timeout: 60_000,
    env: { ...process.env, CI: "", ...env },
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describe("m2-evaluate script", () => {
  let scratch: string;
  let runs: string;
  let truth: string;
  const photo = (mm: number) => ({
    participant: "P001",
    hand: "right" as const,
    paperMm: mm,
  });

  beforeAll(() => {
    scratch = mkdtempSync(join(tmpdir(), "m2-evaluate-test-"));
    runs = join(scratch, "runs");
    truth = join(scratch, "learning");
    mkdirSync(runs);
    mkdirSync(join(truth, "P001"), { recursive: true });
    writeFileSync(
      join(runs, "2026-10-02.json"),
      JSON.stringify(
        runLogOf([188, 190, 191, 187, 189].map(photo), {
          input: "../Photos/session-1",
        }),
      ),
    );
    writeFileSync(
      join(truth, "P001", "truth.json"),
      JSON.stringify(
        truthOf("P001", { handLengthMm: 190, palmWidthMm: 80 }),
        null,
        2,
      ),
    );
  });
  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it("reads a folder of run logs and a folder of truth files, prints a Markdown summary and writes the JSON report", () => {
    const out = join(scratch, "reports", "baseline.json");
    const result = evaluator(["--log", runs, "--truth", truth, "--out", out]);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/# M2 evaluation: landmark-raw-v2/);
    expect(result.stdout).toMatch(/未拍板/);
    // The numbers worked out by hand in m2-evaluate.test.ts: bias -1.00, MAE 1.40.
    expect(result.stdout).toMatch(
      /\| 5 \| -1\.00 \| 1\.40 \| 3\.00 \| 1\.58 \| -4\.10 \| 2\.10 \|/,
    );

    const report = JSON.parse(readFileSync(out, "utf8"));
    expect(report.format).toBe("open-mouse-m2-evaluation/1");
    expect(report.counts.measured).toBe(5);
    expect(
      report.groups.all["paper-edge"].fields.handLengthMm.accuracy.stats.n,
    ).toBe(5);
    // The confirmation does not repeat the file name the user chose.
    expect(result.stderr).toMatch(/^JSON report written\.$/m);
    expect(result.stderr).not.toMatch(/baseline/);
  });

  it("puts no path, account name or file name in the summary, the report or the messages", () => {
    const out = join(scratch, "reports", "clean.json");
    const result = evaluator(["--log", runs, "--truth", truth, "--out", out]);
    const account = userInfo().username;
    const everything = [
      result.stdout,
      result.stderr,
      readFileSync(out, "utf8"),
    ].join("\n");
    expectNoLeak(everything, {
      folders: [scratch, REPO, tmpdir(), homedir()],
      username: account,
    });
    expect(everything).not.toMatch(/IMG_|session-1|Photos\//);
    expect(everything).not.toMatch(/landmarks/i);
  });

  // An unexpected failure prints the message only: no stack, no absolute path,
  // no account name. Two ways to get one, by what the message quotes: the
  // report's folder (cannot be created below a file), and the report file
  // itself (a name no file system accepts).
  const account = userInfo().username;
  it.each([
    [
      "the report's folder cannot be created",
      () =>
        join(
          runs,
          "2026-10-02.json",
          account.length >= 3 ? `${account}-sub` : "sub",
          "report.json",
        ),
    ],
    [
      "the report file cannot be written",
      () => join(scratch, "unwritable", `${"a".repeat(300)}.json`),
    ],
  ])("when %s, it prints the message only", (_label, outOf) => {
    const out = outOf();
    const result = evaluator(["--log", runs, "--truth", truth, "--out", out]);
    expect(result.status).toBe(1);
    // The file system's own words are there...
    expect(result.stderr).toMatch(/ENOTDIR|EEXIST|ENOENT|ENAMETOOLONG|EINVAL/);
    // ...without the stack that would have listed where the script lives.
    expect(result.stderr).not.toMatch(/^\s+at /m);
    expect(result.stderr).not.toMatch(/scripts[\\/]m2-evaluate|node_modules/);
    // No absolute path (of any kind), no repo or scratch folder as an absolute
    // path, no account name. A relative path is fine although, on Linux, it
    // holds "/tmp/m2-evaluate-test-...": the scratch folder is under /tmp.
    expectNoLeak(result.stderr, {
      folders: [scratch, REPO, tmpdir(), homedir()],
      username: account,
    });
  });

  // Other ways the file system can say no, at the places the script touches it.
  describe("other file system failures print the redacted message only", () => {
    function expectQuiet(stderr: string) {
      expectNoLeak(stderr, {
        folders: [scratch, REPO, tmpdir(), homedir()],
        username: account,
      });
    }

    // A folder that exists and is a folder but cannot be listed. Windows: an
    // ACL entry that denies listing; elsewhere: mode 000 (which root ignores).
    function withUnlistable<T>(dir: string, run: () => T): T | "unsupported" {
      if (process.platform === "win32") {
        try {
          execFileSync("icacls", [dir, "/deny", `${account}:(RD)`], {
            stdio: "ignore",
          });
        } catch {
          return "unsupported";
        }
        try {
          return run();
        } finally {
          execFileSync("icacls", [dir, "/remove:d", account], {
            stdio: "ignore",
          });
        }
      }
      if (process.getuid?.() === 0) return "unsupported";
      chmodSync(dir, 0o000);
      try {
        return run();
      } finally {
        chmodSync(dir, 0o755);
      }
    }

    // Where the folder cannot be made unlistable (no icacls; running as root)
    // the test is SKIPPED, so the count shows it, not silently passed.
    for (const [flag, name] of [
      ["--log", "runs-locked"],
      ["--truth", "truth-locked"],
    ] as const) {
      it(`a ${flag} folder that cannot be listed`, ({ skip }) => {
        const locked = join(
          scratch,
          name,
          account.length >= 3 ? `${account}-x` : "x",
        );
        mkdirSync(locked, { recursive: true });
        const other = flag === "--log" ? truth : runs;
        const otherFlag = flag === "--log" ? "--truth" : "--log";
        const result = withUnlistable(locked, () =>
          evaluator([flag, locked, otherFlag, other]),
        );
        if (result === "unsupported") {
          skip(
            "this machine cannot make a folder unlistable (no icacls, or root)",
          );
          return;
        }
        expect(result.status).toBe(1);
        expect(result.stderr).toMatch(/EPERM|EACCES/);
        expectQuiet(result.stderr);
        expect(result.stdout).toBe("");
      });
    }

    // A file already sitting where the report goes, that the up-front check
    // cannot see: a link to nothing. Writing with "wx" then fails.
    it("the report path is taken by a link the up-front check cannot see (EEXIST or similar)", () => {
      const dir = join(scratch, "taken");
      mkdirSync(dir);
      const out = join(dir, account.length >= 3 ? `${account}.json` : "r.json");
      const target = join(dir, "gone");
      mkdirSync(target);
      symlinkSync(target, out, "junction");
      rmdirSync(target);
      try {
        expect(existsSync(out)).toBe(false);
        const result = evaluator([
          "--log",
          runs,
          "--truth",
          truth,
          "--out",
          out,
        ]);
        expect(result.status).toBe(1);
        expect(result.stderr).toMatch(/EEXIST|EISDIR|EPERM|EACCES|ENOENT/);
        expectQuiet(result.stderr);
      } finally {
        if (process.platform === "win32") rmdirSync(out);
        else unlinkSync(out);
      }
    });
  });

  describe("the command line is checked", () => {
    it.each([
      [
        "a misspelt flag",
        ["--participant", "P001"],
        /Unknown option "--participant"/,
      ],
      [
        "--participants with no value",
        ["--participants"],
        /--participants needs a value/,
      ],
      [
        "--participants with an empty value",
        ["--participants", ""],
        /--participants needs a non-empty value/,
      ],
      [
        "--participants with a mistyped code",
        ["--participants", "P01"],
        /not a participant code/,
      ],
      [
        "a single-value flag given twice",
        ["--out", "a.json", "--out", "b.json"],
        /--out was given more than once/,
      ],
      ["a value where a flag should be", ["oops"], /Unexpected argument/],
    ])("%s is an error, and nothing is evaluated", (_label, extra, pattern) => {
      const result = evaluator(["--log", runs, "--truth", truth, ...extra]);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(pattern);
      expect(result.stderr).toMatch(/Usage: npm run m2:evaluate/);
      // Not a run over everyone with the flag ignored.
      expect(result.stdout).toBe("");
    });

    // "/c/Users/me" is how Git Bash spells C:\Users\me; Node on Windows reads
    // it as a folder named "c" and --out would create it: a stray C:\c tree.
    it.skipIf(process.platform !== "win32")(
      "a Git Bash style path is refused on Windows, and no folder is made",
      () => {
        const unique = `m2-msys-${process.pid}-${Date.now()}`;
        const stray = join(parse(scratch).root, "c", unique);
        const cases: [string, string[]][] = [
          [
            "--out",
            ["--log", runs, "--truth", truth, "--out", `/c/${unique}/r.json`],
          ],
          ["--log", ["--log", `/c/${unique}/runs`, "--truth", truth]],
          ["--truth", ["--log", runs, "--truth", `/c/${unique}/t`]],
        ];
        for (const [flag, args] of cases) {
          const result = evaluator(args);
          expect(result.status).toBe(1);
          expect(result.stderr).toContain(`${flag} looks like a Git Bash path`);
          expect(result.stderr).not.toContain(unique);
          expect(result.stdout).toBe("");
        }
        expect(existsSync(stray)).toBe(false);
      },
    );

    it("an unknown option that is a path is not repeated", () => {
      const result = evaluator([
        "--log",
        runs,
        "--truth",
        truth,
        `--${join(scratch, "x")}`,
      ]);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/An unrecognised option was given\./);
      expectNoLeak(result.stderr, {
        folders: [scratch, REPO, tmpdir(), homedir()],
        username: account,
      });
    });

    it("--out=<path>: says to use a space, and never echoes the path", () => {
      const result = evaluator([
        "--log",
        runs,
        "--truth",
        truth,
        `--out=${join(scratch, "x.json")}`,
      ]);
      expect(result.status).toBe(1);
      // A real option with its value glued on: named, with what to do; the value is not repeated.
      expect(result.stderr).toMatch(
        /--out takes its value after a space, not after "="/,
      );
      expect(result.stderr).not.toContain(scratch);
      expect(result.stderr).not.toContain("x.json");
    });
  });

  describe("defaults and repeated flags", () => {
    let mixed: string;
    let two: { a: string; b: string; truths: string };

    beforeAll(() => {
      // One log with two poses of the same participant.
      mixed = join(scratch, "mixed");
      mkdirSync(mixed);
      writeFileSync(
        join(mixed, "log.json"),
        JSON.stringify(
          runLogOf([
            ...[188, 190].map(photo),
            ...[189, 191].map((mm) => ({ ...photo(mm), gesture: "G02" })),
          ]),
        ),
      );
      // Two separate logs, two participants, named one by one.
      two = {
        a: join(scratch, "a.json"),
        b: join(scratch, "b.json"),
        truths: join(scratch, "learning-2"),
      };
      writeFileSync(
        two.a,
        JSON.stringify(runLogOf([188, 190].map(photo), { gitSha: null })),
      );
      writeFileSync(
        two.b,
        JSON.stringify(
          runLogOf(
            [200, 202].map((mm) => ({
              participant: "P002",
              hand: "right" as const,
              paperMm: mm,
            })),
          ),
        ),
      );
      for (const [code, mm] of [
        ["P001", 190],
        ["P002", 200],
      ] as const) {
        mkdirSync(join(two.truths, code), { recursive: true });
        writeFileSync(
          join(two.truths, code, "truth.json"),
          JSON.stringify(truthOf(code, { handLengthMm: mm, palmWidthMm: 80 })),
        );
      }
    });

    const reportOf = (args: string[]) => {
      const out = join(
        scratch,
        `default-${Math.random().toString(36).slice(2)}.json`,
      );
      const result = evaluator([...args, "--out", out]);
      expect(result.status).toBe(0);
      return JSON.parse(readFileSync(out, "utf8"));
    };

    it("--gesture defaults to G01 only: the other poses are counted out of scope", () => {
      const byDefault = reportOf(["--log", mixed, "--truth", truth]);
      expect(byDefault.options.gestures).toEqual(["G01"]);
      expect(byDefault.counts).toMatchObject({ measured: 2, outOfScope: 2 });
      const both = reportOf([
        "--log",
        mixed,
        "--truth",
        truth,
        "--gesture",
        "G01,G02",
      ]);
      expect(both.counts).toMatchObject({ measured: 4, outOfScope: 0 });
    });

    it("--log can be repeated: every file named is read, and only those", () => {
      const both = reportOf([
        "--log",
        two.a,
        "--log",
        two.b,
        "--truth",
        two.truths,
      ]);
      expect(both.inputs.runLogs).toHaveLength(2);
      expect(both.inputs.participants).toEqual(["P001", "P002"]);
      expect(both.counts.measured).toBe(4);
      const onlyA = reportOf(["--log", two.a, "--truth", two.truths]);
      expect(onlyA.inputs.runLogs).toHaveLength(1);
      expect(onlyA.inputs.participants).toEqual(["P001"]);
    });

    it("a requested participant with nothing evaluated is named on stderr, without stopping the run", () => {
      const result = evaluator([
        "--log",
        two.a,
        "--truth",
        two.truths,
        "--participants",
        "P001,P002",
      ]);
      expect(result.status).toBe(0);
      expect(result.stderr).toMatch(/Nothing was evaluated for P002/);
    });

    it("with --aggregate-only the participants named but not evaluated are counted on stderr, never named", () => {
      const result = evaluator([
        "--log",
        two.a,
        "--truth",
        two.truths,
        "--participants",
        "P001,P002,P003",
        "--aggregate-only",
      ]);
      expect(result.status).toBe(0);
      expect(result.stderr).toMatch(
        /^Nothing was evaluated for 2 of the participants named: no measured photo in the logs\.$/m,
      );
      expect(result.stderr).not.toMatch(/P\d{3}/);
      expect(result.stdout).not.toMatch(/P\d{3}/);
    });
  });

  it("takes a single run log file and a single truth file, and the options", () => {
    const result = evaluator([
      "--log",
      join(runs, "2026-10-02.json"),
      "--truth",
      join(truth, "P001", "truth.json"),
      "--path",
      "paper-edge",
      "--gesture",
      "G01,G02",
      "--participants",
      "P001",
    ]);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/- Paths: paper-edge\n/);
    expect(result.stdout).toMatch(/- Poses: G01, G02\n/);
    expect(result.stdout).not.toMatch(/### markers/);
  });

  it("reads limits from a thresholds file", () => {
    const file = join(scratch, "limits.json");
    writeFileSync(
      file,
      JSON.stringify({
        status: "agreed in the test",
        accuracyMm: { handLengthMm: 5 },
      }),
    );
    const result = evaluator([
      "--log",
      runs,
      "--truth",
      truth,
      "--thresholds",
      file,
    ]);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/Limits: agreed in the test\./);
    expect(result.stdout).toMatch(
      /MAE within the limit: 1\.40 mm against 5\.00 mm: \*\*within\*\*/,
    );
  });

  describe("refusals", () => {
    it("will not write the report inside the repo", () => {
      const inRepo = join(REPO, "m2-report-should-not-exist.json");
      const result = evaluator([
        "--log",
        runs,
        "--truth",
        truth,
        "--out",
        inRepo,
      ]);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(
        /--out must be outside the repo and every git worktree/,
      );
      expect(existsSync(inRepo)).toBe(false);
      expect(result.stdout).toBe("");
    });

    it("will not write inside a folder of the repo that does not exist yet", () => {
      const result = evaluator([
        "--log",
        runs,
        "--truth",
        truth,
        "--out",
        join(REPO, "a", "b", "c.json"),
      ]);
      expect(result.status).toBe(1);
      expect(existsSync(join(REPO, "a"))).toBe(false);
    });

    // Needs a second worktree of this repository (a developer's machine has
    // one, a CI checkout does not); the rule itself is tested against a real
    // throwaway repository in learning-sorter-paths.test.ts.
    const otherWorktree = (() => {
      try {
        const listed = execFileSync(
          "git",
          ["worktree", "list", "--porcelain"],
          {
            cwd: REPO,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
          },
        );
        return parseWorktreeList(listed)
          .slice(1)
          .find((root) => resolve(root).toLowerCase() !== REPO.toLowerCase());
      } catch {
        return undefined;
      }
    })();
    it.skipIf(!otherWorktree)(
      "will not write inside another git worktree",
      () => {
        const result = evaluator([
          "--log",
          runs,
          "--truth",
          truth,
          "--out",
          join(otherWorktree!, "m2-report-should-not-exist.json"),
        ]);
        expect(result.status).toBe(1);
        expect(result.stderr).toMatch(/--out must be outside the repo/);
      },
    );

    it("will not overwrite a report that exists", () => {
      const out = join(scratch, "existing.json");
      writeFileSync(out, "keep me");
      const result = evaluator(["--log", runs, "--truth", truth, "--out", out]);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/never overwritten/);
      expect(readFileSync(out, "utf8")).toBe("keep me");
    });

    it("never runs in CI", () => {
      const result = evaluator(["--log", runs, "--truth", truth], { CI: "1" });
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/must never run in CI/);
      expect(result.stdout).toBe("");
    });

    it("says how to use it when the inputs are missing, and rejects a wrong --path", () => {
      expect(evaluator([]).stderr).toMatch(/Usage: npm run m2:evaluate/);
      expect(evaluator(["--log", runs]).stderr).toMatch(/Usage/);
      const bad = evaluator([
        "--log",
        runs,
        "--truth",
        truth,
        "--path",
        "sideways",
      ]);
      expect(bad.status).toBe(1);
      expect(bad.stderr).toMatch(/--path must be markers, paper-edge or both/);
    });
  });

  describe("bad inputs are errors that name the input by position, not by path", () => {
    it("a file that is not JSON", () => {
      const bad = join(scratch, "bad-runs");
      mkdirSync(bad);
      writeFileSync(join(bad, "x.json"), "{ not json");
      const result = evaluator(["--log", bad, "--truth", truth]);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/Run log 1 could not be read as JSON\./);
      expect(result.stderr).not.toContain(scratch);
    });

    it("a run log of the wrong format", () => {
      const bad = join(scratch, "old-runs");
      mkdirSync(bad);
      writeFileSync(
        join(bad, "x.json"),
        JSON.stringify({ kitVersion: 1, reports: [] }),
      );
      const result = evaluator(["--log", bad, "--truth", truth]);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/run log 1 does not fit the format/);
    });

    it("a truth file that is not valid", () => {
      const bad = join(scratch, "bad-truth");
      mkdirSync(join(bad, "P001"), { recursive: true });
      writeFileSync(
        join(bad, "P001", "truth.json"),
        JSON.stringify({ participant: "P001", handLengthMm: 190 }),
      );
      const result = evaluator(["--log", runs, "--truth", bad]);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/truth file 1 is not a valid truth file/);
    });

    it("a folder without any truth.json, and a path that does not exist", () => {
      const empty = join(scratch, "empty");
      mkdirSync(empty);
      expect(evaluator(["--log", runs, "--truth", empty]).stderr).toMatch(
        /No truth\.json was found/,
      );
      const missing = evaluator([
        "--log",
        join(scratch, "nope"),
        "--truth",
        truth,
      ]);
      expect(missing.status).toBe(1);
      expect(missing.stderr).toMatch(/A --log path does not exist\./);
      expect(missing.stderr).not.toContain(scratch);
    });

    it("thresholds that do not make sense", () => {
      const file = join(scratch, "bad-limits.json");
      writeFileSync(file, JSON.stringify({ accuracyMm: { handLengthMm: -1 } }));
      const result = evaluator([
        "--log",
        runs,
        "--truth",
        truth,
        "--thresholds",
        file,
      ]);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/must be a positive number/);
    });
  });

  it("when nothing could be evaluated it says so and exits 2, after showing why", () => {
    const result = evaluator([
      "--log",
      runs,
      "--truth",
      truth,
      "--participants",
      "P999",
    ]);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/No photo could be evaluated/);
    expect(result.stdout).toMatch(/# M2 evaluation/);
  });
});
