/**
 * Scan Lab L3a (2026-10-29): the three card methods in `cardMeasure.ts`,
 * on rendered scenes (`helpers/card-scene.ts`) and on exact projected
 * corners. Measured numbers are printed as `[L3a]` lines for the hand-in
 * report; the 1° wrong-tilt runs are reported, not gated (brief L3a).
 */
import { describe, expect, it } from "vitest";
import { detectCard, type Quad } from "../../src/client/card/detect/detectCard";
import {
  cardScaleRatioAgainstPaper,
  downInCamera,
  fitSimilarity,
  measurePaperWithCardAndTilt,
  measurePaperWithCardHomography,
  paperMeasurementFromMmQuad,
  rectangleMmFor,
  rectifyingHomography,
  tiltAzimuthOf,
  type CameraTilt,
} from "../../src/client/card/detect/cardMeasure";
import { detectPaperQuad } from "../../src/client/paper/detect";
import { orderQuadCorners } from "../../src/client/paper/quad-math";
import type { Mat3 } from "../../src/client/geometry/camera-pose";
import {
  applyMat,
  ID1,
  renderLabCardScene,
  sceneCamera,
  type LabCardScene,
  type Pt,
} from "./helpers/card-scene";

const A4 = { shortMm: 210, longMm: 297 } as const;

const BASE: LabCardScene = {
  width: 900,
  height: 1200,
  fPx: 1000,
  tiltDeg: 8,
  azimuthDeg: 60,
  yawDeg: 4,
  heightMm: 380,
  aimMm: { x: 105, y: 148.5 },
  paperOriginMm: { x: 0, y: 0 },
  cardCentreMm: { x: 105, y: 200 },
  cardAngleDeg: 10,
  cardRgb: [60, 90, 150],
  cardStripe: true,
  background: "grey",
};
const SCENES: [string, LabCardScene, "on-paper" | "beside-paper"][] = [
  ["(a) on the sheet", BASE, "on-paper"],
  [
    "(b) beside the sheet",
    {
      ...BASE,
      aimMm: { x: 137, y: 148.5 },
      cardCentreMm: { x: 247, y: 148.5 },
      cardAngleDeg: 90,
    },
    "beside-paper",
  ],
];

const fmt = (v: number, d = 3) => v.toFixed(d);

function asQuad(p: readonly Pt[]): Quad {
  return orderQuadCorners([p[0], p[1], p[2], p[3]]);
}

function rendered(scene: LabCardScene, placement: "on-paper" | "beside-paper") {
  const r = renderLabCardScene(scene);
  const truePaper = asQuad(r.paperCornersPx as Pt[]);
  const card = detectCard(r, { paperCorners: truePaper, placement });
  if (!card.ok) throw new Error(`card not found: ${card.failure}`);
  const paper = detectPaperQuad(r as unknown as ImageData, "a4");
  return { r, truePaper, card: card.corners, detectedPaper: paper.corners };
}

describe("tilt convention (CameraTilt doc) matches the renderer's camera", () => {
  it("the nadir projects to principal point + f*tan(tilt)*(cos az, sin az)", () => {
    for (const [tilt, az] of [
      [8, 60],
      [12, -135],
      [3, 200],
    ]) {
      const scene = { ...BASE, tiltDeg: tilt, azimuthDeg: az };
      const cam = sceneCamera(scene);
      // World point straight below the camera centre, as table mm (y down).
      const nadir = applyMat(cam.tableToImage, { x: cam.C[0], y: -cam.C[1] });
      const t = (tilt * Math.PI) / 180;
      const a = (az * Math.PI) / 180;
      expect(nadir.x).toBeCloseTo(450 + 1000 * Math.tan(t) * Math.cos(a), 6);
      expect(nadir.y).toBeCloseTo(600 + 1000 * Math.tan(t) * Math.sin(a), 6);
      // All three CameraTilt forms agree.
      const fromAngles = downInCamera({
        kind: "tilt-azimuth",
        tiltDeg: tilt,
        azimuthDeg: az,
      });
      const fromR = downInCamera({
        kind: "rotation",
        R: cam.R as unknown as Mat3,
      });
      for (let i = 0; i < 3; i++)
        expect(fromR[i]).toBeCloseTo(fromAngles[i], 9);
      const back = tiltAzimuthOf(fromAngles);
      expect(back.tiltDeg).toBeCloseTo(tilt, 9);
      expect(((back.azimuthDeg - az + 540) % 360) - 180).toBeCloseTo(0, 9);
    }
  });
});

describe("method (1) card-only homography, noise-free (brief: < 0.2 mm)", () => {
  it.each(SCENES)("%s", (name, scene, placement) => {
    const { truePaper, card, detectedPaper } = rendered(scene, placement);
    const m = measurePaperWithCardHomography(card, truePaper, A4);
    expect(detectedPaper).not.toBeNull();
    const md = measurePaperWithCardHomography(card, detectedPaper as Quad, A4);
    console.log(
      `[L3a] method 1 ${name}: true sheet corners long ${fmt(m.longErrorMm)} short ${fmt(m.shortErrorMm)} diag ${fmt(m.diagonalErrorMm)} mm (${fmt(m.longErrorPct)} / ${fmt(m.shortErrorPct)} / ${fmt(m.diagonalErrorPct)} %); detectPaperQuad corners long ${fmt(md.longErrorMm)} short ${fmt(md.shortErrorMm)} diag ${fmt(md.diagonalErrorMm)} mm`,
    );
    expect(Math.abs(m.longErrorMm)).toBeLessThan(0.2);
    expect(Math.abs(m.shortErrorMm)).toBeLessThan(0.2);
    expect(Math.abs(md.longErrorMm)).toBeLessThan(0.2);
    expect(Math.abs(md.shortErrorMm)).toBeLessThan(0.2);
  });
});

describe("method (2) card + tilt", () => {
  it.each(SCENES)(
    "%s: right tilt < 0.3 mm; 1° off reported",
    (name, scene, placement) => {
      const { r, truePaper, card } = rendered(scene, placement);
      const k = { fPx: scene.fPx, cx: r.cx, cy: r.cy };
      const right: CameraTilt = {
        kind: "tilt-azimuth",
        tiltDeg: scene.tiltDeg,
        azimuthDeg: scene.azimuthDeg,
      };
      const m = measurePaperWithCardAndTilt(card, truePaper, A4, right, k);
      console.log(
        `[L3a] method 2 ${name}, right tilt: long ${fmt(m.longErrorMm)} short ${fmt(m.shortErrorMm)} diag ${fmt(m.diagonalErrorMm)} mm, card fit RMS ${fmt(m.cardFitRmsMm)} mm`,
      );
      expect(Math.abs(m.longErrorMm)).toBeLessThan(0.3);
      expect(Math.abs(m.shortErrorMm)).toBeLessThan(0.3);

      // 1° wrong: tilt magnitude +-1°, and 1° sideways (the down vector rotated
      // 1° about the axis perpendicular to the tilt direction's own plane).
      const off: [string, CameraTilt][] = [
        ["tilt +1°", { ...right, tiltDeg: scene.tiltDeg + 1 }],
        ["tilt -1°", { ...right, tiltDeg: scene.tiltDeg - 1 }],
        [
          "1° sideways",
          {
            kind: "tilt-azimuth",
            tiltDeg: Math.hypot(scene.tiltDeg, 1),
            azimuthDeg:
              scene.azimuthDeg + (Math.atan2(1, scene.tiltDeg) * 180) / Math.PI,
          },
        ],
      ];
      for (const [label, t] of off) {
        const w = measurePaperWithCardAndTilt(card, truePaper, A4, t, k);
        console.log(
          `[L3a] method 2 ${name}, ${label}: long ${fmt(w.longErrorMm)} short ${fmt(w.shortErrorMm)} diag ${fmt(w.diagonalErrorMm)} mm (${fmt(w.longErrorPct)} / ${fmt(w.shortErrorPct)} %), card fit RMS ${fmt(w.cardFitRmsMm)} mm`,
        );
        // Loose bounds (L3b review), so a regression shows: the reported
        // 1 degree runs are 0.8-2.0 mm long, 0.2-2.1 mm short, RMS <= 0.12 mm.
        expect(Math.abs(w.longErrorMm)).toBeLessThan(3);
        expect(Math.abs(w.shortErrorMm)).toBeLessThan(3);
        expect(w.cardFitRmsMm).toBeLessThan(0.5);
        expect(w.cardFitRmsMm).toBeGreaterThan(0.01);
      }
    },
  );

  it("wrong focal length, right tilt: reported", () => {
    const [, scene, placement] = SCENES[1];
    const { r, truePaper, card } = rendered(scene, placement);
    const right: CameraTilt = {
      kind: "tilt-azimuth",
      tiltDeg: scene.tiltDeg,
      azimuthDeg: scene.azimuthDeg,
    };
    for (const f of [900, 1100]) {
      const m = measurePaperWithCardAndTilt(card, truePaper, A4, right, {
        fPx: f,
        cx: r.cx,
        cy: r.cy,
      });
      console.log(
        `[L3a] method 2 (b), focal ${f} px instead of 1000: long ${fmt(m.longErrorMm)} short ${fmt(m.shortErrorMm)} mm`,
      );
      // Reported +-0.7 to 0.9 mm for a 10 % focal error; loose bound.
      expect(Math.abs(m.longErrorMm)).toBeLessThan(2);
      expect(Math.abs(m.longErrorMm)).toBeGreaterThan(0.1);
    }
  });
});

describe("methods (1) and (2) with blur 0.8 px and noise 3: reported", () => {
  it.each(SCENES)("%s", (name, scene, placement) => {
    const noisy = { ...scene, blurSigmaPx: 0.8, noiseSigma: 3, seed: 5 };
    const { r, truePaper, card } = rendered(noisy, placement);
    const m1 = measurePaperWithCardHomography(card, truePaper, A4);
    const m2 = measurePaperWithCardAndTilt(
      card,
      truePaper,
      A4,
      {
        kind: "tilt-azimuth",
        tiltDeg: scene.tiltDeg,
        azimuthDeg: scene.azimuthDeg,
      },
      { fPx: scene.fPx, cx: r.cx, cy: r.cy },
    );
    console.log(
      `[L3a] noisy ${name}: method 1 long ${fmt(m1.longErrorMm)} short ${fmt(m1.shortErrorMm)} mm; method 2 (right tilt) long ${fmt(m2.longErrorMm)} short ${fmt(m2.shortErrorMm)} mm`,
    );
    // Reported a few hundredths of a mm; loose bounds (L3b review).
    expect(Math.abs(m1.longErrorMm)).toBeLessThan(1);
    expect(Math.abs(m1.shortErrorMm)).toBeLessThan(1);
    expect(Math.abs(m2.longErrorMm)).toBeLessThan(1);
    expect(Math.abs(m2.shortErrorMm)).toBeLessThan(1);
  });
});

describe("method (3) cardScaleRatio through the sheet's homography", () => {
  it.each(SCENES)("%s", (name, scene, placement) => {
    const { truePaper, card, detectedPaper } = rendered(scene, placement);
    const c = cardScaleRatioAgainstPaper(card, truePaper, A4);
    const cd = cardScaleRatioAgainstPaper(card, detectedPaper as Quad, A4);
    console.log(
      `[L3a] method 3 ${name}: ratio ${fmt(c.cardScaleRatio, 5)} (card ${fmt(c.cardLongMm)} x ${fmt(c.cardShortMm)} mm); with detectPaperQuad ${fmt(cd.cardScaleRatio, 5)}`,
    );
    expect(Math.abs(c.cardScaleRatio - 1)).toBeLessThan(0.002);
    expect(c.cardLongMm).toBeCloseTo(ID1.long, 0);
  });
});

/**
 * Corner-level Monte Carlo in the research report's set-up (refsim2.py
 * `card_imu`: 886 x 1920, f = 1331, height U[350, 500] mm, tilt U[0, 10]°,
 * random azimuth, card 25 mm beside a 190 x 85 mm hand; sensor error
 * N(0, 1°) on tilt and N(0, 1°) on azimuth), run through THIS module's
 * method (2), so the magnitudes can be set beside the report's table. The
 * hand is a 190 x 85 rectangle, its long side the "hand length".
 */
describe("method (2) vs the research simulation (corner-level, no rendering)", () => {
  function mulberry(seed: number) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function run(
    tiltSdDeg: number,
    cornerSigmaPx: number,
    n: number,
    rand: () => number,
  ) {
    const gauss = () =>
      Math.sqrt(-2 * Math.log(Math.max(rand(), 1e-12))) *
      Math.cos(2 * Math.PI * rand());
    const errsL: number[] = [];
    const errsA4: number[] = [];
    for (let i = 0; i < n; i++) {
      const tilt = rand() * 10;
      const az = rand() * 360;
      const x0 = 42.5 + 25;
      const scene: LabCardScene = {
        width: 886,
        height: 1920,
        fPx: 1331,
        tiltDeg: tilt,
        azimuthDeg: az,
        heightMm: 350 + rand() * 150,
        aimMm: { x: (x0 + ID1.short) / 2 - 10, y: 0 },
      };
      const cam = sceneCamera(scene);
      const P = (x: number, y: number) => applyMat(cam.tableToImage, { x, y });
      const card = [
        P(x0, -ID1.long / 2),
        P(x0 + ID1.short, -ID1.long / 2),
        P(x0 + ID1.short, ID1.long / 2),
        P(x0, ID1.long / 2),
      ].map((p) => ({
        x: p.x + cornerSigmaPx * gauss(),
        y: p.y + cornerSigmaPx * gauss(),
      }));
      const hand = [P(-42.5, -95), P(42.5, -95), P(42.5, 95), P(-42.5, 95)];
      // A4 laid out beside the card the same way (for the sheet-size figure).
      const a4 = [
        P(-210 - 20, -148.5),
        P(-20, -148.5),
        P(-20, 148.5),
        P(-210 - 20, 148.5),
      ];
      const t: CameraTilt = {
        kind: "tilt-azimuth",
        tiltDeg: tilt + tiltSdDeg * gauss(),
        azimuthDeg: az + tiltSdDeg * gauss(),
      };
      const k = { fPx: 1331, cx: 443, cy: 960 };
      const cq = asQuad(card);
      errsL.push(
        measurePaperWithCardAndTilt(
          cq,
          asQuad(hand),
          { longMm: 190, shortMm: 85 },
          t,
          k,
        ).longErrorMm,
      );
      errsA4.push(
        measurePaperWithCardAndTilt(cq, asQuad(a4), A4, t, k).longErrorMm,
      );
    }
    const rms = (e: number[]) =>
      Math.sqrt(e.reduce((s, v) => s + v * v, 0) / e.length);
    const p95 = (e: number[]) => {
      const s = e.map(Math.abs).sort((a, b) => a - b);
      return s[Math.floor(0.95 * (s.length - 1))];
    };
    return {
      lRms: rms(errsL),
      lP95: p95(errsL),
      aRms: rms(errsA4),
      aP95: p95(errsA4),
    };
  }

  it("reports RMS / p95 beside the report's figures", () => {
    const rand = mulberry(67);
    const rows: [string, number, number, string][] = [
      ["exact tilt, sigma 0", 0, 0, "-"],
      ["tilt 1° sd, sigma 0", 1, 0, "-"],
      ["tilt 1° sd, sigma 0.5 px", 1, 0.5, "0.73 / 1.52"],
      ["tilt 1° sd, sigma 1 px", 1, 1, "0.95 / 1.92"],
      ["tilt 2° sd, sigma 1 px", 2, 1, "1.45 / 3.00"],
    ];
    for (const [label, sd, sig, report] of rows) {
      const r = run(sd, sig, 3000, rand);
      console.log(
        `[L3a] MC method 2, ${label}: hand-length RMS ${fmt(r.lRms, 2)} p95 ${fmt(r.lP95, 2)} mm (report: ${report}); A4 long side RMS ${fmt(r.aRms, 2)} p95 ${fmt(r.aP95, 2)} mm`,
      );
      if (sd === 0 && sig === 0) expect(r.lRms).toBeLessThan(1e-6);
      else {
        // The research report's order of magnitude (L3b review): within a
        // factor of 2 of its RMS where it gives one, else 0.2-2 mm.
        const reportRms =
          report === "-" ? null : Number(report.split(" / ")[0]);
        expect(r.lRms).toBeGreaterThan(
          reportRms === null ? 0.2 : reportRms / 2,
        );
        expect(r.lRms).toBeLessThan(reportRms === null ? 2 : reportRms * 2);
      }
    }
  });
});

describe("cardMeasure pure helpers", () => {
  it("rectifyingHomography is the identity at zero tilt", () => {
    const h = rectifyingHomography([0, 0, 1], { fPx: 1000, cx: 450, cy: 600 });
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++)
        expect(h[i][j]).toBeCloseTo(i === j ? 1 : 0, 12);
  });

  it("fitSimilarity recovers a known scale, rotation and shift", () => {
    const src = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
      { x: 0, y: 5 },
    ];
    const s = 0.37;
    const a = 0.4;
    const dst = src.map((p) => ({
      x: s * (Math.cos(a) * p.x - Math.sin(a) * p.y) + 3,
      y: s * (Math.sin(a) * p.x + Math.cos(a) * p.y) - 2,
    }));
    const t = fitSimilarity(src, dst);
    expect(t.scale).toBeCloseTo(s, 12);
    expect(t.angle).toBeCloseTo(a, 12);
    expect(t.tx).toBeCloseTo(3, 12);
    expect(t.ty).toBeCloseTo(-2, 12);
    expect(t.rms).toBeLessThan(1e-12);
  });

  it("rectangleMmFor follows the image's orientation", () => {
    const landscape: Quad = [
      { x: 0, y: 0 },
      { x: 300, y: 0 },
      { x: 300, y: 200 },
      { x: 0, y: 200 },
    ];
    expect(rectangleMmFor(landscape, 297, 210)[2]).toEqual({ x: 297, y: 210 });
    const portrait: Quad = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 300 },
      { x: 0, y: 300 },
    ];
    expect(rectangleMmFor(portrait, 297, 210)[2]).toEqual({ x: 210, y: 297 });
  });

  it("paperMeasurementFromMmQuad: an exact A4 has zero error", () => {
    const m = paperMeasurementFromMmQuad(
      [
        { x: 0, y: 0 },
        { x: 210, y: 0 },
        { x: 210, y: 297 },
        { x: 0, y: 297 },
      ],
      A4,
    );
    expect(m.longErrorMm).toBeCloseTo(0, 12);
    expect(m.shortErrorMm).toBeCloseTo(0, 12);
    expect(m.diagonalErrorMm).toBeCloseTo(0, 12);
  });

  it("downInCamera rejects a zero vector", () => {
    expect(() =>
      downInCamera({ kind: "down-vector", down: [0, 0, 0] }),
    ).toThrow(RangeError);
  });
});
