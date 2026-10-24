/**
 * The share-card preview (V3.2 F21, Kirby 2026-10-25, candidate): a tap on a
 * share entry opens a preview; the PNG is made only then, shown from an object
 * URL, and the person picks 分享 (the system share sheet) or 下載. The preview
 * stays open after either; closing it revokes the URL and gives focus back to
 * the entry.
 *
 * Everything here is plain TypeScript with the browser parts handed in (the
 * repo has no jsdom), so the whole flow is unit-tested. The React component
 * (`SharePreviewDialog.tsx`) only renders `SharePreviewState` and forwards
 * clicks.
 */
import {
  chooseShareAction,
  deliverShareFile,
  type ShareCapable,
  type ShareOutcome,
} from "./shareDecision";

export type PreviewPhase = "closed" | "generating" | "ready" | "error";

/** The 「已下載」 hint: shown, then fading out, then gone. */
export type HintPhase = "hidden" | "shown" | "leaving";

export interface SharePreviewState {
  phase: PreviewPhase;
  /** The object URL of the made card while the preview is open and ready. */
  imageUrl: string | null;
  /** False where files cannot be shared: only 下載 is shown. */
  canShareFiles: boolean;
  /** An action in progress (the share sheet is open): both buttons wait. */
  acting: "share" | "download" | null;
  hint: HintPhase;
  /** The last action failed (neither the share nor the download worked). */
  actionFailed: boolean;
}

export const CLOSED_PREVIEW: SharePreviewState = {
  phase: "closed",
  imageUrl: null,
  canShareFiles: false,
  acting: null,
  hint: "hidden",
  actionFailed: false,
};

/** How long 「已下載」 stays before it fades (about 2 s, Pencil Oqi2W). */
export const SAVED_HINT_MS = 2000;
/** The fade itself; the CSS transition uses the same length. */
export const SAVED_HINT_FADE_MS = 250;

/**
 * The last card made, kept so that reopening the preview for the same result
 * (same response object, language and QR options) shows it again without
 * drawing it again. Only a File is kept, never an object URL.
 */
export interface CardCache {
  current: { key: readonly unknown[]; file: File } | null;
}

export function sameKey(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
}

export interface SharePreviewDeps {
  /** Draws the card (`makeShareCardPng`) and wraps it as a named PNG file. */
  makeFile: () => Promise<File>;
  getNavigator: () => ShareCapable | undefined;
  download: (file: File) => void;
  urls: { create: (file: Blob) => string; revoke: (url: string) => void };
  timers: {
    set: (fn: () => void, ms: number) => unknown;
    clear: (id: unknown) => void;
  };
  cache: CardCache;
  onChange: (state: SharePreviewState) => void;
  /** Analytics only: each action's outcome, and "failed" when the card cannot be made. */
  onFinished?: (outcome: ShareOutcome) => void;
  /** Gives focus back to the entry that opened the preview. */
  returnFocus?: () => void;
  /** A stand-in file to ask `canShare` before the card exists. */
  probeFile?: () => File;
}

export interface SharePreview {
  getState: () => SharePreviewState;
  /** Opens the preview for `key`; a no-op while it is already open. */
  open: (key: readonly unknown[]) => Promise<void>;
  /** Closes it (the close button, Esc), revokes the URL, returns focus. */
  close: () => void;
  share: () => Promise<void>;
  download: () => Promise<void>;
  /** The component unmounts: like close, without moving focus. */
  dispose: () => void;
}

function defaultProbe(): File {
  return new File([], "palmate.png", { type: "image/png" });
}

export function createSharePreview(deps: SharePreviewDeps): SharePreview {
  let state: SharePreviewState = CLOSED_PREVIEW;
  let file: File | null = null;
  // Bumped on every open and close: work that finishes for an older session
  // (a card still drawing when the preview was closed) is dropped.
  let session = 0;
  let hintTimer: unknown = null;

  const set = (patch: Partial<SharePreviewState>) => {
    state = { ...state, ...patch };
    deps.onChange(state);
  };

  const clearHint = () => {
    if (hintTimer !== null) deps.timers.clear(hintTimer);
    hintTimer = null;
  };

  const showHint = () => {
    clearHint();
    set({ hint: "shown" });
    hintTimer = deps.timers.set(() => {
      set({ hint: "leaving" });
      hintTimer = deps.timers.set(() => {
        hintTimer = null;
        set({ hint: "hidden" });
      }, SAVED_HINT_FADE_MS);
    }, SAVED_HINT_MS);
  };

  const canShare = (f: File) =>
    chooseShareAction(deps.getNavigator(), f) === "share";

  const show = (f: File) => {
    file = f;
    set({
      phase: "ready",
      imageUrl: deps.urls.create(f),
      canShareFiles: canShare(f),
    });
  };

  const teardown = () => {
    session += 1;
    clearHint();
    if (state.imageUrl !== null) deps.urls.revoke(state.imageUrl);
    file = null;
  };

  async function open(key: readonly unknown[]): Promise<void> {
    if (state.phase !== "closed") return;
    session += 1;
    const mine = session;
    const cached = deps.cache.current;
    if (cached && sameKey(cached.key, key)) {
      state = { ...CLOSED_PREVIEW };
      show(cached.file);
      return;
    }
    set({
      ...CLOSED_PREVIEW,
      phase: "generating",
      canShareFiles: canShare((deps.probeFile ?? defaultProbe)()),
    });
    let made: File;
    try {
      made = await deps.makeFile();
    } catch {
      if (mine !== session) return;
      set({ phase: "error" });
      deps.onFinished?.("failed");
      return;
    }
    deps.cache.current = { key: [...key], file: made };
    if (mine !== session) return;
    show(made);
  }

  function close(): void {
    if (state.phase === "closed") return;
    teardown();
    set(CLOSED_PREVIEW);
    deps.returnFocus?.();
  }

  function dispose(): void {
    if (state.phase === "closed") return;
    teardown();
    state = CLOSED_PREVIEW;
  }

  async function act(kind: "share" | "download"): Promise<void> {
    if (state.phase !== "ready" || state.acting !== null || file === null)
      return;
    const mine = session;
    const f = file;
    set({ acting: kind, actionFailed: false });
    // 下載 asks the same function with no navigator, which always downloads;
    // 分享 keeps its rules: a cancel is "cancelled", another failure falls back
    // to the download.
    const outcome = await deliverShareFile(
      f,
      kind === "share" ? deps.getNavigator() : undefined,
      deps.download,
    );
    deps.onFinished?.(outcome);
    if (mine !== session) return;
    set({ acting: null, actionFailed: outcome === "failed" });
    if (outcome === "downloaded") showHint();
  }

  return {
    getState: () => state,
    open,
    close,
    share: () => act("share"),
    download: () => act("download"),
    dispose,
  };
}

/**
 * The dialog's `cancel` event (Esc): the native dialog would close itself, but
 * React state decides, so the default is stopped and the preview closes.
 */
export function onPreviewCancel(
  event: { preventDefault: () => void },
  preview: Pick<SharePreview, "close">,
): void {
  event.preventDefault();
  preview.close();
}
