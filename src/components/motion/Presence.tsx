"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { leaveMs } from "@/lib/motion";
import {
  createLeave,
  presenceStep,
  type Leave,
  type LeaveTimers,
  type PresencePhase,
} from "@/lib/presence";

const windowTimers: LeaveTimers = {
  set: (fn, ms) => window.setTimeout(fn, ms),
  clear: (id) => window.clearTimeout(id as number),
};

/**
 * Leaving instead of vanishing (V3.2 motion pass, candidate / 未拍板). Two
 * shapes of the same rule (`src/lib/presence.ts`):
 *
 *  - `Presence` / `usePresence`: the OWNER mounts and unmounts the thing
 *    (`{open && <Sheet/>}`). Wrapped in `Presence`, it stays mounted for
 *    `leaveMs()` after it is gone from the owner's render, showing what it
 *    showed last, and `useLeaving()` inside it says so (the dialog then sets
 *    `data-leaving`, and its CSS plays the way out). Shown again meanwhile, it
 *    simply stays (same instance, the leave runs back).
 *  - `useLeaveThenClose`: the thing ends ITSELF (a native `<dialog>` that calls
 *    `close()`): `requestClose()` sets `leaving`, and `finish` runs after
 *    `leaveMs()`. Route Esc through it: `onCancel={(e) => { e.preventDefault();
 *    requestClose(); }}`.
 *
 * Under reduced motion every leave is `--motion-reduced` (120 ms), a fade.
 */

/** Whether the person asked for reduced motion, read now. */
export function reducedMotionNow(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}

const LeavingContext = createContext(false);

/** True while the nearest `Presence` keeps its content for the way out. */
export function useLeaving(): boolean {
  return useContext(LeavingContext);
}

/**
 * `mounted`: render it; `leaving`: it is on its way out (set `data-leaving`).
 * `onExited` runs once it has gone (focus that could not move while a modal
 * was still open, for example).
 */
export function usePresence(
  present: boolean,
  kind: "fade" | "sheet",
  onExited?: () => void,
): { mounted: boolean; leaving: boolean } {
  const [phase, setPhase] = useState<PresencePhase>(
    present ? "open" : "closed",
  );
  // Follow the owner during render, so the frame that hides it already says
  // "leaving" (no frame without it, no frame without the element).
  const next = presenceStep(phase, present ? "show" : "hide");
  if (next !== phase) setPhase(next);

  const exited = useRef(onExited);
  exited.current = onExited;
  const wasLeaving = useRef(false);
  // The leave itself is `createLeave` (src/lib/presence.ts, tested there):
  // one per mount, timed by leaveMs(); shown again meanwhile, it is cancelled.
  const leave = useRef<Leave | null>(null);
  useEffect(() => {
    const current = createLeave({
      wait: () => leaveMs(kind, reducedMotionNow()),
      finish: () => setPhase((p) => presenceStep(p, "done")),
      timers: windowTimers,
    });
    leave.current = current;
    return () => {
      current.dispose();
      leave.current = null;
    };
  }, [kind]);
  useEffect(() => {
    // After the commit that removed it (its own cleanups, such as a modal's
    // `close()`, have run): only now can focus move to the page behind.
    if (phase === "closed" && wasLeaving.current) exited.current?.();
    wasLeaving.current = phase === "leaving";
    const current = leave.current;
    if (!current) return;
    if (phase === "leaving") current.request();
    else if (current.leaving) current.cancel();
  }, [phase, kind]);

  return { mounted: next !== "closed", leaving: next === "leaving" };
}

/**
 * Keeps `children` on screen for their way out after the owner stops rendering
 * them (`false`, `null` or `undefined`). See `usePresence`.
 */
export function Presence({
  children,
  kind,
  onExited,
}: {
  children: ReactNode;
  kind: "fade" | "sheet";
  onExited?: () => void;
}) {
  const present =
    children !== null && children !== undefined && children !== false;
  const last = useRef<ReactNode>(null);
  if (present) last.current = children;
  const { mounted, leaving } = usePresence(present, kind, onExited);
  if (!mounted) last.current = null;
  return (
    <LeavingContext.Provider value={leaving}>
      {mounted ? (present ? children : last.current) : null}
    </LeavingContext.Provider>
  );
}

/**
 * For a dialog that closes itself: `requestClose()` marks it leaving and runs
 * `finish` (the native `close()`, or the owner's `onClosed`) after
 * `leaveMs(kind)`. Asking twice does nothing; unmounting cancels the timer;
 * `cancelClose()` keeps it open after all.
 */
export function useLeaveThenClose(
  finish: () => void,
  kind: "fade" | "sheet",
): { leaving: boolean; requestClose: () => void; cancelClose: () => void } {
  const [leaving, setLeaving] = useState(false);
  const finishRef = useRef(finish);
  finishRef.current = finish;
  const leave = useRef<ReturnType<typeof createLeave> | null>(null);
  // Made per mount (StrictMode's second mount gets a fresh one), dropped on
  // unmount so no late `finish` reaches an owner that has moved on.
  useEffect(() => {
    const current = createLeave({
      wait: () => leaveMs(kind, reducedMotionNow()),
      finish: () => finishRef.current(),
      onLeaving: setLeaving,
      timers: windowTimers,
    });
    leave.current = current;
    return () => {
      current.dispose();
      leave.current = null;
    };
  }, [kind]);
  const requestClose = useCallback(() => {
    leave.current?.request();
  }, []);
  /** Asked back during the leave: it stays, and runs back from where it is. */
  const cancelClose = useCallback(() => {
    leave.current?.cancel();
  }, []);
  return { leaving, requestClose, cancelClose };
}
