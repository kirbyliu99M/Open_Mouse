import { describe, expect, it } from "vitest";
import {
  clearScanDisclosures,
  resultLengthKey,
} from "../../src/components/results/userLengthDisclosure";
import { resultHandKey } from "../../src/components/results/handDisclosure";

describe("clearScanDisclosures", () => {
  it("removes both disclosures for every listed scan and preserves unlisted scans", () => {
    const values = new Map([
      [resultLengthKey("listed-1"), "180"],
      [resultHandKey("listed-1"), "left"],
      [resultLengthKey("listed-2"), "190"],
      [resultHandKey("listed-2"), "right"],
      [resultLengthKey("unlisted"), "175"],
      [resultHandKey("unlisted"), "left"],
    ]);
    const storage = { removeItem: (key: string) => values.delete(key) };

    clearScanDisclosures(storage, ["listed-1", "listed-2"]);

    expect([...values]).toEqual([
      [resultLengthKey("unlisted"), "175"],
      [resultHandKey("unlisted"), "left"],
    ]);
  });
});
