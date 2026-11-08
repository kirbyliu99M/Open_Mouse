/**
 * The consent sheet's states (candidate 未拍板; review #241 rounds 3 and 4).
 * Pure: the sheet (src/components/error-photo/ErrorPhotoSheet.tsx) renders
 * `sheetView` and dispatches `sheetReducer`; tests/unit/error-photo-sheet-state.test.ts
 * drives it.
 *
 * The rule (review L1): from the moment the first POST is attempted, the
 * photo MAY be on the server, so every later state (sending, failed, timed
 * out, sent) shows the deletion code with the copy button, and Esc / back no
 * longer close the sheet; only 「不用了」 and 「完成」 do. The only failure
 * without a code is one that is certain nothing was sent: a check that failed
 * on the device before the first request.
 */
import type { ErrorPhotoMeta } from "../../lib/contracts/error-photo";
import type { SendOutcome } from "./send";

export type FailReason =
  | "too-many"
  | "unavailable"
  | "timeout"
  | "failed"
  /** Failed on the device before any request (e.g. the metadata check). */
  | "local";

export interface SheetState {
  /** The session's code, made on the device when the sheet opened. */
  readonly code: string;
  /** A POST has been attempted in this session (it may have arrived). */
  readonly attempted: boolean;
  readonly phase: "form" | "sending" | "failed" | "sent";
  readonly reason: FailReason | null;
  /** How many failures so far: the alert line is keyed by it (review N1). */
  readonly failures: number;
}

export type SheetEvent =
  /** About to call fetch. */
  | { readonly type: "send" }
  | { readonly type: "outcome"; readonly outcome: SendOutcome }
  /** A check on the device failed before fetch was called. */
  | { readonly type: "local-failure" };

export function initialSheetState(code: string): SheetState {
  return { code, attempted: false, phase: "form", reason: null, failures: 0 };
}

export function sheetReducer(state: SheetState, event: SheetEvent): SheetState {
  switch (event.type) {
    case "send":
      return { ...state, attempted: true, phase: "sending", reason: null };
    case "local-failure":
      return {
        ...state,
        phase: "failed",
        reason: "local",
        failures: state.failures + 1,
      };
    case "outcome":
      if (event.outcome.ok && event.outcome.deleteCode === state.code)
        return { ...state, phase: "sent", reason: null };
      return {
        ...state,
        phase: "failed",
        reason: event.outcome.ok ? "failed" : event.outcome.reason,
        failures: state.failures + 1,
      };
  }
}

export interface SheetView {
  /** The code to show (with the copy button), or null. */
  readonly code: string | null;
  /** Esc / back may close the sheet. */
  readonly escClosable: boolean;
  readonly busy: boolean;
  readonly sent: boolean;
  /**
   * What to say about the last try: `uncertain` (it may have arrived: the
   * code line), `timeout` (too slow, may have arrived), or a plain failure
   * that is certain nothing was sent (`local`). `extra` is a short reason
   * line before it (rate limit, store unavailable).
   */
  readonly message: "uncertain" | "timeout" | "local" | null;
  readonly extra: "too-many" | "unavailable" | null;
}

export function sheetView(state: SheetState): SheetView {
  const code = state.attempted ? state.code : null;
  const failed = state.phase === "failed";
  const reason = failed ? state.reason : null;
  return {
    code,
    escClosable: !state.attempted && state.phase !== "sending",
    busy: state.phase === "sending",
    sent: state.phase === "sent",
    message:
      reason === null
        ? null
        : reason === "timeout"
          ? "timeout"
          : reason === "local" && !state.attempted
            ? "local"
            : "uncertain",
    extra: reason === "too-many" || reason === "unavailable" ? reason : null,
  };
}

/**
 * One press of 傳送 (review N2): the sheet calls this, the tests drive it.
 * `build` checks everything on the device first; if it fails, nothing is
 * sent (`local-failure`, and `send` is never called). Otherwise `send` is
 * dispatched BEFORE the request starts, so the code is on screen and Esc is
 * blocked while it is out, then the outcome.
 */
export async function runSheetSend(deps: {
  readonly build: () => ErrorPhotoMeta | null;
  readonly dispatch: (event: SheetEvent) => void;
  readonly send: (meta: ErrorPhotoMeta) => Promise<SendOutcome>;
}): Promise<void> {
  const meta = deps.build();
  if (!meta) {
    deps.dispatch({ type: "local-failure" });
    return;
  }
  deps.dispatch({ type: "send" });
  deps.dispatch({ type: "outcome", outcome: await deps.send(meta) });
}
