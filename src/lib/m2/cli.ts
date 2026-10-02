/**
 * The command line of `npm run m2:evaluate`, parsed strictly. A misspelt flag,
 * a flag with no value, a single-value flag given twice, or a value that is
 * empty is an error, never a default: in particular `--participants` must
 * never fall back to "everyone" because it was mistyped.
 *
 * Messages name the flag, never the value or the token that was wrong: that
 * could be a path with an account name in it.
 *
 * Two protocols (src/lib/m2/protocol.ts). The protocol is the run logs'
 * (format 2 is candidate-v1, format 3 is agreed-v2), so what a run needs
 * depends on files this parser does not open: `--truth` is required here
 * unless `--protocol agreed-v2` is given or the caller says it will check for
 * itself (`truthOptional`), which the script does once it has read the logs.
 * Fields that exist only when their flag was given are left out otherwise,
 * so a plain command line parses to exactly what it always did.
 */
import { GESTURES } from "../learning/kit";
import { looksLikeMsysPath } from "../learning/paths";
import { PROTOCOLS, isProtocol, type Protocol } from "./protocol";

export type PathChoice = "markers" | "paper-edge" | "both";

export interface M2Args {
  readonly logs: readonly string[];
  readonly truths: readonly string[];
  readonly path: PathChoice;
  readonly gestures: readonly string[];
  /** `null` = everyone in the logs (the flag was not given). */
  readonly participants: readonly string[] | null;
  readonly thresholds: string | null;
  readonly out: string | null;
  /** `--gesture` was given, so `gestures` is the caller's choice and not the default. */
  readonly gesturesGiven?: true;
  /** `--protocol`; absent = the run logs' own. */
  readonly protocol?: Protocol;
  /** `--records`: participant.json files or folders (agreed-v2). */
  readonly records?: readonly string[];
  /** `--session`: session.json files or folders (agreed-v2). */
  readonly sessions?: readonly string[];
  /** `--held-out`: only the held-out participants (agreed-v2), once, by Claude, on the frozen model. */
  readonly heldOut?: true;
  /** `--s0`: only the S0 pilot (agreed-v2). */
  readonly s0?: true;
  /** `--aggregate-only`: no per-person or per-photo row in the output. */
  readonly aggregateOnly?: true;
}

export type ParsedArgs =
  | { readonly ok: true; readonly args: M2Args }
  | { readonly ok: false; readonly message: string };

export interface ParseOptions {
  /** Do not require `--truth` here; the caller checks it once the protocol is known. */
  readonly truthOptional?: boolean;
}

const REPEATABLE = ["--log", "--truth", "--records", "--session"] as const;
const SINGLE = [
  "--path",
  "--gesture",
  "--participants",
  "--thresholds",
  "--out",
  "--protocol",
] as const;
/** Flags that take no value. */
const BOOLEAN = ["--held-out", "--s0", "--aggregate-only"] as const;
const KNOWN: readonly string[] = [...REPEATABLE, ...SINGLE];

const PARTICIPANT = /^P\d{3}$/;
const GESTURE_CODES: readonly string[] = GESTURES.map((g) => g.code);

const bad = (message: string): ParsedArgs => ({ ok: false, message });

/** A comma-separated list with no empty entry and no duplicate, each checked. */
function codeList(
  flag: string,
  raw: string,
  valid: (code: string) => boolean,
  shape: string,
): { codes: string[] } | { message: string } {
  const codes = raw.split(",").map((c) => c.trim());
  if (codes.some((c) => c === "")) {
    return {
      message: `${flag} needs a comma-separated list with no empty entry (${shape}).`,
    };
  }
  if (codes.some((c) => !valid(c))) {
    return { message: `${flag} has an entry that is not ${shape}.` };
  }
  if (new Set(codes).size !== codes.length) {
    return { message: `${flag} lists the same code more than once.` };
  }
  return { codes };
}

/**
 * An option name that is safe to show back: plain letters, digits and hyphens,
 * not long. Anything else (a path someone typed with two dashes in front, say)
 * is not repeated.
 */
const SAFE_OPTION = /^--[A-Za-z0-9-]{1,30}$/;

const PATH_FLAGS = [
  "--log",
  "--truth",
  "--records",
  "--session",
  "--thresholds",
  "--out",
] as const;

export function parseM2Args(
  argv: readonly string[],
  platform: NodeJS.Platform = process.platform,
  parseOptions: ParseOptions = {},
): ParsedArgs {
  const repeated: Record<string, string[]> = {
    "--log": [],
    "--truth": [],
    "--records": [],
    "--session": [],
  };
  const single = new Map<string, string>();
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (!token.startsWith("--")) {
      return bad(
        `Unexpected argument at position ${i + 1} (a value must follow its flag).`,
      );
    }
    // "--participants=P001": a real option written the way other tools take
    // values. Say so, by the option's name; the value is never repeated.
    const equals = token.indexOf("=");
    if (equals > 0 && KNOWN.includes(token.slice(0, equals))) {
      const name = token.slice(0, equals);
      return bad(
        `${name} takes its value after a space, not after "=": write ${name} <value>.`,
      );
    }
    if (
      equals > 0 &&
      (BOOLEAN as readonly string[]).includes(token.slice(0, equals))
    ) {
      return bad(`${token.slice(0, equals)} takes no value.`);
    }
    if ((BOOLEAN as readonly string[]).includes(token)) {
      if (flags.has(token)) return bad(`${token} was given more than once.`);
      flags.add(token);
      continue;
    }
    if (!KNOWN.includes(token)) {
      // Only a plain option name is echoed (`--partcipants=...` shows
      // "--partcipants"); a token that is anything else, such as a path with
      // two dashes in front of it, is not repeated.
      const name = token.split("=")[0]!;
      return bad(
        SAFE_OPTION.test(name)
          ? `Unknown option "${name}".`
          : "An unrecognised option was given.",
      );
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      return bad(`${token} needs a value.`);
    }
    if (value.trim() === "") return bad(`${token} needs a non-empty value.`);
    i++;
    if ((REPEATABLE as readonly string[]).includes(token)) {
      repeated[token]!.push(value);
    } else {
      if (single.has(token)) return bad(`${token} was given more than once.`);
      single.set(token, value);
    }
  }
  // "/c/Users/me" is Git Bash's spelling; Windows Node would read it as a
  // folder named "c" on the current drive, and --out would create it.
  for (const flag of PATH_FLAGS) {
    const values = repeated[flag] ?? [];
    const one = single.get(flag);
    for (const value of one === undefined ? values : [one]) {
      if (looksLikeMsysPath(value, platform)) {
        return bad(
          `${flag} looks like a Git Bash path (a slash, one letter, a slash), which Windows reads as a folder on the current drive. Give the Windows form instead: the drive letter, a colon, then the folders with backslashes.`,
        );
      }
    }
  }
  if (repeated["--log"]!.length === 0) return bad("--log is required.");

  let protocol: Protocol | undefined;
  const protocolArg = single.get("--protocol");
  if (protocolArg !== undefined) {
    if (!isProtocol(protocolArg)) {
      return bad(`--protocol must be ${PROTOCOLS.join(" or ")}.`);
    }
    protocol = protocolArg;
  }
  // Under agreed-v2 there is no ruler truth, so --truth is not required. When
  // the protocol is not named, the caller may decide after reading the logs.
  if (
    repeated["--truth"]!.length === 0 &&
    protocol !== "agreed-v2" &&
    parseOptions.truthOptional !== true
  ) {
    return bad("--truth is required.");
  }

  const heldOut = flags.has("--held-out");
  const s0 = flags.has("--s0");
  if (heldOut && s0) {
    return bad("--held-out and --s0 choose different participants: give one.");
  }
  if (protocol === "candidate-v1") {
    for (const [given, name] of [
      [heldOut, "--held-out"],
      [s0, "--s0"],
      [repeated["--records"]!.length > 0, "--records"],
      [repeated["--session"]!.length > 0, "--session"],
    ] as const) {
      if (given) return bad(`${name} belongs to agreed-v2, not candidate-v1.`);
    }
  }
  if (protocol === "agreed-v2" && single.has("--thresholds")) {
    return bad(
      "--thresholds does not apply to agreed-v2: its criteria are frozen in the prereg.",
    );
  }
  if (heldOut && single.has("--participants")) {
    return bad(
      "--held-out evaluates the whole held-out set: it cannot be narrowed with --participants.",
    );
  }

  const path = single.get("--path") ?? "both";
  if (path !== "markers" && path !== "paper-edge" && path !== "both") {
    return bad("--path must be markers, paper-edge or both.");
  }
  let gestures = ["G01"];
  const gestureArg = single.get("--gesture");
  if (gestureArg !== undefined) {
    const parsed = codeList(
      "--gesture",
      gestureArg,
      (c) => GESTURE_CODES.includes(c),
      `a pose code like ${GESTURE_CODES.slice(0, 2).join(", ")}`,
    );
    if ("message" in parsed) return bad(parsed.message);
    gestures = parsed.codes;
  }
  let participants: string[] | null = null;
  const participantsArg = single.get("--participants");
  if (participantsArg !== undefined) {
    const parsed = codeList(
      "--participants",
      participantsArg,
      (c) => PARTICIPANT.test(c),
      "a participant code like P001",
    );
    if ("message" in parsed) return bad(parsed.message);
    participants = parsed.codes;
  }
  return {
    ok: true,
    args: {
      logs: repeated["--log"]!,
      truths: repeated["--truth"]!,
      path,
      gestures,
      participants,
      thresholds: single.get("--thresholds") ?? null,
      out: single.get("--out") ?? null,
      ...(gestureArg !== undefined ? { gesturesGiven: true as const } : {}),
      ...(protocol !== undefined ? { protocol } : {}),
      ...(repeated["--records"]!.length > 0
        ? { records: repeated["--records"]! }
        : {}),
      ...(repeated["--session"]!.length > 0
        ? { sessions: repeated["--session"]! }
        : {}),
      ...(heldOut ? { heldOut: true as const } : {}),
      ...(s0 ? { s0: true as const } : {}),
      ...(flags.has("--aggregate-only")
        ? { aggregateOnly: true as const }
        : {}),
    },
  };
}
