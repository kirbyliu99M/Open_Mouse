/** Pure helpers that shape event properties before the contract's schema sees them. */
import { ANALYTICS_COUNT_CAP } from "@/lib/contracts/analytics";

const MAX_CODES = 8;
const CODE_SHAPE = /^[A-Z][A-Z0-9_]{0,47}$/;

/** A non-negative integer, at most `ANALYTICS_COUNT_CAP`. Not a number is 0. */
export function clampCount(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(ANALYTICS_COUNT_CAP, Math.max(0, Math.floor(n)));
}

/** Issue codes: only code-shaped strings, deduplicated, at most 8. */
export function issueCodes(codes: readonly string[]): string[] {
  const out: string[] = [];
  for (const code of codes) {
    if (CODE_SHAPE.test(code) && !out.includes(code)) out.push(code);
    if (out.length === MAX_CODES) break;
  }
  return out;
}

/** The 1-based attempt number, clamped to 1..`ANALYTICS_COUNT_CAP`. */
export function clampAttempt(n: number): number {
  return Math.max(1, clampCount(n));
}
