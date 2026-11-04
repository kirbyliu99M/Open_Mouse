/**
 * v3.4 (Kirby: A4 and the card coexist): the paper path must stay exactly
 * as on main 4658bdab. These pin the A4 submit body byte for byte, and the
 * reference chip's A4 ↔ Letter toggle, with the card flag off and on.
 */
import { describe, expect, it } from "vitest";
import { assemblePaperEdgeSubmission } from "../../src/client/photo/submission";
import {
  readStoredPaperSize,
  readStoredReference,
  referenceSelect,
  referenceSwitch,
  writeStoredReference,
  type StorageLike,
} from "../../src/client/camera/easyScanPreferences";

const MEASUREMENTS = {
  handLengthMm: 183.4,
  palmLengthMm: 104.2,
  palmWidthMm: 64.6,
  thumbLengthMm: 58.1,
  indexLengthMm: 70.3,
  middleLengthMm: 79.9,
  ringLengthMm: 74.2,
  pinkyLengthMm: 58.6,
};

/** The body main 4658bdab builds for this A4 scan (JSON, byte for byte). */
const A4_BODY_ON_MAIN =
  '{"hand":"right","measurements":{"handLengthMm":183.4,"palmLengthMm":104.2,"palmWidthMm":64.6,"thumbLengthMm":58.1,"indexLengthMm":70.3,"middleLengthMm":79.9,"ringLengthMm":74.2,"pinkyLengthMm":58.6},"calibration":{"method":"paper-edge","paperSize":"a4","edgeFitResidualMm":0.42,"minSideCoverage":0.93,"parallaxCorrected":true,"focalSource":"nominal"},"measurementModelVersion":"landmark-raw-v3"}';

describe("paper path regression (v3.4 card mode added)", () => {
  it("an A4 scan's submit body is byte-identical to main's", () => {
    const body = assemblePaperEdgeSubmission({
      hand: "right",
      measurements: MEASUREMENTS,
      paperSize: "a4",
      edgeFitResidualMm: 0.42,
      minSideCoverage: 0.93,
      parallaxCorrected: true,
      focalSource: "nominal",
    });
    expect(JSON.stringify(body)).toBe(A4_BODY_ON_MAIN);
  });

  it("A4 ↔ Letter never touches the live loop, with the card flag off or on", () => {
    for (const flag of [false, true]) {
      expect(
        referenceSwitch({ cardMode: false, paperSize: "a4" }, flag),
      ).toEqual({
        next: "letter",
        cardMode: false,
        paperSize: "letter",
        resetLoop: false,
      });
    }
    // Flag off: Letter goes back to A4, exactly the old toggle.
    expect(
      referenceSwitch({ cardMode: false, paperSize: "letter" }, false),
    ).toEqual({
      next: "a4",
      cardMode: false,
      paperSize: "a4",
      resetLoop: false,
    });
  });

  it("crossing into and out of the card resets the live loop", () => {
    const toCard = referenceSwitch(
      { cardMode: false, paperSize: "letter" },
      true,
    );
    expect(toCard).toEqual({
      next: "card",
      cardMode: true,
      paperSize: "letter",
      resetLoop: true,
    });
    const back = referenceSwitch({ cardMode: true, paperSize: "letter" }, true);
    expect(back).toEqual({
      next: "a4",
      cardMode: false,
      paperSize: "a4",
      resetLoop: true,
    });
  });

  it("choosing directly (the tour's radios) is the same step as the chip", () => {
    const paper = { cardMode: false, paperSize: "a4" } as const;
    // A4 → Letter: the old toggle, no loop reset.
    expect(referenceSelect(paper, "letter", true)).toEqual({
      next: "letter",
      cardMode: false,
      paperSize: "letter",
      resetLoop: false,
    });
    expect(referenceSelect(paper, "a4", false).resetLoop).toBe(false);
    // Into the card and back: a reset each way.
    expect(referenceSelect(paper, "card", true)).toEqual({
      next: "card",
      cardMode: true,
      paperSize: "a4",
      resetLoop: true,
    });
    expect(
      referenceSelect({ cardMode: true, paperSize: "a4" }, "letter", true),
    ).toEqual({
      next: "letter",
      cardMode: false,
      paperSize: "letter",
      resetLoop: true,
    });
    // The card with the flag off changes nothing.
    expect(referenceSelect(paper, "card", false)).toEqual({
      next: "a4",
      cardMode: false,
      paperSize: "a4",
      resetLoop: false,
    });
  });

  it("a new user starts on A4; the card only when chosen", () => {
    const store = new Map<string, string>();
    const storage: StorageLike = {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => void store.set(k, v),
    };
    expect(readStoredReference(storage, true)).toBe("a4");
    expect(readStoredPaperSize(storage)).toBe("a4");
    writeStoredReference(storage, "card", true);
    expect(readStoredReference(storage, true)).toBe("card");
    expect(readStoredReference(storage, false)).toBe("a4");
    // The paper size is kept apart from the card (review item 6).
    expect(readStoredPaperSize(storage)).toBe("a4");
  });
});
