import { describe, expect, it } from "vitest";
import {
  ATTEMPT_LOG_KEY,
  clearAttempts,
  readStoredPaperSize,
  writeStoredPaperSize,
  readFirstRunTipSeen,
  markFirstRunTipSeen,
  type StorageLike,
} from "../../src/client/camera/easyScanPreferences";

function fakeStorage(initial: Record<string, string> = {}): StorageLike {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
  };
}

describe("easy-scan localStorage preferences", () => {
  it("defaults the paper size to a4 with no storage", () => {
    expect(readStoredPaperSize(null)).toBe("a4");
  });

  it("defaults to a4 when nothing has been stored yet", () => {
    expect(readStoredPaperSize(fakeStorage())).toBe("a4");
  });

  it("round-trips a stored paper size", () => {
    const storage = fakeStorage();
    writeStoredPaperSize(storage, "letter");
    expect(readStoredPaperSize(storage)).toBe("letter");
  });

  it("ignores a corrupt stored value and falls back", () => {
    const storage = fakeStorage({ "openMouse.easyScan.paperSize": "junk" });
    expect(readStoredPaperSize(storage)).toBe("a4");
  });

  it("the first-run tip is unseen with no storage, and seen after marking", () => {
    expect(readFirstRunTipSeen(null)).toBe(false);
    const storage = fakeStorage();
    expect(readFirstRunTipSeen(storage)).toBe(false);
    markFirstRunTipSeen(storage);
    expect(readFirstRunTipSeen(storage)).toBe(true);
  });

  it("writing to a null storage is a silent no-op", () => {
    expect(() => writeStoredPaperSize(null, "letter")).not.toThrow();
    expect(() => markFirstRunTipSeen(null)).not.toThrow();
  });
});

describe("clearAttempts — the attempt log goes when the person deletes their data", () => {
  function removable(initial: Record<string, string>) {
    const store = new Map(Object.entries(initial));
    return {
      store,
      storage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
          store.set(key, value);
        },
        removeItem: (key: string) => {
          store.delete(key);
        },
      } satisfies StorageLike,
    };
  }

  it("removes the log and nothing else", () => {
    const { store, storage } = removable({
      [ATTEMPT_LOG_KEY]: '[{"v":1}]',
      "openMouse.easyScan.paperSize": "letter",
      unrelated: "x",
    });
    clearAttempts(storage);
    expect(store.has(ATTEMPT_LOG_KEY)).toBe(false);
    expect(store.get("openMouse.easyScan.paperSize")).toBe("letter");
    expect(store.get("unrelated")).toBe("x");
  });

  it("on a store with no removeItem it empties the log instead", () => {
    const storage = fakeStorage({ [ATTEMPT_LOG_KEY]: '[{"v":1}]' });
    clearAttempts(storage);
    expect(storage.getItem(ATTEMPT_LOG_KEY)).toBe("[]");
  });

  it("never throws: no storage, a store that refuses", () => {
    expect(() => clearAttempts(null)).not.toThrow();
    expect(() =>
      clearAttempts({
        getItem: () => null,
        setItem: () => {
          throw new Error("blocked");
        },
        removeItem: () => {
          throw new Error("blocked");
        },
      }),
    ).not.toThrow();
  });
});
