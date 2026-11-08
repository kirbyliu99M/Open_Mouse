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
