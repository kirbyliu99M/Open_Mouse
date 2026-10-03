import { describe, expect, it } from "vitest";
import {
  HANDEDNESS_GATE_CODE,
  photoQualityAccepted,
} from "../../src/lib/m2/evaluate";
import type { LearningPhotoReport } from "../../src/lib/learning/report";

// The product's verdict for judgement correctness: the recorded paper and hand
// gates, with the handedness gate left out. One test per branch.

const gate = (errorCodes: string[] = [], ok = errorCodes.length === 0) => ({
  ok,
  errorCodes,
  warningCodes: [] as string[],
});

function reportWith(
  productGates: {
    paper: ReturnType<typeof gate>;
    hand: ReturnType<typeof gate> | null;
    accepted?: boolean;
  } | null,
): LearningPhotoReport {
  return {
    productGates:
      productGates === null
        ? null
        : {
            ...productGates,
            accepted:
              productGates.accepted ??
              (productGates.paper.ok && productGates.hand?.ok === true),
          },
  } as unknown as LearningPhotoReport;
}

describe("photoQualityAccepted", () => {
  it("names the one gate it leaves out", () => {
    expect(HANDEDNESS_GATE_CODE).toBe("HANDEDNESS_MISMATCH");
  });

  it("no gate record at all: not accepted, and the record is said to be missing", () => {
    expect(photoQualityAccepted(reportWith(null))).toEqual({
      accepted: false,
      hasRecord: false,
    });
  });

  it("the paper was refused, so the hand gates were never reached: not accepted", () => {
    expect(
      photoQualityAccepted(
        reportWith({ paper: gate(["PAPER_CORNER_HIDDEN"]), hand: null }),
      ),
    ).toEqual({ accepted: false, hasRecord: true });
  });

  it("the paper is fine but the hand gates were not reached or not recorded (hand is null): not accepted", () => {
    expect(
      photoQualityAccepted(reportWith({ paper: gate(), hand: null })),
    ).toEqual({ accepted: false, hasRecord: true });
  });

  it("the paper was refused and the hand gates are clear: still not accepted", () => {
    expect(
      photoQualityAccepted(
        reportWith({ paper: gate(["PAPER_CURLED"]), hand: gate() }),
      ),
    ).toEqual({ accepted: false, hasRecord: true });
  });

  it("only HANDEDNESS_MISMATCH: accepted, though the recorded gates as a whole refuse the photo", () => {
    const report = reportWith({
      paper: gate(),
      hand: gate(["HANDEDNESS_MISMATCH"]),
    });
    expect(report.productGates!.accepted).toBe(false);
    expect(photoQualityAccepted(report)).toEqual({
      accepted: true,
      hasRecord: true,
    });
  });

  it("HANDEDNESS_MISMATCH plus another error: not accepted", () => {
    expect(
      photoQualityAccepted(
        reportWith({
          paper: gate(),
          hand: gate(["HANDEDNESS_MISMATCH", "LOW_LANDMARK_CONFIDENCE"]),
        }),
      ),
    ).toEqual({ accepted: false, hasRecord: true });
    // Another error alone, too.
    expect(
      photoQualityAccepted(
        reportWith({ paper: gate(), hand: gate(["HAND_OUT_OF_BOUNDS"]) }),
      ),
    ).toEqual({ accepted: false, hasRecord: true });
  });

  it("a hand gate that failed with no code recorded is not mistaken for a handedness-only failure", () => {
    expect(
      photoQualityAccepted(
        reportWith({ paper: gate(), hand: gate([], false) }),
      ),
    ).toEqual({ accepted: false, hasRecord: true });
  });

  it("everything clear: accepted", () => {
    expect(
      photoQualityAccepted(reportWith({ paper: gate(), hand: gate() })),
    ).toEqual({ accepted: true, hasRecord: true });
  });

  it("a paper gate that is not ok is not accepted even with no code (the paper's own ok decides)", () => {
    expect(
      photoQualityAccepted(
        reportWith({ paper: gate([], false), hand: gate() }),
      ),
    ).toEqual({ accepted: false, hasRecord: true });
  });
});
