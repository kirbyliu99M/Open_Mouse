import { testerCodeSchema } from "../contracts/tester";

/**
 * True when the server env `TESTER_CODES` names at least one valid code — the
 * same rule as `parseTesterCodes` (src/server/tester/codes.ts), without the
 * Node crypto import, so the Edge middleware can use it.
 */
export function testerCodesConfigured(raw: string | undefined): boolean {
  if (!raw) return false;
  return raw
    .split(",")
    .some((entry) => testerCodeSchema.safeParse(entry).success);
}

/** Open mode (Kirby 2026-11-10): `TESTER_OPEN=1` lets anyone in, no code. */
export function testerOpenConfigured(raw: string | undefined): boolean {
  return raw?.trim() === "1";
}

/** The tester page is on: open mode, or at least one valid code. */
export function testerPageConfigured(env: {
  readonly TESTER_OPEN?: string;
  readonly TESTER_CODES?: string;
}): boolean {
  return (
    testerOpenConfigured(env.TESTER_OPEN) ||
    testerCodesConfigured(env.TESTER_CODES)
  );
}
