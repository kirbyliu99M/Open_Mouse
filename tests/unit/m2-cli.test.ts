import { describe, expect, it } from "vitest";
import { parseM2Args } from "../../src/lib/m2/cli";

const base = ["--log", "runs", "--truth", "truth"];

function ok(...extra: string[]) {
  const parsed = parseM2Args([...base, ...extra]);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.args;
}
function message(argv: string[]): string {
  const parsed = parseM2Args(argv);
  if (parsed.ok) throw new Error("expected an error");
  return parsed.message;
}

describe("m2:evaluate arguments: what is accepted", () => {
  it("defaults: both paths, pose G01, everyone, no thresholds file, no report file", () => {
    expect(ok()).toEqual({
      logs: ["runs"],
      truths: ["truth"],
      path: "both",
      gestures: ["G01"],
      participants: null,
      thresholds: null,
      out: null,
    });
  });

  it("--log and --truth may be repeated, in order", () => {
    const parsed = parseM2Args([
      "--log",
      "a",
      "--log",
      "b",
      "--truth",
      "t1",
      "--truth",
      "t2",
    ]);
    expect(parsed).toMatchObject({
      ok: true,
      args: { logs: ["a", "b"], truths: ["t1", "t2"] },
    });
  });

  it("every option, together", () => {
    const a = ok(
      "--path",
      "markers",
      "--gesture",
      "G01,G02",
      "--participants",
      "P001, P002",
      "--thresholds",
      "limits.json",
      "--out",
      "report.json",
    );
    expect(a).toMatchObject({
      path: "markers",
      gestures: ["G01", "G02"],
      participants: ["P001", "P002"],
      thresholds: "limits.json",
      out: "report.json",
    });
  });
});

describe("m2:evaluate arguments: what is an error", () => {
  it.each([
    [
      "a misspelt flag",
      ["--participant", "P001"],
      /Unknown option "--participant"/,
    ],
    [
      "a misspelt flag with a value glued on",
      ["--partcipants=P001"],
      /Unknown option "--partcipants"/,
    ],
    ["a flag from another tool", ["--dry-run"], /Unknown option "--dry-run"/],
    ["a bare value", ["P001"], /Unexpected argument at position 5/],
    [
      "a flag at the end with no value",
      ["--participants"],
      /--participants needs a value/,
    ],
    [
      "a flag followed by another flag",
      ["--path", "--out", "x.json"],
      /--path needs a value/,
    ],
    ["an empty value", ["--out", ""], /--out needs a non-empty value/],
    [
      "a blank value",
      ["--participants", "  "],
      /--participants needs a non-empty value/,
    ],
    [
      "--path given twice",
      ["--path", "markers", "--path", "both"],
      /--path was given more than once/,
    ],
    [
      "--out given twice",
      ["--out", "a.json", "--out", "b.json"],
      /--out was given more than once/,
    ],
    [
      "--gesture given twice",
      ["--gesture", "G01", "--gesture", "G02"],
      /--gesture was given more than once/,
    ],
    [
      "--participants given twice",
      ["--participants", "P001", "--participants", "P002"],
      /--participants was given more than once/,
    ],
    [
      "--thresholds given twice",
      ["--thresholds", "a", "--thresholds", "b"],
      /--thresholds was given more than once/,
    ],
    [
      "an unknown path",
      ["--path", "marker"],
      /--path must be markers, paper-edge or both/,
    ],
    [
      "an empty entry in --participants",
      ["--participants", "P001,,P002"],
      /--participants needs a comma-separated list with no empty entry/,
    ],
    [
      "a trailing comma in --participants",
      ["--participants", "P001,"],
      /no empty entry/,
    ],
    [
      "a participant code with a typo",
      ["--participants", "P01"],
      /--participants has an entry that is not a participant code like P001/,
    ],
    [
      "a lower-case participant code",
      ["--participants", "p001"],
      /not a participant code/,
    ],
    [
      "the same participant twice",
      ["--participants", "P001,P001"],
      /--participants lists the same code more than once/,
    ],
    [
      "an unknown pose",
      ["--gesture", "G99"],
      /--gesture has an entry that is not a pose code/,
    ],
    ["a pose typo", ["--gesture", "g01"], /--gesture has an entry/],
    [
      "an empty pose entry",
      ["--gesture", "G01,"],
      /--gesture needs a comma-separated list/,
    ],
  ])("%s", (_label, extra, pattern) => {
    expect(message([...base, ...extra])).toMatch(pattern);
  });

  it("--log and --truth are required", () => {
    expect(message(["--truth", "t"])).toMatch(/--log is required/);
    expect(message(["--log", "r"])).toMatch(/--truth is required/);
    expect(message([])).toMatch(/--log is required/);
  });

  it("--participants never falls back to everyone: mistyped, empty and missing-value are all errors", () => {
    for (const bad of [
      ["--participants"],
      ["--participants", ""],
      ["--participants", ","],
      ["--participants", "P01"],
      ["--participant", "P001"],
      ["--participants="],
    ]) {
      expect(parseM2Args([...base, ...bad]).ok).toBe(false);
    }
  });

  it("no message repeats a value or a wrong token: it could be a path with an account name", () => {
    const secret = "C:/Users/kirby/Photos";
    for (const argv of [
      [...base, `--log=${secret}`],
      [...base, secret],
      [...base, "--path", secret],
      [...base, "--participants", secret],
      [...base, "--gesture", secret],
      [...base, "--out", secret, "--out", secret],
    ]) {
      expect(message(argv)).not.toMatch(/kirby|Users|Photos|C:/i);
    }
  });
});
