/**
 * The command line of `npm run m2:evaluate`, parsed strictly. A misspelt flag,
 * a flag with no value, a single-value flag given twice, or a value that is
 * empty is an error, never a default: in particular `--participants` must
 * never fall back to "everyone" because it was mistyped.
 *
 * Messages name the flag, never the value or the token that was wrong: that
 * could be a path with an account name in it.
 */
import { GESTURES } from "../learning/kit";
import { looksLikeMsysPath } from "../learning/paths";

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
}

export type ParsedArgs =
  | { readonly ok: true; readonly args: M2Args }
  | { readonly ok: false; readonly message: string };

const REPEATABLE = ["--log", "--truth"] as const;
const SINGLE = [
  "--path",
  "--gesture",
  "--participants",
  "--thresholds",
  "--out",
] as const;
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

const PATH_FLAGS = ["--log", "--truth", "--thresholds", "--out"] as const;

export function parseM2Args(
  argv: readonly string[],
  platform: NodeJS.Platform = process.platform,
): ParsedArgs {
  const repeated: Record<string, string[]> = { "--log": [], "--truth": [] };
  const single = new Map<string, string>();
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
    if (token === "--log" || token === "--truth") {
      repeated[token]!.push(value);
    } else {
      if (single.has(token)) return bad(`${token} was given more than once.`);
      single.set(token, value);
    }
  }
  // "/c/Users/me" is Git Bash's spelling; Windows Node would read it as a
  // folder named "c" on the current drive, and --out would create it.
  for (const flag of PATH_FLAGS) {
    const values =
      flag === "--log" || flag === "--truth" ? repeated[flag]! : [];
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
  if (repeated["--truth"]!.length === 0) return bad("--truth is required.");

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
    },
  };
}
