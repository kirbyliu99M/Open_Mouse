/**
 * The scan error budget simulation (scripts/scan-error-budget*.ts). These
 * tests pin the machinery (the PRNG, the statistics, the synthetic world) and
 * the two sanity properties the numbers rest on: a scan with nothing perturbed
 * comes out at the truth, and each single perturbation pushes the error the
 * way the geometry says. They do not pin the report's numbers, which are
 * simulation output under stated assumptions.
 */
import { describe, expect, it } from "vitest";
import {
  HAND_SIZES_MM,
  HAND_TEMPLATE,
  IMAGE_HEIGHT_PX,
  IMAGE_WIDTH_PX,
  NO_PERTURBATION,
  covariance2,
  decompose,
  drawScene,
  drawScenes,
  errorStats,
  fixed,
  gaussian,
  hashSeed,
  mulberry32,
  percentile,
  projectToPixel,
  buildCamera,
  runCondition,
  trueHandSheetMm,
  type Perturbation,
} from "../../scripts/scan-error-budget-core";
import {
  buildErrorBudget,
  renderMarkdown,
} from "../../scripts/scan-error-budget-report";

const SEED = 4242;
const N = 60;
const scenes = drawScenes(SEED, N);

const run = (perturbation: Perturbation, name = "t") =>
  runCondition(SEED, N, name, perturbation, scenes);

describe("deterministic randomness", () => {
  it("mulberry32 repeats for a seed, differs across seeds, stays in [0, 1)", () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    const c = mulberry32(8);
    const seqA = Array.from({ length: 50 }, () => a());
    const seqB = Array.from({ length: 50 }, () => b());
    const seqC = Array.from({ length: 50 }, () => c());
    expect(seqA).toEqual(seqB);
    expect(seqA).not.toEqual(seqC);
    for (const v of seqA) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("hashSeed separates labels and indices", () => {
    expect(hashSeed(1, "corner", 3)).toBe(hashSeed(1, "corner", 3));
    expect(hashSeed(1, "corner", 3)).not.toBe(hashSeed(1, "landmark", 3));
    expect(hashSeed(1, "corner", 3)).not.toBe(hashSeed(1, "corner", 4));
    expect(hashSeed(1, "corner", 3)).not.toBe(hashSeed(2, "corner", 3));
  });

  it("gaussian has mean near 0 and standard deviation near 1", () => {
    const rng = mulberry32(99);
    const draws = Array.from({ length: 20000 }, () => gaussian(rng));
    const stats = errorStats(draws);
    expect(Math.abs(stats.bias)).toBeLessThan(0.03);
    expect(stats.sd).toBeGreaterThan(0.97);
    expect(stats.sd).toBeLessThan(1.03);
  });
});

describe("statistics", () => {
  it("percentile interpolates between ranks", () => {
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(percentile([0, 10], 0.95)).toBeCloseTo(9.5, 10);
    expect(percentile([], 0.5)).toBeNaN();
  });

  it("errorStats gives bias, sample SD, P95 of |e| and RMS", () => {
    const s = errorStats([-2, 0, 2]);
    expect(s.bias).toBe(0);
    expect(s.sd).toBeCloseTo(2, 10);
    expect(s.p95Abs).toBeCloseTo(2, 10); // |e| sorted: 0, 2, 2
    expect(s.rms).toBeCloseTo(Math.sqrt(8 / 3), 10);
    expect(errorStats([]).n).toBe(0);
  });

  it("covariance2 matches a hand computation", () => {
    const [[vaa, cov], [, vbb]] = covariance2([1, 2, 3], [2, 4, 6]);
    expect(vaa).toBeCloseTo(1, 10);
    expect(cov).toBeCloseTo(2, 10);
    expect(vbb).toBeCloseTo(4, 10);
  });

  it("decompose splits variance into shares that sum to 1", () => {
    const stat = (sd: number) => ({
      n: 10,
      bias: 0,
      sd,
      p95Abs: 0,
      rms: sd,
    });
    const d = decompose(
      [
        { source: "corner", stats: stat(3) },
        { source: "landmark", stats: stat(4) },
      ],
      stat(5),
    );
    expect(d.sumOfVariances).toBeCloseTo(25, 10);
    expect(d.additivityRatio).toBeCloseTo(1, 10);
    expect(d.shares[0].share).toBeCloseTo(9 / 25, 10);
    expect(d.shares.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1, 10);
  });
});

describe("synthetic world", () => {
  it("draws the same scene for the same seed and index, in the stated ranges", () => {
    for (let i = 0; i < 20; i++) {
      const a = drawScene(SEED, i);
      expect(a).toEqual(drawScene(SEED, i));
      expect(a.distanceMm).toBeGreaterThanOrEqual(350);
      expect(a.distanceMm).toBeLessThanOrEqual(500);
      expect(a.tiltDeg).toBeGreaterThanOrEqual(0);
      expect(a.tiltDeg).toBeLessThanOrEqual(10);
      expect(a.handLengthMm).toBe(HAND_SIZES_MM[i % HAND_SIZES_MM.length]);
    }
  });

  it("keeps every drawn scene's paper corners and hand inside the frame", () => {
    for (const scene of scenes) {
      const camera = buildCamera(scene);
      for (const p of trueHandSheetMm(scene)) {
        const px = projectToPixel(camera, p, 0, 0);
        expect(px).not.toBeNull();
        expect(px!.x).toBeGreaterThanOrEqual(0);
        expect(px!.x).toBeLessThanOrEqual(IMAGE_WIDTH_PX);
        expect(px!.y).toBeGreaterThanOrEqual(0);
        expect(px!.y).toBeLessThanOrEqual(IMAGE_HEIGHT_PX);
      }
    }
  });

  it("the hand template has the stated length: landmark 0 to 12 is exactly 1", () => {
    expect(HAND_TEMPLATE).toHaveLength(21);
    expect(
      Math.hypot(
        HAND_TEMPLATE[12].x - HAND_TEMPLATE[0].x,
        HAND_TEMPLATE[12].y - HAND_TEMPLATE[0].y,
      ),
    ).toBeCloseTo(1, 12);
  });

  it("zero distortion leaves the principal point where it is", () => {
    const scene = {
      ...drawScene(SEED, 0),
      tiltDeg: 0,
      aimMm: { x: 105, y: 148.5 },
    };
    const px = projectToPixel(
      buildCamera(scene),
      { x: 105, y: 148.5 },
      0,
      0.05,
    );
    expect(px!.x).toBeCloseTo(IMAGE_WIDTH_PX / 2, 6);
    expect(px!.y).toBeCloseTo(IMAGE_HEIGHT_PX / 2, 6);
  });
});

describe("with nothing perturbed", () => {
  it("the real pipeline returns the truth to well under 0.01 mm", () => {
    const r = run(NO_PERTURBATION);
    expect(r.rejected).toBe(0);
    expect(r.correctedFraction).toBe(1);
    expect(r.handLength.p95Abs).toBeLessThan(0.01);
    expect(r.palmWidth.p95Abs).toBeLessThan(0.01);
    expect(Math.abs(r.handLength.bias)).toBeLessThan(0.01);
    expect(Math.abs(r.palmWidth.bias)).toBeLessThan(0.01);
  });

  it("the same seed gives the same numbers twice", () => {
    const p: Perturbation = { ...NO_PERTURBATION, landmarkSigmaPx: 2 };
    expect(run(p)).toEqual(run(p));
  });
});

describe("one perturbation at a time pushes the error the way the geometry says", () => {
  it("skipping the parallax correction reads long", () => {
    const r = run({ ...NO_PERTURBATION, parallaxCorrection: false });
    expect(r.handLength.bias).toBeGreaterThan(3);
    expect(r.palmWidth.bias).toBeGreaterThan(1);
  });

  it("taller true joints than assumed read long, flatter read short", () => {
    expect(
      run({ ...NO_PERTURBATION, heightScale: fixed(1.4) }).handLength.bias,
    ).toBeGreaterThan(1);
    expect(
      run({ ...NO_PERTURBATION, heightScale: fixed(0.6) }).handLength.bias,
    ).toBeLessThan(-1);
  });

  it("a focal length that is too long reads long, too short reads short", () => {
    expect(
      run({ ...NO_PERTURBATION, focalRel: fixed(0.1) }).handLength.bias,
    ).toBeGreaterThan(0.2);
    expect(
      run({ ...NO_PERTURBATION, focalRel: fixed(-0.1) }).handLength.bias,
    ).toBeLessThan(-0.2);
  });

  it("barrel distortion (k1 < 0) reads long and pincushion (k1 > 0) reads short", () => {
    expect(
      run({ ...NO_PERTURBATION, k1: fixed(-0.05) }).handLength.bias,
    ).toBeGreaterThan(0.3);
    expect(
      run({ ...NO_PERTURBATION, k1: fixed(0.05) }).handLength.bias,
    ).toBeLessThan(-0.3);
  });

  it("landmark noise has no bias to speak of, and its SD grows with the noise", () => {
    const one = run({ ...NO_PERTURBATION, landmarkSigmaPx: 1 });
    const four = run({ ...NO_PERTURBATION, landmarkSigmaPx: 4 });
    expect(four.handLength.sd).toBeGreaterThan(2 * one.handLength.sd);
    expect(Math.abs(four.handLength.bias)).toBeLessThan(four.handLength.sd);
    expect(four.palmWidth.sd).toBeGreaterThan(2 * one.palmWidth.sd);
  });

  it("corner noise adds spread, and less of it than the same noise on the landmarks", () => {
    const corner = run({ ...NO_PERTURBATION, cornerSigmaPx: 2 });
    const landmark = run({ ...NO_PERTURBATION, landmarkSigmaPx: 2 });
    expect(corner.handLength.sd).toBeGreaterThan(0.05);
    expect(corner.handLength.sd).toBeLessThan(landmark.handLength.sd);
  });

  it("a definition offset is a pure bias of minus the offset", () => {
    const r = run({ ...NO_PERTURBATION, definitionOffsetMm: 4 });
    expect(r.handLength.bias).toBeCloseTo(-4, 2);
    expect(r.handLength.sd).toBeLessThan(0.01);
    expect(r.palmWidth.bias).toBeCloseTo(-4, 2);
  });
});

describe("no EXIF: the focal comes from the corners", () => {
  it("noise-free corners give an exact result whenever the pipeline corrects at all", () => {
    const r = run({ ...NO_PERTURBATION, focalMode: "homography" });
    expect(r.bySource.corrected.handLength.n).toBeGreaterThan(0);
    expect(r.bySource.corrected.handLength.p95Abs).toBeLessThan(0.01);
    expect(
      r.bySource.flat.handLength.n + r.bySource.corrected.handLength.n,
    ).toBe(N);
  });

  it("corner noise at near-overhead tilt pushes most scans onto the flat path, which reads long", () => {
    const r = run({
      ...NO_PERTURBATION,
      focalMode: "homography",
      cornerSigmaPx: 2,
    });
    expect(r.correctedFraction).toBeLessThan(0.5);
    expect(r.bySource.flat.handLength.bias).toBeGreaterThan(3);
  });
});

describe("report", () => {
  const report = buildErrorBudget(SEED, 12, { handLength: 6, palmWidth: 4 });

  it("labels itself as a simulation, in the data and in the Markdown", () => {
    expect(report.label).toBe("模擬，非實測");
    const md = renderMarkdown(report);
    expect(md.split("\n")[0]).toContain("模擬，非實測");
    expect(md).toContain("Σ_input");
    expect(md).toContain("不是**實測");
  });

  it("covers every source in each joint profile and survives JSON", () => {
    expect(report.profiles).toHaveLength(3);
    for (const p of report.profiles) {
      expect(p.singles.map((s) => s.source)).toEqual([
        "corner",
        "landmark",
        "focal",
        "heightScale",
        "heightJitter",
        "distortion",
      ]);
      expect(p.joint.covariance[0][1]).toBe(p.joint.covariance[1][0]);
    }
    expect(JSON.parse(JSON.stringify(report)).seed).toBe(SEED);
  });
});
