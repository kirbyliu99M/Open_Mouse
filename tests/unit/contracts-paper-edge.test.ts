import { describe, expect, it } from "vitest";
import {
  MEASUREMENT_MODEL_VERSION,
  PAPER_EDGE_LIMITS,
  PAPER_SIZES_MM,
  scanSubmissionSchema,
} from "../../src/lib/contracts/measurement";

const measurements = { handLengthMm: 185, palmLengthMm: 105, palmWidthMm: 82 };

const paperEdge = {
  method: "paper-edge",
  paperSize: "a4",
  edgeFitResidualMm: 0.6,
  minSideCoverage: 0.72,
  parallaxCorrected: true,
} as const;

const body = (calibration: unknown) => ({
  hand: "right",
  measurements,
  calibration,
  measurementModelVersion: MEASUREMENT_MODEL_VERSION,
});

describe("scanSubmissionSchema — plain-paper calibration", () => {
  it("accepts a paper-edge calibration within the limits", () => {
    expect(scanSubmissionSchema.safeParse(body(paperEdge)).success).toBe(true);
  });

  it("still accepts the printed-sheet calibration with no method field", () => {
    const printed = {
      markerIds: [0, 1, 2, 3],
      reprojectionErrorMm: 0.4,
      cardScaleRatio: 1.003,
      parallaxCorrected: true,
    };
    expect(scanSubmissionSchema.safeParse(body(printed)).success).toBe(true);
  });

  it("rejects an edge-fit residual above the limit", () => {
    const r = scanSubmissionSchema.safeParse(
      body({
        ...paperEdge,
        edgeFitResidualMm: PAPER_EDGE_LIMITS.maxEdgeFitResidualMm + 0.01,
      }),
    );
    expect(r.success).toBe(false);
  });

  it("rejects a side coverage below the limit", () => {
    const r = scanSubmissionSchema.safeParse(
      body({
        ...paperEdge,
        minSideCoverage: PAPER_EDGE_LIMITS.minSideCoverage - 0.01,
      }),
    );
    expect(r.success).toBe(false);
  });

  it("rejects a paper size it does not know", () => {
    const r = scanSubmissionSchema.safeParse(
      body({ ...paperEdge, paperSize: "a5" }),
    );
    expect(r.success).toBe(false);
  });

  it("rejects a paper-edge body carrying printed-sheet fields (strict)", () => {
    const r = scanSubmissionSchema.safeParse(
      body({ ...paperEdge, cardScaleRatio: 1 }),
    );
    expect(r.success).toBe(false);
  });

  it("defines A4 and Letter in portrait millimetres", () => {
    expect(PAPER_SIZES_MM.a4).toEqual({ width: 210, height: 297 });
    expect(PAPER_SIZES_MM.letter).toEqual({ width: 215.9, height: 279.4 });
  });
});
