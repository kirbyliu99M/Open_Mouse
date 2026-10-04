import { describe, expect, it } from "vitest";
import {
  measuredNumbersText,
  measuredSheetNumbers,
  UNVERIFIED_MEASUREMENT_NOTE,
} from "../../src/client/photo/unverified-note";

describe("measuredNumbersText", () => {
  it("says the hand length and the palm width in whole millimetres", () => {
    expect(
      measuredNumbersText({ handLengthMm: 189.6, palmWidthMm: 84.4 }),
    ).toBe("Hand length 190\u00A0mm · Palm width 84\u00A0mm");
  });

  it("says the length was entered when it is the typed reference, and shows that number", () => {
    expect(
      measuredNumbersText({
        handLengthMm: 186.2,
        palmWidthMm: 79.5,
        enteredLengthMm: 186,
      }),
    ).toBe("Hand length 186\u00A0mm (entered) · Palm width 80\u00A0mm");
  });

  it("is the same rounding the drawing on the photo uses (toFixed(0))", () => {
    for (const mm of [0.5, 1.5, 84.49, 84.5, 189.5]) {
      expect(measuredNumbersText({ handLengthMm: mm, palmWidthMm: mm })).toBe(
        `Hand length ${mm.toFixed(0)}\u00A0mm · Palm width ${mm.toFixed(0)}\u00A0mm`,
      );
    }
  });
});

describe("the unverified note", () => {
  it("is one plain sentence", () => {
    expect(UNVERIFIED_MEASUREMENT_NOTE).toBe(
      "Measurements are still being validated.",
    );
  });
});

describe("measuredSheetNumbers", () => {
  const measurements = { handLengthMm: 186.3, palmWidthMm: 79.5 };

  it("reads a typed length as entered, from the calibration's reference", () => {
    expect(
      measuredSheetNumbers(measurements, {
        method: "user-length",
        referenceMm: 186,
      }),
    ).toBe("Hand length 186\u00A0mm (entered) · Palm width 80\u00A0mm");
  });

  it("reads a paper-edge scan as measured", () => {
    expect(
      measuredSheetNumbers(measurements, {
        method: "paper-edge",
        paperSize: "a4",
      }),
    ).toBe("Hand length 186\u00A0mm · Palm width 80\u00A0mm");
  });

  it("reads a calibration with no method (the printed sheet) as measured", () => {
    expect(measuredSheetNumbers(measurements, { sheet: "a4" })).toBe(
      "Hand length 186\u00A0mm · Palm width 80\u00A0mm",
    );
  });

  it("does not say 'entered' for a user-length calibration with no reference", () => {
    expect(measuredSheetNumbers(measurements, { method: "user-length" })).toBe(
      "Hand length 186\u00A0mm · Palm width 80\u00A0mm",
    );
  });
});
