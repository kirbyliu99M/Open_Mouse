/**
 * Tester codes (candidate 未拍板; contract src/lib/contracts/tester.ts).
 *
 * `TESTER_CODES` is a comma-separated list Kirby sets on the server. Unset or
 * empty: the page and both routes answer 404. A code typed on the page is
 * compared against EVERY configured code in constant time (SHA-256 of both,
 * `timingSafeEqual`, no early exit), so the answer time does not tell how
 * much of a guess was right. Only `participantOf(code)` (`P07`) is ever kept.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import {
  participantOf,
  testerAnonIdSchema,
  testerCodeSchema,
} from "../../lib/contracts/tester";

/**
 * The configured codes, normalised (trimmed, upper case), or `null` when the
 * variable is unset or names no valid code. An entry that breaks the format
 * is ignored, so a typo cannot open a code nobody can type.
 */
export function parseTesterCodes(raw: string | undefined): string[] | null {
  if (!raw) return null;
  const codes = raw
    .split(",")
    .map((entry) => testerCodeSchema.safeParse(entry))
    .filter((r) => r.success)
    .map((r) => r.data);
  return codes.length > 0 ? [...new Set(codes)] : null;
}

const digest = (s: string) => createHash("sha256").update(s, "utf8").digest();

/**
 * The configured code `input` names (normalised), or `null`. Every configured
 * code is compared, whatever matched before it.
 */
export function matchTesterCode(
  input: unknown,
  configured: readonly string[],
): string | null {
  const parsed = testerCodeSchema.safeParse(input);
  // A malformed input is still compared (against a fixed dummy) so the time
  // does not split "malformed" from "well-formed but unknown".
  const candidate = digest(parsed.success ? parsed.data : "P00-AAAAAA");
  let found: string | null = null;
  for (const code of configured) {
    const equal = timingSafeEqual(candidate, digest(code));
    if (equal && parsed.success && found === null) found = code;
  }
  return found;
}

/**
 * The participant id a request's `code` field names, or `null`: in open mode
 * a well-formed anonymous id (`WK7Q2M9XA`) is accepted as is; otherwise (or
 * as well) an invited code that matches a configured one gives `P07`.
 */
export function resolveParticipant(
  input: unknown,
  access: { readonly open: boolean; readonly codes: readonly string[] | null },
): string | null {
  if (access.open) {
    const anon = testerAnonIdSchema.safeParse(input);
    if (anon.success) return anon.data;
  }
  if (!access.codes) return null;
  const code = matchTesterCode(input, access.codes);
  return code ? participantOf(code) : null;
}
