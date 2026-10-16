import { describe, expect, it } from "vitest";
import {
  CAPTURE_METHODS,
  EDGE_FIT_BUCKETS,
  FOCAL_SOURCES,
  RESOLUTION_BUCKETS,
  SHARPNESS_BUCKETS,
  analyticsEventSchemas,
} from "../../src/lib/contracts/analytics";
import {
  buildScanQuality,
  edgeFitBucket,
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
      minSideCoverage: 0.9,
      gateFailures: [],
    },
    laplacianVariance: 150,
    hand: { detected: true, confidence: 0.9, handedness: "right" },
    parallaxCorrected: true,
    measured: { handLengthMm: 180, palmWidthMm: 85 },
    focal: { source: "exif", px: 2900 },
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
        "edge fit null (no four corners)",
        {
          paper: {
            cornersSeen: 3,
            paperRegionFound: true,
            widthFraction: null,
            heightFraction: null,
            edgeFitResidualMm: null,
            minSideCoverage: 0.5,
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
      minSideCoverage: 0.91,
      gateFailures: ["PAPER_CURLED"],
    },
    measured: { handLengthMm: 183.7, palmWidthMm: 86.2 },
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
