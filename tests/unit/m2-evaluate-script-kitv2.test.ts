/**
 * `npm run m2:evaluate` on kit v2 inputs (format-3 run logs, participant
 * records, no truth): the real script on synthetic files in a throwaway
 * folder, like m2-evaluate-script.test.ts does for candidate-v1.
 */
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir, userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  destinationsOf,
  kitV2LogOf,
  labelsRecordOf,
  participantRecordOf,
  sessionRecordOf,
  type KitV2SynthPhoto,
  type SynthLabel,
} from "./helpers/m2-kitv2-synth";
import { truthOf } from "./helpers/m2-synth";
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

const g02 = (
  participant: string,
  markersMm: number,
  paperMm: number = markersMm,
  extra: Partial<KitV2SynthPhoto> = {},
): KitV2SynthPhoto => ({
  participant,
  gesture: "G02",
  markersMm,
  paperMm,
  ...extra,
});
const g04 = (participant: string, markersMm: number): KitV2SynthPhoto => ({
  participant,
  gesture: "G04",
  markersMm,
});

// Block P001-P004 is complete (P004 is held out); P901 is S0.
const PHOTOS: KitV2SynthPhoto[] = [
  g02("P001", 190, 191),
  g02("P001", 191, 192),
  g02("P001", 189, 190),
  g04("P001", 152),
  g04("P001", 133),
  g02("P002", 180, 179, { palmRatio: 0.6 }),
  g02("P002", 182, 182, { palmRatio: 0.6 }),
  g02("P002", 181, 180, { palmRatio: 0.6 }),
  g04("P002", 145),
  g02("P003", 170),
  g02("P003", 170.5),
  g04("P003", 140),
  g02("P004", 200),
  g02("P004", 205),
  g02("P004", 195),
  g04("P004", 160),
  g02("P901", 185),
  g02("P901", 185),
];

describe("m2-evaluate script, kit v2 (agreed-v2)", () => {
  let scratch: string;
  let runs: string;
  let records: string;
  let sessions: string;
  let labels: string;
  let truth: string;
  const account = userInfo().username;

  beforeAll(() => {
    scratch = mkdtempSync(join(tmpdir(), "m2-kitv2-script-"));
    runs = join(scratch, "runs");
    records = join(scratch, "learning");
    sessions = join(scratch, "sessions");
    labels = join(scratch, "labels");
    truth = join(scratch, "truth");
    for (const dir of [runs, sessions, truth]) mkdirSync(dir);
    writeFileSync(
      join(runs, "2026-10-05.json"),
      JSON.stringify(kitV2LogOf(PHOTOS)),
    );
    for (const [id, grip] of [
      ["P001", "claw"],
      ["P002", "palm"],
      ["P003", "fingertip"],
      ["P004", "claw"],
      ["P901", "palm"],
    ] as const) {
      mkdirSync(join(records, id), { recursive: true });
      writeFileSync(
        join(records, id, "participant.json"),
        JSON.stringify(participantRecordOf(id, { gripSelf: grip })),
      );
    }
    writeFileSync(
      join(sessions, "session.json"),
      JSON.stringify(sessionRecordOf("S001", { phone: "Phone A" })),
    );
    // Blind labels for the calibration photos (the first twelve of the log),
    // named by destination as the sorter's template names them: ten good, one
    // bad (a photo the product accepted), one not labelled.
    mkdirSync(join(labels, "S001"), { recursive: true });
    const destinations = destinationsOf(PHOTOS);
    const calls: SynthLabel[] = [
      ...Array.from({ length: 10 }, (_, i): SynthLabel => ({
        file: destinations[i]!,
        label: "good",
      })),
      { file: destinations[10]!, label: "bad", reasons: ["blur"] },
    ];
    writeFileSync(
      join(labels, "S001", "labels.json"),
      JSON.stringify(labelsRecordOf("S001", true, calls)),
    );
    // A candidate-v1 truth file, to prove it is not mixed with agreed-v2.
    mkdirSync(join(truth, "P001"), { recursive: true });
    writeFileSync(
      join(truth, "P001", "truth.json"),
      JSON.stringify(truthOf("P001", { handLengthMm: 190, palmWidthMm: 80 })),
    );
  });
  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it("evaluates the calibration set with no truth: the summary, the JSON, and what was left out", () => {
    const out = join(scratch, "reports", "calibration.json");
    const result = evaluator([
      "--log",
      runs,
      "--records",
      records,
      "--session",
      sessions,
      "--out",
      out,
    ]);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(
      /^# M2 evaluation \(agreed-v2\): landmark-raw-v1/,
    );
    expect(result.stdout).toMatch(/Dormant: no ruler truth/);
    expect(result.stdout).toMatch(/Poses \(field tables\): G02\./);
    // P001 190 191 189, P002 180 182 181, P003 170 170.5: pooled 0.91 mm, next to its 1.00 mm reference.
    expect(result.stdout).toMatch(
      /\| 3 \| 8 \| 0 \| 5 \| 0\.91 mm \| 1\.00 mm \|/,
    );
    expect(result.stdout).toMatch(/\| held-out \| 1 \| 4 \|/);
    expect(result.stdout).toMatch(/\| S0 pilot \| 1 \| 2 \|/);
    // The phone comes from the session record the run log embeds.
    expect(result.stdout).toMatch(/\| Phone A, main 1x \| 3 \| 12 \|/);
    // What was left out is said on stderr too, by count.
    expect(result.stderr).toMatch(
      /agreed-v2: the calibration set\. Left out: 1 held-out, 1 S0 and 0 pending/,
    );
    expect(result.stderr).toMatch(/^JSON report written\.$/m);
    expect(result.stderr).not.toMatch(/calibration\.json/);

    const report = JSON.parse(readFileSync(out, "utf8"));
    expect(report.format).toBe("open-mouse-m2-evaluation/2");
    expect(report.protocol).toBe("agreed-v2");
    expect(report.accuracy).toEqual({
      status: "dormant",
      reason: "no ruler truth",
    });
    expect(report.kitV2.repeatability.people).toBe(3);
    expect(report.options.gestures).toEqual(["G02"]);

    // The per-person rows are there without --aggregate-only; no labels were given, and that is said.
    expect(result.stdout).toMatch(/## Per-person rows/);
    expect(result.stdout).toMatch(/\| P001 \| right \| 3 \|/);
    expect(result.stdout).toMatch(/No labels file was given \(--labels\)/);

    // No path, account name or file name in the summary, the report or the messages.
    const everything = [
      result.stdout,
      result.stderr,
      JSON.stringify(report),
    ].join("\n");
    expectNoLeak(everything, {
      folders: [scratch, REPO, tmpdir(), homedir()],
      username: account,
    });
    expect(everything).not.toMatch(/IMG_|\.jpg/);
    expect(everything).not.toMatch(/landmarks/i);
    expect(everything).not.toMatch(/accurate/i);
  });

  it("--held-out evaluates the held-out set only, with the loud notice on stderr and at the top of the summary; --gesture changes the field tables, not the per-person statistics", () => {
    const out = join(scratch, "reports", "held-out.json");
    const result = evaluator([
      "--log",
      runs,
      "--records",
      records,
      "--held-out",
      "--gesture",
      "G04",
      "--out",
      out,
    ]);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/Poses \(field tables\): G04\./);
    expect(result.stderr).toMatch(
      /\*\*\* HELD-OUT EVALUATION: this is meant to be run ONCE, by Claude, after the model is frozen\./,
    );
    expect(result.stderr).toMatch(/not again after the result has been seen/);
    expect(result.stdout).toMatch(
      /> \*\*HELD-OUT EVALUATION: this is meant to be run ONCE/,
    );
    // P004: 200 205 195, SD 5 mm.
    expect(result.stdout).toMatch(
      /\| 1 \| 3 \| 0 \| 2 \| 5\.00 mm \| 1\.00 mm \|/,
    );
    const report = JSON.parse(readFileSync(out, "utf8"));
    expect(report.notices).toHaveLength(1);
    expect(report.options.selection).toBe("held-out");
    expect(report.inputs.participants).toEqual(["P004"]);
  });

  it("--labels gives the headline: the product's verdict against Kirby's blind labels, with the target shown as a target", () => {
    const out = join(scratch, "reports", "judgement.json");
    const result = evaluator([
      "--log",
      runs,
      "--records",
      records,
      "--labels",
      labels,
      "--out",
      out,
    ]);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/## Judgement correctness \(headline\)/);
    expect(result.stdout).toMatch(
      /Target: 95\.0%\. It is a target, not a pass or fail threshold\./,
    );
    expect(result.stdout).toMatch(
      /Labelled photos: 11 \(labels: 10 good, 1 bad; product: 11 accepted, 0 retake\)\./,
    );
    expect(result.stdout).toMatch(
      /\| agreement \(accepted and good, or retake and bad\) \| 10 \| 90\.9% \|/,
    );
    expect(result.stdout).toMatch(/Left out as unlabelled: 1 \(/);
    expect(result.stdout).not.toMatch(
      /target (was )?(met|reached|missed|not met)/i,
    );
    const report = JSON.parse(readFileSync(out, "utf8"));
    expect(report.inputs.labelsFiles).toBe(1);
    expect(report.kitV2.judgement.headline.photos).toBe(11);
    expect(report.kitV2.judgement.headline.falseAccepts).toBe(1);
    expect(report.kitV2.judgement.target).toBe(0.95);
  });

  it("--aggregate-only keeps the judgement numbers and leaves no participant code or photo name in the summary, the JSON or the messages", () => {
    const out = join(scratch, "reports", "aggregate.json");
    const result = evaluator([
      "--log",
      runs,
      "--records",
      records,
      "--labels",
      labels,
      "--participants",
      "P001,P002,P004",
      "--aggregate-only",
      "--out",
      out,
    ]);
    expect(result.status).toBe(0);
    const json = readFileSync(out, "utf8");
    for (const text of [result.stdout, result.stderr, json]) {
      expect(text).not.toMatch(/P\d{3}|IMG_/);
    }
    expect(result.stdout).toMatch(/not included \(--aggregate-only\)/);
    // P001 and P002 hold the first nine of the labelled photos, all labelled good.
    expect(result.stdout).toMatch(/Labelled photos: 9 /);
    // The unnamed participant outside the set is counted, not named.
    expect(result.stderr).toMatch(
      /1 participants named with --participants are not in this run's set \(calibration\) and were not evaluated\./,
    );
    const report = JSON.parse(json);
    expect(report.aggregateOnly).toBe(true);
    expect(report.kitV2.people).toEqual([]);
    expect(report.kitV2.repeatability.rows).toEqual([]);
    expect(report.kitV2.repeatability.pooledSdMm).toBeGreaterThan(0);
    expect(report.kitV2.judgement.headline.photos).toBe(9);
    expect(report.excluded).toEqual([]);
  });

  it("a labels file that breaks the contract is an error that names it by position", () => {
    const bad = join(scratch, "bad-labels");
    mkdirSync(join(bad, "S001"), { recursive: true });
    writeFileSync(
      join(bad, "S001", "labels.json"),
      JSON.stringify(
        labelsRecordOf("S001", true, [
          { file: "P001/G02/1.jpg", label: "good", reasons: ["blur"] },
        ]),
      ),
    );
    const result = evaluator([
      "--log",
      runs,
      "--records",
      records,
      "--labels",
      bad,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(
      /labels record 1 is not a valid labels record/,
    );
    expect(result.stderr).toMatch(/only a bad photo has reasons/);
    expect(result.stderr).not.toContain(scratch);
    const missing = evaluator([
      "--log",
      runs,
      "--labels",
      join(scratch, "nope"),
    ]);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toMatch(/A --labels path does not exist\./);
  });

  it("--s0 evaluates the pilot on its own", () => {
    const result = evaluator(["--log", runs, "--records", records, "--s0"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/the S0 pilot only/);
    expect(result.stdout).not.toMatch(/HELD-OUT EVALUATION/);
    expect(result.stderr).not.toMatch(/HELD-OUT EVALUATION/);
  });

  describe("the two protocols are never mixed", () => {
    it("format-3 logs with a candidate-v1 truth file: refused, nothing evaluated", () => {
      const result = evaluator(["--log", runs, "--truth", truth]);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(
        /Truth file 1 is a candidate-v1 file but the run logs are agreed-v2: candidate-v1 values are never mixed with agreed-v2/,
      );
      expect(result.stdout).toBe("");
      expectNoLeak(result.stderr, {
        folders: [scratch, REPO],
        username: account,
      });
    });
  });

  it("a --truth folder holding no truth.json is said to be ignored (agreed-v2 has no ruler truth), and the run goes on", () => {
    const empty = join(scratch, "empty-truth");
    mkdirSync(empty);
    const result = evaluator([
      "--log",
      runs,
      "--records",
      records,
      "--truth",
      empty,
    ]);
    expect(result.status).toBe(0);
    expect(result.stderr).toMatch(
      /^--truth holds no truth\.json and agreed-v2 has no ruler truth, so the flag is ignored\.$/m,
    );
    expect(result.stderr).not.toContain(scratch);
    expect(result.stdout).toMatch(/^# M2 evaluation \(agreed-v2\)/);
    // Without --truth, nothing is said.
    const without = evaluator(["--log", runs, "--records", records]);
    expect(without.stderr).not.toMatch(/--truth/);
  });

  it("a participant outside the set is named on stderr, and when nobody is left it exits 2 with the reason", () => {
    const result = evaluator([
      "--log",
      runs,
      "--records",
      records,
      "--participants",
      "P004",
    ]);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(
      /Not in this run's set \(calibration\), so not evaluated: P004\./,
    );
    expect(result.stderr).toMatch(/No photo could be evaluated/);
    expect(result.stdout).toMatch(/# M2 evaluation \(agreed-v2\)/);
  });

  it("bad records or sessions are errors that name the input by position, not by path", () => {
    const bad = join(scratch, "bad-records");
    mkdirSync(join(bad, "P001"), { recursive: true });
    writeFileSync(
      join(bad, "P001", "participant.json"),
      JSON.stringify({ ...participantRecordOf("P001"), name: "someone" }),
    );
    const result = evaluator(["--log", runs, "--records", bad]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(
      /participant record 1 is not a valid participant record/,
    );
    expect(result.stderr).not.toContain(scratch);
    const missing = evaluator([
      "--log",
      runs,
      "--records",
      join(scratch, "nope"),
    ]);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toMatch(/A --records path does not exist\./);
    expect(missing.stderr).not.toContain(scratch);
  });
});
