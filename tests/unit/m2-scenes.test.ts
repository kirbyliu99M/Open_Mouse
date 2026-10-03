/**
 * The evaluator on realistic synthetic photos: a hand of known size at known
 * heights, a pinhole camera with tilt and rotation, the paper drawn to pixels
 * and found by the real detector, noise, and different focal lengths in the
 * record. Reports are made by the real `assembleLearningReport`, so what the
 * evaluator recomputes is what the checker would have recorded.
 *
 * The expected numbers come from the values recorded next to the planes
 * (`markerMm`, `paperMm`) with plain arithmetic written here, not from the
 * evaluator's own statistics code.
 */
import { describe, expect, it } from "vitest";
import type { Point2 } from "../../src/client/geometry/homography";
import type { DetectedMarker } from "../../src/client/photo/markers";
import {
  markerReference,
  paperFindings,
} from "../../src/lib/learning/findings";
import type { KitCode } from "../../src/lib/learning/kit";
import {
  assembleLearningReport,
  type LearningPhotoReport,
} from "../../src/lib/learning/report";
import { buildRunLog, sortReports } from "../../src/lib/learning/runlog";
import { evaluate, type EvaluationReport } from "../../src/lib/m2/evaluate";
import { slateReport } from "./helpers/m2-synth";
import {
  HAND_MM,
  INDEPENDENT_SCENE,
  TRUE_HAND_LENGTH_MM,
  flatMarkerDetections,
  independentShot,
} from "./helpers/learning-scene";
import { independentSceneCamera } from "./helpers/independent-scene";
import { LANDMARK_HEIGHTS_MM } from "../../src/client/geometry/parallax";
import { truthOf } from "./helpers/m2-synth";

const code = (hand: "left" | "right"): KitCode => ({
  kind: "gesture",
  version: 1,
  gesture: "G01",
  hand,
});

interface Variant {
  readonly seed: number;
  readonly rotationDeg: number;
  readonly tiltXDeg: number;
  readonly tiltYDeg: number;
  readonly noise: number;
  /** Multiplier on the true focal length in the record; `null` = no EXIF. */
  readonly focal: number | null;
  /** Shift the hand this far (mm) toward the outside of the sheet. */
  readonly handOffsetMm?: number;
}

function photo(
  name: string,
  hand: "left" | "right",
  v: Variant,
): LearningPhotoReport {
  const scene = {
    ...INDEPENDENT_SCENE,
    seed: v.seed,
    rotationDeg: v.rotationDeg,
    tiltXDeg: v.tiltXDeg,
    tiltYDeg: v.tiltYDeg,
    noiseAmplitude: v.noise,
  };
  const shot = independentShot(scene);
  expect(shot.quad.corners).not.toBeNull();
  const camera = independentSceneCamera(scene);
  const cx = scene.paperWidthMm / 2;
  const cy = scene.paperHeightMm / 2;
  const landmarksPx: Point2[] = HAND_MM.map((mm, i) =>
    camera.project(
      mm.x + cx + (v.handOffsetMm ?? 0),
      mm.y + cy,
      LANDMARK_HEIGHTS_MM[i]!,
    ),
  );
  const markers: DetectedMarker[] = flatMarkerDetections(scene);
  return assembleLearningReport({
    file: name,
    width: shot.imageSize.width,
    height: shot.imageSize.height,
    paperSize: "a4",
    exif: null,
    exifFocalPx: v.focal === null ? null : shot.exifFocalPx * v.focal,
    qrText: `https://open-mouse.vercel.app/l/v1/G01${hand === "right" ? "R" : "L"}`,
    code: code(hand),
    markers,
    laplacianVariance: 400,
    reference: markerReference(markers),
    paper: paperFindings(shot.quad, "a4"),
    hand: { landmarksPx, handedness: hand, confidence: 0.93 },
  });
}

function logOf(
  entries: readonly { participant: string; report: LearningPhotoReport }[],
) {
  const reports: LearningPhotoReport[] = [];
  let n = 0;
  const seen = new Set<string>();
  for (const { participant, report } of entries) {
    if (!seen.has(participant)) {
      seen.add(participant);
      reports.push(
        slateReport(participant, `IMG_${String(++n).padStart(4, "0")}.jpg`),
      );
    }
    reports.push({
      ...report,
      file: `IMG_${String(++n).padStart(4, "0")}.jpg`,
    });
  }
  return buildRunLog({
    reports,
    sort: sortReports(reports),
    paperSize: "a4",
    input: null,
    provenance: { gitSha: null, gitDirty: null },
    now: new Date("2026-10-02T00:00:00Z"),
  });
}

// Plain arithmetic, written here (not the evaluator's code).
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
};

const BASE: Variant = {
  seed: 7,
  rotationDeg: 20,
  tiltXDeg: 12,
  tiltYDeg: 8,
  noise: 4,
  focal: 1,
};

// Five photos of P001's right hand: different framing, noise and focal
// lengths in the record. And two of P002's left hand.
const VARIANTS: Variant[] = [
  { ...BASE, seed: 11, focal: 1 },
  {
    ...BASE,
    seed: 12,
    rotationDeg: 5,
    tiltXDeg: 6,
    tiltYDeg: 3,
    noise: 8,
    focal: 1,
  },
  { ...BASE, seed: 13, rotationDeg: 40, focal: 1.1 }, // the record's focal length is 10% long
  { ...BASE, seed: 14, rotationDeg: 60, tiltXDeg: 20, focal: 0.9 }, // 10% short
  { ...BASE, seed: 15, rotationDeg: 30, focal: null }, // no EXIF: focal from the homography
];

describe("realistic scenes through the evaluator", () => {
  const p1 = VARIANTS.map((v, i) => photo(`a${i}.jpg`, "right", v));
  const p2 = [
    photo("b0.jpg", "left", { ...BASE, seed: 21 }),
    photo("b1.jpg", "left", { ...BASE, seed: 22, rotationDeg: 15 }),
  ];
  const log = logOf([
    ...p1.map((report) => ({ participant: "P001", report })),
    ...p2.map((report) => ({ participant: "P002", report })),
  ]);
  const TRUTH_P1 = 190;
  const TRUTH_P2 = 188.5;
  const truths = [
    truthOf("P001", { handLengthMm: TRUTH_P1, palmWidthMm: 80 }),
    truthOf(
      "P002",
      { handLengthMm: 0 + 100, palmWidthMm: 60 },
      { handLengthMm: TRUTH_P2, palmWidthMm: 80 },
    ),
  ];
  const report: EvaluationReport = evaluate({ logs: [log], truths });

  it("the recorded planes really differ in focal length (so the test means something)", () => {
    const focals = p1.map((r) => r.paperPlane!.parallax!.focalPx);
    expect(
      new Set(focals.map((f) => f && Math.round(f))).size,
    ).toBeGreaterThanOrEqual(4);
    expect(p1[4]!.paperPlane!.parallax!.focalSource).toBe("homography");
    expect(p1[0]!.paperPlane!.parallax!.focalSource).toBe("exif");
  });

  it("paper-edge path: n, bias, MAE, SD and limits equal the arithmetic on the recorded measurements", () => {
    const errors = [
      ...p1.map((r) => r.paperMm!.handLengthMm - TRUTH_P1),
      ...p2.map((r) => r.paperMm!.handLengthMm - TRUTH_P2),
    ];
    const s =
      report.groups.all["paper-edge"]!.fields.handLengthMm!.accuracy.stats!;
    expect(s.n).toBe(7);
    expect(s.bias).toBeCloseTo(mean(errors), 9);
    expect(s.mae).toBeCloseTo(mean(errors.map(Math.abs)), 9);
    expect(s.maxAbsError).toBeCloseTo(Math.max(...errors.map(Math.abs)), 9);
    expect(s.sd).toBeCloseTo(sd(errors), 9);
    expect(s.loa!.lower).toBeCloseTo(mean(errors) - 1.96 * sd(errors), 9);
    expect(s.loa!.upper).toBeCloseTo(mean(errors) + 1.96 * sd(errors), 9);
  });

  it("marker path is judged on its own plane, and is not the paper path's numbers", () => {
    const errors = [
      ...p1.map((r) => r.markerMm!.handLengthMm - TRUTH_P1),
      ...p2.map((r) => r.markerMm!.handLengthMm - TRUTH_P2),
    ];
    const s = report.groups.all.markers!.fields.handLengthMm!.accuracy.stats!;
    expect(s.n).toBe(7);
    expect(s.bias).toBeCloseTo(mean(errors), 9);
    expect(s.sd).toBeCloseTo(sd(errors), 9);
  });

  it("repeatability of P001's five right-hand photos equals the range and SD of the recorded lengths", () => {
    const lengths = p1.map((r) => r.paperMm!.handLengthMm);
    const row = report.groups.all[
      "paper-edge"
    ]!.fields.handLengthMm!.repeatability.rows.find(
      (r) => r.participant === "P001",
    )!;
    expect(row).toMatchObject({ hand: "right", gesture: "G01", n: 5 });
    expect(row.range).toBeCloseTo(
      Math.max(...lengths) - Math.min(...lengths),
      9,
    );
    expect(row.sd).toBeCloseTo(sd(lengths), 9);
  });

  it("a wrong focal length in the record shows up as a longer or shorter hand, and the evaluator sees it", () => {
    const [good, long, short] = [p1[0]!, p1[2]!, p1[3]!].map(
      (r) => r.paperMm!.handLengthMm,
    );
    // With the correct focal length the corrected hand is within half a millimetre.
    expect(Math.abs(good! - TRUE_HAND_LENGTH_MM)).toBeLessThan(0.5);
    // A focal length recorded 10% off moves it, in opposite directions.
    expect(Math.abs(long! - good!)).toBeGreaterThan(0.2);
    expect(Math.abs(short! - good!)).toBeGreaterThan(0.2);
    expect(Math.sign(long! - good!)).not.toBe(Math.sign(short! - good!));
    // The evaluator, working from the planes, reproduces each photo's value.
    const rows =
      report.groups.all["paper-edge"]!.fields.handLengthMm!.repeatability.rows;
    const p1row = rows.find((r) => r.participant === "P001")!;
    expect(p1row.min).toBeCloseTo(
      Math.min(...p1.map((r) => r.paperMm!.handLengthMm)),
      9,
    );
    expect(p1row.max).toBeCloseTo(
      Math.max(...p1.map((r) => r.paperMm!.handLengthMm)),
      9,
    );
  });

  it("the product accepts these photos, so the accepted group is the whole group", () => {
    expect(p1.every((r) => r.productGates!.accepted)).toBe(true);
    expect(report.groups.accepted["paper-edge"]!.photos).toBe(7);
    expect(report.excluded.filter((e) => e.stage === "product")).toEqual([]);
  });

  it("left-hand photos are compared with the left-hand ruler value, not the right's (100 mm here)", () => {
    const only = evaluate({ logs: [log], truths }, { participants: ["P002"] });
    const s =
      only.groups.all["paper-edge"]!.fields.handLengthMm!.accuracy.stats!;
    expect(s.n).toBe(2);
    expect(Math.abs(s.bias)).toBeLessThan(2); // against 188.5; against the right's 100 it would be about +90
  });
});

describe("a photo the product would refuse", () => {
  it("leaves the accepted group but stays in all, with the product's own codes", () => {
    const fine = [0, 1, 2].map((i) =>
      photo(`f${i}.jpg`, "right", { ...BASE, seed: 30 + i }),
    );
    // The hand is well off the sheet.
    const off = photo("off.jpg", "right", {
      ...BASE,
      seed: 40,
      handOffsetMm: 450,
    });
    expect(off.productGates!.accepted).toBe(false);
    expect(off.productGates!.hand!.errorCodes).toContain("HAND_OUT_OF_BOUNDS");

    const log = logOf(
      [...fine, off].map((report) => ({ participant: "P001", report })),
    );
    const r = evaluate({
      logs: [log],
      truths: [truthOf("P001", { handLengthMm: 190, palmWidthMm: 80 })],
    });
    expect(r.groups.all["paper-edge"]!.photos).toBe(4);
    expect(r.groups.accepted["paper-edge"]!.photos).toBe(3);
    expect(r.excluded.filter((e) => e.stage === "product")).toEqual([
      expect.objectContaining({
        id: "P001/G01R/4",
        reasons: ["hand:HAND_OUT_OF_BOUNDS"],
      }),
    ]);
  });
});
