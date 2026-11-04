/**
 * Scan Lab L12 (2026-11-04): fixes measured on the L12 synthetic set (local
 * composites of Kirby's real card photos, never in the repo). Rendered
 * scenes here, no photos:
 * - (a) a light rim at the card's edge: the fitted sides sit on the rim's
 *   OUTER side (with no sheet), not 1-2 px inside it;
 * - sharp-cornered ID-1 rectangles that are small and blurred are not a
 *   card with no sheet (`cornerRoundingMargins`), while the same card with
 *   rounded corners still is;
 * - (b) with no card slot, a box beside the hand (`handCardSearchRegion`)
 *   for the straight-edge search only (`linesRegion`).
 * Each failed on d2d1b42e (no such option, export or rule).
 */
import { describe, expect, it } from "vitest";
import {
  detectCard,
  noSheetCornersPass,
} from "../../src/client/card/detect/detectCard";
import { findCardByLines } from "../../src/client/card/detect/lineSearch";
import {
  cornerRoundingMargins,
  MIN_BEST_ROUNDING_MARGIN,
} from "../../src/client/card/detect/cornerCheck";
import { handCardSearchRegion } from "../../src/client/card/hand/handCardRegion";
import {
  cornerErrorsPx,
  renderLabCardScene,
  type LabCardScene,
  type Pt,
} from "./helpers/card-scene";

const BLACK: readonly [number, number, number] = [60, 61, 66];

/** The L11 scene: a black card with a light rim on the dark maze mat. */
function darkScene(extra: Partial<LabCardScene> = {}): LabCardScene {
  return {
    width: 720,
    height: 1180,
    fPx: 800,
    tiltDeg: 3,
    azimuthDeg: 80,
    yawDeg: 1.5,
    heightMm: 200,
    aimMm: { x: 0, y: 0 },
    paperOriginMm: null,
    cardCentreMm: { x: 20, y: -10 },
    cardAngleDeg: 90,
    cardRgb: BLACK,
    cardLogo: false,
    cardStripe: false,
    cardRim: { widthMm: 0.25, rgb: [115, 108, 108] },
    background: "darkMaze",
    blurSigmaPx: 1.2,
    noiseSigma: 1.5,
    seed: 11,
    ...extra,
  };
}

/** A blue card, small and blurred, on the plain grey table, no sheet. */
function smallBlurred(extra: Partial<LabCardScene> = {}): LabCardScene {
  return {
    width: 720,
    height: 1180,
    fPx: 800,
    tiltDeg: 3,
    azimuthDeg: 80,
    yawDeg: 1.5,
    heightMm: 380,
    aimMm: { x: 0, y: 0 },
    paperOriginMm: null,
    cardCentreMm: { x: 20, y: -10 },
    cardAngleDeg: 90,
    cardRgb: [50, 70, 160],
    cardLogo: false,
    cardStripe: false,
    background: "grey",
    blurSigmaPx: 2,
    noiseSigma: 1.5,
    seed: 5,
    ...extra,
  };
}

function boxAround(corners: readonly Pt[], pad: number) {
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  const x = Math.min(...xs) - pad;
  const y = Math.min(...ys) - pad;
  return {
    x,
    y,
    width: Math.max(...xs) + pad - x,
    height: Math.max(...ys) + pad - y,
  };
}

const focalOf = (s: LabCardScene) => ({
  focalPx: s.fPx,
  principalPoint: { x: s.width / 2, y: s.height / 2 },
});

describe("L12 (a): a light rim belongs to the card", () => {
  it("the dark card's corners land on the rim's outer side (< 1 px)", () => {
    const s = darkScene();
    const r = renderLabCardScene(s);
    const truth = r.cardCornersPx as Pt[];
    const d = detectCard(r, {
      ...focalOf(s),
      searchRegion: boxAround(truth, 70),
    });
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    // L11: about 2.4 px inside (the fit took the rim's inner step).
    expect(cornerErrorsPx(d.corners, truth).max).toBeLessThan(1);
  });

  it("a card without a rim keeps its corners where they were", () => {
    const s = smallBlurred({ heightMm: 260, blurSigmaPx: 1 });
    const r = renderLabCardScene(s);
    const truth = r.cardCornersPx as Pt[];
    const d = detectCard(r, focalOf(s));
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(cornerErrorsPx(d.corners, truth).max).toBeLessThan(0.5);
  });
});

describe("L12: sharp-cornered ID-1 rectangles with no sheet", () => {
  it("a small, blurred sharp rectangle is not a card", () => {
    const s = smallBlurred({ cardRadiusMm: 0 });
    const r = renderLabCardScene(s);
    const d = detectCard(r, focalOf(s));
    expect(d.ok).toBe(false);
  });

  it("the same card with rounded corners is found", () => {
    const s = smallBlurred();
    const r = renderLabCardScene(s);
    const d = detectCard(r, focalOf(s));
    expect(d.ok).toBe(true);
  });

  it("rounding margins: sharp corners read no rounding, rounded ones do", () => {
    const sharp = renderLabCardScene(smallBlurred({ cardRadiusMm: 0 }));
    const round = renderLabCardScene(smallBlurred());
    const best = (img: typeof sharp) =>
      Math.max(
        ...cornerRoundingMargins(
          img,
          img.cardCornersPx as [Pt, Pt, Pt, Pt],
        ).map((v) => v ?? -1),
      );
    expect(best(sharp)).toBeLessThan(MIN_BEST_ROUNDING_MARGIN);
    expect(best(round)).toBeGreaterThan(MIN_BEST_ROUNDING_MARGIN);
  });
});

/** A right hand, palm down, fingers up, thumb to the left (image px). */
function rightHand(): Pt[] {
  const p: Pt[] = [];
  const wrist = { x: 400, y: 1100 };
  p.push(wrist);
  // thumb 1-4, up-left
  for (let i = 1; i <= 4; i++) p.push({ x: 400 - 60 * i, y: 1080 - 70 * i });
  // fingers: index (5-8) x 330, middle (9-12) x 400, ring (13-16) x 460, little (17-20) x 520
  for (const x of [330, 400, 460, 520]) {
    for (let j = 0; j < 4; j++) p.push({ x, y: 820 - 90 * j });
  }
  return p;
}

describe("L12 (b): the box beside the hand when the guide has no slot", () => {
  const shot = { width: 1080, height: 1768 };

  it("lies on the little-finger side, level with the hand", () => {
    const box = handCardSearchRegion(rightHand(), shot);
    expect(box).not.toBeNull();
    if (!box) return;
    // little finger at x 520: the box starts just past it and runs right
    expect(box.x).toBeGreaterThan(520);
    expect(box.x).toBeLessThan(560);
    // hand length |0 -> 12| = 1100 - 550 = 550 px: 0.8 L out
    expect(box.x + box.width).toBeCloseTo(Math.min(1080, 520 + 0.8 * 550), 0);
    // along: 0.1 L below the wrist to 1.1 L above it
    expect(box.y).toBeCloseTo(1100 - 1.1 * 550, 0);
    expect(box.y + box.height).toBeCloseTo(1100 + 0.1 * 550, 0);
  });

  it("mirrored for a hand whose little finger is on the left", () => {
    const left = rightHand().map((p) => ({ x: 1080 - p.x, y: p.y }));
    const box = handCardSearchRegion(left, shot);
    expect(box).not.toBeNull();
    if (!box) return;
    expect(box.x + box.width).toBeLessThan(1080 - 520);
    expect(box.x).toBeCloseTo(Math.max(0, 560 - 0.8 * 550), 0);
  });

  it("no box without 21 finite landmarks", () => {
    expect(handCardSearchRegion(null, shot)).toBeNull();
    expect(handCardSearchRegion(rightHand().slice(0, 20), shot)).toBeNull();
    const bad = rightHand();
    bad[3] = { x: Number.NaN, y: 0 };
    expect(handCardSearchRegion(bad, shot)).toBeNull();
  });

  it("the dark card is found in that box by its straight edges", () => {
    const s = darkScene();
    const r = renderLabCardScene(s);
    const truth = r.cardCornersPx as Pt[];
    const whole = detectCard(r, focalOf(s));
    expect(whole.ok).toBe(false);
    const d = detectCard(r, {
      ...focalOf(s),
      linesRegion: boxAround(truth, 70),
    });
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.method).toBe("lines");
    expect(cornerErrorsPx(d.corners, truth).max).toBeLessThan(1);
  });

  it("a hand-long box is searched in windows and still finds it", () => {
    const s = darkScene();
    const r = renderLabCardScene(s);
    const truth = r.cardCornersPx as Pt[];
    const b = boxAround(truth, 70);
    // as tall as a hand beside it (about 2.5 x the card's box), card low in it
    const tall = {
      x: b.x,
      y: Math.max(0, b.y - 1.6 * b.height),
      width: b.width,
    };
    const region = { ...tall, height: b.y + b.height + 20 - tall.y };
    expect(region.height).toBeGreaterThan(760);
    const d = detectCard(r, { ...focalOf(s), linesRegion: region });
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.method).toBe("lines");
    expect(cornerErrorsPx(d.corners, truth).max).toBeLessThan(1);
  });
});

/**
 * A hand painted onto a rendered scene (skin, hard edges: the strongest
 * straight edges a hand gives), from 21 landmarks: palm polygon, five
 * fingers and the forearm as thick segments.
 */
function paintHand(
  img: { data: Uint8ClampedArray; width: number; height: number },
  lm: readonly Pt[],
): void {
  const segs: [Pt, Pt, number][] = [];
  for (const f of [1, 5, 9, 13, 17]) {
    for (let j = 0; j < 3; j++) segs.push([lm[f + j], lm[f + j + 1], 34]);
  }
  segs.push([lm[0], { x: lm[0].x, y: img.height + 50 }, 170]);
  const palm = [lm[0], lm[1], lm[5], lm[9], lm[13], lm[17]];
  const inPalm = (x: number, y: number) => {
    let inside = false;
    for (let i = 0, j = palm.length - 1; i < palm.length; j = i++) {
      const a = palm[i];
      const b = palm[j];
      if (
        a.y > y !== b.y > y &&
        x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x
      ) {
        inside = !inside;
      }
    }
    return inside;
  };
  const nearSeg = (x: number, y: number) =>
    segs.some(([a, b, w]) => {
      const vx = b.x - a.x;
      const vy = b.y - a.y;
      const t = Math.max(
        0,
        Math.min(1, ((x - a.x) * vx + (y - a.y) * vy) / (vx * vx + vy * vy)),
      );
      return Math.hypot(x - a.x - t * vx, y - a.y - t * vy) <= w / 2;
    });
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (!inPalm(x + 0.5, y + 0.5) && !nearSeg(x + 0.5, y + 0.5)) continue;
      const k = (y * img.width + x) * 4;
      img.data[k] = 205;
      img.data[k + 1] = 160;
      img.data[k + 2] = 140;
    }
  }
}

/** A right hand, palm down, little finger toward the card (x 290), wrist at y 900, hand length 520 px; `tiltDeg` turns it about the wrist. */
function handBesideCard(tiltDeg = 0): Pt[] {
  const p: Pt[] = [{ x: 180, y: 900 }];
  for (let i = 1; i <= 4; i++) p.push({ x: 180 - 35 * i, y: 870 - 45 * i });
  for (const x of [120, 180, 235, 290]) {
    for (let j = 0; j < 4; j++) p.push({ x, y: 666 - 95 * j });
  }
  const a = (tiltDeg * Math.PI) / 180;
  return p.map((q) => ({
    x: 180 + (q.x - 180) * Math.cos(a) - (q.y - 900) * Math.sin(a),
    y: 900 + (q.x - 180) * Math.sin(a) + (q.y - 900) * Math.cos(a),
  }));
}

describe("L12 (b): the box beside a painted hand (handCardSearchRegion's own box)", () => {
  it("finds the dark card beside the hand", () => {
    const s = darkScene();
    const r = renderLabCardScene(s);
    const lm = handBesideCard();
    paintHand(r, lm);
    const box = handCardSearchRegion(lm, r);
    expect(box).not.toBeNull();
    const d = detectCard(r, { ...focalOf(s), linesRegion: box });
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.method).toBe("lines");
    expect(cornerErrorsPx(d.corners, r.cardCornersPx as Pt[]).max).toBeLessThan(
      1,
    );
  });

  it.each([0, 15, -15])(
    "no card beside the hand (turned %i deg): nothing found",
    (tilt) => {
      const s = darkScene({ cardCentreMm: null });
      const r = renderLabCardScene(s);
      const lm = handBesideCard(tilt);
      paintHand(r, lm);
      const d = detectCard(r, {
        ...focalOf(s),
        linesRegion: handCardSearchRegion(lm, r),
      });
      expect(d.ok).toBe(false);
    },
  );
});

describe("L12: the no-sheet corner gate on the straight-edge path", () => {
  it("a dark sharp-cornered rectangle's true corners fail the gate, a card's pass", () => {
    const sharp = renderLabCardScene(darkScene({ cardRadiusMm: 0 }));
    const round = renderLabCardScene(darkScene());
    const q = (img: typeof sharp) => img.cardCornersPx as [Pt, Pt, Pt, Pt];
    // colours too close for the rounding margins: all null on this path
    expect(
      cornerRoundingMargins(sharp, q(sharp)).every((v) => v === null),
    ).toBe(true);
    expect(noSheetCornersPass(sharp, q(sharp), true)).toBe(false);
    expect(noSheetCornersPass(round, q(round), true)).toBe(true);
  });
});

describe("L12 (1): line run-on at the search box's edge", () => {
  it("a maze grid with no card gives no quad (corners at the box edge no longer pass)", () => {
    const w = 400;
    const h = 600;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const k = (y * w + x) * 4;
        const line = x % 60 < 3 || y % 40 < 3;
        const v = line ? 150 : 40;
        data[k] = v;
        data[k + 1] = v;
        data[k + 2] = v;
        data[k + 3] = 255;
      }
    }
    const quads = findCardByLines(
      { data, width: w, height: h },
      { x: 0, y: 0, width: w, height: h },
      { minLongPx: 120, maxLongPx: 700, aspectTolerance: 0.6 },
    );
    expect(quads).toEqual([]);
  });
});
