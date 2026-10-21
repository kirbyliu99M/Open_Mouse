/**
 * V3.2 F13 (candidate, 未拍板): the short "results updated" line the results
 * page shows when the server said the ranking on screen was stale (412) and
 * the new one was put in its place. Pure (no React), so the rule and the
 * timings are tested without a browser; `ResultsUpdatedNotice.tsx` draws it.
 */
import type { FitResponse } from "@/lib/contracts/fit";

/** Candidate timings (模擬 values chosen by Claude, not measured on a phone). */
export const RANKING_UPDATED_NOTICE = {
  /** How long the line stays before it fades by itself. */
  VISIBLE_MS: 4000,
  /** Its fade-out; 0 under reduced motion (`noticeFadeMs`). */
  FADE_MS: 220,
} as const;

/**
 * Whether the refreshed fit deserves the notice: yes unless both fits carry a
 * fingerprint and it is the same one (then nothing on screen changed). With
 * no fit before (`previous` null) there is nothing that was "updated".
 */
export function rankingUpdatedNoticeDue(
  previous: FitResponse | null,
  next: FitResponse,
): boolean {
  if (previous === null) return false;
  const before = previous.resultFingerprint;
  const after = next.resultFingerprint;
  if (before !== undefined && after !== undefined) return before !== after;
  return true;
}

/** The fade-out length: none under reduced motion (the line just goes). */
export function noticeFadeMs(reducedMotion: boolean): number {
  return reducedMotion ? 0 : RANKING_UPDATED_NOTICE.FADE_MS;
}

export type NoticePhase = "shown" | "leaving" | "gone";

/**
 * Where the notice is `elapsedMs` after it appeared, when it was closed by
 * hand at `closedAtMs` (or not, null): shown, then fading for `fadeMs`, then
 * gone. Closing starts the fade at once.
 */
export function noticePhaseAt(
  elapsedMs: number,
  closedAtMs: number | null,
  fadeMs: number,
): NoticePhase {
  const leaveAt = Math.min(
    RANKING_UPDATED_NOTICE.VISIBLE_MS,
    closedAtMs ?? Number.POSITIVE_INFINITY,
  );
  if (elapsedMs < leaveAt) return "shown";
  if (elapsedMs < leaveAt + fadeMs) return "leaving";
  return "gone";
}

const PHASE_ORDER: Record<NoticePhase, number> = {
  shown: 0,
  leaving: 1,
  gone: 2,
};

/**
 * What the notice does next, given the phase on screen: `gone` (call onGone),
 * `set` (move to a later phase now), or `wait` `ms` and then move to `then`.
 *
 * The phase never goes back: a timer that fires a little early (or whose
 * fractional delay the browser truncated) would make `noticePhaseAt` say the
 * old phase again, and the line would stay forever. So the step only moves
 * forward, and the timer moves to `then` without asking the clock again.
 */
export type NoticeStep =
  | { kind: "gone" }
  | { kind: "set"; phase: NoticePhase }
  | { kind: "wait"; ms: number; then: NoticePhase };

export function noticeStep(
  phase: NoticePhase,
  elapsedMs: number,
  closedAtMs: number | null,
  fadeMs: number,
): NoticeStep {
  const byClock = noticePhaseAt(elapsedMs, closedAtMs, fadeMs);
  const now = PHASE_ORDER[byClock] > PHASE_ORDER[phase] ? byClock : phase;
  if (now !== phase) return { kind: "set", phase: now };
  if (now === "gone") return { kind: "gone" };
  const leaveAt = Math.min(
    RANKING_UPDATED_NOTICE.VISIBLE_MS,
    closedAtMs ?? Number.POSITIVE_INFINITY,
  );
  const next = now === "shown" ? leaveAt : leaveAt + fadeMs;
  const then: NoticePhase = now === "shown" && fadeMs > 0 ? "leaving" : "gone";
  // Whole milliseconds, rounded up (setTimeout truncates a fraction).
  return { kind: "wait", ms: Math.max(0, Math.ceil(next - elapsedMs)), then };
}
