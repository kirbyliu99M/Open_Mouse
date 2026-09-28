import { describe, expect, it } from "vitest";
import {
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
