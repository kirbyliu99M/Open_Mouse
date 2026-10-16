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
  JOINT_PROFILES,
  HAND_SIZES_MM,
  HAND_TEMPLATE,
  IMAGE_HEIGHT_PX,
  IMAGE_WIDTH_PX,
  NO_PERTURBATION,
  covariance2,
  decompose,
  jointPerturbation,
  normal,
  poolConditions,
  sampleDist,
  uniform,
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
  type ConditionResult,
  type Dist,
  type Perturbation,
} from "../../scripts/scan-error-budget-core";
import {
  breakEven,
  buildErrorBudget,
  buildSigmaInput,
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

  it("a fixed definition offset is a pure bias of minus the offset, in either direction", () => {
    const longer = run({
      ...NO_PERTURBATION,
      definitionOffsetMm: { length: fixed(6.2), width: fixed(10) },
    });
    expect(longer.handLength.bias).toBeCloseTo(-6.2, 2);
    expect(longer.handLength.sd).toBeLessThan(0.01);
    expect(longer.palmWidth.bias).toBeCloseTo(-10, 2);
    const shorter = run({
      ...NO_PERTURBATION,
      definitionOffsetMm: { length: fixed(-7.5), width: fixed(0) },
    });
    expect(shorter.handLength.bias).toBeCloseTo(7.5, 2);
    expect(shorter.palmWidth.bias).toBeCloseTo(0, 2);
  });

  it("a random definition offset has the SD it is given and no bias", () => {
    const r = run({
      ...NO_PERTURBATION,
      definitionOffsetMm: {
        length: normal(0, 5.6),
        width: normal(0, 3.4),
      },
    });
    expect(r.handLength.sd).toBeGreaterThan(4.2);
    expect(r.handLength.sd).toBeLessThan(7);
    expect(r.palmWidth.sd).toBeGreaterThan(2.5);
    expect(r.palmWidth.sd).toBeLessThan(4.3);
    expect(Math.abs(r.handLength.bias)).toBeLessThan(1.8);
  });

  it("a systematic landmark displacement moves only its own axis, by about its size", () => {
    const len = run({
      ...NO_PERTURBATION,
      landmarkBiasMm: { length: fixed(3), width: fixed(0) },
    });
    expect(len.handLength.bias).toBeGreaterThan(2.8);
    expect(len.handLength.bias).toBeLessThan(3.2);
    expect(Math.abs(len.palmWidth.bias)).toBeLessThan(0.1);
    const wid = run({
      ...NO_PERTURBATION,
      landmarkBiasMm: { length: fixed(0), width: fixed(-3) },
    });
    expect(wid.palmWidth.bias).toBeLessThan(-2.8);
    expect(wid.palmWidth.bias).toBeGreaterThan(-3.2);
    expect(Math.abs(wid.handLength.bias)).toBeLessThan(0.1);
  });

  it("joints that are really lower than the product assumes (MCP 2 and 5) read a little short", () => {
    const r = run({
      ...NO_PERTURBATION,
      mcpHeightOffsetMm: { index: 1.8, little: 3 },
    });
    expect(r.palmWidth.bias).toBeLessThan(-0.05);
    expect(r.palmWidth.bias).toBeGreaterThan(-1);
    expect(Math.abs(r.handLength.bias)).toBeLessThan(0.01);
  });
});

describe("sampleDist", () => {
  it("always consumes exactly two uniforms, whatever the distribution", () => {
    for (const dist of [fixed(1), uniform(0, 1), normal(0, 1)]) {
      const rng = mulberry32(5);
      const reference = mulberry32(5);
      sampleDist(dist, rng);
      reference();
      reference();
      expect(rng()).toBe(reference());
    }
  });

  it("is deterministic and has the stated moments", () => {
    const draws = (dist: Dist) => {
      const rng = mulberry32(11);
      return Array.from({ length: 20000 }, () => sampleDist(dist, rng));
    };
    expect(draws(normal(2, 3))).toEqual(draws(normal(2, 3)));
    const n = errorStats(draws(normal(2, 3)));
    expect(n.bias).toBeGreaterThan(1.9);
    expect(n.bias).toBeLessThan(2.1);
    expect(n.sd).toBeGreaterThan(2.9);
    expect(n.sd).toBeLessThan(3.1);
    const u = draws(uniform(-1, 3));
    expect(Math.min(...u)).toBeGreaterThanOrEqual(-1);
    expect(Math.max(...u)).toBeLessThan(3);
  });
});

describe("tilt cap and lens as scene parameters", () => {
  it("draws within the stated tilt cap, and the same scene for the same arguments", () => {
    for (const cap of [10, 20, 30, 45]) {
      let maxTilt = 0;
      for (let i = 0; i < 60; i++) {
        const s = drawScene(SEED, i, { tiltMaxDeg: cap });
        expect(s).toEqual(drawScene(SEED, i, { tiltMaxDeg: cap }));
        expect(s.tiltDeg).toBeGreaterThanOrEqual(0);
        expect(s.tiltDeg).toBeLessThanOrEqual(cap);
        maxTilt = Math.max(maxTilt, s.tiltDeg);
      }
      expect(maxTilt).toBeGreaterThan(0.7 * cap);
    }
  });

  it("scales the camera distance and the true focal with focalScale, and rejects nonsense", () => {
    const wide = drawScene(SEED, 3, { focalScale: 0.5 });
    expect(wide.focalScale).toBe(0.5);
    expect(wide.distanceMm).toBeGreaterThanOrEqual(175);
    expect(wide.distanceMm).toBeLessThanOrEqual(250);
    expect(buildCamera(wide).fPx).toBeCloseTo(
      0.5 * buildCamera(drawScene(SEED, 3)).fPx,
      9,
    );
    expect(() => drawScene(SEED, 0, { tiltMaxDeg: 90 })).toThrow(RangeError);
    expect(() => drawScene(SEED, 0, { focalScale: 0 })).toThrow(RangeError);
  });

  it("a wider tilt cap lets more scans use the focal estimated from the paper", () => {
    const p = jointPerturbation(JOINT_PROFILES[1], "homography");
    const low = runCondition(
      SEED,
      N,
      "10",
      p,
      drawScenes(SEED, N, { tiltMaxDeg: 10 }),
    );
    const high = runCondition(
      SEED,
      N,
      "45",
      p,
      drawScenes(SEED, N, { tiltMaxDeg: 45 }),
    );
    expect(high.estimateFraction).toBeGreaterThan(low.estimateFraction);
  });
});

describe("no EXIF: the focal comes from the corners (current policy)", () => {
  it("noise-free corners give an exact result on the paths that correct", () => {
    const r = run({ ...NO_PERTURBATION, focalMode: "homography" });
    expect(r.byPath.estimate.n).toBeGreaterThan(0);
    expect(r.byPath.estimate.handLength.p95Abs).toBeLessThan(0.01);
    expect(r.byPath.exif.n).toBe(0);
    expect(r.byPath.nominal.n).toBe(0);
    expect(r.byPath.estimate.n + r.byPath.flat.n).toBe(N);
  });

  it("corner noise at near-overhead tilt pushes most scans onto the flat path, which reads long", () => {
    const r = run({
      ...NO_PERTURBATION,
      focalMode: "homography",
      cornerSigmaPx: 2,
    });
    expect(r.estimateFraction).toBeLessThan(0.5);
    expect(r.byPath.flat.handLength.bias).toBeGreaterThan(3);
    expect(r.fallback.n).toBe(r.byPath.flat.n);
  });
});

describe("nominal focal prior (candidate fix)", () => {
  const noisy: Perturbation = {
    ...NO_PERTURBATION,
    cornerSigmaPx: 1,
    landmarkSigmaPx: 0,
  };
  const flat = run({ ...noisy, focalMode: "homography" });
  const exact = run({ ...noisy, focalMode: "nominal" });

  it("with no perturbation and an exact prior every scan comes out at the truth", () => {
    for (const focalMode of ["nominal", "nominalOnly"] as const) {
      const r = run({ ...NO_PERTURBATION, focalMode });
      expect(r.rejected).toBe(0);
      expect(r.correctedFraction).toBe(1);
      expect(r.handLength.p95Abs).toBeLessThan(0.01);
      expect(r.palmWidth.p95Abs).toBeLessThan(0.01);
    }
  });

  it("the prior only stands in where the estimate was judged unreliable; the other scans are untouched", () => {
    expect(exact.byPath.flat.n).toBe(0);
    expect(exact.byPath.nominal.n).toBe(flat.byPath.flat.n);
    expect(exact.byPath.estimate.n).toBe(flat.byPath.estimate.n);
    expect(exact.byPath.estimate.handLength).toEqual(
      flat.byPath.estimate.handLength,
    );
    expect(exact.fallback.n).toBe(flat.fallback.n);
  });

  it("an exact prior beats no correction on the same fallback scans, by a lot", () => {
    expect(exact.fallback.handLength.rms).toBeLessThan(
      0.5 * flat.fallback.handLength.rms,
    );
    expect(exact.fallback.palmWidth.rms).toBeLessThan(
      0.5 * flat.fallback.palmWidth.rms,
    );
    expect(exact.handLength.rms).toBeLessThan(flat.handLength.rms);
  });

  it("a prior that is too long reads long and one that is too short reads short, around the exact prior", () => {
    const at = (rel: number) =>
      run({ ...noisy, focalMode: "nominal", nominalPriorRel: fixed(rel) });
    const long = at(0.3);
    const short = at(-0.3);
    expect(long.fallback.handLength.bias).toBeGreaterThan(
      exact.fallback.handLength.bias + 0.3,
    );
    expect(short.fallback.handLength.bias).toBeLessThan(
      exact.fallback.handLength.bias - 0.3,
    );
    expect(long.fallback.palmWidth.bias).toBeGreaterThan(
      exact.fallback.palmWidth.bias,
    );
    expect(short.fallback.palmWidth.bias).toBeLessThan(
      exact.fallback.palmWidth.bias,
    );
  });

  it("a prior that is badly wrong is worse than none; a modest error is not", () => {
    const at = (rel: number) =>
      run({ ...noisy, focalMode: "nominal", nominalPriorRel: fixed(rel) })
        .fallback.handLength.rms;
    expect(at(-0.1)).toBeLessThan(flat.fallback.handLength.rms);
    expect(at(0.1)).toBeLessThan(flat.fallback.handLength.rms);
    expect(at(-0.7)).toBeGreaterThan(flat.fallback.handLength.rms);
    expect(at(5)).toBeGreaterThan(flat.fallback.handLength.rms);
  });

  it("a uniform prior spread keeps about the same mean as an exact one and adds spread", () => {
    const spread = run({
      ...noisy,
      focalMode: "nominal",
      nominalPriorRel: uniform(-0.3, 0.3),
    });
    expect(spread.fallback.handLength.sd).toBeGreaterThan(
      exact.fallback.handLength.sd,
    );
    expect(
      Math.abs(
        spread.fallback.handLength.bias - exact.fallback.handLength.bias,
      ),
    ).toBeLessThan(0.6);
  });

  it("the prior-only variant ignores the paper estimate: every scan takes the nominal path", () => {
    const r = run({ ...noisy, focalMode: "nominalOnly" });
    expect(r.byPath.nominal.n).toBe(N);
    expect(r.byPath.estimate.n).toBe(0);
    expect(r.estimateFraction).toBe(0);
  });
});

describe("pooling and break-even", () => {
  const fake = (mean: [number, number], v: number): ConditionResult => {
    const empty = {
      n: 0,
      handLength: errorStats([]),
      palmWidth: errorStats([]),
    };
    const stats = errorStats([0]);
    return {
      name: "fake",
      n: 10,
      rejected: 0,
      correctedFraction: 1,
      estimateFraction: 1,
      handLength: stats,
      palmWidth: stats,
      mean,
      covariance: [
        [v, 0],
        [0, v],
      ],
      byPath: { exif: empty, estimate: empty, nominal: empty, flat: empty },
      fallback: empty,
      byHandSize: {},
    };
  };

  it("poolConditions applies the law of total variance across conditions", () => {
    const pooled = poolConditions([fake([-1, 2], 1), fake([1, 2], 1)]);
    expect(pooled.mean).toEqual([0, 2]);
    expect(pooled.covariance[0][0]).toBeCloseTo(2, 12); // 1 within + 1 between
    expect(pooled.covariance[1][1]).toBeCloseTo(1, 12);
    expect(pooled.betweenSd[0]).toBeCloseTo(1, 12);
    expect(pooled.betweenSd[1]).toBeCloseTo(0, 12);
    expect(() => poolConditions([])).toThrow(RangeError);
  });

  it("buildSigmaInput adds the systematic variance (half² / 3) per axis, and Rogers on top", () => {
    const s = buildSigmaInput("t", [fake([0, 0], 4), fake([0, 0], 4)], 3);
    expect(s.covScan[0][0]).toBeCloseTo(4, 12);
    expect(s.systematicVar).toBeCloseTo(3, 12);
    expect(s.cov[0][0]).toBeCloseTo(7, 12);
    expect(s.cov[1][1]).toBeCloseTo(7, 12);
    expect(s.covWithDefinition[0][0]).toBeCloseTo(7 + 5.6 ** 2, 12);
    expect(s.covWithDefinition[1][1]).toBeCloseTo(7 + 3.4 ** 2, 12);
  });

  it("breakEven interpolates both crossings, and reports open ends and never-better", () => {
    const pts = [-1, -0.5, 0, 0.5, 1].map((rel) => ({
      rel,
      rms: 1 + 4 * Math.abs(rel),
    }));
    const b = breakEven(pts, 3);
    expect(b.neverBetter).toBe(false);
    expect(b.lower).toBeCloseTo(-0.5, 12);
    expect(b.upper).toBeCloseTo(0.5, 12);
    expect(b.lowerOpen).toBe(false);
    expect(b.bestRel).toBe(0);
    expect(breakEven(pts, 6).upperOpen).toBe(true);
    expect(breakEven(pts, 6).lowerOpen).toBe(true);
    expect(breakEven(pts, 0.5).neverBetter).toBe(true);
  });
});

describe("report", () => {
  const options = {
    tiltCaps: [10, 30],
    frameOptions: {
      fixedGrid: [-0.1, 0, 0.1],
      uniformHalves: [0.2],
      onlyHalves: [0.2],
    },
  };
  const report = buildErrorBudget(
    SEED,
    12,
    { handLength: 6, palmWidth: 4 },
    options,
  );

  it("labels itself as a simulation, in the data and in the Markdown", () => {
    expect(report.label).toBe("模擬，非實測");
    const md = renderMarkdown(report);
    expect(md.split("\n")[0]).toContain("模擬，非實測");
    expect(md).toContain("Σ_input");
    expect(md).toContain("不是實測");
    expect(md).toContain("主要情境：影格、無 EXIF");
  });

  it("makes the frame, no-EXIF scenario primary: every profile, every tilt cap, both paths", () => {
    expect(report.frame).toHaveLength(3);
    for (const r of report.frame) {
      expect(r.cells.map((c) => c.tiltMaxDeg)).toEqual([10, 30]);
      for (const cell of r.cells) {
        expect(cell.current.estimateFraction).toBeGreaterThanOrEqual(0);
        expect(cell.current.estimateFraction).toBeLessThanOrEqual(1);
        expect(cell.current.byPath.exif.n).toBe(0);
        expect(cell.priors).toHaveLength(5);
      }
    }
    expect(report.frame[1].cells[0].lenses.map((l) => l.focalScale)).toEqual([
      0.5, 2,
    ]);
    expect(report.frame[0].cells[0].lenses).toHaveLength(0);
  });

  it("covers every source in each EXIF comparison profile and survives JSON", () => {
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

  it("gives a bias vector and a symmetric Sigma for the current policy and both candidates", () => {
    expect(report.sigma).toHaveLength(3);
    for (const s of report.sigma) {
      for (const x of [s.current, s.nominal, s.nominalOnly]) {
        expect(x.bias).toHaveLength(2);
        expect(x.cov[0][1]).toBe(x.cov[1][0]);
        expect(x.cov[0][0]).toBeGreaterThan(x.covScan[0][0]);
        expect(x.covWithDefinition[0][0]).toBeGreaterThan(x.cov[0][0]);
      }
      expect(s.current.bias[0]).toBeGreaterThan(s.nominal.bias[0]);
    }
  });

  it("is deterministic: the same seed gives the same report", () => {
    expect(
      buildErrorBudget(SEED, 12, { handLength: 6, palmWidth: 4 }, options),
    ).toEqual(report);
  });
});
