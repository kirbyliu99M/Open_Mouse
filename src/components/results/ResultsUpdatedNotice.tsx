"use client";

/**
 * V3.2 F13 (candidate, 未拍板): one short line at the top of the results page,
 * 「結果已更新。」, after the server said the ranking on screen was stale (412)
 * and the new one replaced it in place. It fades by itself after
 * `RANKING_UPDATED_NOTICE.VISIBLE_MS`, or at once when closed (×). Nothing
 * else on the page moves: it floats over the top, so a reader further down
 * (at the feedback sheet, say) loses neither the place nor what was typed.
 *
 * The timing is `noticePhaseAt` (rankingUpdatedNotice.ts); under reduced
 * motion the line has no fade and simply goes.
 */
import { useEffect, useRef, useState } from "react";
import { usePrefersReducedMotion } from "@/client/camera/useReducedMotion";
import type { Locale } from "@/lib/contracts/locale";
import { resultsScreensCopy } from "@/lib/copy/results-screens";
import {
  RANKING_UPDATED_NOTICE,
  noticeFadeMs,
  noticePhaseAt,
  type NoticePhase,
} from "./rankingUpdatedNotice";

export function ResultsUpdatedNotice({
  language,
  onGone,
}: {
  language: Locale;
  /** Called once the line has faded out (or was closed under reduced motion). */
  onGone: () => void;
}) {
  const copy = resultsScreensCopy(language).rankingUpdated;
  const reducedMotion = usePrefersReducedMotion();
  const fadeMs = noticeFadeMs(reducedMotion);
  const [phase, setPhase] = useState<NoticePhase>("shown");
  const [closedAt, setClosedAt] = useState<number | null>(null);
  const shownAt = useRef<number | null>(null);
  const onGoneRef = useRef(onGone);
  onGoneRef.current = onGone;

  useEffect(() => {
    if (shownAt.current === null) shownAt.current = performance.now();
    const elapsed = () => performance.now() - (shownAt.current ?? 0);
    const now = noticePhaseAt(elapsed(), closedAt, fadeMs);
    setPhase(now);
    if (now === "gone") {
      onGoneRef.current();
      return;
    }
    // Wake at the next change of phase.
    const leaveAt = Math.min(
      RANKING_UPDATED_NOTICE.VISIBLE_MS,
      closedAt ?? Number.POSITIVE_INFINITY,
    );
    const next = now === "shown" ? leaveAt : leaveAt + fadeMs;
    const timer = setTimeout(
      () => setPhase(noticePhaseAt(elapsed(), closedAt, fadeMs)),
      Math.max(0, next - elapsed()),
    );
    return () => clearTimeout(timer);
  }, [closedAt, fadeMs, phase]);

  if (phase === "gone") return null;
  return (
    <div
      className="results-updatedNotice"
      data-phase={phase}
      data-testid="results-updated-notice"
    >
      <p role="status">{copy.text}</p>
      <button
        type="button"
        className="results-updatedNotice-close"
        aria-label={copy.close}
        onClick={() =>
          setClosedAt(
            performance.now() - (shownAt.current ?? performance.now()),
          )
        }
      >
        <svg
          viewBox="0 0 24 24"
          width="16"
          height="16"
          aria-hidden="true"
          focusable="false"
        >
          <path
            d="M6 6l12 12M18 6 6 18"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}
