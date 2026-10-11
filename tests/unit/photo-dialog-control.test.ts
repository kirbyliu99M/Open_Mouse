/**
 * The modal lock and the scrim press of the enlarged-photo dialog, run against a
 * fake `<dialog>`: the repo has no jsdom or testing-library (and no new
 * dependency may be added), so the real component is not rendered here. The fake
 * behaves like the real element where it matters: `showModal()` sets `open`,
 * `close()` clears it and fires `close` ASYNCHRONOUSLY (a queued event), and
 * closing a dialog that is not open does nothing.
 */
import { describe, expect, it, vi } from "vitest";
import {
  createScrimPress,
  lockModal,
} from "../../src/lib/results/photoDialogControl";
import * as mouseMedia from "../../src/lib/results/mouseMedia";
import * as photoPaths from "../../src/lib/results/photoPaths";

class FakeDialog {
  open = false;
  private queue: (() => void)[] = [];
  closeListeners: (() => void)[] = [];
  showModal = vi.fn(() => {
    this.open = true;
  });
  close = vi.fn(() => {
    if (!this.open) return;
    this.open = false;
    this.queue.push(() => this.closeListeners.forEach((fn) => fn()));
  });
  /** Deliver the queued `close` events, as the event loop would later. */
  flush() {
    const run = this.queue;
    this.queue = [];
    run.forEach((fn) => fn());
  }
}

function setup() {
  const dialog = new FakeDialog();
  const body = { style: { overflow: "auto" } };
  const onClosed = vi.fn();
  // The component's wiring: the close handler asks the CURRENT lock.
  let current: ReturnType<typeof lockModal> | null = null;
  dialog.closeListeners.push(() => {
    if (current?.shouldNotifyClosed() === false) return;
    onClosed();
  });
  return {
    dialog,
    body,
    onClosed,
    mount() {
      current = lockModal(dialog, body);
      return current;
    },
  };
}

describe("lockModal: open, lock and close", () => {
  it("shows the dialog as a modal and stops the page behind it scrolling", () => {
    const t = setup();
    t.mount();
    expect(t.dialog.showModal).toHaveBeenCalledTimes(1);
    expect(t.dialog.open).toBe(true);
    expect(t.body.style.overflow).toBe("hidden");
  });

  it("does not call showModal on a dialog that is already open", () => {
    const t = setup();
    t.dialog.open = true;
    t.mount();
    expect(t.dialog.showModal).not.toHaveBeenCalled();
  });

  it("restores the page scroll when the user closes it", () => {
    const t = setup();
    const lock = t.mount();
    t.dialog.close();
    t.dialog.flush();
    expect(t.onClosed).toHaveBeenCalledTimes(1);
    // The component unmounts on the close, which runs the cleanup.
    lock.dispose();
    expect(t.body.style.overflow).toBe("auto");
  });

  it("restores the page scroll when the component unmounts while open", () => {
    const t = setup();
    const lock = t.mount();
    lock.dispose();
    expect(t.body.style.overflow).toBe("auto");
    expect(t.dialog.open).toBe(false);
  });

  it("never reports its own cleanup's close as a close by the user", () => {
    const t = setup();
    const lock = t.mount();
    lock.dispose();
    t.dialog.flush(); // the close() from the cleanup arrives
    expect(t.onClosed).not.toHaveBeenCalled();
  });
});

describe("lockModal: React StrictMode's mount, cleanup, mount", () => {
  it("keeps the dialog open and mounted after the queued close event", () => {
    const t = setup();
    const first = t.mount(); // effect
    first.dispose(); // simulated cleanup: close() queues its event
    t.mount(); // effect again: showModal() once more
    expect(t.dialog.open).toBe(true);
    t.dialog.flush(); // the first close() event reaches the handler now
    expect(t.onClosed).not.toHaveBeenCalled(); // so the component stays mounted
    expect(t.dialog.open).toBe(true);
    expect(t.body.style.overflow).toBe("hidden");
  });

  it("restores the original scroll style, not the first lock's", () => {
    const t = setup();
    t.mount().dispose();
    const second = t.mount();
    second.dispose();
    expect(t.body.style.overflow).toBe("auto");
  });

  it("still reports a real close afterwards", () => {
    const t = setup();
    t.mount().dispose();
    t.mount();
    t.dialog.flush();
    t.dialog.close(); // Esc or the close button
    t.dialog.flush();
    expect(t.onClosed).toHaveBeenCalledTimes(1);
  });
});

describe("createScrimPress", () => {
  it("closes on a press that starts and ends on the scrim", () => {
    const press = createScrimPress();
    press.down(1, true);
    expect(press.up(1, true)).toBe(true);
  });

  it("does not close when the press starts on the photo and ends on the scrim", () => {
    const press = createScrimPress();
    press.down(1, false);
    expect(press.up(1, true)).toBe(false);
  });

  it("does not close when the press starts on the scrim and ends on the photo", () => {
    const press = createScrimPress();
    press.down(1, true);
    expect(press.up(1, false)).toBe(false);
  });

  it("does not close when a second pointer lands, whichever lifts last", () => {
    const press = createScrimPress();
    press.down(1, true);
    press.down(2, true); // a pinch starting on the scrim
    expect(press.up(2, true)).toBe(false);
    expect(press.up(1, true)).toBe(false);
  });

  it("does not close when the first pointer lifts first either", () => {
    const press = createScrimPress();
    press.down(1, true);
    press.down(2, true);
    expect(press.up(1, true)).toBe(false);
    expect(press.up(2, true)).toBe(false);
  });

  it("is clean again after a pinch: the next single press can close", () => {
    const press = createScrimPress();
    press.down(1, true);
    press.down(2, true);
    press.up(1, true);
    press.up(2, true);
    press.down(3, true);
    expect(press.up(3, true)).toBe(true);
  });

  it("does not close after a cancel", () => {
    const press = createScrimPress();
    press.down(1, true);
    press.cancel(1);
    expect(press.up(1, true)).toBe(false);
    press.down(2, true);
    expect(press.up(2, true)).toBe(true);
  });

  it("ignores an up with no matching down", () => {
    expect(createScrimPress().up(9, true)).toBe(false);
  });
});

describe("photoPaths", () => {
  it("is re-exported unchanged by mouseMedia", () => {
    expect(mouseMedia.largePhotoPath).toBe(photoPaths.largePhotoPath);
    expect(mouseMedia.LARGE_PHOTO_WIDTH).toBe(photoPaths.LARGE_PHOTO_WIDTH);
    expect(mouseMedia.LARGE_PHOTO_HEIGHT).toBe(photoPaths.LARGE_PHOTO_HEIGHT);
    expect(photoPaths.largePhotoPath("/images/mice/a-b.webp")).toBe(
      "/images/mice/l/a-b.webp",
    );
  });
});
