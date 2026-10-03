import { describe, expect, it } from "vitest";
import { parseM2Args } from "../../src/lib/m2/cli";

const base = ["--log", "runs", "--truth", "truth"];
const v2 = ["--log", "runs"];

function ok(
  argv: string[],
  platform?: NodeJS.Platform,
  options?: { truthOptional?: boolean },
) {
  const parsed = parseM2Args(argv, platform, options);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.args;
}
function message(
  argv: string[],
  options?: { truthOptional?: boolean },
): string {
  const parsed = parseM2Args(argv, process.platform, options);
  if (parsed.ok) throw new Error("expected an error");
  return parsed.message;
}

describe("m2:evaluate arguments for kit v2: what is accepted", () => {
  it("a plain command line parses to what it always did: no kit v2 field appears", () => {
    expect(Object.keys(ok(base)).sort()).toEqual(
      [
        "gestures",
        "logs",
        "out",
        "participants",
        "path",
        "thresholds",
        "truths",
      ].sort(),
    );
  });

  it("--gesture marks the poses as the caller's choice, so a default can differ by protocol", () => {
    expect(ok(base).gestures).toEqual(["G01"]);
    expect(ok(base).gesturesGiven).toBeUndefined();
    const a = ok([...base, "--gesture", "G02"]);
    expect(a.gestures).toEqual(["G02"]);
    expect(a.gesturesGiven).toBe(true);
    // Even when it names the old default.
    expect(ok([...base, "--gesture", "G01"]).gesturesGiven).toBe(true);
  });

  it("--truth is not needed with --protocol agreed-v2, or when the caller will check after reading the logs", () => {
    expect(message(v2)).toMatch(/--truth is required/);
    expect(ok([...v2, "--protocol", "agreed-v2"]).truths).toEqual([]);
    expect(ok(v2, undefined, { truthOptional: true }).truths).toEqual([]);
    // Still required with the other protocol named.
    expect(message([...v2, "--protocol", "candidate-v1"])).toMatch(
      /--truth is required/,
    );
    // --log is always required.
    expect(message(["--protocol", "agreed-v2"])).toMatch(/--log is required/);
  });

  it("--protocol takes one of the two protocol names", () => {
    expect(ok([...base, "--protocol", "candidate-v1"]).protocol).toBe(
      "candidate-v1",
    );
    expect(ok([...v2, "--protocol", "agreed-v2"]).protocol).toBe("agreed-v2");
    expect(ok(base).protocol).toBeUndefined();
    expect(message([...base, "--protocol", "agreed-v3"])).toBe(
      "--protocol must be agreed-v2 or candidate-v1.",
    );
    expect(message([...base, "--protocol"])).toBe("--protocol needs a value.");
    expect(
      message([...base, "--protocol", "agreed-v2", "--protocol", "agreed-v2"]),
    ).toBe("--protocol was given more than once.");
  });

  it("the three switches take no value", () => {
    const a = ok([
      ...v2,
      "--protocol",
      "agreed-v2",
      "--held-out",
      "--aggregate-only",
    ]);
    expect(a.heldOut).toBe(true);
    expect(a.aggregateOnly).toBe(true);
    expect(a.s0).toBeUndefined();
    const b = ok([...v2, "--s0", "--protocol", "agreed-v2"]);
    expect(b.s0).toBe(true);
    expect(b.heldOut).toBeUndefined();
    // They may sit anywhere, before a flag that has a value too.
    expect(
      ok([
        ...v2,
        "--protocol",
        "agreed-v2",
        "--aggregate-only",
        "--out",
        "r.json",
      ]).out,
    ).toBe("r.json");
  });

  it("--records and --session may be repeated, in order", () => {
    const a = ok([
      ...v2,
      "--protocol",
      "agreed-v2",
      "--records",
      "a",
      "--records",
      "b",
      "--session",
      "s",
    ]);
    expect(a.records).toEqual(["a", "b"]);
    expect(a.sessions).toEqual(["s"]);
  });

  it("--labels may be repeated, and is absent unless given", () => {
    expect(ok(base).labels).toBeUndefined();
    const a = ok([
      ...v2,
      "--protocol",
      "agreed-v2",
      "--labels",
      "one",
      "--labels",
      "two",
    ]);
    expect(a.labels).toEqual(["one", "two"]);
    expect(message([...v2, "--labels"])).toMatch(/--labels needs a value/);
    expect(message([...base, "--labels=x"])).toBe(
      '--labels takes its value after a space, not after "=": write --labels <value>.',
    );
    expect(
      message([
        ...base,
        "--protocol",
        "candidate-v1",
        "--labels",
        "labels.json",
      ]),
    ).toBe("--labels belongs to agreed-v2, not candidate-v1.");
    expect(
      parseM2Args(
        [...base, "--protocol", "agreed-v2", "--labels", "/c/Users/me/x"],
        "win32",
      ),
    ).toMatchObject({
      ok: false,
      message: expect.stringContaining("--labels looks like a Git Bash path"),
    });
  });

  it("every kit v2 option together", () => {
    const a = ok([
      ...v2,
      "--protocol",
      "agreed-v2",
      "--records",
      "r",
      "--session",
      "s",
      "--held-out",
      "--aggregate-only",
      "--gesture",
      "G02",
      "--path",
      "markers",
      "--out",
      "report.json",
    ]);
    expect(a).toMatchObject({
      protocol: "agreed-v2",
      records: ["r"],
      sessions: ["s"],
      heldOut: true,
      aggregateOnly: true,
      gestures: ["G02"],
      path: "markers",
      out: "report.json",
    });
  });
});

describe("m2:evaluate arguments for kit v2: what is an error", () => {
  it.each([
    [
      "--held-out and --s0 together",
      [...v2, "--protocol", "agreed-v2", "--held-out", "--s0"],
      /--held-out and --s0 choose different participants/,
    ],
    [
      "--held-out narrowed by --participants",
      [
        ...v2,
        "--protocol",
        "agreed-v2",
        "--held-out",
        "--participants",
        "P004",
      ],
      /--held-out evaluates the whole held-out set: it cannot be narrowed/,
    ],
    [
      "--held-out under candidate-v1",
      [...base, "--protocol", "candidate-v1", "--held-out"],
      /--held-out belongs to agreed-v2, not candidate-v1\./,
    ],
    [
      "--s0 under candidate-v1",
      [...base, "--protocol", "candidate-v1", "--s0"],
      /--s0 belongs to agreed-v2/,
    ],
    [
      "--records under candidate-v1",
      [...base, "--protocol", "candidate-v1", "--records", "r"],
      /--records belongs to agreed-v2/,
    ],
    [
      "--session under candidate-v1",
      [...base, "--protocol", "candidate-v1", "--session", "s"],
      /--session belongs to agreed-v2/,
    ],
    [
      "--thresholds under agreed-v2",
      [...v2, "--protocol", "agreed-v2", "--thresholds", "t.json"],
      /--thresholds does not apply to agreed-v2: its criteria are frozen in the prereg/,
    ],
    [
      "--held-out given twice",
      [...base, "--held-out", "--held-out"],
      /--held-out was given more than once/,
    ],
    [
      "--aggregate-only given twice",
      [...base, "--aggregate-only", "--aggregate-only"],
      /--aggregate-only was given more than once/,
    ],
    [
      "--held-out with a value glued on",
      [...base, "--held-out=1"],
      /^--held-out takes no value\.$/,
    ],
    [
      "--s0 with a value glued on",
      [...base, "--s0=true"],
      /^--s0 takes no value\.$/,
    ],
    [
      "--aggregate-only with a value glued on",
      [...base, "--aggregate-only=yes"],
      /^--aggregate-only takes no value\.$/,
    ],
    [
      "a value after a switch",
      [...base, "--held-out", "P004"],
      /Unexpected argument at position 6/,
    ],
    [
      "--records with no value",
      [...base, "--records"],
      /--records needs a value/,
    ],
    [
      "--session=<value>",
      [...base, "--session=s"],
      /^--session takes its value after a space, not after "=": write --session <value>\.$/,
    ],
  ])("%s", (_label, argv, pattern) => {
    expect(message(argv)).toMatch(pattern);
  });

  it("a switch typed in the wrong case or spelling is unknown, not ignored", () => {
    expect(message([...base, "--heldout"])).toBe('Unknown option "--heldout".');
    // An underscore is not a plain option name, so it is not echoed.
    expect(message([...base, "--held_out"])).toBe(
      "An unrecognised option was given.",
    );
    expect(message([...base, "--aggregate"])).toBe(
      'Unknown option "--aggregate".',
    );
  });

  it("no message repeats a value: it could be a path with an account name", () => {
    const secret = "C:/Users/kirby/Photos";
    for (const argv of [
      [...base, "--protocol", secret],
      [...base, "--records", secret, "--records="],
      [...base, `--held-out=${secret}`],
      [...v2, "--protocol", "agreed-v2", "--thresholds", secret],
    ]) {
      expect(message(argv)).not.toMatch(/kirby|Users|Photos|C:/i);
    }
  });

  it("--records and --session in Git Bash spelling are refused on Windows, without repeating them", () => {
    for (const flag of ["--records", "--session"]) {
      const parsed = parseM2Args(
        [...base, "--protocol", "agreed-v2", flag, "/c/Users/me/x"],
        "win32",
      );
      expect(parsed.ok).toBe(false);
      const text = (parsed as { message: string }).message;
      expect(text).toContain(`${flag} looks like a Git Bash path`);
      expect(text).not.toMatch(/Users|\/c\//);
    }
    // An ordinary path elsewhere.
    expect(
      parseM2Args([...base, "--records", "/c/Users/me/x"], "linux").ok,
    ).toBe(true);
  });
});
