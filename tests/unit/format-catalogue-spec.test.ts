import { describe, expect, it } from "vitest";
import { formatCatalogueSpec } from "../../src/app/format-catalogue-spec";

describe("formatCatalogueSpec", () => {
  it("shows whole values without a decimal", () => {
    expect(formatCatalogueSpec(125, "mm")).toBe("125 mm");
    expect(formatCatalogueSpec(60, "g")).toBe("60 g");
  });

  it("keeps one decimal for fractional values", () => {
    expect(formatCatalogueSpec(63.5, "mm")).toBe("63.5 mm");
  });
});
