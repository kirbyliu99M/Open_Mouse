import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CAPTURE_METHODS,
  EDGE_FIT_BUCKETS,
  FOCAL_SOURCES,
  HAND_POSE_BUCKETS,
  LIVE_WAIT_BUCKETS,
  PAPER_ASPECT_BUCKETS,
  PAPER_COVERAGE_BUCKETS,
  PAPER_SKEW_BUCKETS,
  PRIOR_EFFECT_BUCKETS,
  RESOLUTION_BUCKETS,
  SHARPNESS_BUCKETS,
  analyticsEventSchemas,
  PAPER_DETECTION_STAGES as CONTRACT_PAPER_DETECTION_STAGES,
} from "../../src/lib/contracts/analytics";
import {
  PAPER_DETECTION_STAGES as CLIENT_PAPER_DETECTION_STAGES,
  type PaperDetectionStage,
} from "../../src/client/paper/detectionStage";
import {
  buildScanQuality,
  buildScanRejected,
  edgeFitBucket,
  handPoseBucket,
  liveWaitBucket,
  paperAspectBucket,
  paperCoverageBucket,
  paperSkewBucket,
  priorEffectBucket,
  rejectedHandPose,
  rejectedPaperCoverage,
  rejectedPaperSkew,
  rejectedShadowProps,
  resolutionBucket,
  sharpnessBucket,
} from "../../src/client/analytics/scanQuality";
import { GATE_THRESHOLDS } from "../../src/client/photo/gates";
import type { PipelineDiagnostics } from "../../src/client/photo/diagnostics";

function diag(over: Partial<PipelineDiagnostics> = {}): PipelineDiagnostics {
  return {
    decodeMs: 10,
    paperMs: 10,
    handMs: 10,
    totalMs: 40,
    decoded: { width: 2000, height: 1500 },
    analysed: { width: 2000, height: 1500 },
    fovCrop: null,
    view: null,
    paper: {
      cornersSeen: 4,
      paperRegionFound: true,
      widthFraction: 0.7,
      heightFraction: 0.8,
      edgeFitResidualMm: 0.3,
      maxAngleDeviationDeg: 1.5,
      observedAspect: 0.7066,
      minSideCoverage: 0.9,
      sideCoverages: [0.9, 1, 1, 0.95],
      worstSide: "top",
      gateFailures: [],
    },
    laplacianVariance: 150,
    hand: {
      detected: true,
      confidence: 0.9,
      handedness: "right",
      flatness: {
        pose: "flat_like",
        reachMean: 0.745,
        fingerStraightMin: 0.999,
      },
    },
    parallaxCorrected: true,
    measured: { handLengthMm: 180, palmWidthMm: 85 },
    focal: { source: "exif", px: 2900 },
    shadowPrior: { handLengthDeltaMm: -0.4 },
    ...over,
  };
}

const BAD_NUMBERS = [Number.NaN, -1, Infinity, -Infinity, null, undefined];

describe("the sharpness gate is the pipeline's, not a second copy", () => {
  it("buckets against GATE_THRESHOLDS.minLaplacianVariance", () => {
    const gate = GATE_THRESHOLDS.minLaplacianVariance;
    expect(sharpnessBucket(gate - 0.01)).toBe("below_gate");
    expect(sharpnessBucket(gate)).toBe("near_gate");
    expect(sharpnessBucket(gate * 2)).toBe("clear");
  });
});

describe("sharpnessBucket", () => {
  it.each([
    [0, "below_gate"],
    [49.99, "below_gate"],
    [50, "near_gate"],
    [99.99, "near_gate"],
    [100, "clear"],
    [5000, "clear"],
  ] as const)("%s -> %s", (v, bucket) => {
    expect(sharpnessBucket(v)).toBe(bucket);
  });
  it.each(BAD_NUMBERS)("%s -> null", (v) => {
    expect(sharpnessBucket(v)).toBeNull();
  });
});

describe("resolutionBucket (long edge of the decoded photo)", () => {
  it.each([
    [1279, 900, "under_1280"],
    [1280, 900, "from_1280_to_1919"],
    [1919, 900, "from_1280_to_1919"],
    [1920, 900, "from_1920"],
    [3000, 2000, "from_1920"],
    // The long edge counts, not the width: a portrait photo buckets the same.
    [900, 1279, "under_1280"],
    [900, 1280, "from_1280_to_1919"],
    [900, 1919, "from_1280_to_1919"],
    [900, 1920, "from_1920"],
  ] as const)("%s x %s -> %s", (width, height, bucket) => {
    expect(resolutionBucket({ width, height })).toBe(bucket);
  });
  it("null without a decoded photo", () => {
    expect(resolutionBucket(null)).toBeNull();
    expect(resolutionBucket(undefined)).toBeNull();
  });
  it.each([
    [Number.NaN, 1000],
    [1000, Number.NaN],
    [-1, 1000],
    [1000, -1],
    [Infinity, 1000],
    [1000, Infinity],
    [0, 0],
    [0, 2000],
    [2000, 0],
  ])("%s x %s -> null", (width, height) => {
    expect(resolutionBucket({ width, height })).toBeNull();
  });
});

describe("edgeFitBucket", () => {
  it.each([
    [0, "under_0_5_mm"],
    [0.4999, "under_0_5_mm"],
    [0.5, "from_0_5_to_1_mm"],
    [0.9999, "from_0_5_to_1_mm"],
    [1, "from_1_mm"],
    [3, "from_1_mm"],
  ] as const)("%s -> %s", (v, bucket) => {
    expect(edgeFitBucket(v)).toBe(bucket);
  });
  it.each(BAD_NUMBERS)("%s -> null", (v) => {
    expect(edgeFitBucket(v)).toBeNull();
  });
});

describe("paperSkewBucket (largest corner-angle deviation, degrees)", () => {
  it.each([
    [0, "under_3"],
    [2.9999, "under_3"],
    [3, "from_3_to_6"],
    [5.9999, "from_3_to_6"],
    [6, "from_6_to_9"],
    [8.9999, "from_6_to_9"],
    [9, "from_9"],
    [12, "from_9"],
    [40, "from_9"],
  ] as const)("%s -> %s", (v, bucket) => {
    expect(paperSkewBucket(v)).toBe(bucket);
  });
  it.each([-0.0001, -1, Number.NaN, Infinity, -Infinity, null, undefined])(
    "%s -> null",
    (v) => {
      expect(paperSkewBucket(v)).toBeNull();
    },
  );
});

describe("paperAspectBucket does not depend on which way the sheet lies in the frame", () => {
  it("reads a sheet lying across the frame (about 1.41) the same as one standing up (about 0.71)", () => {
    for (const standing of [0.7071, 0.7113, 0.7053, 0.7727, 0.6627, 0.68]) {
      expect(paperAspectBucket(1 / standing)).toBe(paperAspectBucket(standing));
    }
    expect(paperAspectBucket(297 / 210)).toBe("under_2_pct");
    expect(paperAspectBucket(279.4 / 215.9)).toBe("under_2_pct");
    // Kirby's 163.5 mm scan (0.6627) is just as far off turned the other way.
    expect(paperAspectBucket(1 / 0.6627)).toBe("from_4_pct");
  });
  it("an aspect of exactly 1 is a square, far from any sheet", () => {
    expect(paperAspectBucket(1)).toBe("from_4_pct");
  });
});

describe("paperAspectBucket (observed width over height against A4 and Letter)", () => {
  const A4 = 210 / 297;
  const LETTER = 215.9 / 279.4;

  it("an exact A4 or Letter sheet is under 2 %", () => {
    expect(paperAspectBucket(A4)).toBe("under_2_pct");
    expect(paperAspectBucket(LETTER)).toBe("under_2_pct");
  });

  it.each([
    [0.0199, "under_2_pct"],
    [0.02, "from_2_to_4_pct"],
    [0.0399, "from_2_to_4_pct"],
    [0.04, "from_4_pct"],
    [0.2, "from_4_pct"],
  ] as const)("a deviation of %s from A4 -> %s", (deviation, bucket) => {
    // A sheet that reads too narrow, and (clear of Letter, below 4 %) too wide.
    expect(paperAspectBucket(A4 * (1 - deviation))).toBe(bucket);
    if (deviation < 0.04) {
      expect(paperAspectBucket(A4 * (1 + deviation))).toBe(bucket);
    }
  });

  it("the deviation is against the nearer paper: Letter's own shape is not an outlier", () => {
    expect(paperAspectBucket(LETTER * 1.0199)).toBe("under_2_pct");
    expect(paperAspectBucket(LETTER * 0.9801)).toBe("under_2_pct");
    expect(paperAspectBucket(LETTER * 1.02)).toBe("from_2_to_4_pct");
    expect(paperAspectBucket(LETTER * 1.0399)).toBe("from_2_to_4_pct");
    expect(paperAspectBucket(LETTER * 1.04)).toBe("from_4_pct");
  });

  // Kirby's real scans (2026-10-17): (widthFraction, heightFraction) of an
  // analysed photo of 1024 x 1920 px; observed = (w * 1024) / (h * 1920).
  const observed = (w: number, h: number) => (w * 1024) / (h * 1920);
  it.each([
    [0.6687, 0.5051],
    [0.5987, 0.4514],
    [0.6385, 0.4787],
    [0.6318, 0.4779],
    [0.7151, 0.5382],
    [0.652, 0.4931],
    [0.7296, 0.5517],
    [0.6728, 0.5081],
  ] as const)("ordinary scan (%s, %s) is under 2 percent", (w, h) => {
    const a = observed(w, h);
    expect(Math.abs(a / A4 - 1)).toBeLessThan(0.007);
    expect(paperAspectBucket(a)).toBe("under_2_pct");
  });

  it("the outlier scan (0.765, 0.6157) is 4 % or more off, about 6.3 %", () => {
    const a = observed(0.765, 0.6157);
    expect(Math.abs(a / A4 - 1)).toBeCloseTo(0.063, 2);
    expect(paperAspectBucket(a)).toBe("from_4_pct");
  });

  it.each([0, -0.7, Number.NaN, Infinity, -Infinity, null, undefined])(
    "%s -> null",
    (v) => {
      expect(paperAspectBucket(v)).toBeNull();
    },
  );
});

describe("priorEffectBucket (shadow hand length minus the shown one, mm)", () => {
  it.each([
    [-30, "lower_5_plus"],
    [-5.0001, "lower_5_plus"],
    [-5, "lower_5_plus"],
    [-4.9999, "lower_2_to_5"],
    [-3, "lower_2_to_5"],
    [-2.0001, "lower_2_to_5"],
    [-2, "lower_2_to_5"],
    [-1.9999, "within_2"],
    [0, "within_2"],
    [1.9999, "within_2"],
    [2, "higher_2_plus"],
    [2.0001, "higher_2_plus"],
    [30, "higher_2_plus"],
  ] as const)("%s -> %s", (v, bucket) => {
    expect(priorEffectBucket(v)).toBe(bucket);
  });
  it.each([Number.NaN, Infinity, -Infinity, null, undefined])(
    "%s -> null",
    (v) => {
      expect(priorEffectBucket(v)).toBeNull();
    },
  );
});

describe("paperCoverageBucket (the sheet's least-seen side)", () => {
  it.each([
    [0, "under_0_6"],
    [0.4, "under_0_6"],
    [0.5999, "under_0_6"],
    [0.6, "from_0_6_to_0_8"],
    [0.7999, "from_0_6_to_0_8"],
    [0.8, "from_0_8"],
    [1, "from_0_8"],
  ] as const)("%s -> %s", (v, bucket) => {
    expect(paperCoverageBucket(v)).toBe(bucket);
  });
  it.each([Number.NaN, -0.01, 1.01, Infinity, -Infinity, null, undefined])(
    "%s -> null",
    (v) => {
      expect(paperCoverageBucket(v)).toBeNull();
    },
  );
  it("uses every step of the contract's list", () => {
    expect(
      new Set([0, 0.7, 0.9].map((v) => paperCoverageBucket(v) as string)),
    ).toEqual(new Set(PAPER_COVERAGE_BUCKETS));
  });
});

describe("handPoseBucket (only the grade is passed on)", () => {
  it.each(["flat_like", "borderline", "extreme", "unknown"] as const)(
    "%s",
    (pose) => {
      const hand = {
        ...diag().hand,
        flatness: { pose, reachMean: null, fingerStraightMin: null },
      };
      expect(handPoseBucket(hand)).toBe(pose);
      expect(HAND_POSE_BUCKETS).toContain(pose);
    },
  );
  it("is null without a hand or a reading", () => {
    expect(handPoseBucket(null)).toBeNull();
    expect(handPoseBucket(undefined)).toBeNull();
    expect(handPoseBucket({ ...diag().hand, flatness: null })).toBeNull();
  });
});

describe("liveWaitBucket (milliseconds to four steps and unknown)", () => {
  it.each([
    [0, "under_3_s"],
    [2999, "under_3_s"],
    [3000, "from_3_to_10_s"],
    [9999, "from_3_to_10_s"],
    [10000, "from_10_to_30_s"],
    [29999, "from_10_to_30_s"],
    [30000, "from_30_s"],
    [600000, "from_30_s"],
  ] as const)("%s ms -> %s", (v, bucket) => {
    expect(liveWaitBucket(v)).toBe(bucket);
  });
  it.each([Number.NaN, -1, Infinity, -Infinity, null, undefined])(
    "%s -> unknown",
    (v) => {
      expect(liveWaitBucket(v)).toBe("unknown");
    },
  );
  it("only returns the contract's steps", () => {
    for (const v of [0, 3000, 10000, 30000, null]) {
      expect(LIVE_WAIT_BUCKETS).toContain(liveWaitBucket(v));
    }
  });
  it("passes the contract's scan_capture_attempted schema", () => {
    expect(() =>
      analyticsEventSchemas.scan_capture_attempted.parse({
        flow: "easy",
        method: "canvas",
        attempt: 1,
        liveWait: liveWaitBucket(4200),
      }),
    ).not.toThrow();
  });
});

describe("the shadow buckets of a refused scan", () => {
  it("coverage needs the four corners, the pose needs a read hand", () => {
    expect(rejectedPaperCoverage(diag())).toBe("from_0_8");
    expect(rejectedHandPose(diag())).toBe("flat_like");
    const noCorners = diag({
      paper: {
        ...diag().paper!,
        widthFraction: null,
        heightFraction: null,
        edgeFitResidualMm: null,
        maxAngleDeviationDeg: null,
        observedAspect: null,
        minSideCoverage: 0.3,
        sideCoverages: [0.3, 1, 1, 1],
        worstSide: null,
      },
      hand: {
        detected: false,
        confidence: null,
        handedness: null,
        flatness: null,
      },
    });
    expect(rejectedPaperCoverage(noCorners)).toBeUndefined();
    expect(rejectedHandPose(noCorners)).toBeUndefined();
    expect(rejectedShadowProps(noCorners)).toEqual({});
    expect(rejectedShadowProps(null)).toEqual({});
    expect(rejectedShadowProps(undefined)).toEqual({});
  });
  it("rejectedShadowProps carries the three grades and passes the schema", () => {
    const props = rejectedShadowProps(diag());
    expect(props).toEqual({
      paperSkew: "under_3",
      paperCoverage: "from_0_8",
      handPose: "flat_like",
    });
    expect(() =>
      analyticsEventSchemas.scan_rejected.parse({
        flow: "easy",
        attempt: 1,
        codes: ["PAPER_CURLED"],
        ...props,
      }),
    ).not.toThrow();
  });
  it("no number or raw ratio rides along", () => {
    const out = rejectedShadowProps(
      diag({
        hand: {
          detected: true,
          confidence: 0.9234,
          handedness: "left",
          flatness: {
            pose: "extreme",
            reachMean: 0.48123,
            fingerStraightMin: 0.94321,
          },
        },
      }),
    );
    expect(Object.values(out).every((v) => typeof v === "string")).toBe(true);
    const text = JSON.stringify(out);
    for (const needle of ["0.481", "0.943", "0.9234"]) {
      expect(text).not.toContain(needle);
    }
  });
});

describe("buildScanQuality carries the shadow grades", () => {
  const base = {
    flow: "easy",
    attempt: 1,
    method: "canvas",
  } as const;
  it("adds paperCoverage and handPose", () => {
    const out = buildScanQuality({ ...base, diagnostics: diag() });
    expect(out?.paperCoverage).toBe("from_0_8");
    expect(out?.handPose).toBe("flat_like");
  });
  it("leaves them out, and keeps the event, where they cannot be worked out", () => {
    const out = buildScanQuality({
      ...base,
      diagnostics: diag({
        paper: { ...diag().paper!, minSideCoverage: Number.NaN },
        hand: {
          detected: true,
          confidence: 0.9,
          handedness: "left",
          flatness: null,
        },
      }),
    });
    expect(out).not.toBeNull();
    expect(out).not.toHaveProperty("paperCoverage");
    expect(out).not.toHaveProperty("handPose");
    expect(() => analyticsEventSchemas.scan_quality.parse(out)).not.toThrow();
  });
});

describe("rejectedPaperSkew (a refused scan's skew bucket)", () => {
  it("is the bucket when the four corners were found", () => {
    expect(rejectedPaperSkew(diag())).toBe("under_3");
    expect(
      rejectedPaperSkew(
        diag({ paper: { ...diag().paper!, maxAngleDeviationDeg: 10 } }),
      ),
    ).toBe("from_9");
  });
  it("is undefined (property left out) without it", () => {
    expect(
      rejectedPaperSkew(
        diag({ paper: { ...diag().paper!, maxAngleDeviationDeg: null } }),
      ),
    ).toBeUndefined();
    expect(rejectedPaperSkew(diag({ paper: null }))).toBeUndefined();
    expect(rejectedPaperSkew(null)).toBeUndefined();
    expect(rejectedPaperSkew(undefined)).toBeUndefined();
  });
  it("passes the contract's scan_rejected schema either way", () => {
    const skew = rejectedPaperSkew(diag());
    const base = { flow: "easy", attempt: 1, codes: ["PAPER_CURLED"] };
    expect(() =>
      analyticsEventSchemas.scan_rejected.parse({
        ...base,
        ...(skew ? { paperSkew: skew } : {}),
      }),
    ).not.toThrow();
    expect(() => analyticsEventSchemas.scan_rejected.parse(base)).not.toThrow();
  });
});

describe("rejected paper grades for a frame a person placed (V3.2 F2)", () => {
  const placed = (source: "adjusted" | "manual") =>
    diag({
      paper: {
        ...diag().paper!,
        cornersSource: source,
        minSideCoverage: null,
        edgeFitResidualMm: null,
      },
    });
  const fullCoverage = (source: "adjusted" | "manual") =>
    diag({ paper: { ...diag().paper!, cornersSource: source } });

  it("leaves paperSkew and paperCoverage out for adjusted and manual corners", () => {
    for (const source of ["adjusted", "manual"] as const) {
      expect(rejectedPaperSkew(placed(source))).toBeUndefined();
      // Even with a coverage number on it, a placed frame carries none.
      expect(rejectedPaperCoverage(fullCoverage(source))).toBeUndefined();
      const out = buildScanRejected({
        flow: "easy",
        attempt: 2,
        errors: [{ code: "HAND_OUT_OF_BOUNDS" }],
        diagnostics: fullCoverage(source),
      });
      expect(out).not.toHaveProperty("paperSkew");
      expect(out).not.toHaveProperty("paperCoverage");
      // The hand grade does not depend on the paper's corners.
      expect(out.handPose).toBe("flat_like");
      expect(() =>
        analyticsEventSchemas.scan_rejected.parse(out),
      ).not.toThrow();
    }
  });

  it("keeps them for the detector's corners, said or left unsaid", () => {
    const auto = diag({ paper: { ...diag().paper!, cornersSource: "auto" } });
    expect(rejectedPaperSkew(auto)).toBe("under_3");
    expect(rejectedPaperCoverage(auto)).toBe("from_0_8");
    expect(rejectedPaperSkew(diag())).toBe("under_3");
    expect(rejectedPaperCoverage(diag())).toBe("from_0_8");
  });
});

describe("buildScanQuality", () => {
  const base = { flow: "easy", attempt: 2, method: "canvas" } as const;

  it("maps a full diagnostics object", () => {
    expect(buildScanQuality({ ...base, diagnostics: diag() })).toEqual({
      flow: "easy",
      attempt: 2,
      method: "canvas",
      focalSource: "exif",
      parallaxCorrected: true,
      sharpness: "clear",
      resolution: "from_1920",
      edgeFit: "under_0_5_mm",
      paperSkew: "under_3",
      paperAspect: "under_2_pct",
      priorEffect: "within_2",
      paperCoverage: "from_0_8",
      handPose: "flat_like",
    });
  });

  it("takes paperAspect from the paper's observed shape", () => {
    const far = buildScanQuality({
      ...base,
      diagnostics: diag({
        paper: { ...diag().paper!, observedAspect: 0.6627 },
      }),
    });
    expect(far?.paperAspect).toBe("from_4_pct");
    const mid = buildScanQuality({
      ...base,
      diagnostics: diag({ paper: { ...diag().paper!, observedAspect: 0.69 } }),
    });
    expect(mid?.paperAspect).toBe("from_2_to_4_pct");
  });

  it("takes paperSkew from the paper's angle and priorEffect from the shadow delta", () => {
    const out = buildScanQuality({
      ...base,
      diagnostics: diag({
        paper: { ...diag().paper!, maxAngleDeviationDeg: 7.4 },
        shadowPrior: { handLengthDeltaMm: -5.837 },
      }),
    });
    expect(out).toMatchObject({
      paperSkew: "from_6_to_9",
      priorEffect: "lower_5_plus",
    });
  });

  it("takes focalSource straight from focal.source", () => {
    for (const source of FOCAL_SOURCES) {
      const out = buildScanQuality({
        ...base,
        diagnostics: diag({
          focal: { source, px: source === "none" ? null : 1000 },
        }),
      });
      expect(out?.focalSource).toBe(source);
    }
  });

  it("landmark-raw-v3 (candidate): a nominal scan with the local S25 check sends only buckets, never a px or a mm", () => {
    const out = buildScanQuality({
      ...base,
      diagnostics: diag({
        parallaxCorrected: true,
        focal: { source: "nominal", px: 1442.1077 },
        shadowPrior: {
          handLengthDeltaMm: 4.6812,
          uncorrected: {
            handLengthMm: 189.4321,
            palmLengthMm: 107.019,
            palmWidthMm: 65.7444,
          },
          reported: {
            handLengthMm: 184.7509,
            palmLengthMm: 102.81,
            palmWidthMm: 63.52,
          },
          homographyFocal: { px: 1823.456, reliable: false },
        },
      }),
    });
    expect(out).toMatchObject({
      focalSource: "nominal",
      parallaxCorrected: true,
      // Uncorrected minus reported, +4.7 mm.
      priorEffect: "higher_2_plus",
    });
    const text = JSON.stringify(out);
    for (const n of [
      "1442",
      "1823",
      "189",
      "184",
      "107",
      "102",
      "65.7",
      "63.5",
      "4.68",
    ]) {
      expect(text).not.toContain(n);
    }
    expect(text).not.toMatch(/uncorrected|reported|homographyFocal/);
  });

  it("takes parallaxCorrected as the boolean, either way", () => {
    for (const value of [true, false]) {
      const out = buildScanQuality({
        ...base,
        diagnostics: diag({ parallaxCorrected: value }),
      });
      expect(out?.parallaxCorrected).toBe(value);
    }
  });

  it("passes flow, attempt and method through", () => {
    for (const method of CAPTURE_METHODS) {
      const out = buildScanQuality({
        flow: "sheet",
        attempt: 7,
        method,
        diagnostics: diag(),
      });
      expect(out).toMatchObject({ flow: "sheet", attempt: 7, method });
    }
  });

  describe("a shadow that could not be worked out is its own step, not a lost event", () => {
    const cases: [string, Partial<PipelineDiagnostics>][] = [
      ["no shadow record", { shadowPrior: null }],
      [
        "shadow delta null (could not be worked out)",
        { shadowPrior: { handLengthDeltaMm: null } },
      ],
      ["shadow delta NaN", { shadowPrior: { handLengthDeltaMm: Number.NaN } }],
      [
        "shadow delta Infinity",
        { shadowPrior: { handLengthDeltaMm: Infinity } },
      ],
    ];
    it.each(cases)("%s", (_name, over) => {
      const out = buildScanQuality({ ...base, diagnostics: diag(over) });
      expect(out).not.toBeNull();
      expect(out!.priorEffect).toBe("unavailable");
      // Everything else the event says is still there and still true.
      const whole = buildScanQuality({ ...base, diagnostics: diag() })!;
      expect({ ...out, priorEffect: "x" }).toEqual({
        ...whole,
        priorEffect: "x",
      });
      expect(analyticsEventSchemas.scan_quality.safeParse(out).success).toBe(
        true,
      );
    });
  });

  describe("returns null rather than guess", () => {
    const cases: [string, Partial<PipelineDiagnostics>][] = [
      ["no focal record", { focal: null }],
      ["parallaxCorrected null", { parallaxCorrected: null }],
      ["laplacianVariance null", { laplacianVariance: null }],
      ["laplacianVariance NaN", { laplacianVariance: Number.NaN }],
      ["laplacianVariance negative", { laplacianVariance: -3 }],
      ["laplacianVariance Infinity", { laplacianVariance: Infinity }],
      ["no decoded size", { decoded: null }],
      ["decoded size NaN", { decoded: { width: Number.NaN, height: 100 } }],
      ["no paper record", { paper: null }],
      [
        "skew null (no four corners)",
        { paper: { ...diag().paper!, maxAngleDeviationDeg: null } },
      ],
      [
        "skew negative",
        { paper: { ...diag().paper!, maxAngleDeviationDeg: -2 } },
      ],
      [
        "observed aspect null (no four corners)",
        { paper: { ...diag().paper!, observedAspect: null } },
      ],
      [
        "observed aspect NaN",
        { paper: { ...diag().paper!, observedAspect: Number.NaN } },
      ],
      [
        "observed aspect not positive",
        { paper: { ...diag().paper!, observedAspect: 0 } },
      ],
      [
        "edge fit null (no four corners)",
        {
          paper: {
            cornersSeen: 3,
            paperRegionFound: true,
            widthFraction: null,
            heightFraction: null,
            edgeFitResidualMm: null,
            maxAngleDeviationDeg: null,
            observedAspect: null,
            minSideCoverage: 0.5,
            sideCoverages: null,
            worstSide: null,
            gateFailures: [],
          },
        },
      ],
    ];
    it.each(cases)("%s", (_name, over) => {
      expect(buildScanQuality({ ...base, diagnostics: diag(over) })).toBeNull();
    });
    it("no diagnostics at all", () => {
      expect(buildScanQuality({ ...base, diagnostics: undefined })).toBeNull();
      expect(buildScanQuality({ ...base, diagnostics: null })).toBeNull();
    });
    it("no capture method", () => {
      expect(
        buildScanQuality({ ...base, method: null, diagnostics: diag() }),
      ).toBeNull();
      expect(
        buildScanQuality({ ...base, method: undefined, diagnostics: diag() }),
      ).toBeNull();
    });
  });
});

describe("privacy: the output is the contract's shape and nothing more", () => {
  const CONTRACT_KEYS = Object.keys(
    analyticsEventSchemas.scan_quality.shape,
  ).sort();
  const ENUM_VALUES = new Set<string>([
    "easy",
    "sheet",
    ...CAPTURE_METHODS,
    ...FOCAL_SOURCES,
    ...SHARPNESS_BUCKETS,
    ...RESOLUTION_BUCKETS,
    ...EDGE_FIT_BUCKETS,
    ...PAPER_SKEW_BUCKETS,
    ...PAPER_ASPECT_BUCKETS,
    ...PRIOR_EFFECT_BUCKETS,
    ...PAPER_COVERAGE_BUCKETS,
    ...HAND_POSE_BUCKETS,
  ]);

  // Distinctive raw values that must never appear in what is sent.
  const raw = diag({
    laplacianVariance: 123.456789,
    decoded: { width: 2731, height: 2048 },
    focal: { source: "homography", px: 2873.31 },
    paper: {
      cornersSeen: 4,
      paperRegionFound: true,
      widthFraction: 0.6123,
      heightFraction: 0.7123,
      edgeFitResidualMm: 0.777,
      maxAngleDeviationDeg: 7.4321,
      observedAspect: 0.6627,
      minSideCoverage: 0.91,
      sideCoverages: [0.91, 1, 1, 1],
      worstSide: "top",
      gateFailures: ["PAPER_CURLED"],
    },
    measured: { handLengthMm: 183.7, palmWidthMm: 86.2 },
    shadowPrior: { handLengthDeltaMm: -5.837 },
    hand: {
      detected: true,
      confidence: 0.9234,
      handedness: "left",
      flatness: {
        pose: "borderline",
        reachMean: 0.55123,
        fingerStraightMin: 0.97654,
      },
    },
  });

  const outputs = [
    buildScanQuality({
      flow: "easy",
      attempt: 3,
      method: "takePhoto",
      diagnostics: raw,
    }),
    buildScanQuality({
      flow: "sheet",
      attempt: 1,
      method: "upload",
      diagnostics: diag({ focal: { source: "none", px: null } }),
    }),
  ];

  it("produced an output to check", () => {
    for (const out of outputs) expect(out).not.toBeNull();
  });

  it("has exactly the contract's keys", () => {
    for (const out of outputs) {
      expect(Object.keys(out!).sort()).toEqual(CONTRACT_KEYS);
    }
  });

  it("holds only enum strings, the attempt count and one boolean", () => {
    for (const out of outputs) {
      for (const [key, value] of Object.entries(out!)) {
        if (key === "attempt") {
          // The attempt number is the contract's own small integer, not a measurement.
          expect(Number.isInteger(value)).toBe(true);
        } else if (key === "parallaxCorrected") {
          expect(typeof value).toBe("boolean");
        } else {
          expect(typeof value).toBe("string");
          expect(ENUM_VALUES.has(value as string)).toBe(true);
        }
      }
    }
  });

  it("carries no number other than the attempt, and no raw value", () => {
    for (const out of outputs) {
      const { attempt, ...rest } = out!;
      expect(attempt).toBeGreaterThanOrEqual(1);
      expect(Object.values(rest).some((v) => typeof v === "number")).toBe(
        false,
      );
      const text = JSON.stringify(rest);
      for (const needle of [
        "123.45",
        "2731",
        "2048",
        "2873",
        "0.777",
        "183.7",
        "86.2",
        "5.837",
        "7.43",
        "0.6627",
        "0.663",
        "0.063",
        "0.551",
        "0.976",
        "0.9234",
      ]) {
        expect(text).not.toContain(needle);
      }
    }
  });

  it("passes the contract's schema", () => {
    for (const out of outputs) {
      expect(() => analyticsEventSchemas.scan_quality.parse(out)).not.toThrow();
    }
  });
});

describe("buildScanRejected: the whole scan_rejected payload", () => {
  const errors = [
    { code: "PAPER_EDGE_HIDDEN" },
    { code: "PAPER_CURLED" },
    { code: "PAPER_EDGE_HIDDEN" },
    { code: "not a code!" },
  ];

  it.each(["easy", "sheet"] as const)(
    "%s: the flow, the attempt, the codes and all three shadow grades",
    (flow) => {
      const out = buildScanRejected({
        flow,
        attempt: 3,
        errors,
        diagnostics: diag(),
      });
      expect(out).toEqual({
        flow,
        attempt: 3,
        codes: ["PAPER_EDGE_HIDDEN", "PAPER_CURLED"],
        paperSkew: "under_3",
        paperCoverage: "from_0_8",
        handPose: "flat_like",
      });
      expect(() =>
        analyticsEventSchemas.scan_rejected.parse(out),
      ).not.toThrow();
    },
  );

  it("takes the grades from the diagnostics it is given, and leaves out what cannot be worked out", () => {
    const hidden = buildScanRejected({
      flow: "easy",
      attempt: 1,
      errors,
      diagnostics: diag({
        paper: { ...diag().paper!, minSideCoverage: 0.3 },
        hand: {
          detected: true,
          confidence: 0.9,
          handedness: "left",
          flatness: { pose: "extreme", reachMean: 0.4, fingerStraightMin: 0.9 },
        },
      }),
    });
    expect(hidden.paperCoverage).toBe("under_0_6");
    expect(hidden.handPose).toBe("extreme");
    const none = buildScanRejected({
      flow: "easy",
      attempt: 1,
      errors,
      diagnostics: undefined,
    });
    expect(none).toEqual({
      flow: "easy",
      attempt: 1,
      codes: ["PAPER_EDGE_HIDDEN", "PAPER_CURLED"],
    });
  });
});

describe("buildScanRejected: paperStage on PAPER_NOT_FOUND (V3.2 F6)", () => {
  const notFound = (failureStage: PaperDetectionStage | null) =>
    diag({
      paper: {
        ...diag().paper!,
        cornersSeen: 0,
        paperRegionFound: false,
        widthFraction: null,
        heightFraction: null,
        maxAngleDeviationDeg: null,
        observedAspect: null,
        minSideCoverage: null,
        sideCoverages: null,
        worstSide: null,
        gateFailures: ["PAPER_NOT_FOUND"],
        failureStage,
      },
    });

  it("the client's stages are the contract's list itself", () => {
    expect(CLIENT_PAPER_DETECTION_STAGES).toBe(CONTRACT_PAPER_DETECTION_STAGES);
  });

  it.each(CONTRACT_PAPER_DETECTION_STAGES)(
    "%s: carried on a PAPER_NOT_FOUND refusal, and the payload passes the contract",
    (stage) => {
      const out = buildScanRejected({
        flow: "easy",
        attempt: 2,
        errors: [{ code: "PAPER_NOT_FOUND" }],
        diagnostics: notFound(stage),
      });
      expect(out.paperStage).toBe(stage);
      expect(out.codes).toEqual(["PAPER_NOT_FOUND"]);
      expect(() =>
        analyticsEventSchemas.scan_rejected.parse(out),
      ).not.toThrow();
    },
  );

  it("is left out for any other refusal, even with a stage in the diagnostics", () => {
    const out = buildScanRejected({
      flow: "sheet",
      attempt: 1,
      errors: [{ code: "PAPER_CORNERS_HIDDEN" }],
      diagnostics: notFound("region_split"),
    });
    expect("paperStage" in out).toBe(false);
  });

  it("is left out when no stage was recorded (null, absent, no diagnostics)", () => {
    for (const diagnostics of [notFound(null), diag(), undefined]) {
      const out = buildScanRejected({
        flow: "easy",
        attempt: 1,
        errors: [{ code: "PAPER_NOT_FOUND" }],
        diagnostics,
      });
      expect("paperStage" in out).toBe(false);
    }
  });

  it("refuses a value outside the list rather than send it", () => {
    const out = buildScanRejected({
      flow: "easy",
      attempt: 1,
      errors: [{ code: "PAPER_NOT_FOUND" }],
      diagnostics: notFound("hand_covering" as never),
    });
    expect("paperStage" in out).toBe(false);
  });
});

describe("the two call sites send that payload for a refused photo", () => {
  // The call sites are components that cannot run here, so this reads their
  // source: each must build its scan_rejected for a pipeline result through
  // buildScanRejected (which carries the grades), and neither may build one by
  // hand from the result's errors again, which would drop them.
  const read = (rel: string) =>
    readFileSync(new URL(rel, import.meta.url), "utf8");
  const sites = [
    [
      "EasyScanCamera.tsx",
      "../../src/client/camera/EasyScanCamera.tsx",
      "easy",
    ],
    ["ScanClient.tsx", "../../src/app/scan/ScanClient.tsx", "sheet"],
  ] as const;

  it.each(sites)("%s builds it with buildScanRejected", (_name, rel, flow) => {
    const source = read(rel);
    expect(source).toMatch(
      new RegExp(
        `track\\(\\s*"scan_rejected",\\s*buildScanRejected\\(\\{\\s*flow: "${flow}",\\s*attempt,\\s*errors: (pipelineResult|result)\\.errors,\\s*diagnostics: (pipelineResult|result)\\.diagnostics,`,
      ),
    );
  });

  it.each(sites)(
    "%s has no hand-built payload from a result's errors",
    (_name, rel) => {
      const source = read(rel);
      expect(source).not.toMatch(
        /codes: issueCodes\(\s*(pipelineResult|result)\.errors/,
      );
      expect(source).not.toContain("rejectedShadowProps");
    },
  );
});
