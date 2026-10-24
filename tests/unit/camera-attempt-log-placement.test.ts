/**
 * V3.3 WP1b (candidate): what the local attempt log keeps about where the
 * hand lay (placement, world, live guidance, the soft hint it would get, the
 * experiment tag). Summary numbers only: no list of any kind in these blocks,
 * no landmark and no world point. Older records read back unchanged.
 */
import { describe, expect, it } from "vitest";
import {
  buildAttemptRecord,
  describeAttempt,
  parseAttempts,
  sanitizeAttempt,
  serialiseAttempts,
  softHintHistoryOf,
  type AttemptCapture,
  type AttemptRecord,
} from "../../src/client/camera/attemptLog";
import type { PipelineResult } from "../../src/client/photo/pipeline";
import type { PipelineDiagnostics } from "../../src/client/photo/diagnostics";
import type { PlacementDiagnostics } from "../../src/client/photo/placementDiagnostics";
import type { SoftHintCode } from "../../src/client/photo/softHint";

const DIAGNOSTICS: PipelineDiagnostics = {
  decodeMs: 300,
  paperMs: 400,
  handMs: 180,
  totalMs: 1200,
  decoded: { width: 1080, height: 1920 },
  analysed: { width: 1080, height: 1920 },
  fovCrop: null,
  view: null,
  paper: {
    cornersSeen: 4,
    paperRegionFound: true,
    widthFraction: 0.66,
    heightFraction: 0.7,
    edgeFitResidualMm: 0.31,
    maxAngleDeviationDeg: 3,
    observedAspect: 0.7,
    minSideCoverage: 0.6,
    sideCoverages: [1, 1, 0.6, 1],
    worstSide: "bottom",
    gateFailures: [],
  },
  laplacianVariance: 140,
  hand: {
    detected: true,
    confidence: 0.9,
    handedness: "right",
    flatness: {
      pose: "flat",
      reachMean: 0.9,
      fingerStraightMin: 0.98,
      fingerReach: [0.9, 0.9, 0.9, 0.9],
    } as unknown as NonNullable<PipelineDiagnostics["hand"]["flatness"]>,
  },
  parallaxCorrected: true,
  measured: { handLengthMm: 180, palmWidthMm: 85 },
  focal: { source: "nominal", px: 998 },
  shadowPrior: null,
};

const PLACEMENT: PlacementDiagnostics = {
  placement: {
    wristToEdgeMm: 8.04,
    wristEdge: "near-bottom",
    handAxisDeg: -3.21,
    minSideMarginMm: 22.55,
    thumbOutside: false,
    palmOverHand: 0.495123,
    distalOverProximal: [0.61234, 0.6, 0.59, 0.58],
  },
  world: {
    palmTiltDeg: 7.77,
    fingerFlexDeg: [10.11, 12, 13, 14],
    fingerElevDeg: [1, 2, 3, 4],
    planarityRmsMm: 2.3456,
  },
  corrected: true,
  zWristMinusMcp: 0.012345,
  camDistMm: 412.4,
  camOffsetMm: 18.6,
  frameEdge: { minPx: 140.26, fractionOfShortSide: 0.12987 },
  shadowRing: 0.93456,
  shadowRingMs: 3.4567,
};

function result(placement?: PlacementDiagnostics): PipelineResult {
  return {
    status: "error",
    errors: [{ code: "X", message: "x" }],
    overlay: {
      imageWidth: 1080,
      imageHeight: 1920,
      markers: [],
      card: null,
      landmarksPx: null,
    },
    diagnostics: { ...DIAGNOSTICS, ...(placement ? { placement } : {}) },
  };
}

const CAPTURE: AttemptCapture = {
  method: "canvas",
  captureSource: "frame",
  photoWidth: 1080,
  photoHeight: 1920,
  photoKb: 300,
  previewWidth: 1080,
  previewHeight: 1920,
};

function build(
  opts: {
    placement?: PlacementDiagnostics;
    capture?: Partial<AttemptCapture>;
    history?: readonly (SoftHintCode | null)[];
  } = {},
): AttemptRecord {
  return buildAttemptRecord({
    at: "2026-10-25T01:02:03.000Z",
    userAgent: "test",
    capture: { ...CAPTURE, ...opts.capture },
    outcome: { kind: "result", result: result(opts.placement) },
    ...(opts.history ? { softHintHistory: opts.history } : {}),
  });
}

/** Every array anywhere under `value`. */
function arraysIn(value: unknown, path = "$"): string[] {
  if (Array.isArray(value)) return [path];
  if (value && typeof value === "object")
    return Object.entries(value).flatMap(([k, v]) =>
      arraysIn(v, `${path}.${k}`),
    );
  return [];
}

describe("placement in the attempt log", () => {
  it("keeps the placement and world summaries, rounded, as named fields", () => {
    const r = build({ placement: PLACEMENT });
    expect(r.placement).toStrictEqual({
      wristToEdgeMm: 8,
      wristEdge: "near-bottom",
      handAxisDeg: -3.2,
      minSideMarginMm: 22.6,
      thumbOutside: false,
      palmOverHand: 0.4951,
      distalOverProximal: {
        index: 0.6123,
        middle: 0.6,
        ring: 0.59,
        little: 0.58,
      },
      corrected: true,
      zWristMinusMcp: 0.0123,
      camDistMm: 412,
      camOffsetMm: 19,
      frameEdgePx: 140.3,
      frameEdgeFraction: 0.1299,
      shadowRing: 0.935,
      shadowRingMs: 3.46,
    });
    expect(r.world).toStrictEqual({
      palmTiltDeg: 7.8,
      fingerFlexDeg: { index: 10.1, middle: 12, ring: 13, little: 14 },
      fingerElevDeg: { index: 1, middle: 2, ring: 3, little: 4 },
      planarityRmsMm: 2.35,
    });
  });

  it("holds no list in any WP1b block (no landmark, no world point)", () => {
    const r = build({
      placement: PLACEMENT,
      capture: {
        guidance: {
          shutter: "auto",
          live: [
            {
              ageMs: 900,
              fill: 0.64,
              wristToEdgeMm: 7,
              handAxisDeg: 1,
              palmOverHand: 0.5,
            },
          ],
        },
        experimentTag: "aligned/0.65",
      },
    });
    for (const key of [
      "placement",
      "world",
      "guidance",
      "softHint",
      "experimentTag",
    ] as const) {
      expect(arraysIn(r[key], key)).toEqual([]);
    }
    const json = JSON.stringify(r);
    expect(json).not.toContain("worldLandmarks");
    expect(json).not.toContain("landmarksPx");
  });

  it("the soft hint is recorded with today's candidate thresholds (here: none fires)", () => {
    const r = build({ placement: PLACEMENT });
    expect(r.softHint).toStrictEqual({
      code: null,
      candidate: null,
      suppressed: false,
    });
  });

  it("a wrist too far up gives wrist-align, and the device history throttles it", () => {
    const far: PlacementDiagnostics = {
      ...PLACEMENT,
      placement: { ...PLACEMENT.placement, wristToEdgeMm: 40 },
    };
    expect(build({ placement: far }).softHint).toStrictEqual({
      code: "wrist-align",
      candidate: "wrist-align",
      suppressed: false,
    });
    const throttled = build({
      placement: far,
      history: ["wrist-align", "wrist-align", "wrist-align"],
    });
    expect(throttled.softHint).toStrictEqual({
      code: null,
      candidate: "wrist-align",
      suppressed: true,
    });
  });

  it("guidance: the shutter and the last three readings, newest first", () => {
    const reading = (ageMs: number) => ({
      ageMs,
      fill: 0.651234,
      wristToEdgeMm: 7.04,
      handAxisDeg: 1.26,
      palmOverHand: 0.50001,
    });
    const r = build({
      capture: {
        guidance: {
          shutter: "no-sheet",
          live: [reading(1600), reading(1100), reading(600), reading(100.4)],
        },
      },
    });
    expect(r.guidance).toStrictEqual({
      shutter: "no-sheet",
      live: {
        latest: {
          ageMs: 100,
          fill: 0.6512,
          wristToEdgeMm: 7,
          handAxisDeg: 1.3,
          palmOverHand: 0.5,
        },
        previous: {
          ageMs: 600,
          fill: 0.6512,
          wristToEdgeMm: 7,
          handAxisDeg: 1.3,
          palmOverHand: 0.5,
        },
        earlier: {
          ageMs: 1100,
          fill: 0.6512,
          wristToEdgeMm: 7,
          handAxisDeg: 1.3,
          palmOverHand: 0.5,
        },
      },
    });
    const few = build({
      capture: { guidance: { shutter: "manual", live: [] } },
    });
    expect(few.guidance).toStrictEqual({
      shutter: "manual",
      live: { latest: null, previous: null, earlier: null },
    });
  });

  it("experiment tag: only a known one is kept", () => {
    expect(
      build({ capture: { experimentTag: "pencil/0.65" } }).experimentTag,
    ).toBe("pencil/0.65");
    expect(
      "experimentTag" in build({ capture: { experimentTag: "bogus" } }),
    ).toBe(false);
  });

  it("describeAttempt names the wrist, the axis, the shutter and the tag", () => {
    const line = describeAttempt(
      build({
        placement: PLACEMENT,
        capture: {
          guidance: { shutter: "auto", live: [] },
          experimentTag: "up2/0.50",
        },
      }),
    );
    expect(line).toContain("wrist 8 mm · axis -3.2°");
    expect(line).toContain("shutter auto");
    expect(line).toContain("tag up2/0.50");
  });
});

describe("older records and junk", () => {
  it("a record without WP1b blocks has none of the fields and the same line as before", () => {
    const r = build();
    for (const key of [
      "placement",
      "world",
      "guidance",
      "softHint",
      "experimentTag",
    ])
      expect(key in r).toBe(false);
    expect(describeAttempt(r)).not.toContain("wrist");
    // Round-trips unchanged through storage.
    expect(parseAttempts(serialiseAttempts([r]))).toStrictEqual([r]);
  });

  it("a stored WP1b record round-trips unchanged", () => {
    const r = build({
      placement: PLACEMENT,
      capture: {
        guidance: { shutter: "auto", live: [] },
        experimentTag: "aligned/0.80",
      },
    });
    expect(parseAttempts(serialiseAttempts([r]))).toStrictEqual([r]);
  });

  it("junk in the blocks is dropped field by field; arrays of world points are never kept", () => {
    const base = build();
    const dirty = sanitizeAttempt({
      ...base,
      placement: {
        wristToEdgeMm: "8",
        wristEdge: "sideways",
        handAxisDeg: 999,
        distalOverProximal: [1, 2, 3],
        landmarks: [{ x: 1, y: 2 }],
        corrected: "yes",
      },
      world: {
        palmTiltDeg: Number.NaN,
        worldLandmarks: [{ x: 0, y: 0, z: 0 }],
      },
      guidance: { shutter: "robot", live: [] },
      softHint: { code: "nag", candidate: "blurry", suppressed: 1 },
      experimentTag: "data:image/png;base64,AAAA",
    })!;
    expect(dirty.placement).toMatchObject({
      wristToEdgeMm: null,
      wristEdge: null,
      handAxisDeg: null,
      distalOverProximal: null,
      corrected: false,
    });
    expect("landmarks" in dirty.placement!).toBe(false);
    expect("world" in dirty).toBe(false);
    expect("guidance" in dirty).toBe(false);
    expect(dirty.softHint).toStrictEqual({
      code: null,
      candidate: "blurry",
      suppressed: false,
    });
    expect("experimentTag" in dirty).toBe(false);
  });
});

describe("softHintHistoryOf", () => {
  it("the candidates of the records that have one, oldest first", () => {
    const a = build();
    const b = build({ placement: PLACEMENT });
    const c = build({
      placement: {
        ...PLACEMENT,
        placement: { ...PLACEMENT.placement, wristToEdgeMm: 40 },
      },
    });
    expect(softHintHistoryOf([a, b, c])).toEqual([null, "wrist-align"]);
  });
});
