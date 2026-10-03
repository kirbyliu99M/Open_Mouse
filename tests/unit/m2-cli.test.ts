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
      ["--participants=P001"],
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

  // A path typed with two dashes in front of it (or glued to a flag) must not
  // come back in the error.
  it.each([
    ["a Windows path after two dashes", "--C:\\Users\\kirby\\x"],
    ["a POSIX path after two dashes", "--/home/kirby/x"],
    ["a name with a dot", "--kirby.photos"],
    ["a very long name", `--${"a".repeat(80)}`],
    ["an empty name", "--"],
    ["a name with a space", "--my photos"],
    ["a name with non-ASCII letters", "--照片"],
  ])("an unknown option that is %s is not repeated", (_label, token) => {
    const text = message([...base, token]);
    expect(text).toBe("An unrecognised option was given.");
    const glued = message([...base, `${token}=value`]);
    expect(glued).toBe("An unrecognised option was given.");
  });

  // "--participants=P001" is how other tools take a value; here it is a space.
  it.each([
    "--log",
    "--truth",
    "--path",
    "--gesture",
    "--participants",
    "--thresholds",
    "--out",
  ])(
    "%s=<value> says to use a space, names the option, and never repeats the value",
    (flag) => {
      for (const value of ["P001", "C:/Users/kirby/x", "", "a=b"]) {
        const text = message([...base, `${flag}=${value}`]);
        expect(text).toBe(
          `${flag} takes its value after a space, not after "=": write ${flag} <value>.`,
        );
      }
    },
  );

  it("a misspelt option with = is still unknown, not 'use a space'", () => {
    expect(message([...base, "--participant=P001"])).toBe(
      'Unknown option "--participant".',
    );
    expect(message([...base, "--=x"])).toBe(
      "An unrecognised option was given.",
    );
  });

  it("a plain option name is shown, up to the equals sign, and no further", () => {
    expect(message([...base, "--partcipants=P001"])).toBe(
      'Unknown option "--partcipants".',
    );
    expect(message([...base, "--dry-run"])).toBe('Unknown option "--dry-run".');
    expect(message([...base, `--${"a".repeat(30)}`])).toContain(
      `--${"a".repeat(30)}`,
    );
    expect(message([...base, `--${"a".repeat(31)}`])).toBe(
      "An unrecognised option was given.",
    );
  });
});

describe("m2:evaluate arguments: Git Bash paths on Windows", () => {
  const win = "win32";
  const parse = (argv: string[], platform: NodeJS.Platform = win) =>
    parseM2Args(argv, platform);

  it("Cygwin and WSL spellings are refused too", () => {
    for (const bad of [
      ["--log", "/cygdrive/c/Users/me/runs", "--truth", "t"],
      ["--log", "r", "--truth", "/mnt/c/Users/me/learning"],
      ["--log", "r", "--truth", "t", "--out", "/mnt/d/report.json"],
    ]) {
      const result = parse(bad);
      expect(result.ok).toBe(false);
      expect((result as { message: string }).message).toMatch(
        /looks like a Git Bash path/,
      );
    }
    // Not a drive: an ordinary folder on Windows, and everything elsewhere.
    expect(parse(["--log", "r", "--truth", "/mnt/data/t"]).ok).toBe(true);
    expect(parse(["--log", "/mnt/c/runs", "--truth", "t"], "linux").ok).toBe(
      true,
    );
  });

  it.each([
    ["--log", ["--log", "/c/Users/me/runs", "--truth", "t"]],
    ["--truth", ["--log", "r", "--truth", "/d/data/learning"]],
    ["--thresholds", [...base, "--thresholds", "/c/limits.json"]],
    ["--out", [...base, "--out", "/c/Users/me/report.json"]],
    ["a repeated --log", ["--log", "ok", "--log", "/e/runs", "--truth", "t"]],
  ])(
    "%s in Git Bash spelling is refused, without repeating it",
    (flag, argv) => {
      const result = parse(argv);
      expect(result.ok).toBe(false);
      const text = (result as { message: string }).message;
      expect(text).toMatch(/looks like a Git Bash path/);
      expect(text).not.toMatch(/Users|\/c\/|\/d\/|\/e\//);
      if (flag.startsWith("--")) expect(text).toContain(flag);
    },
  );

  it("is an ordinary path elsewhere, and a Windows path is fine on Windows", () => {
    expect(parse([...base, "--out", "/c/tmp/r.json"], "linux").ok).toBe(true);
    expect(parse([...base, "--out", "/c/tmp/r.json"], "darwin").ok).toBe(true);
    expect(
      parse(["--log", "C:\\runs", "--truth", "D:\\t", "--out", "E:\\r.json"])
        .ok,
    ).toBe(true);
    expect(parse(["--log", "runs", "--truth", "/cx/t"]).ok).toBe(true);
  });
});
