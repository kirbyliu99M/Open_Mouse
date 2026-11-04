/**
 * Scan Lab L3a (2026-10-29): `detectCard` on rendered scenes
 * (`helpers/card-scene.ts`, a separate camera model). Every accuracy
 * figure is against the card's TRUE sharp-rectangle corners, projected from
 * the table, never against the detector's own output. The numbers measured
 * are printed (`[L3a]` lines) for the hand-in report.
 */
import { describe, expect, it } from "vitest";
import {
  detectCard,
  MIN_CARD_LONG_SIDE_PX,
  type Quad,
} from "../../src/client/card/detect/detectCard";
import {
  buildSearchMask,
  findCoarseCandidates,
} from "../../src/client/card/detect/coarse";
import {
  cardSideLengthsMm,
  edgeOffsetAlongNormal,
} from "../../src/client/card/detect/refine";
import { downscaleImage } from "../../src/client/card/detect/image";
import {
  findQuadCandidates,
  selectBestCardCandidate,
} from "../../src/client/photo/card";
import { orderQuadCorners } from "../../src/client/paper/quad-math";
import {
  cornerErrorsPx,
  renderLabCardScene,
  type LabCardScene,
  type Pt,
} from "./helpers/card-scene";

const ON_PAPER: LabCardScene = {
  width: 900,
  height: 1200,
  fPx: 1000,
  tiltDeg: 6,
  azimuthDeg: 30,
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

/** Card on the table, 10 mm right of the sheet, long side along the sheet. */
const BESIDE: LabCardScene = {
  ...ON_PAPER,
  aimMm: { x: 137, y: 148.5 },
  cardCentreMm: { x: 247, y: 148.5 },
  cardAngleDeg: 90,
};

function paperQuad(r: ReturnType<typeof renderLabCardScene>): Quad {
  return orderQuadCorners(r.paperCornersPx as unknown as Quad);
}

/** How far each found corner sits INSIDE the true corner, along the line from the card's centre (px; positive = pulled in). */
function inwardPx(found: readonly Pt[], truth: readonly Pt[]): number[] {
  const cx = truth.reduce((s, p) => s + p.x, 0) / 4;
  const cy = truth.reduce((s, p) => s + p.y, 0) / 4;
  return found.map((f) => {
    const t = truth.reduce((best, p) =>
      Math.hypot(p.x - f.x, p.y - f.y) < Math.hypot(best.x - f.x, best.y - f.y)
        ? p
        : best,
    );
    const ux = t.x - cx;
    const uy = t.y - cy;
    const n = Math.hypot(ux, uy);
    return ((t.x - f.x) * ux + (t.y - f.y) * uy) / n;
  });
}

/** ID-1 short side, mm. */
const ID1_SHORT_MM = 53.98;

const fmt = (v: number[]) => v.map((x) => x.toFixed(3)).join(", ");

describe("detectCard: noise-free corners (brief: < 0.3 px)", () => {
  const cases: [string, LabCardScene, "on-paper" | "beside-paper"][] = [
    ["(a) blue card on the sheet", ON_PAPER, "on-paper"],
    ["(b) blue card on a grey table", BESIDE, "beside-paper"],
    [
      "(b) light card on wood",
      { ...BESIDE, cardRgb: [225, 225, 230], background: "wood" },
      "beside-paper",
    ],
    [
      "(b) light card on a dark table",
      { ...BESIDE, cardRgb: [225, 225, 230], background: "dark" },
      "beside-paper",
    ],
  ];
  it.each(cases)("%s", (name, scene, placement) => {
    const r = renderLabCardScene(scene);
    const d = detectCard(r, { paperCorners: paperQuad(r), placement });
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    const err = cornerErrorsPx(d.corners, r.cardCornersPx as Pt[]);
    console.log(
      `[L3a] corners noise-free ${name}: per-corner px ${fmt(err.each)}; residuals px ${fmt(
        d.sides.map((s) => s.residualPx ?? NaN),
      )}; points ${d.sides.map((s) => `${s.pointsUsed}/${s.pointsSampled}`).join(" ")}`,
    );
    expect(err.max).toBeLessThan(0.3);
    expect(d.worstResidualPx).toBeLessThan(0.3);
    for (const s of d.sides) expect(s.pointsUsed).toBeGreaterThan(50);
  });
});

describe("detectCard: rounded corners do not pull the corner inward", () => {
  it("edge-line intersections sit on the true corner; outline vertices sit inside it", () => {
    const r = renderLabCardScene(ON_PAPER);
    const truth = r.cardCornersPx as Pt[];
    const d = detectCard(r, {
      paperCorners: paperQuad(r),
      placement: "on-paper",
    });
    expect(d.ok).toBe(true);
    if (!d.ok) return;

    // Baseline 1: the existing contour-vertex finder (photo/card.ts, js-aruco2).
    const best = selectBestCardCandidate(findQuadCandidates(r));
    expect(best).not.toBeNull();
    const contour: readonly Pt[] = best ?? [];
    const contourErr = cornerErrorsPx(contour, truth);
    const contourIn = inwardPx(contour, truth);

    // Baseline 2: this module's own hull vertices before the edge fit.
    const mask = buildSearchMask(r.width, r.height, {
      paperCorners: paperQuad(r),
      placement: "on-paper",
    });
    const hull = findCoarseCandidates(r, mask).candidates.find(
      (c) => cornerErrorsPx(c.quad, truth).max < 10,
    );
    expect(hull).toBeDefined();
    const hullErr = cornerErrorsPx(hull!.hullQuad, truth);
    const hullIn = inwardPx(hull!.hullQuad, truth);

    const fitErr = cornerErrorsPx(d.corners, truth);
    const fitIn = inwardPx(d.corners, truth);
    console.log(
      `[L3a] rounded-corner control: contour vertices (photo/card.ts) max ${contourErr.max.toFixed(2)} px, inward ${fmt(contourIn)}; hull vertices max ${hullErr.max.toFixed(2)} px, inward ${fmt(hullIn)}; edge-line fit max ${fitErr.max.toFixed(3)} px, inward ${fmt(fitIn)}`,
    );
    expect(Math.min(...contourIn)).toBeGreaterThan(1);
    expect(Math.min(...hullIn)).toBeGreaterThan(1);
    expect(Math.max(...fitIn.map(Math.abs))).toBeLessThan(0.3);
  });
});

describe("detectCard: blur and noise", () => {
  const cases: [string, LabCardScene, "on-paper" | "beside-paper"][] = [
    ["(a) blur 0.8 px, noise 3", ON_PAPER, "on-paper"],
    ["(b) grey table, blur 0.8 px, noise 3", BESIDE, "beside-paper"],
    [
      "(b) wood, blur 0.8 px, noise 3",
      { ...BESIDE, cardRgb: [225, 225, 230], background: "wood" },
      "beside-paper",
    ],
    [
      // The dark stripe meets the card's short edges against a dark table: the
      // outline breaks in two and only the joined pair is card-shaped.
      "(b) dark table, blur 1.2 px, noise 6 (outline split by the stripe)",
      {
        ...BESIDE,
        cardRgb: [225, 225, 230],
        background: "dark",
        blurSigmaPx: 1.2,
        noiseSigma: 6,
      },
      "beside-paper",
    ],
  ];
  it.each(cases)("%s", (name, scene, placement) => {
    const r = renderLabCardScene({
      blurSigmaPx: 0.8,
      noiseSigma: 3,
      seed: 3,
      ...scene,
    });
    const d = detectCard(r, { paperCorners: paperQuad(r), placement });
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    const err = cornerErrorsPx(d.corners, r.cardCornersPx as Pt[]);
    console.log(
      `[L3a] corners ${name}: per-corner px ${fmt(err.each)}; worst residual ${d.worstResidualPx.toFixed(3)} px`,
    );
    expect(err.max).toBeLessThan(0.5);
  });

  it("the downscaled coarse search (big photos) gives the same corners", () => {
    const r = renderLabCardScene(BESIDE);
    const full = detectCard(r, {
      paperCorners: paperQuad(r),
      placement: "beside-paper",
    });
    const half = detectCard(r, {
      paperCorners: paperQuad(r),
      placement: "beside-paper",
      coarseMaxLongEdgePx: 600,
    });
    expect(full.ok && half.ok).toBe(true);
    if (!full.ok || !half.ok) return;
    expect(cornerErrorsPx(half.corners, full.corners).max).toBeLessThan(0.05);
  });
});

describe("detectCard: failure codes, never a guessed corner", () => {
  it("no card in the scene -> no_candidate", () => {
    const r = renderLabCardScene({ ...BESIDE, cardCentreMm: null });
    const d = detectCard(r, {
      paperCorners: paperQuad(r),
      placement: "beside-paper",
    });
    expect(d).toMatchObject({ ok: false, failure: "no_candidate" });
  });

  it("card on the sheet but searched beside it -> no_candidate (placement is respected)", () => {
    const r = renderLabCardScene(ON_PAPER);
    const d = detectCard(r, {
      paperCorners: paperQuad(r),
      placement: "beside-paper",
    });
    expect(d).toMatchObject({ ok: false, failure: "no_candidate" });
  });

  it("card half out of the frame -> card_clipped", () => {
    // Card centre ~20 px inside the right frame edge: over half of it is cut off.
    const r = renderLabCardScene({
      ...BESIDE,
      cardCentreMm: { x: 300, y: 148.5 },
    });
    const d = detectCard(r, {
      paperCorners: paperQuad(r),
      placement: "beside-paper",
    });
    expect(d).toMatchObject({ ok: false, failure: "card_clipped" });
  });

  it("card too far away -> too_small", () => {
    const r = renderLabCardScene({ ...BESIDE, heightMm: 1100 });
    const longPx = Math.max(
      ...[0, 1, 2, 3].map((i) => {
        const c = r.cardCornersPx as Pt[];
        return Math.hypot(c[(i + 1) % 4].x - c[i].x, c[(i + 1) % 4].y - c[i].y);
      }),
    );
    expect(longPx).toBeLessThan(MIN_CARD_LONG_SIDE_PX);
    const d = detectCard(r, {
      paperCorners: paperQuad(r),
      placement: "beside-paper",
    });
    expect(d).toMatchObject({ ok: false, failure: "too_small" });
  });

  it("mismatched data length -> invalid_input", () => {
    const d = detectCard({
      data: new Uint8ClampedArray(10),
      width: 4,
      height: 4,
    });
    expect(d).toMatchObject({ ok: false, failure: "invalid_input" });
  });

  it("no options: the card is still found on its own in a plain scene", () => {
    const r = renderLabCardScene({ ...BESIDE, paperOriginMm: null });
    const d = detectCard(r);
    expect(d.ok).toBe(true);
    if (d.ok)
      expect(
        cornerErrorsPx(d.corners, r.cardCornersPx as Pt[]).max,
      ).toBeLessThan(0.3);
  });

  it("a search region away from the card -> no_candidate", () => {
    const r = renderLabCardScene(BESIDE);
    const d = detectCard(r, {
      searchRegion: { x: 0, y: 0, width: 300, height: 300 },
    });
    expect(d).toMatchObject({ ok: false, failure: "no_candidate" });
  });
});

describe("refine helpers", () => {
  it("edgeOffsetAlongNormal finds a vertical step at sub-pixel precision", () => {
    // A box-filtered step at x = 20.3 in a 40 x 20 image.
    const w = 40;
    const h = 20;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const cover = Math.min(1, Math.max(0, x + 1 - 20.3)); // share of the pixel right of the edge
        const v = 50 + 150 * cover;
        const o = (y * w + x) * 4;
        data[o] = data[o + 1] = data[o + 2] = v;
        data[o + 3] = 255;
      }
    }
    const off = edgeOffsetAlongNormal(
      { data, width: w, height: h },
      { x: 18, y: 10 },
      { x: 0, y: 1 },
      { x: 1, y: 0 },
      5,
    );
    expect(off).not.toBeNull();
    expect(Math.abs(18 + (off as number) - 20.3)).toBeLessThan(0.1);
  });

  it("edgeOffsetAlongNormal returns null on a flat patch", () => {
    const data = new Uint8ClampedArray(40 * 20 * 4).fill(128);
    expect(
      edgeOffsetAlongNormal(
        { data, width: 40, height: 20 },
        { x: 20, y: 10 },
        { x: 0, y: 1 },
        { x: 1, y: 0 },
        5,
      ),
    ).toBeNull();
  });

  it("cardSideLengthsMm gives the longer opposite pair 85.6 mm", () => {
    const portrait: Quad = [
      { x: 0, y: 0 },
      { x: 54, y: 0 },
      { x: 54, y: 86 },
      { x: 0, y: 86 },
    ];
    expect(cardSideLengthsMm(portrait)).toEqual([53.98, 85.6, 53.98, 85.6]);
  });

  it("downscaleImage box-averages by an integer factor", () => {
    const data = new Uint8ClampedArray([
      0, 0, 0, 255, 100, 100, 100, 255, 200, 200, 200, 255, 100, 100, 100, 255,
    ]);
    const s = downscaleImage({ data, width: 2, height: 2 }, 2);
    expect(s.width).toBe(1);
    expect(Array.from(s.data.slice(0, 3))).toEqual([100, 100, 100]);
  });
});

/**
 * L4 (2026-10-30): Kirby's real photos — a dark-blue card with a white logo
 * lying in the MIDDLE of loose-leaf grid paper with punched holes — came back
 * `too_small` although the card's long side was over 300 px. The card's
 * outline was found and then dropped because it contained the sheet's centre
 * (a test meant to drop the sheet itself), and the punched holes, tiny but
 * card-shaped, then set `too_small`. These scenes reproduce both.
 */
describe("detectCard: card in the middle of punched grid paper (L4 real-photo case)", () => {
  const GRID_SHEET: LabCardScene = {
    ...ON_PAPER,
    tiltDeg: 3,
    azimuthDeg: 95,
    yawDeg: 1,
    heightMm: 330,
    cardCentreMm: { x: 105, y: 148.5 },
    cardAngleDeg: 1,
    cardRgb: [40, 50, 120],
    cardStripe: false,
    cardLogo: true,
    paperGridMm: 5,
    paperHoles: true,
    background: "dark",
    blurSigmaPx: 0.8,
    noiseSigma: 2,
    seed: 11,
  };

  it("finds the card, with corners within 0.3 px", () => {
    const r = renderLabCardScene(GRID_SHEET);
    const d = detectCard(r, {
      paperCorners: paperQuad(r),
      placement: "on-paper",
    });
    if (!d.ok) console.log(`[L4] grid sheet: failure ${d.failure}`);
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    const err = cornerErrorsPx(d.corners, r.cardCornersPx as Pt[]);
    console.log(
      `[L4] grid sheet, card at the centre: per-corner px ${fmt(err.each)}; residuals px ${fmt(
        d.sides.map((s) => s.residualPx ?? NaN),
      )}`,
    );
    expect(err.max).toBeLessThan(0.3);
  });

  it("without a card the holes are not reported as a too-small card", () => {
    const r = renderLabCardScene({ ...GRID_SHEET, cardCentreMm: null });
    const d = detectCard(r, {
      paperCorners: paperQuad(r),
      placement: "on-paper",
    });
    expect(d).toMatchObject({ ok: false, failure: "no_candidate" });
  });
});

describe("coarse outline is not pulled out by a faint grid line next to the card (L4)", () => {
  // Card top edge 2 mm below a grid line (19-47-55: the line was ~8 px out).
  it.each([1.6, 2.0, 2.4])("grid line %f mm outside the top edge", (gapMm) => {
    const scene: LabCardScene = {
      ...ON_PAPER,
      tiltDeg: 3,
      azimuthDeg: 95,
      yawDeg: 0,
      heightMm: 330,
      cardCentreMm: { x: 102.5, y: 120 + gapMm + 26.99 },
      cardAngleDeg: 0,
      cardRgb: [40, 50, 120],
      cardStripe: false,
      cardLogo: true,
      paperGridMm: 5,
      paperHoles: true,
      background: "dark",
      blurSigmaPx: 0.8,
    };
    const r = renderLabCardScene(scene);
    const d = detectCard(r, {
      paperCorners: paperQuad(r),
      placement: "on-paper",
    });
    if (!d.ok) console.log(`[L4] gap ${gapMm} mm: failure ${d.failure}`);
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    const err = cornerErrorsPx(d.corners, r.cardCornersPx as Pt[]);
    const coarseErr = cornerErrorsPx(d.coarseCorners, r.cardCornersPx as Pt[]);
    console.log(
      `[L4] grid line ${gapMm} mm out: coarse max ${coarseErr.max.toFixed(2)} px, fitted max ${err.max.toFixed(3)} px`,
    );
    expect(err.max).toBeLessThan(0.3);
  });
});

describe("failure codes are judged by the card size the sheet implies (L4)", () => {
  it("too_small only for an outline near a card's expected size", () => {
    const r = renderLabCardScene({ ...BESIDE, heightMm: 1100 });
    const opts = {
      paperCorners: paperQuad(r),
      placement: "beside-paper" as const,
    };
    // A4: the outline is the size a card should be here, so it is a card, too small.
    expect(detectCard(r, opts)).toMatchObject({ failure: "too_small" });
    // Claim the sheet is 60 mm long: a card should then look ~5x bigger, and
    // this outline is a speck, not a small card.
    expect(detectCard(r, { ...opts, paperLongMm: 60 })).toMatchObject({
      failure: "no_candidate",
    });
  });

  it("card_clipped only for an outline no bigger than a card could look", () => {
    const r = renderLabCardScene({
      ...BESIDE,
      cardCentreMm: { x: 300, y: 148.5 },
    });
    const opts = {
      paperCorners: paperQuad(r),
      placement: "beside-paper" as const,
    };
    expect(detectCard(r, opts)).toMatchObject({ failure: "card_clipped" });
    // Claim the sheet is 1000 mm long: a card should look ~3.4x smaller, and
    // the cut-off outline is too big to be part of one.
    expect(detectCard(r, { ...opts, paperLongMm: 1000 })).toMatchObject({
      failure: "no_candidate",
    });
  });
});

describe("L5: a dark card on wood, touching the sheet's edge, and two cards", () => {
  // Kirby's 2026-10-30 photos: a Toastmasters card back (dark purple, white
  // logo) on a wood table, its long side against the sheet's right edge, and
  // a second, colourful card on the sheet.
  const TOUCHING: LabCardScene = {
    ...BESIDE,
    tiltDeg: 4,
    azimuthDeg: 80,
    yawDeg: 2,
    heightMm: 360,
    cardCentreMm: { x: 210 + ID1_SHORT_MM / 2, y: 200 },
    cardAngleDeg: 90,
    cardRgb: [70, 72, 130],
    cardStripe: false,
    cardLogo: true,
    background: "wood",
    blurSigmaPx: 0.8,
    noiseSigma: 2,
    seed: 5,
  };
  const TWO_CARDS: LabCardScene = {
    ...TOUCHING,
    secondCard: {
      centreMm: { x: 105, y: 120 },
      angleDeg: 3,
      rgb: [70, 150, 200],
    },
  };

  it("beside-paper finds the touching card, corners within 0.5 px, sides at most 0.5 px residual", () => {
    const r = renderLabCardScene(TOUCHING);
    const d = detectCard(r, {
      paperCorners: paperQuad(r),
      placement: "beside-paper",
    });
    if (!d.ok) console.log(`[L5] touching card: failure ${d.failure}`);
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    const err = cornerErrorsPx(d.corners, r.cardCornersPx as Pt[]);
    console.log(
      `[L5] dark card touching the sheet: per-corner px ${fmt(err.each)}; residuals px ${fmt(
        d.sides.map((s) => s.residualPx ?? NaN),
      )}`,
    );
    expect(err.max).toBeLessThan(0.5);
    expect(d.worstResidualPx).toBeLessThanOrEqual(0.5);
  });

  it("each placement takes its own card when there are two", () => {
    const r = renderLabCardScene(TWO_CARDS);
    const paperCorners = paperQuad(r);
    const beside = detectCard(r, { paperCorners, placement: "beside-paper" });
    const on = detectCard(r, { paperCorners, placement: "on-paper" });
    if (!beside.ok) console.log(`[L5] two cards, beside: ${beside.failure}`);
    if (!on.ok) console.log(`[L5] two cards, on: ${on.failure}`);
    expect(beside.ok && on.ok).toBe(true);
    if (!beside.ok || !on.ok) return;
    const besideErr = cornerErrorsPx(beside.corners, r.cardCornersPx as Pt[]);
    const onErr = cornerErrorsPx(on.corners, r.secondCardCornersPx as Pt[]);
    console.log(
      `[L5] two cards: beside-paper max ${besideErr.max.toFixed(3)} px, on-paper max ${onErr.max.toFixed(3)} px`,
    );
    expect(besideErr.max).toBeLessThan(0.5);
    expect(onErr.max).toBeLessThan(0.5);
  });

  it("a card cut by the frame is still card_clipped; one 6 px inside the frame is found", () => {
    const r = renderLabCardScene(TOUCHING);
    const c = r.cardCornersPx as Pt[];
    const right = Math.max(...c.map((p) => p.x));
    // Crop the frame on the right: 6 px past the card, then 20 px into it.
    const crop = (w: number) => {
      const data = new Uint8ClampedArray(w * r.height * 4);
      for (let y = 0; y < r.height; y++) {
        data.set(
          r.data.subarray(y * r.width * 4, (y * r.width + w) * 4),
          y * w * 4,
        );
      }
      return { data, width: w, height: r.height };
    };
    const paperCorners = paperQuad(r);
    const inside = detectCard(crop(Math.ceil(right + 6)), {
      paperCorners,
      placement: "beside-paper",
    });
    expect(inside.ok).toBe(true);
    const cut = detectCard(crop(Math.floor(right - 20)), {
      paperCorners,
      placement: "beside-paper",
    });
    expect(cut).toMatchObject({ ok: false, failure: "card_clipped" });
  });
});
