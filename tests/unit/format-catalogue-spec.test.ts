import { describe, expect, it } from "vitest";
import { formatCatalogueSpec } from "../../src/app/format-catalogue-spec";

describe("formatCatalogueSpec", () => {
  it("shows whole values without a decimal", () => {
    expect(formatCatalogueSpec(125, "mm")).toBe("125\u00A0mm");
    expect(formatCatalogueSpec(60, "g")).toBe("60\u00A0g");
  });

  it("keeps one decimal for fractional values", () => {
    expect(formatCatalogueSpec(63.5, "mm")).toBe("63.5\u00A0mm");
  });
});
