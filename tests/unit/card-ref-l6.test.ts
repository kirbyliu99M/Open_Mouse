/**
 * Scan Lab L6 (2026-11-01): Kirby's third round put a Toastmasters card back
 * on the table just above the sheet's top edge. Rendered scenes for the four
 * things that went wrong there: a card pushed under the sheet
 * (`card_under_paper`), a card-shaped outline the sheet says is the wrong
 * size (`size_mismatch`), a card whose glare end split its colour region
 * (`coarse.ts` step 8), and the table-plane measure itself (`planeCheck.ts`).
 */
import { describe, expect, it } from "vitest";
import { detectCard, type Quad } from "../../src/client/card/detect/detectCard";
import { cardOnPaperPlane } from "../../src/client/card/detect/planeCheck";
import { orderQuadCorners } from "../../src/client/paper/quad-math";
import {
  cornerErrorsPx,
  renderLabCardScene,
  type LabCardScene,
  type Pt,
} from "./helpers/card-scene";

const ID1_SHORT_MM = 53.98;

/**
 * Card back (dark blue, white logo) on wood, long side along the sheet's top
 * edge, its bottom edge exactly on that edge (`gapMm` 0), above the sheet.
 */
function aboveSheet(
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
    background: "wood",
    blurSigmaPx: 0.8,
    noiseSigma: 2,
    seed: 11,
    ...extra,
  };
}

function paperQuad(r: ReturnType<typeof renderLabCardScene>): Quad {
  return orderQuadCorners(r.paperCornersPx as unknown as Quad);
}

describe("L6: card under the sheet", () => {
  it("a card with 8 mm of its short side under the sheet -> card_under_paper", () => {
    const r = renderLabCardScene(aboveSheet(-8, { paperOverCard: true }));
    const d = detectCard(r, {
      paperCorners: paperQuad(r),
      placement: "beside-paper",
    });
    console.log(`[L6] 8 mm under the sheet: ${d.ok ? "found" : d.failure}`);
    expect(d).toMatchObject({ ok: false, failure: "card_under_paper" });
  });

  it("a card with 3 mm under the sheet -> card_under_paper (past the 3 % margin)", () => {
    const r = renderLabCardScene(aboveSheet(-3, { paperOverCard: true }));
    const d = detectCard(r, {
      paperCorners: paperQuad(r),
      placement: "beside-paper",
    });
    console.log(`[L6] 3 mm under the sheet: ${d.ok ? "found" : d.failure}`);
    expect(d).toMatchObject({ ok: false, failure: "card_under_paper" });
  });

  it("the same card touching the sheet's edge, not under it, is found", () => {
    const r = renderLabCardScene(aboveSheet(0, { paperOverCard: true }));
    const d = detectCard(r, {
      paperCorners: paperQuad(r),
      placement: "beside-paper",
    });
    if (!d.ok) console.log(`[L6] touching: ${d.failure}`);
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    const err = cornerErrorsPx(d.corners, r.cardCornersPx as Pt[]);
    console.log(
      `[L6] touching the sheet: max corner error ${err.max.toFixed(3)} px`,
    );
    expect(err.max).toBeLessThan(0.5);
  });
});

describe("L6: a strip of table between the card and the sheet", () => {
  it.each([1, 2, 3])(
    "a card %d mm from the sheet's edge is fitted on its own edge, not the sheet's (corners within 0.6 px)",
    (gapMm) => {
      // Within the masked band the card's side is laid on the sheet's edge
      // line (L5); the fit must then take the card's edge, the first one met
      // from the card's side, not the sheet's stronger edge just beyond it.
      const r = renderLabCardScene(aboveSheet(gapMm));
      const d = detectCard(r, {
        paperCorners: paperQuad(r),
        placement: "beside-paper",
      });
      if (!d.ok) console.log(`[L6] gap ${gapMm} mm: ${d.failure}`);
      expect(d.ok).toBe(true);
      if (!d.ok) return;
      const err = cornerErrorsPx(d.corners, r.cardCornersPx as Pt[]);
      console.log(
        `[L6] gap ${gapMm} mm: max corner error ${err.max.toFixed(3)} px`,
      );
      expect(err.max).toBeLessThan(0.6);
    },
  );
});

describe("L6: the sheet measures the card", () => {
  it("a card-shaped outline that is not the card's size on the table -> size_mismatch", () => {
    // The person said the card is 100 x 63.06 mm (ID-1's aspect, 17 % bigger);
    // the photo holds an ID-1 card. The outline is card-shaped in the image
    // (as 13-09-10's false card was), but the sheet measures it at 85.6 mm.
    const r = renderLabCardScene(aboveSheet(4));
    const d = detectCard(r, {
      paperCorners: paperQuad(r),
      placement: "beside-paper",
      cardSizeMm: { longMm: 100, shortMm: 63.06 },
    });
    console.log(`[L6] wrong card size: ${d.ok ? "found" : d.failure}`);
    expect(d).toMatchObject({ ok: false, failure: "size_mismatch" });
  });

  it("the right card size is found in the same photo", () => {
    const r = renderLabCardScene(aboveSheet(4));
    const d = detectCard(r, {
      paperCorners: paperQuad(r),
      placement: "beside-paper",
      cardSizeMm: { longMm: 85.6, shortMm: 53.98 },
    });
    expect(d.ok).toBe(true);
  });

  it("cardOnPaperPlane: an ID-1 card on the table measures 85.6 x 53.98, right angles, orientation agrees", () => {
    const r = renderLabCardScene(aboveSheet(4));
    const card = orderQuadCorners(r.cardCornersPx as unknown as Quad);
    const pc = cardOnPaperPlane(card, paperQuad(r), 297, 210);
    expect(pc).not.toBeNull();
    if (!pc) return;
    expect(pc.longMm).toBeCloseTo(85.6, 1);
    expect(pc.shortMm).toBeCloseTo(53.98, 1);
    expect(pc.maxAngleErrorDeg).toBeLessThan(0.1);
    expect(pc.planeLongSideFirst).toBe(pc.pixelLongSideFirst);
  });

  it("cardOnPaperPlane: a quad squashed across the view flags the long-side disagreement", () => {
    // Pixel long side vertical, table long side horizontal: what the record
    // calls orientation.disagrees.
    const paper: Quad = [
      { x: 0, y: 0 },
      { x: 210, y: 0 },
      { x: 210, y: 297 },
      { x: 0, y: 297 },
    ];
    const squashed: Quad = [
      { x: 300, y: 0 },
      { x: 340, y: 0 },
      { x: 340, y: 60 },
      { x: 300, y: 60 },
    ];
    const pc = cardOnPaperPlane(squashed, paper, 297, 210);
    expect(pc).not.toBeNull();
    expect(pc?.pixelLongSideFirst).toBe(false);
    expect(pc?.planeLongSideFirst).toBe(false);
    // A sheet whose long side runs across the image instead: the same pixels
    // read as a wide quad on the table.
    const pc2 = cardOnPaperPlane(squashed, paper, 297, 210, true);
    expect(pc2?.planeLongSideFirst).toBe(true);
    expect(pc2?.pixelLongSideFirst).toBe(false);
  });
});

describe("L6: glare at one end of the card", () => {
  it("a card 110 grey levels brighter at one end is still found, corners within 0.5 px", () => {
    // Kirby's 13-08-44: the colour region stopped short of the glare end and
    // the coarse right side sat up to 29 px inside the card (edge_fit_failed).
    const r = renderLabCardScene(aboveSheet(6, { cardGlare: 110 }));
    const d = detectCard(r, {
      paperCorners: paperQuad(r),
      placement: "beside-paper",
    });
    if (!d.ok) console.log(`[L6] glare: ${d.failure}`);
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    const err = cornerErrorsPx(d.corners, r.cardCornersPx as Pt[]);
    console.log(`[L6] glare: max corner error ${err.max.toFixed(3)} px`);
    expect(err.max).toBeLessThan(0.5);
  });
});
