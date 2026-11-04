import { describe, expect, it } from "vitest";
import {
  ATTEMPT_LOG_KEY,
  clearAttempts,
  readStoredPaperSize,
  writeStoredPaperSize,
  readFirstRunTipSeen,
  markFirstRunTipSeen,
  nextReference,
  readStoredReference,
  referenceChoices,
  writeStoredReference,
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

describe("v3.4 scan reference (A4 / Letter / card)", () => {
  it("steps A4 → Letter → card → A4 with the card on, and skips the card off", () => {
    expect(referenceChoices(true)).toEqual(["a4", "letter", "card"]);
    expect(referenceChoices(false)).toEqual(["a4", "letter"]);
    expect(nextReference("a4", true)).toBe("letter");
    expect(nextReference("letter", true)).toBe("card");
    expect(nextReference("card", true)).toBe("a4");
    expect(nextReference("letter", false)).toBe("a4");
    // A card left over from a build with the flag on starts over at A4.
    expect(nextReference("card", false)).toBe("a4");
  });

  it("keeps the card choice under its own key; the paper size under it survives (review items 5+6)", () => {
    const storage = fakeStorage();
    writeStoredReference(storage, "letter", true);
    writeStoredReference(storage, "card", true);
    expect(readStoredReference(storage, true)).toBe("card");
    // Flag off (or rolled back): the Letter choice is still there.
    expect(readStoredReference(storage, false)).toBe("letter");
    // The paper-size reader (used by the tour and on load) never sees "card".
    expect(readStoredPaperSize(storage)).toBe("letter");
    writeStoredReference(storage, "a4", true);
    expect(readStoredReference(storage, true)).toBe("a4");
    expect(readStoredPaperSize(storage)).toBe("a4");
  });

  it("with the flag off a paper choice writes only the paper-size key, as main did", () => {
    const writes: [string, string][] = [];
    const storage: StorageLike = {
      getItem: () => null,
      setItem: (k, v) => void writes.push([k, v]),
    };
    writeStoredReference(storage, "letter", false);
    expect(writes).toEqual([["openMouse.easyScan.paperSize", "letter"]]);
  });

  it('an older build\'s "card" under the paper-size key reads as A4 plus the card', () => {
    const legacy = fakeStorage({ "openMouse.easyScan.paperSize": "card" });
    expect(readStoredReference(legacy, true)).toBe("card");
    expect(readStoredReference(legacy, false)).toBe("a4");
    expect(readStoredPaperSize(legacy)).toBe("a4");
    // Choosing Letter afterwards: Letter, the card off.
    writeStoredReference(legacy, "letter", true);
    expect(readStoredReference(legacy, true)).toBe("letter");
  });

  it("falls back without storage, on junk and on a store that throws", () => {
    expect(readStoredReference(null, true)).toBe("a4");
    expect(
      readStoredReference(
        fakeStorage({ "openMouse.easyScan.paperSize": "x" }),
        true,
      ),
    ).toBe("a4");
    const throwing: StorageLike = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readStoredReference(throwing, true)).toBe("a4");
    expect(() => writeStoredReference(throwing, "card", true)).not.toThrow();
    expect(() => writeStoredReference(throwing, "a4", true)).not.toThrow();
  });
});
