/**
 * The share-card preview (V3.2 F21): the flow in `sharePreview.ts`, run with
 * fake browser parts (the repo has no jsdom), and the dialog's markup through
 * `renderToStaticMarkup`.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  CLOSED_PREVIEW,
  SAVED_HINT_FADE_MS,
  SAVED_HINT_MS,
  createSharePreview,
  onPreviewCancel,
  type CardCache,
  type SharePreviewDeps,
  type SharePreviewState,
} from "../../src/components/results/share/sharePreview";
import { SharePreviewDialog } from "../../src/components/results/share/SharePreviewDialog";
import { en, zhTW } from "../../src/lib/copy/share-card";

const card = new File([new Uint8Array([1, 2, 3])], "palmate-x.png", {
  type: "image/png",
});

/** A fake clock for the hint's timers. */
function fakeTimers() {
  let now = 0;
  let next = 1;
  const pending = new Map<number, { at: number; fn: () => void }>();
  return {
    set: (fn: () => void, ms: number) => {
      const id = next++;
      pending.set(id, { at: now + ms, fn });
      return id;
    },
    clear: (id: unknown) => {
      pending.delete(id as number);
    },
    advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const due = [...pending.entries()]
          .filter(([, t]) => t.at <= end)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        pending.delete(due[0]);
        now = due[1].at;
        due[1].fn();
      }
      now = end;
    },
    get size() {
      return pending.size;
    },
  };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup(
  over: Partial<SharePreviewDeps> & {
    nav?: {
      share?: (d?: ShareData) => Promise<void>;
      canShare?: () => boolean;
    };
  } = {},
) {
  const states: SharePreviewState[] = [];
  let urlCount = 0;
  const created: string[] = [];
  const timers = fakeTimers();
  const nav =
    "nav" in over
      ? over.nav
      : { share: vi.fn(() => Promise.resolve()), canShare: () => true };
  const deps: SharePreviewDeps = {
    makeFile: vi.fn(() => Promise.resolve(card)),
    getNavigator: () => nav,
    download: vi.fn(),
    urls: {
      create: vi.fn(() => {
        const url = `blob:card-${++urlCount}`;
        created.push(url);
        return url;
      }),
      revoke: vi.fn(),
    },
    timers,
    cache: { current: null },
    onChange: (s) => states.push(s),
    onFinished: vi.fn(),
    returnFocus: vi.fn(),
    ...over,
  };
  const preview = createSharePreview(deps);
  return { preview, deps, states, timers, created, nav };
}

const KEY = ["fit", "zh-TW", undefined, undefined] as const;

describe("opening and closing the preview", () => {
  it("starts closed and makes nothing before it is opened", () => {
    const t = setup();
    expect(t.preview.getState()).toEqual(CLOSED_PREVIEW);
    expect(t.deps.makeFile).not.toHaveBeenCalled();
  });

  it("makes the card when opened: generating first, then the image", async () => {
    const made = deferred<File>();
    const t2 = setup({ makeFile: () => made.promise });
    const opening = t2.preview.open(KEY);
    expect(t2.preview.getState().phase).toBe("generating");
    expect(t2.preview.getState().imageUrl).toBeNull();
    made.resolve(card);
    await opening;
    const s = t2.preview.getState();
    expect(s.phase).toBe("ready");
    expect(s.imageUrl).toBe("blob:card-1");
    expect(t2.deps.urls.create).toHaveBeenCalledWith(card);
  });

  it("closing revokes the object URL and gives focus back to the entry", async () => {
    const t = setup();
    await t.preview.open(KEY);
    t.preview.close();
    expect(t.deps.urls.revoke).toHaveBeenCalledWith("blob:card-1");
    expect(t.deps.returnFocus).toHaveBeenCalledTimes(1);
    expect(t.preview.getState()).toEqual(CLOSED_PREVIEW);
  });

  it("a second open while open does nothing", async () => {
    const t = setup();
    await t.preview.open(KEY);
    await t.preview.open(KEY);
    expect(t.deps.makeFile).toHaveBeenCalledTimes(1);
    expect(t.deps.urls.create).toHaveBeenCalledTimes(1);
  });

  it("reopening the same result reuses the card, with a fresh URL", async () => {
    const cache: CardCache = { current: null };
    const t = setup({ cache });
    await t.preview.open(KEY);
    t.preview.close();
    await t.preview.open(KEY);
    expect(t.deps.makeFile).toHaveBeenCalledTimes(1);
    expect(t.preview.getState().phase).toBe("ready");
    expect(t.preview.getState().imageUrl).toBe("blob:card-2");
    // Another entry on the same page shares the cache.
    const other = setup({ cache });
    await other.preview.open(KEY);
    expect(other.deps.makeFile).not.toHaveBeenCalled();
  });

  it("another result or language makes a new card", async () => {
    const cache: CardCache = { current: null };
    const t = setup({ cache });
    await t.preview.open(KEY);
    t.preview.close();
    await t.preview.open(["fit", "en", undefined, undefined]);
    expect(t.deps.makeFile).toHaveBeenCalledTimes(2);
  });

  it("closed while the card is still drawing: no URL is made, the card is kept for next time", async () => {
    const made = deferred<File>();
    const t = setup({ makeFile: vi.fn(() => made.promise) });
    const opening = t.preview.open(KEY);
    t.preview.close();
    made.resolve(card);
    await opening;
    expect(t.deps.urls.create).not.toHaveBeenCalled();
    expect(t.preview.getState()).toEqual(CLOSED_PREVIEW);
    expect(t.deps.cache.current?.file).toBe(card);
  });

  it("a card that cannot be made shows the error and reports failed", async () => {
    const t = setup({ makeFile: () => Promise.reject(new Error("no canvas")) });
    await t.preview.open(KEY);
    expect(t.preview.getState().phase).toBe("error");
    expect(t.deps.onFinished).toHaveBeenCalledWith("failed");
    expect(t.deps.cache.current).toBeNull();
    t.preview.close();
    expect(t.deps.urls.revoke).not.toHaveBeenCalled();
  });

  it("dispose (unmount) revokes the URL without moving focus", async () => {
    const t = setup();
    await t.preview.open(KEY);
    t.preview.dispose();
    expect(t.deps.urls.revoke).toHaveBeenCalledWith("blob:card-1");
    expect(t.deps.returnFocus).not.toHaveBeenCalled();
  });
});

describe("Esc", () => {
  it("stops the native close and closes the preview, focus back to the entry", async () => {
    const t = setup();
    await t.preview.open(KEY);
    const event = { preventDefault: vi.fn() };
    onPreviewCancel(event, t.preview);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(t.preview.getState().phase).toBe("closed");
    expect(t.deps.returnFocus).toHaveBeenCalledTimes(1);
  });
});

describe("share and download", () => {
  it("knows whether files can be shared already while generating", () => {
    const t = setup();
    void t.preview.open(KEY);
    expect(t.preview.getState().canShareFiles).toBe(true);
    const none = setup({ nav: undefined });
    void none.preview.open(KEY);
    expect(none.preview.getState().canShareFiles).toBe(false);
    const noCanShare = setup({ nav: { share: () => Promise.resolve() } });
    void noCanShare.preview.open(KEY);
    expect(noCanShare.preview.getState().canShareFiles).toBe(false);
  });

  it("does nothing until the card is ready", async () => {
    const made = deferred<File>();
    const t = setup({ makeFile: () => made.promise });
    const opening = t.preview.open(KEY);
    await t.preview.share();
    await t.preview.download();
    expect(t.deps.download).not.toHaveBeenCalled();
    made.resolve(card);
    await opening;
  });

  it("shares the file through navigator.share and stays open", async () => {
    const share = vi.fn(() => Promise.resolve());
    const t = setup({ nav: { share, canShare: () => true } });
    await t.preview.open(KEY);
    await t.preview.share();
    expect(share).toHaveBeenCalledWith({ files: [card] });
    expect(t.deps.onFinished).toHaveBeenCalledWith("shared");
    const s = t.preview.getState();
    expect(s.phase).toBe("ready");
    expect(s.hint).toBe("hidden");
    expect(s.actionFailed).toBe(false);
    expect(t.deps.download).not.toHaveBeenCalled();
  });

  it("a cancelled share is not an error and shows nothing", async () => {
    const share = vi.fn(() =>
      Promise.reject(new DOMException("cancelled", "AbortError")),
    );
    const t = setup({ nav: { share, canShare: () => true } });
    await t.preview.open(KEY);
    await t.preview.share();
    expect(t.deps.onFinished).toHaveBeenCalledWith("cancelled");
    const s = t.preview.getState();
    expect(s.hint).toBe("hidden");
    expect(s.actionFailed).toBe(false);
    expect(s.acting).toBeNull();
    expect(t.deps.download).not.toHaveBeenCalled();
  });

  it("waits while the share sheet is open: a second press does nothing", async () => {
    const sheet = deferred<void>();
    const share = vi.fn(() => sheet.promise);
    const t = setup({ nav: { share, canShare: () => true } });
    await t.preview.open(KEY);
    const first = t.preview.share();
    expect(t.preview.getState().acting).toBe("share");
    await t.preview.share();
    await t.preview.download();
    expect(share).toHaveBeenCalledTimes(1);
    expect(t.deps.download).not.toHaveBeenCalled();
    sheet.resolve();
    await first;
    expect(t.preview.getState().acting).toBeNull();
  });

  it("downloads through the given download, shows 已下載, and hides it after about 2 s", async () => {
    const t = setup();
    await t.preview.open(KEY);
    await t.preview.download();
    expect(t.deps.download).toHaveBeenCalledWith(card);
    expect(t.deps.onFinished).toHaveBeenCalledWith("downloaded");
    expect(t.preview.getState().hint).toBe("shown");
    expect(t.preview.getState().phase).toBe("ready");
    t.timers.advance(SAVED_HINT_MS - 1);
    expect(t.preview.getState().hint).toBe("shown");
    t.timers.advance(1);
    expect(t.preview.getState().hint).toBe("leaving");
    t.timers.advance(SAVED_HINT_FADE_MS);
    expect(t.preview.getState().hint).toBe("hidden");
    expect(t.timers.size).toBe(0);
  });

  it("a second download restarts the hint's 2 s", async () => {
    const t = setup();
    await t.preview.open(KEY);
    await t.preview.download();
    t.timers.advance(1500);
    await t.preview.download();
    t.timers.advance(1500);
    expect(t.preview.getState().hint).toBe("shown");
    t.timers.advance(500 + SAVED_HINT_FADE_MS);
    expect(t.preview.getState().hint).toBe("hidden");
  });

  it("closing clears the hint's timers", async () => {
    const t = setup();
    await t.preview.open(KEY);
    await t.preview.download();
    t.preview.close();
    expect(t.timers.size).toBe(0);
  });

  it("a share that fails for another reason falls back to the download (the old rule)", async () => {
    const share = vi.fn(() => Promise.reject(new Error("too large")));
    const t = setup({ nav: { share, canShare: () => true } });
    await t.preview.open(KEY);
    await t.preview.share();
    expect(t.deps.download).toHaveBeenCalledWith(card);
    expect(t.preview.getState().hint).toBe("shown");
  });

  it("a download that throws shows the action error, no hint", async () => {
    const t = setup({
      download: () => {
        throw new Error("blocked");
      },
    });
    await t.preview.open(KEY);
    await t.preview.download();
    expect(t.deps.onFinished).toHaveBeenCalledWith("failed");
    expect(t.preview.getState().actionFailed).toBe(true);
    expect(t.preview.getState().hint).toBe("hidden");
  });
});

function renderDialog(state: Partial<SharePreviewState>, copy = zhTW): string {
  return renderToStaticMarkup(
    createElement(SharePreviewDialog, {
      state: { ...CLOSED_PREVIEW, ...state },
      copy,
      onClose: () => {},
      onShare: () => {},
      onDownload: () => {},
    }),
  );
}

describe("the dialog's markup", () => {
  it("is a named modal dialog with a close button", () => {
    const html = renderDialog({
      phase: "ready",
      imageUrl: "blob:x",
      canShareFiles: true,
    });
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    const labelledBy = /aria-labelledby="([^"]+)"/.exec(html)?.[1];
    expect(labelledBy).toBeTruthy();
    expect(html).toContain(`id="${labelledBy}"`);
    expect(html).toContain("分享圖預覽</h2>");
    expect(html).toContain('aria-label="關閉"');
  });

  it("shows the card with alt text and both buttons when ready", () => {
    const html = renderDialog({
      phase: "ready",
      imageUrl: "blob:x",
      canShareFiles: true,
    });
    expect(html).toMatch(/<img[^>]*src="blob:x"/);
    expect(html).toMatch(/<img[^>]*alt="分享圖預覽"/);
    expect(html).toContain("share-preview-share");
    expect(html).toContain("share-preview-download");
    expect(html).toContain("<span>分享</span>");
    expect(html).toContain("<span>下載</span>");
    expect(html).not.toMatch(/<button[^>]*disabled=""/);
  });

  it("only 下載 where files cannot be shared", () => {
    const html = renderDialog({
      phase: "ready",
      imageUrl: "blob:x",
      canShareFiles: false,
    });
    expect(html).not.toContain("share-preview-share");
    expect(html).toContain("share-preview-download");
  });

  it("generating: a spinner, no image, both buttons disabled", () => {
    const html = renderDialog({ phase: "generating", canShareFiles: true });
    expect(html).toContain("sharePreview-spinner");
    expect(html).toContain('role="status"');
    expect(html).toContain("製作中…");
    expect(html).not.toContain("<img");
    const buttons = html.match(/<button[^>]*sharePreview-action[^>]*>/g) ?? [];
    expect(buttons).toHaveLength(2);
    for (const b of buttons) expect(b).toContain('disabled=""');
  });

  it("the 已下載 hint only after a download", () => {
    expect(renderDialog({ phase: "ready", imageUrl: "blob:x" })).not.toContain(
      "已下載",
    );
    const html = renderDialog({
      phase: "ready",
      imageUrl: "blob:x",
      hint: "shown",
    });
    expect(html).toContain("已下載");
    expect(html).toContain('data-phase="shown"');
  });

  it("English", () => {
    const html = renderDialog(
      {
        phase: "ready",
        imageUrl: "blob:x",
        canShareFiles: true,
        hint: "shown",
      },
      en,
    );
    expect(html).toContain("Share image preview</h2>");
    expect(html).toMatch(/alt="Share image preview"/);
    expect(html).toContain('aria-label="Close"');
    expect(html).toContain("<span>Share</span>");
    expect(html).toContain("<span>Download</span>");
    expect(html).toContain("Saved");
  });
});
