import { describe, expect, it } from "vitest";
import { REASON_CODES } from "../../src/lib/contracts/fit";
import {
  allReasonCodesHaveTemplates,
  reasonText,
} from "../../src/components/results/reasons";

describe("reasonText", () => {
  it("has a template for every REASON_CODE", () => {
    expect(allReasonCodesHaveTemplates()).toBe(true);
  });

  it.each(REASON_CODES)("renders a non-empty sentence for %s", (code) => {
    const sentence = reasonText(code, {}, "en");
    expect(typeof sentence).toBe("string");
    expect(sentence.length).toBeGreaterThan(0);
  });

  it("formats a length_short delta in mm", () => {
    expect(reasonText("length_short", { deltaMm: -3.2 }, "en")).toContain(
      "3.2\u00A0mm",
    );
  });

  it("formats a length_long delta in mm", () => {
    expect(reasonText("length_long", { deltaMm: 6.4 }, "en")).toContain(
      "6.4\u00A0mm",
    );
  });

  it("formats a weight_heavier delta in grams, rounded", () => {
    expect(reasonText("weight_heavier", { deltaG: 12.6 }, "en")).toContain(
      "13\u00A0g",
    );
  });

  it("formats a weight_lighter delta in grams", () => {
    expect(reasonText("weight_lighter", { deltaG: -8 }, "en")).toContain(
      "8\u00A0g",
    );
  });

  it("degrades gracefully when a numeric param is missing", () => {
    expect(reasonText("length_short", {}, "en")).toBe(
      "This mouse is shorter than your ideal length.",
    );
  });

  it("never shows a negative sign — deltas are always presented as a magnitude", () => {
    const sentence = reasonText("length_short", { deltaMm: -3.2 }, "en");
    expect(sentence).not.toContain("-3.2");
  });

  it("descriptor_unknown renders the plain shape status", () => {
    expect(reasonText("descriptor_unknown", {}, "en")).toBe(
      "Shape not rated yet",
    );
  });
});
