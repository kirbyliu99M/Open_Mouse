/**
 * V3.2 motion pass #6 (review fix, candidate / 未拍板): a results page comes in
 * from a side only when it replaces another page of the same scan inside the
 * same results layout.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  enterDirection,
  forgetShownView,
  lastShownView,
  noteShownView,
} from "../../src/lib/results/viewEnter";

afterEach(() => forgetShownView());

describe("enterDirection", () => {
  it("a detail page after the main page comes from the right", () => {
    expect(enterDirection({ scanId: "a", key: "main" }, "a", "g-pro")).toBe(
      "forward",
    );
  });
  it("another detail page also comes from the right", () => {
    expect(enterDirection({ scanId: "a", key: "g-pro" }, "a", "viper")).toBe(
      "forward",
    );
  });
  it("the main page after a detail page comes from the left", () => {
    expect(enterDirection({ scanId: "a", key: "g-pro" }, "a", "main")).toBe(
      "back",
    );
  });
  it("no side on a first arrival, for another scan, or for the same page", () => {
    expect(enterDirection(null, "a", "main")).toBeUndefined();
    expect(
      enterDirection({ scanId: "b", key: "main" }, "a", "g-pro"),
    ).toBeUndefined();
    expect(
      enterDirection({ scanId: "a", key: "main" }, "a", "main"),
    ).toBeUndefined();
  });
});

describe("the memory of the page last shown", () => {
  it("is forgotten when the results layout unmounts: coming back has no side", () => {
    noteShownView({ scanId: "a", key: "g-pro" });
    expect(enterDirection(lastShownView(), "a", "main")).toBe("back");
    forgetShownView();
    expect(enterDirection(lastShownView(), "a", "main")).toBeUndefined();
  });

  it("the provider forgets it on unmount (source pin)", async () => {
    const { readFileSync } = await import("node:fs");
    const provider = readFileSync(
      "src/app/results/[scanId]/ResultsScanProvider.tsx",
      "utf8",
    );
    expect(provider).toContain("useEffect(() => forgetShownView, []);");
  });
});
