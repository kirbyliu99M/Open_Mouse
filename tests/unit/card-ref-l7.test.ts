/**
 * Scan Lab L7 (2026-11-02): Kirby's fifth round. Rendered scenes for the
 * three ways the card's outline went wrong there:
 * - a two-colour card (red body, navy band along one long side) whose colour
 *   region held only the red, so the outline missed the band
 *   (`coarse.ts` step 9, `detectCard`'s band extensions);
 * - no sheet found, a card on the red and black maze mat (`detectCard`'s
 *   no-sheet path: colour regions, shape on its plane, rounded corners);
 * - a whole card reported `card_clipped`.
 * Each of these failed before L7 (checked against a2b553de).
 */
import { describe, expect, it } from "vitest";
import { detectCard, type Quad } from "../../src/client/card/detect/detectCard";
import { orderQuadCorners } from "../../src/client/paper/quad-math";
import {
  cornerErrorsPx,
  renderLabCardScene,
  type LabCardScene,
  type Pt,
} from "./helpers/card-scene";

const ID1_SHORT_MM = 53.98;
const RED: readonly [number, number, number] = [130, 25, 50];
const NAVY: readonly [number, number, number] = [35, 45, 100];

/** A card on the maze mat above the sheet's top edge, `gapMm` clear of it. */
function onMaze(
  gapMm: number,
  extra: Partial<LabCardScene> = {},
): LabCardScene {
  return {
    width: 900,
    height: 1200,
    fPx: 1000,
    tiltDeg: 5,
    azimuthDeg: 70,
    yawDeg: 2,
    heightMm: 380,
    aimMm: { x: 105, y: 110 },
    paperOriginMm: { x: 0, y: 0 },
    cardCentreMm: { x: 100, y: -ID1_SHORT_MM / 2 - gapMm },
    cardAngleDeg: 0,
    cardRgb: [61, 95, 159],
    cardStripe: false,
    cardLogo: true,
    background: "maze",
    blurSigmaPx: 0.8,
    noiseSigma: 2,
    seed: 7,
    ...extra,
  };
}

/**
 * Kirby's red card front: red body, 5 mm navy band along its top long side,
 * a thin gold line between them (it keeps the red and navy colour regions
 * from touching, so L6's joined region pairs do not make the card whole).
 */
const redFront: Partial<LabCardScene> = {
  cardRgb: RED,
  cardLogo: false,
  cardBand: {
    widthMm: 5,
    rgb: NAVY,
    line: { widthMm: 0.8, rgb: [200, 170, 110] },
  },
};

function paperQuad(r: ReturnType<typeof renderLabCardScene>): Quad {
  return orderQuadCorners(r.paperCornersPx as unknown as Quad);
}

describe("L7: a card with a band of another colour", () => {
  it("red body + navy band beside the sheet: the outline takes in the band", () => {
    const r = renderLabCardScene(onMaze(6, redFront));
    const d = detectCard(r, {
      paperCorners: paperQuad(r),
      placement: "beside-paper",
    });
    if (!d.ok) console.log(`[L7] band, sheet: ${d.failure}`);
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    const err = cornerErrorsPx(d.corners, r.cardCornersPx as Pt[]);
    console.log(`[L7] band, sheet: max corner error ${err.max.toFixed(3)} px`);
    expect(err.max).toBeLessThan(1);
  });

  it("the same card with no sheet given is found whole too", () => {
    const r = renderLabCardScene(onMaze(6, redFront));
    const d = detectCard(r, { focalPx: 1000 });
    if (!d.ok) console.log(`[L7] band, no sheet: ${d.failure}`);
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    const err = cornerErrorsPx(d.corners, r.cardCornersPx as Pt[]);
    console.log(
      `[L7] band, no sheet: max corner error ${err.max.toFixed(3)} px`,
    );
    expect(err.max).toBeLessThan(1);
  });
});

describe("L7: no sheet, a card on the patterned mat", () => {
  it("a blue card back on the maze mat is found, corners within 1 px", () => {
    const r = renderLabCardScene(onMaze(6));
    const d = detectCard(r, { placement: "beside-paper", focalPx: 1000 });
    if (!d.ok) console.log(`[L7] maze, no sheet: ${d.failure}`);
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    const err = cornerErrorsPx(d.corners, r.cardCornersPx as Pt[]);
    console.log(
      `[L7] maze, no sheet: max corner error ${err.max.toFixed(3)} px`,
    );
    expect(err.max).toBeLessThan(1);
  });

  it("with no card, neither the sheet nor anything on the mat is reported as one", () => {
    const r = renderLabCardScene(onMaze(6, { cardCentreMm: null }));
    const d = detectCard(r, { focalPx: 1000 });
    expect(d.ok).toBe(false);
  });
});

describe("L7: a whole card is not card_clipped", () => {
  it("no sheet: a whole card on the maze mat is not card_clipped", () => {
    const r = renderLabCardScene(onMaze(6, redFront));
    const d = detectCard(r, { focalPx: 1000 });
    if (!d.ok) expect(d.failure).not.toBe("card_clipped");
    expect(d.ok).toBe(true);
  });

  it("with the sheet: a whole two-colour card near the frame's top is not card_clipped", () => {
    // The card's top edge about 25 px below the frame's top.
    const r = renderLabCardScene(
      onMaze(6, { ...redFront, aimMm: { x: 105, y: 150 } }),
    );
    const top = Math.min(...(r.cardCornersPx as Pt[]).map((p) => p.y));
    expect(top).toBeGreaterThan(10);
    const d = detectCard(r, {
      paperCorners: paperQuad(r),
      placement: "beside-paper",
    });
    if (!d.ok)
      console.log(
        `[L7] near the top: ${d.failure} (card top ${top.toFixed(0)} px)`,
      );
    if (!d.ok) expect(d.failure).not.toBe("card_clipped");
    expect(d.ok).toBe(true);
  });
});
