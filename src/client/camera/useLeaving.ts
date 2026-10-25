"use client";

import { useEffect, useRef, useState } from "react";

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
 * replaces it at once (`leaving` goes back to false, the timer is dropped).
 * Only presence matters, not identity, so a `value` built anew on every
 * render (an object of props) does not restart anything.
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
  const [wasPresent, setWasPresent] = useState(present);
  const [leavingState, setLeavingState] = useState(false);
  // A change of presence updates the state in this render (React's "state
  // derived from props" pattern), so the first frame of the leave is already
  // painted with the element kept.
  if (present !== wasPresent) {
    setWasPresent(present);
    setLeavingState(!present);
  }
  const leaving =
    !present &&
    (leavingState || present !== wasPresent) &&
    lastRef.current !== null;

  useEffect(() => {
    if (!leavingState) return;
    const timer = window.setTimeout(() => setLeavingState(false), ms);
    return () => window.clearTimeout(timer);
  }, [leavingState, ms]);

  if (present) return { shown: value, leaving: false };
  return { shown: leaving ? lastRef.current : null, leaving };
}
