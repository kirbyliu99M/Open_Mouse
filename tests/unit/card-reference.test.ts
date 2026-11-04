/**
 * v3.4 card reference (candidate 未拍板): the product-side pieces around the
 * ported lab detector — the card-only measurement, the two-pass search, the
 * photo analysis, the live G-M2 step and the submission.
 */
import { describe, expect, it, vi } from "vitest";
import {
  calibrationMethodOf,
  scanSubmissionSchema,
} from "../../src/lib/contracts/measurement";
import { landmarkHeightsMm } from "../../src/client/geometry/parallax";
import { applyHomography } from "../../src/client/geometry/homography";
import {
  NOMINAL_FOCAL_EQUIV_MM,
  nominalFocalPxFromLongEdge,
} from "../../src/client/geometry/nominalFocalShadow";
import {
  CARD_LAB_SCALE,
  cardOnlyHomography,
  measureHandWithCard,
} from "../../src/client/card/cardHandMeasure";
import {
  cropPrincipalPoint,
  detectCardInPasses,
  tiltDegFromSensor,
} from "../../src/client/card/cardReference";
import {
  analyseCardPhoto,
  cardPhotoIntrinsics,
} from "../../src/client/card/cardPhoto";
import {
  cardFailureText,
  cardHintKey,
  evaluateCardLive,
  toViewHand,
} from "../../src/client/card/cardLive";
import {
  buildCardSubmission,
  cardFitMm,
} from "../../src/client/card/cardSubmission";
import type { CardDetection } from "../../src/client/card/detect/detectCard";
import { cardReferenceCopy } from "../../src/lib/copy/card-reference";
import { renderLabCardScene, type Pt } from "./helpers/card-scene";

// ── A synthetic right hand, palm down, fingers up the picture ──────────────

function tableHand(): Pt[] {
  const p: Pt[] = [];
  p[0] = { x: 0, y: 0 };
  p[1] = { x: -22, y: -25 };
  p[2] = { x: -35, y: -45 };
  p[3] = { x: -42, y: -65 };
  p[4] = { x: -48, y: -85 };
  const finger = (base: number, x: number, lens: number[]) => {
    let y = -95;
    p[base] = { x, y };
    for (let i = 0; i < 3; i++) {
      y -= lens[i];
      p[base + i + 1] = { x, y };
    }
  };
  finger(5, -22, [42, 25, 20]);
  finger(9, 0, [47, 28, 15]);
  finger(13, 18, [44, 26, 20]);
  finger(17, 34, [34, 20, 18]);
  return p;
}

const W = 1080;
const H = 1920;
const F = nominalFocalPxFromLongEdge(H, NOMINAL_FOCAL_EQUIV_MM) as number;
const CAM_MM = 420;
/** Straight down, aimed at table (0, 0): a table point at `h` mm up → image px. */
const project = (p: Pt, h = 0): Pt => ({
  x: W / 2 + (F * p.x) / (CAM_MM - h),
  y: H / 2 + (F * p.y) / (CAM_MM - h),
});
const ID1 = { longMm: 85.6, shortMm: 53.98 };
// Card upright in the G-M2 slot (right hand: view x 0.68-0.90, y 0.26-0.58).
const CARD_CENTRE = {
  x: ((0.79 * W - W / 2) * CAM_MM) / F,
  y: ((0.42 * H - H / 2) * CAM_MM) / F,
};
const cardTable: Pt[] = [
  { x: CARD_CENTRE.x - ID1.shortMm / 2, y: CARD_CENTRE.y - ID1.longMm / 2 },
  { x: CARD_CENTRE.x + ID1.shortMm / 2, y: CARD_CENTRE.y - ID1.longMm / 2 },
  { x: CARD_CENTRE.x + ID1.shortMm / 2, y: CARD_CENTRE.y + ID1.longMm / 2 },
  { x: CARD_CENTRE.x - ID1.shortMm / 2, y: CARD_CENTRE.y + ID1.longMm / 2 },
];
const cardPx = cardTable.map((p) => project(p)) as [Pt, Pt, Pt, Pt];
// Wrist 120 mm below the centre, 40 mm left: the hand left of the slot.
const handTable = tableHand().map((p) => ({ x: p.x - 40, y: p.y + 120 }));
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const trueLength = dist(handTable[0], handTable[12]);
const trueWidth = dist(handTable[5], handTable[17]);
const heights = landmarkHeightsMm(trueLength);
const handPx = handTable.map((p, i) => project(p, heights[i]));
const intrinsics = { fPx: F, cx: W / 2, cy: H / 2 };

describe("card-only measurement (cardHandMeasure.ts)", () => {
  it("recovers the parallax-corrected hand and applies the card scale to the length only", () => {
    const r = measureHandWithCard({
      landmarksPx: handPx,
      cardCorners: cardPx,
      intrinsics,
      cardSize: ID1,
    });
    expect(r.error).toBe(null);
    expect(Math.abs(r.correctedLengthMm! - trueLength)).toBeLessThan(0.1);
    expect(Math.abs(r.correctedWidthMm! - trueWidth)).toBeLessThan(0.1);
    expect(r.measurements!.handLengthMm).toBeCloseTo(
      r.correctedLengthMm! * CARD_LAB_SCALE.handLength,
      6,
    );
    expect(r.measurements!.palmWidthMm).toBeCloseTo(r.correctedWidthMm!, 6);
    expect(r.cameraHeightMm!).toBeCloseTo(CAM_MM, 0);
    // The same shape as the paper path's measurements.
    expect(r.measurements!.palmLengthMm).toBeGreaterThan(0);
    expect(r.measurements!.middleLengthMm).toBeGreaterThan(0);
  });

  it("the scale is the lab's 1.038 on the length, 1 on the width", () => {
    expect(CARD_LAB_SCALE.handLength).toBe(1.038);
    expect(CARD_LAB_SCALE.handWidth).toBe(1);
  });

  it("maps the card to its true size whichever corner the quad starts at", () => {
    const turned = [cardPx[1], cardPx[2], cardPx[3], cardPx[0]] as const;
    const h = cardOnlyHomography(turned, ID1);
    const m = turned.map((p) => applyHomography(h, p));
    const a = dist(m[0], m[1]);
    const b = dist(m[1], m[2]);
    expect(Math.min(a, b)).toBeCloseTo(53.98, 3);
    expect(Math.max(a, b)).toBeCloseTo(85.6, 3);
  });

  it("says why instead of throwing on a degenerate card", () => {
    const flat = [cardPx[0], cardPx[0], cardPx[0], cardPx[0]] as const;
    const r = measureHandWithCard({
      landmarksPx: handPx,
      cardCorners: flat,
      intrinsics,
      cardSize: ID1,
    });
    expect(r.measurements).toBe(null);
    expect(r.error).not.toBe(null);
  });
});

describe("two-pass card search (cardReference.ts)", () => {
  const found = { ok: true } as unknown as CardDetection;
  const missed = {
    ok: false,
    failure: "no_candidate",
  } as unknown as CardDetection;
  const slot = { x: 1, y: 2, width: 3, height: 4 };
  const side = { x: 5, y: 6, width: 7, height: 8 };

  it("no slot: one pass, whole frame, hand-side box for the lines", () => {
    const detect = vi.fn(() => missed);
    const r = detectCardInPasses(detect, null, side);
    expect(detect).toHaveBeenCalledTimes(1);
    expect(detect).toHaveBeenCalledWith({
      searchRegion: null,
      linesRegion: side,
    });
    expect(r.searchPass).toBe(null);
  });

  it("slot finds it: one pass", () => {
    const detect = vi.fn(() => found);
    const r = detectCardInPasses(detect, slot, side);
    expect(detect).toHaveBeenCalledTimes(1);
    expect(r.searchPass).toBe("slot");
  });

  it("slot misses: the hand-side pass runs and is kept", () => {
    const detect = vi
      .fn<(b: unknown) => CardDetection>()
      .mockReturnValueOnce(missed)
      .mockReturnValueOnce(found);
    const r = detectCardInPasses(detect, slot, side);
    expect(detect).toHaveBeenCalledTimes(2);
    expect(r.searchPass).toBe("hand-side");
    expect(r.slotFailure).toBe("no_candidate");
    expect(r.detection.ok).toBe(true);
  });

  it("principal point of a crop, and the window tilt", () => {
    expect(
      cropPrincipalPoint({ width: 1080, height: 1920 }, { x: 0, y: 76 }),
    ).toEqual({ cx: 540, cy: 884 });
    expect(tiltDegFromSensor(null)).toBe(null);
  });

  it("nominal intrinsics: 18 mm on the stream's long edge, crop principal point", () => {
    const k = cardPhotoIntrinsics(
      { width: 1080, height: 1768 },
      { stream: { width: 1080, height: 1920 }, crop: { x: 0, y: 76 } },
    )!;
    expect(k.fPx).toBeCloseTo(F, 6);
    expect(k.cy).toBe(884);
    const own = cardPhotoIntrinsics({ width: 1080, height: 1920 }, null)!;
    expect(own.cx).toBe(540);
  });
});

describe("one card photo (cardPhoto.ts)", () => {
  // The card rendered where `cardPx` is (straight down, same camera).
  const scene = renderLabCardScene({
    width: W,
    height: H,
    fPx: F,
    tiltDeg: 0,
    azimuthDeg: 0,
    heightMm: CAM_MM,
    aimMm: { x: 0, y: 0 },
    cardCentreMm: CARD_CENTRE,
    cardAngleDeg: 90,
    cardRgb: [235, 235, 230],
    background: "wood",
  });
  const image = { width: scene.width, height: scene.height, data: scene.data };
  const base = {
    image,
    selectedHand: "right" as const,
    handExplicit: false,
    sensor: null,
    frame: null,
    locale: "zh-TW" as const,
  };

  it("finds the card in the slot, measures, and builds a valid submission", () => {
    const out = analyseCardPhoto({
      ...base,
      hand: { landmarksPx: handPx, handedness: "right", confidence: 0.95 },
    });
    expect(out.result.status).toBe("ok");
    if (out.result.status !== "ok") return;
    expect(out.diagnostics.searchPass).toBe("slot");
    expect(
      Math.abs(out.diagnostics.correctedLengthMm! - trueLength),
    ).toBeLessThan(1);
    expect(scanSubmissionSchema.safeParse(out.result.submission).success).toBe(
      true,
    );
    expect(out.result.overlay.paperCorners).toHaveLength(4);
    // No sensor: nothing waited for it.
    expect(out.diagnostics.tiltDeg).toBe(null);
  });

  it("no hand: HAND_NOT_DETECTED", () => {
    const out = analyseCardPhoto({ ...base, hand: null });
    expect(out.result.status).toBe("error");
    if (out.result.status === "error")
      expect(out.result.errors[0].code).toBe("HAND_NOT_DETECTED");
  });

  it("no card: CARD_NOT_FOUND with the retake line", () => {
    const blank = renderLabCardScene({
      width: W,
      height: H,
      fPx: F,
      tiltDeg: 0,
      azimuthDeg: 0,
      heightMm: CAM_MM,
      aimMm: { x: 0, y: 0 },
      cardCentreMm: null,
      background: "wood",
    });
    const out = analyseCardPhoto({
      ...base,
      image: { width: blank.width, height: blank.height, data: blank.data },
      hand: { landmarksPx: handPx, handedness: "right", confidence: 0.95 },
    });
    expect(out.result.status).toBe("error");
    if (out.result.status === "error") {
      expect(out.result.errors[0].code).toBe("CARD_NOT_FOUND");
      expect(out.result.errors[0].message.length).toBeGreaterThan(0);
    }
  });
});

describe("live G-M2 step (cardLive.ts)", () => {
  const copy = cardReferenceCopy("zh-TW");

  it("maps sample px to view 0..1", () => {
    const h = toViewHand(handPx, { width: W, height: H }, 5)!;
    expect(h.points[0].x).toBeCloseTo(handPx[0].x / W, 9);
    expect(toViewHand([], { width: W, height: H }, 5)).toBe(null);
  });

  it("no hand: the ring may not fill and the hint asks for the hand", () => {
    const step = evaluateCardLive({
      hand: null,
      previousHand: null,
      side: "right",
      view: { width: W, height: H },
      tiltDeg: null,
      detectorReady: true,
      nowMs: 0,
    });
    expect(step.passing).toBe(false);
    expect(cardHintKey(step.problem)).toBe("hintNoHand");
    // The overlay keeps the centre tick and the card slot.
    expect(
      step.evaluation.overlay.some((s) => s.kind === "line" && s.dashed),
    ).toBe(true);
    expect(
      step.evaluation.overlay.some((s) => s.kind === "zone" && s.card),
    ).toBe(true);
  });

  it("a missing tilt sensor never holds the ring", () => {
    const step = evaluateCardLive({
      hand: null,
      previousHand: null,
      side: "right",
      view: { width: W, height: H },
      tiltDeg: null,
      detectorReady: true,
      nowMs: 0,
    });
    const tilt = step.evaluation.checks.find((c) => c.id === "tilt")!;
    expect(tilt.blocks).toBe(false);
  });

  it("every hint and failure has words", () => {
    expect(cardHintKey(null)).toBe("hintOk");
    expect(
      cardHintKey({
        id: "distance",
        level: "fail",
        blocks: true,
        hint: "手機再拿高一點",
      }),
    ).toBe("hintHigher");
    expect(
      cardHintKey({
        id: "wrist",
        level: "fail",
        blocks: true,
        hint: "手往下移一點",
      }),
    ).toBe("hintWristDown");
    expect(cardFailureText("card_blends_background", copy)).toBe(
      copy.failCardBlends,
    );
    expect(cardFailureText(null, copy)).toBe(copy.failNoCard);
  });

  it("the card rule asks for a light, standard, back-up card and never a credit card", () => {
    for (const c of [cardReferenceCopy("zh-TW"), cardReferenceCopy("en")]) {
      expect(c.cardRule).not.toMatch(/信用卡|credit/i);
    }
    expect(copy.cardRule).toMatch(/背面朝上/);
    expect(copy.cardRule).toMatch(/名片/);
  });
});

describe("card submission (cardSubmission.ts)", () => {
  const m = () =>
    measureHandWithCard({
      landmarksPx: handPx,
      cardCorners: cardPx,
      intrinsics,
      cardSize: ID1,
    }).measurements!;

  it("is a valid scan submission with card-edge evidence", () => {
    const s = buildCardSubmission({
      hand: "right",
      measurements: m(),
      cardSize: ID1,
      searchPass: "slot",
      cardFitRmsMm: 0.3,
    });
    expect(scanSubmissionSchema.safeParse(s).success).toBe(true);
    expect(s.calibration).toEqual({
      method: "card-edge",
      cardSizeMm: { longMm: 85.6, shortMm: 53.98 },
      searchPass: "slot",
      cardFitRmsMm: 0.3,
      parallaxCorrected: true,
      focalSource: "nominal",
    });
    expect(calibrationMethodOf(s.calibration)).toBe("card-edge");
  });

  it("puts the edge residual in mm at the card's scale", () => {
    // Long side 200 px for 85.6 mm: 2 px is 0.856 mm.
    const q = [
      { x: 0, y: 0 },
      { x: 126.12, y: 0 },
      { x: 126.12, y: 200 },
      { x: 0, y: 200 },
    ];
    expect(cardFitMm(2, q, ID1)).toBeCloseTo(0.856, 6);
    expect(cardFitMm(2, q.slice(0, 3), ID1)).toBe(null);
  });
});
