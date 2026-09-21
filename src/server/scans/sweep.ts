import type { ScanRepo } from "./repo";

/**
 * Lazy sweep (issue #17 spec amendment): the Hobby plan only allows a daily
 * cron, which would let an anonymous session outlive its 24h promise by up
 * to ~24h more. `POST /api/scans` — the highest-traffic write — also runs
 * the expiry delete, so `scan_sessions` never accumulates more than a
 * minute's worth of stale rows between real requests. The daily cron stays
 * as a backstop for instances that go quiet.
 */
export const SWEEP_THROTTLE_MS = 60_000;

export interface SweepThrottle {
  /**
   * Runs the expiry delete if at least `SWEEP_THROTTLE_MS` has passed since
   * the last sweep on this instance; otherwise no-ops. The clock comes from
   * the caller (usually the request's own `now`), not the wall clock, so
   * this is deterministic in tests.
   */
  maybeSweep(repo: ScanRepo, now: Date): Promise<void>;
}

/** One throttle per call site. `defaultSweepThrottle` below is the shared,
 * module-level instance a warm serverless instance reuses across requests —
 * "once a minute per instance" means exactly that: state that lives as long
 * as the instance does, not a database row. */
export function createSweepThrottle(
  intervalMs: number = SWEEP_THROTTLE_MS,
): SweepThrottle {
  let lastSweepAtMs = 0;
  return {
    async maybeSweep(repo, now) {
      const nowMs = now.getTime();
      if (nowMs - lastSweepAtMs < intervalMs) return;
      lastSweepAtMs = nowMs;
      await repo.deleteExpiredAnonymousSessions(now);
    },
  };
}

export const defaultSweepThrottle = createSweepThrottle();
