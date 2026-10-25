"use client";

import { useEffect, useRef, useState } from "react";
import {
  leavingAfter,
  leavingTimedOut,
  leavingView,
  type LeavingState,
} from "./scanMotion";

/**
 * Keeps something on screen while it leaves (V3.2 motion pass, candidate /
 * 未拍板). `value` is what should be shown now, or `null` once it should be
 * gone. The hook answers with what to render:
 * - `shown`: `value` while there is one; after it becomes `null`, the last
 *   one, for `ms`, so the element can fade or slide out; then `null`.
 * - `leaving`: true during those `ms` (the element gets `data-leaving` and is
 *   made inert, so nothing under it is blocked and nothing reads it).
 *
 * Interruptible: a `value` that comes back while the old one is leaving
 * replaces it at once (`leaving` goes back to false, the timer is dropped; a
 * later leave gets its whole time again). The caller makes the piece usable
 * again: each dialog's effect opens it when it is wanted and not open.
 * Only presence matters, not identity, so a `value` built anew on every
 * render (an object of props) does not restart anything. The rules are the
 * pure `leavingAfter`, `leavingTimedOut` and `leavingView` (scanMotion.ts).
 */
export function useLeaving<T>(
  value: T | null,
  ms: number,
): { shown: T | null; leaving: boolean } {
  const present = value !== null;
  // The last value that was on screen, for the leave. Written during render
  // like the component's other "latest" refs; it only ever holds a value the
  // same render returned.
  const lastRef = useRef<T | null>(value);
  if (present) lastRef.current = value;
  const [state, setState] = useState<LeavingState>({
    wasPresent: present,
    leaving: false,
  });
  // A change of presence updates the state in this render (React's "state
  // derived from props" pattern), so the first frame of the leave is already
  // painted with the element kept.
  const next = leavingAfter(state, present);
  if (next !== state) setState(next);

  useEffect(() => {
    if (!state.leaving) return;
    const timer = window.setTimeout(
      () => setState((s) => leavingTimedOut(s)),
      ms,
    );
    return () => window.clearTimeout(timer);
  }, [state.leaving, ms]);

  return leavingView(value, next, lastRef.current);
}
