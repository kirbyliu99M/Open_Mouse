import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  isPersonOpening,
  PRINT_OPENED_ATTRIBUTE,
} from "../../src/lib/results/disclosure";

describe("isPersonOpening (what counts as opening Details or Other mice)", () => {
  it("counts a person opening it", () => {
    expect(isPersonOpening({ open: true, printOpened: false })).toBe(true);
  });

  it("does not count a close, whoever does it", () => {
    expect(isPersonOpening({ open: false, printOpened: false })).toBe(false);
    expect(isPersonOpening({ open: false, printOpened: true })).toBe(false);
  });

  it("does not count the open the print fallback makes", () => {
    expect(isPersonOpening({ open: true, printOpened: true })).toBe(false);
  });
});

describe("where the rule is used", () => {
  const read = (p: string) => readFileSync(p, "utf8");

  it("both disclosures skip analytics and the viewer for a print open", () => {
    for (const file of [
      "src/components/results/OtherMice.tsx",
      "src/components/results/ResultsDetails.tsx",
    ]) {
      const source = read(file);
      expect(source, file).toContain("isPersonOpening(");
      expect(source, file).toContain("PRINT_OPENED_ATTRIBUTE");
    }
  });

  it("the print fallback sets the mark before it opens, and clears it after the toggle events", () => {
    const source = read("src/components/results/PrintOpenDetails.tsx");
    expect(
      source.indexOf("setAttribute(PRINT_OPENED_ATTRIBUTE"),
    ).toBeGreaterThan(-1);
    expect(source.indexOf("setAttribute(PRINT_OPENED_ATTRIBUTE")).toBeLessThan(
      source.indexOf("details.open = true"),
    );
    expect(source).toContain("removeAttribute(PRINT_OPENED_ATTRIBUTE)");
    expect(PRINT_OPENED_ATTRIBUTE).toBe("data-print-opened");
  });
});
