/**
 * V3.2 F11 (Kirby's phone test, 2026-10-21: "after pressing other buttons the
 * results page's back no longer works"; the rule is a candidate): what each
 * action on a results page does to the browser's history, so the back button
 * and the top bar's 「‹ 重新掃描」 always lead out of the results pages.
 *
 * The rule:
 *   - Nothing on a page adds a history entry: the shape toggle and the filter
 *     (`history.replaceState`), the filter sheet, Details, Other mice, the
 *     enlarged photo, share and the feedback sheet (no URL change at all).
 *     An open sheet or dialog is a native modal `<dialog>`: on a phone the back
 *     gesture closes it first (the browser's close watcher).
 *   - Only opening another mouse's detail page from the main page adds one.
 *     From a detail page, another detail page replaces it, and the first place
 *     goes back to the main page's entry when that entry is right behind
 *     (replaces it otherwise). So there is at most one results entry above the
 *     main page, and back from a detail page lands on the list, the next back
 *     on the page before the results.
 *   - The top bar's back: when the results were opened from the scan page (it
 *     says so, `noteScanHandoff`), it goes back in history past the results
 *     entries, like the browser's back; otherwise it is a plain link to the
 *     scan page.
 *
 * What a page knows about its place is stamped into its own history entry
 * (`history.state[RESULTS_HISTORY_KEY]`), which survives a reload and back and
 * forward; Next.js keeps keys it does not own (its patched `replaceState`).
 * The decisions are pure; the few lines that touch `window` are at the end.
 */

/** The key of the stamp in `history.state`. */
export const RESULTS_HISTORY_KEY = "palmateResults";

export interface ResultsStamp {
  scanId: string;
  /** The pathname the stamp was written for (a guard against a stale write). */
  path: string;
  /** 0: the main page, or a page opened directly; 1: a detail page above the main page's entry. */
  depth: 0 | 1;
  /** The entry before the results is the scan page that made this scan. */
  scanBehind: boolean;
}

/** What the next results page inherits from a click on this one. */
export interface PendingArrival {
  scanId: string;
  depth: 0 | 1;
  scanBehind: boolean;
}

/** Every action on a results page and what it does to history (documented, and tested). */
export const RESULTS_ACTION_HISTORY = {
  shapeToggle: "none",
  filterChange: "none",
  filterSheetOpen: "none",
  filterSheetClose: "none",
  detailsToggle: "none",
  otherMiceToggle: "none",
  photoZoom: "none",
  share: "none",
  feedbackSheet: "none",
  openDetailFromMain: "push",
  openDetailFromDetail: "replace",
  openMainFromDetail: "back-or-replace",
} as const satisfies Record<
  string,
  "none" | "push" | "replace" | "back-or-replace"
>;

export type ResultsAction = keyof typeof RESULTS_ACTION_HISTORY;

/** Read a stamp from `history.state`; `null` when there is none or it is malformed. */
export function parseStamp(state: unknown): ResultsStamp | null {
  if (typeof state !== "object" || state === null) return null;
  const raw = (state as Record<string, unknown>)[RESULTS_HISTORY_KEY];
  if (typeof raw !== "object" || raw === null) return null;
  const s = raw as Record<string, unknown>;
  if (
    typeof s.scanId !== "string" ||
    typeof s.path !== "string" ||
    (s.depth !== 0 && s.depth !== 1) ||
    typeof s.scanBehind !== "boolean"
  )
    return null;
  return {
    scanId: s.scanId,
    path: s.path,
    depth: s.depth,
    scanBehind: s.scanBehind,
  };
}

/**
 * The stamp a page should carry when it is shown. A stamp already on this
 * entry for this scan and path is kept (back, forward, a reload, a filter
 * change). Otherwise a click on a results page says what it inherits; with
 * none, the main page knows from the scan page's handoff whether the scan page
 * is right behind, and a detail page opened directly is the first entry.
 */
export function stampOnArrival(input: {
  scanId: string;
  path: string;
  isMain: boolean;
  existing: ResultsStamp | null;
  pending: PendingArrival | null;
  /** The scan id the scan page handed over just before opening the results, if any. */
  scanHandoff: string | null;
}): ResultsStamp {
  const { scanId, path, isMain, existing, pending, scanHandoff } = input;
  if (existing && existing.scanId === scanId && existing.path === path)
    return existing;
  if (pending && pending.scanId === scanId) {
    return {
      scanId,
      path,
      // The main page is never above another results entry.
      depth: isMain ? 0 : pending.depth,
      scanBehind: pending.scanBehind,
    };
  }
  return {
    scanId,
    path,
    depth: 0,
    scanBehind: isMain && scanHandoff === scanId,
  };
}

export type PickNavigation =
  { kind: "push" } | { kind: "replace" } | { kind: "back" };

/** How a card (another mouse) is opened from this page. */
export function pickNavigation(input: {
  fromMain: boolean;
  toMain: boolean;
  stamp: ResultsStamp | null;
}): PickNavigation {
  const { fromMain, toMain, stamp } = input;
  if (fromMain) return toMain ? { kind: "replace" } : { kind: "push" };
  if (toMain && stamp?.depth === 1) return { kind: "back" };
  return { kind: "replace" };
}

/** What the page a pick opens inherits (`null` for a back: its entry has its stamp). */
export function pendingForPick(
  navigation: PickNavigation,
  input: { scanId: string; toMain: boolean; stamp: ResultsStamp | null },
): PendingArrival | null {
  if (navigation.kind === "back") return null;
  const scanBehind = input.stamp?.scanBehind ?? false;
  if (navigation.kind === "push")
    return { scanId: input.scanId, depth: 1, scanBehind };
  return {
    scanId: input.scanId,
    depth: input.toMain ? 0 : (input.stamp?.depth ?? 0),
    scanBehind,
  };
}

export type TopBarBack = { kind: "history"; steps: number } | { kind: "link" };

/** The top bar's 「‹ 重新掃描」: back in history to the scan page when it is behind, else the link. */
export function topBarBack(
  stamp: ResultsStamp | null,
  scanId: string | undefined,
): TopBarBack {
  if (!stamp || scanId === undefined || stamp.scanId !== scanId)
    return { kind: "link" };
  if (!stamp.scanBehind) return { kind: "link" };
  return { kind: "history", steps: stamp.depth + 1 };
}

/**
 * `history.state` without Next.js's own keys, to pass to `replaceState`: the
 * patched `replaceState` adds them back, and a state that carries `__NA` would
 * skip the patch (the router would not hear of the new URL).
 */
export function customHistoryState(state: unknown): Record<string, unknown> {
  if (typeof state !== "object" || state === null) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(state)) {
    if (key === "__NA" || key === "_N" || key.startsWith("__PRIVATE_NEXTJS"))
      continue;
    out[key] = value;
  }
  return out;
}

// ---- The browser side: module memory for one tab's client navigation.

let pendingArrival: PendingArrival | null = null;
let scanHandoff: string | null = null;

/** The scan page calls this just before it opens the results of `scanId`. */
export function noteScanHandoff(scanId: string): void {
  scanHandoff = scanId;
}

/** A results page calls this just before a click navigates to another one. */
export function notePendingArrival(next: PendingArrival | null): void {
  pendingArrival = next;
}

/** Read and clear what the module remembers for an arriving page. */
export function takeArrivalMemory(): {
  pending: PendingArrival | null;
  scanHandoff: string | null;
} {
  const memory = { pending: pendingArrival, scanHandoff };
  pendingArrival = null;
  scanHandoff = null;
  return memory;
}

/** The stamp on the current history entry, or `null` (never throws). */
export function readCurrentStamp(): ResultsStamp | null {
  try {
    return typeof window === "undefined"
      ? null
      : parseStamp(window.history.state);
  } catch {
    return null;
  }
}

/** Write `stamp` on the current entry without changing the URL (never throws). */
export function writeCurrentStamp(stamp: ResultsStamp): void {
  try {
    window.history.replaceState(
      {
        ...customHistoryState(window.history.state),
        [RESULTS_HISTORY_KEY]: stamp,
      },
      "",
    );
  } catch {
    // History unavailable: the top bar falls back to its link.
  }
}
