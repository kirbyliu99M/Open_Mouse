/**
 * `npm run m2:evaluate` reads landmarks of real people, so its refusals and
 * its output are tested by running the real script on synthetic files in a
 * throwaway folder.
 */
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseWorktreeList } from "../../src/lib/learning/paths";
import { runLogOf, truthOf } from "./helpers/m2-synth";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TSX = join(REPO, "node_modules", "tsx", "dist", "cli.mjs");
const SCRIPT = join(REPO, "scripts", "m2-evaluate.ts");

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
    expect(result.stdout).toMatch(/# M2 evaluation: landmark-raw-v1/);
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
    expect(result.stderr).toMatch(/JSON report written to baseline\.json\./);
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
    expect(everything).not.toContain(scratch);
    expect(everything).not.toContain(tmpdir());
    expect(everything.toLowerCase()).not.toContain(account.toLowerCase());
    expect(everything).not.toMatch(/IMG_|session-1|Photos\//);
    expect(everything).not.toMatch(/landmarks/i);
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
