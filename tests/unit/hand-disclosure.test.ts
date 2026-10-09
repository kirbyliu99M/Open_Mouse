import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  RESULT_HAND_KEY_PREFIX,
  resultHandKey,
  sweepLegacyHandKeys,
} from "../../src/components/results/handDisclosure";
import { resultLengthKey } from "../../src/components/results/userLengthDisclosure";

// A Storage stand-in with the real shape: index-addressed keys that shift
// when one is removed, which is what makes remove-while-walking a bug.
function fakeStorage(entries: Record<string, string>) {
  const map = new Map(Object.entries(entries));
  return {
    map,
    get length() {
      return map.size;
    },
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => {
      map.delete(key);
    },
  };
}

describe("sweepLegacyHandKeys", () => {
  it("removes every hand key, whatever scan it was for, and only those", () => {
    const storage = fakeStorage({
      [resultHandKey("scan-1")]: "left",
      [resultHandKey("scan-2")]: "right",
      [resultHandKey("scan-3")]: "left",
      [resultHandKey("scan-4")]: "right",
      [resultLengthKey("scan-1")]: "186",
      "open-mouse:first-run-tip": "1",
      "openMouse.resultHandsome": "not ours",
      unrelated: "x",
    });
    expect(sweepLegacyHandKeys(storage)).toBe(4);
    expect([...storage.map.keys()].sort()).toEqual(
      [
        resultLengthKey("scan-1"),
        "open-mouse:first-run-tip",
        "openMouse.resultHandsome",
        "unrelated",
      ].sort(),
    );
  });

  it("does nothing to an empty or hand-key-free storage", () => {
    expect(sweepLegacyHandKeys(fakeStorage({}))).toBe(0);
    const storage = fakeStorage({ unrelated: "x" });
    expect(sweepLegacyHandKeys(storage)).toBe(0);
    expect(storage.map.size).toBe(1);
  });

  it("uses the prefix the old builds wrote", () => {
    expect(RESULT_HAND_KEY_PREFIX).toBe("openMouse.resultHand.");
  });
});

describe("where the sweep runs", () => {
  it("on the results page and on both branches of the account page", () => {
    const results = readFileSync(
      "src/app/results/[scanId]/ResultsScanProvider.tsx",
      "utf8",
    );
    expect(results).toContain("sweepLegacyHandKeys(localStorage)");
    const account = readFileSync("src/app/account/page.tsx", "utf8");
    expect(account.match(/<LegacyHandKeySweep \/>/g)).toHaveLength(2);
  });
});
