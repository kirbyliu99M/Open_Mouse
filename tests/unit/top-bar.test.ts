import { describe, expect, it } from "vitest";
import { backLinkName } from "../../src/components/nav/labels";

describe("TopBar", () => {
  it("names the return destination for a screen reader", () => {
    expect(backLinkName("Sheet")).toBe("Back to Sheet");
    expect(backLinkName("Home")).toBe("Back to Home");
  });
});
