import { describe, expect, it } from "vitest";
import {
  GUIDE_INSETS,
  MEASURED_LAYOUT,
  applyMeasuredTransform,
  boundingRect,
  clampInto,
  computeFrozenPhotoLayout,
  computeGuideRect,
  computeMeasuredTransform,
  computeOverlayToStill,
  computeResultFocusRect,
  overlayUnitsPerPx,
  overlayVisibleRect,
  computeStillCrop,
  padRect,
  paperAspect,
  photoPointToStage,
  rectCorners,
} from "../../src/client/camera/photoLayout";
import { computeCoverRect } from "../../src/client/camera/quad";
import { computeDownscaleSize } from "../../src/client/photo/decode";

const STAGE = { width: 390, height: 844 };

describe("computeGuideRect", () => {
  it("is a centred A4 portrait sheet between the top bar and the shutter row", () => {
    const guide = computeGuideRect(STAGE, paperAspect("a4"));
    expect(guide.width).toBeCloseTo(390 * 0.85, 6);
    expect(guide.height / guide.width).toBeCloseTo(297 / 210, 6);
    expect(guide.x).toBeCloseTo((390 - guide.width) / 2, 6);
    // The storyboard's guide runs from about y=166 to y=640 on this stage.
    expect(guide.y).toBeGreaterThan(150);
    expect(guide.y + guide.height).toBeLessThan(844 - 190);
    expect(guide.y).toBeCloseTo(166, -1);
  });

  it("letter paper is a little shorter", () => {
    const a4 = computeGuideRect(STAGE, paperAspect("a4"));
    const letter = computeGuideRect(STAGE, paperAspect("letter"));
    expect(letter.height).toBeLessThan(a4.height);
    expect(letter.height / letter.width).toBeCloseTo(279.4 / 215.9, 6);
  });

  it("is the same rectangle every time for the same stage and paper: it never moves on its own", () => {
    expect(computeGuideRect(STAGE, 1.4143)).toEqual(
      computeGuideRect({ ...STAGE }, 1.4143),
    );
  });

  it("shrinks to fit a short stage instead of running under the bars", () => {
    const guide = computeGuideRect({ width: 390, height: 640 }, 1.4143);
    expect(guide.y).toBeGreaterThanOrEqual(GUIDE_INSETS.topPx);
    expect(guide.y + guide.height).toBeLessThanOrEqual(
      640 - GUIDE_INSETS.bottomPx + 1e-9,
    );
    expect(guide.height / guide.width).toBeCloseTo(1.4143, 6);
  });

  it("falls back to the inset stage when there is no room for the bars (landscape)", () => {
    const guide = computeGuideRect({ width: 844, height: 390 }, 1.4143);
    expect(guide.x).toBeGreaterThan(0);
    expect(guide.y).toBeGreaterThan(0);
    expect(guide.x + guide.width).toBeLessThan(844);
    expect(guide.y + guide.height).toBeLessThan(390);
  });

  it("rejects a stage without a size", () => {
    expect(() => computeGuideRect({ width: 0, height: 10 }, 1.4)).toThrow(
      RangeError,
    );
    expect(() => computeGuideRect(STAGE, 0)).toThrow(RangeError);
  });

  it("rectCorners lists TL, TR, BR, BL", () => {
    expect(rectCorners({ x: 1, y: 2, width: 10, height: 20 })).toEqual([
      { x: 1, y: 2 },
      { x: 11, y: 2 },
      { x: 11, y: 22 },
      { x: 1, y: 22 },
    ]);
  });
});

describe("computeStillCrop — the still is cropped to what the stream showed", () => {
  it("the same aspect ratio: the whole still", () => {
    expect(
      computeStillCrop(
        { width: 1080, height: 1920 },
        { width: 2160, height: 3840 },
      ),
    ).toEqual({ x: 0, y: 0, width: 2160, height: 3840 });
  });

  it("a 3:4 portrait still under a 9:16 portrait preview: the same height, less width", () => {
    const crop = computeStillCrop(
      { width: 1080, height: 1920 },
      { width: 3000, height: 4000 },
    );
    expect(crop.height).toBe(4000);
    expect(crop.width).toBeCloseTo(4000 * (1080 / 1920), 6);
    expect(crop.x).toBeCloseTo((3000 - crop.width) / 2, 6);
    expect(crop.y).toBe(0);
    expect(crop.width / crop.height).toBeCloseTo(1080 / 1920, 9);
  });

  it("a relatively taller still keeps its width and loses height", () => {
    const crop = computeStillCrop(
      { width: 1600, height: 1200 }, // 4:3
      { width: 1000, height: 1000 }, // square
    );
    expect(crop.width).toBe(1000);
    expect(crop.height).toBeCloseTo(750, 6);
    expect(crop.y).toBeCloseTo(125, 6);
    expect(crop.x).toBe(0);
  });

  it("is centred, so it stays inside the still", () => {
    for (const [sw, sh, tw, th] of [
      [1080, 1920, 3000, 4000],
      [1920, 1080, 4000, 3000],
      [720, 1280, 3024, 4032],
      [1000, 1000, 500, 1500],
    ] as const) {
      const crop = computeStillCrop(
        { width: sw, height: sh },
        { width: tw, height: th },
      );
      expect(crop.x).toBeGreaterThanOrEqual(0);
      expect(crop.y).toBeGreaterThanOrEqual(0);
      expect(crop.x + crop.width).toBeLessThanOrEqual(tw + 1e-9);
      expect(crop.y + crop.height).toBeLessThanOrEqual(th + 1e-9);
      expect(crop.width / crop.height).toBeCloseTo(sw / sh, 9);
    }
  });

  it("treats aspect ratios within 0.001 as the same", () => {
    const crop = computeStillCrop(
      { width: 1000, height: 1000 },
      { width: 1000, height: 1000.5 },
    );
    expect(crop).toEqual({ x: 0, y: 0, width: 1000, height: 1000.5 });
  });
});

describe("computeFrozenPhotoLayout — the frozen picture is the last live frame", () => {
  it("with a stream: the box is exactly where the video's cover rectangle was", () => {
    const stream = { width: 1080, height: 1920 };
    const layout = computeFrozenPhotoLayout({
      stage: STAGE,
      stream,
      still: { width: 3000, height: 4000 },
    });
    expect(layout.box).toEqual(
      computeCoverRect(STAGE.width, STAGE.height, stream.width, stream.height),
    );
    expect(layout.crop).toEqual(
      computeStillCrop(stream, { width: 3000, height: 4000 }),
    );
  });

  it("the same scene lands on the same stage pixel in the live frame and in the photo", () => {
    // A point at the centre of the stream frame, and one a quarter across.
    const stream = { width: 1080, height: 1920 };
    const still = { width: 3000, height: 4000 };
    const layout = computeFrozenPhotoLayout({ stage: STAGE, stream, still });
    const cover = computeCoverRect(
      STAGE.width,
      STAGE.height,
      stream.width,
      stream.height,
    );
    for (const [u, v] of [
      [0.5, 0.5],
      [0.25, 0.75],
      [0.9, 0.1],
    ] as const) {
      // Where the video shows the point (u, v) of its frame...
      const live = {
        x: cover.x + u * cover.width,
        y: cover.y + v * cover.height,
      };
      // ...and where the photo shows the same point (u, v) of the cropped still.
      const inStill = {
        x: layout.crop.x + u * layout.crop.width,
        y: layout.crop.y + v * layout.crop.height,
      };
      const frozen = photoPointToStage(inStill, layout);
      expect(frozen.x).toBeCloseTo(live.x, 6);
      expect(frozen.y).toBeCloseTo(live.y, 6);
    }
  });

  it("the stage does not appear in the result's size: the box covers it whatever the still's shape", () => {
    const layout = computeFrozenPhotoLayout({
      stage: STAGE,
      stream: { width: 1080, height: 1920 },
      still: { width: 4000, height: 6000 },
    });
    expect(layout.box.x).toBeLessThanOrEqual(0);
    expect(layout.box.y).toBeLessThanOrEqual(0);
    expect(layout.box.x + layout.box.width).toBeGreaterThanOrEqual(390 - 1e-9);
    expect(layout.box.y + layout.box.height).toBeGreaterThanOrEqual(844 - 1e-9);
  });

  it("a photo with no stream (the upload button) is shown whole, fitted inside the stage", () => {
    const still = { width: 4000, height: 3000 };
    const layout = computeFrozenPhotoLayout({
      stage: STAGE,
      stream: null,
      still,
    });
    expect(layout.crop).toEqual({ x: 0, y: 0, width: 4000, height: 3000 });
    expect(layout.box.width).toBeCloseTo(390, 6);
    expect(layout.box.height).toBeCloseTo(390 * 0.75, 6);
    expect(layout.box.x).toBeCloseTo(0, 6);
    expect(layout.box.y).toBeCloseTo((844 - 292.5) / 2, 6);
  });

  it("a still whose orientation disagrees with the stream cannot be matched: shown whole", () => {
    const layout = computeFrozenPhotoLayout({
      stage: STAGE,
      stream: { width: 1080, height: 1920 },
      still: { width: 4000, height: 3000 },
    });
    expect(layout.crop).toEqual({ x: 0, y: 0, width: 4000, height: 3000 });
    expect(layout.box.width).toBeCloseTo(390, 6);
  });

  it("ignores a stream without a size", () => {
    const layout = computeFrozenPhotoLayout({
      stage: STAGE,
      stream: { width: 0, height: 0 },
      still: { width: 3000, height: 4000 },
    });
    expect(layout.crop).toEqual({ x: 0, y: 0, width: 3000, height: 4000 });
  });

  it("rejects a stage or still without a size", () => {
    expect(() =>
      computeFrozenPhotoLayout({
        stage: { width: 0, height: 844 },
        stream: null,
        still: { width: 1, height: 1 },
      }),
    ).toThrow(RangeError);
    expect(() =>
      computeFrozenPhotoLayout({
        stage: STAGE,
        stream: null,
        still: { width: 1, height: 0 },
      }),
    ).toThrow(RangeError);
  });
});

describe("boundingRect and padRect", () => {
  it("wraps the points", () => {
    expect(
      boundingRect([
        { x: 5, y: 9 },
        { x: -2, y: 4 },
        { x: 7, y: 6 },
      ]),
    ).toEqual({ x: -2, y: 4, width: 9, height: 5 });
    expect(boundingRect([])).toBeNull();
  });

  it("grows a rectangle on every side", () => {
    expect(padRect({ x: 10, y: 10, width: 20, height: 30 }, 4)).toEqual({
      x: 6,
      y: 6,
      width: 28,
      height: 38,
    });
  });
});

describe("computeMeasuredTransform — nothing under the sheet", () => {
  // The paper on the storyboard's stage, and a sheet about 240 px tall.
  const paper = { x: 30, y: 166, width: 332, height: 474 };
  const sheetTop = 844 - 240;

  it("scales to 90% and moves the paper up, clear of the sheet and of the top buttons", () => {
    const t = computeMeasuredTransform({
      stage: STAGE,
      focus: paper,
      sheetTop,
    });
    expect(t.scale).toBe(0.9);
    expect(t.translateY).toBeLessThan(0);
    const top = applyMeasuredTransform({ x: paper.x, y: paper.y }, STAGE, t);
    const bottom = applyMeasuredTransform(
      { x: paper.x + paper.width, y: paper.y + paper.height },
      STAGE,
      t,
    );
    expect(top.y).toBeGreaterThanOrEqual(MEASURED_LAYOUT.topInsetPx);
    expect(bottom.y).toBeLessThanOrEqual(sheetTop - MEASURED_LAYOUT.sheetGapPx);
    // Storyboard screen 6 shows the paper from about y=109 to y=537; centring
    // it in the free band gives 121 to 547 (candidate numbers either way).
    expect(top.y).toBeCloseTo(120.7, 1);
    expect(bottom.y).toBeCloseTo(547.3, 1);
  });

  it("sits centred in the free band above the sheet", () => {
    const t = computeMeasuredTransform({
      stage: STAGE,
      focus: paper,
      sheetTop,
    });
    const top = applyMeasuredTransform({ x: 0, y: paper.y }, STAGE, t).y;
    const bottom = applyMeasuredTransform(
      { x: 0, y: paper.y + paper.height },
      STAGE,
      t,
    ).y;
    const bandTop = MEASURED_LAYOUT.topInsetPx;
    const bandBottom = sheetTop - MEASURED_LAYOUT.sheetGapPx;
    expect(top - bandTop).toBeCloseTo(bandBottom - bottom, 6);
  });

  it("shrinks further than 90% when the content would not fit the band", () => {
    // Band: 88 to 580 = 492 px. Content 600 px tall fits at 0.82.
    const tall = { x: 0, y: 100, width: 390, height: 600 };
    const t = computeMeasuredTransform({ stage: STAGE, focus: tall, sheetTop });
    expect(t.scale).toBeLessThan(0.9);
    expect(t.scale).toBeGreaterThan(MEASURED_LAYOUT.minScale);
    expect(t.scale).toBeCloseTo(492 / 600, 6);
    const top = applyMeasuredTransform({ x: 0, y: 100 }, STAGE, t).y;
    const bottom = applyMeasuredTransform({ x: 0, y: 700 }, STAGE, t).y;
    expect(top).toBeGreaterThanOrEqual(MEASURED_LAYOUT.topInsetPx - 1e-9);
    expect(bottom).toBeLessThanOrEqual(
      sheetTop - MEASURED_LAYOUT.sheetGapPx + 1e-9,
    );
  });

  it("never goes below 0.4 however tall the sheet: no thumbnail", () => {
    expect(MEASURED_LAYOUT.minScale).toBe(0.4);
    const tall = { x: 0, y: 0, width: 390, height: 844 };
    // A sheet reaching well up the screen (a large system font).
    for (const top of [604, 500, 400, 300, 200, 100, 10]) {
      const t = computeMeasuredTransform({
        stage: STAGE,
        focus: tall,
        sheetTop: top,
      });
      expect(t.scale, `sheet top ${top}`).toBeGreaterThanOrEqual(0.4);
      expect(t.scale, `sheet top ${top}`).toBeLessThanOrEqual(0.9);
    }
    // ...and 0.4 exactly where the content cannot fit at all.
    expect(
      computeMeasuredTransform({ stage: STAGE, focus: tall, sheetTop: 300 })
        .scale,
    ).toBe(0.4);
  });

  describe("large text on a 390x844 screen (sheet capped at 52vh = 439 px, so its top is at 405)", () => {
    // The paper and its checks as the layout sees them: a guide-sized sheet.
    const paper = { x: 30, y: 146, width: 332, height: 514 };
    const sheetTop = 844 - 439;

    it("at 100% text the top bar ends at 58 px and the inset of 88 px stands", () => {
      const t = computeMeasuredTransform({
        stage: STAGE,
        focus: paper,
        sheetTop: 511,
        barBottom: 58,
      });
      const same = computeMeasuredTransform({
        stage: STAGE,
        focus: paper,
        sheetTop: 511,
      });
      expect(t).toEqual(same);
    });

    it("at 200% text the band starts 8 px below a bar that ends at 139 px, and the paper still fits it above the sheet at about 0.46", () => {
      const t = computeMeasuredTransform({
        stage: STAGE,
        focus: paper,
        sheetTop,
        barBottom: 139,
      });
      expect(t.scale).toBeGreaterThan(MEASURED_LAYOUT.minScale);
      expect(t.scale).toBeCloseTo(
        (sheetTop - MEASURED_LAYOUT.sheetGapPx - 147) / 514,
        6,
      );
      const top = applyMeasuredTransform({ x: 0, y: paper.y }, STAGE, t).y;
      const bottom = applyMeasuredTransform(
        { x: 0, y: paper.y + paper.height },
        STAGE,
        t,
      ).y;
      expect(top).toBeGreaterThanOrEqual(147 - 1e-9);
      expect(bottom).toBeLessThanOrEqual(
        sheetTop - MEASURED_LAYOUT.sheetGapPx + 1e-9,
      );
    });

    it("a bar higher than the inset moves the band down; a lower one never moves it up", () => {
      const a = computeMeasuredTransform({
        stage: STAGE,
        focus: paper,
        sheetTop,
        barBottom: 20,
      });
      const b = computeMeasuredTransform({
        stage: STAGE,
        focus: paper,
        sheetTop,
      });
      expect(a).toEqual(b);
    });
  });

  it("at the clamp the content is centred in the band, even if it does not fit it", () => {
    const tall = { x: 0, y: 0, width: 390, height: 844 };
    const t = computeMeasuredTransform({
      stage: STAGE,
      focus: tall,
      sheetTop: 300,
    });
    const top = applyMeasuredTransform({ x: 0, y: 0 }, STAGE, t).y;
    const bottom = applyMeasuredTransform({ x: 0, y: 844 }, STAGE, t).y;
    const bandCentre =
      (MEASURED_LAYOUT.topInsetPx + (300 - MEASURED_LAYOUT.sheetGapPx)) / 2;
    expect((top + bottom) / 2).toBeCloseTo(bandCentre, 6);
  });

  it("with a shorter sheet the photo needs to move less", () => {
    const tall = computeMeasuredTransform({
      stage: STAGE,
      focus: paper,
      sheetTop: 604,
    });
    const short = computeMeasuredTransform({
      stage: STAGE,
      focus: paper,
      sheetTop: 700,
    });
    expect(Math.abs(short.translateY)).toBeLessThan(Math.abs(tall.translateY));
  });

  it("stays defined when the sheet reaches the top (the band never inverts)", () => {
    const t = computeMeasuredTransform({
      stage: STAGE,
      focus: paper,
      sheetTop: 10,
    });
    expect(Number.isFinite(t.scale)).toBe(true);
    expect(Number.isFinite(t.translateY)).toBe(true);
    expect(t.scale).toBeGreaterThan(0);
  });

  it("a rectangle without height keeps the base scale", () => {
    const t = computeMeasuredTransform({
      stage: STAGE,
      focus: { x: 100, y: 300, width: 50, height: 0 },
      sheetTop,
    });
    expect(t.scale).toBe(0.9);
  });

  it("horizontal content only comes closer to the centre", () => {
    const t = computeMeasuredTransform({
      stage: STAGE,
      focus: paper,
      sheetTop,
    });
    const left = applyMeasuredTransform({ x: paper.x, y: 300 }, STAGE, t);
    const right = applyMeasuredTransform(
      { x: paper.x + paper.width, y: 300 },
      STAGE,
      t,
    );
    expect(left.x).toBeGreaterThan(paper.x);
    expect(right.x).toBeLessThan(paper.x + paper.width);
  });
});

describe("computeResultFocusRect — what has to stay above the sheet", () => {
  const stage = { width: 390, height: 844 };
  const layout = {
    box: { x: 0, y: 0, width: 390, height: 844 },
    crop: { x: 0, y: 0, width: 1000, height: (1000 * 844) / 390 },
  };

  it("wraps the paper's corners and the hand, with room for the labels", () => {
    const rect = computeResultFocusRect({
      stage,
      layout,
      overlayToStill: 1,
      overlay: {
        paperCorners: [
          { x: 100, y: 300 },
          { x: 900, y: 300 },
          { x: 900, y: 1700 },
          { x: 100, y: 1700 },
        ],
        landmarksPx: [
          { x: 500, y: 800 },
          { x: 520, y: 1500 },
        ],
      },
      labelAllowancePx: 20,
    });
    const scale = 390 / 1000;
    expect(rect.x).toBeCloseTo(100 * scale - 20, 6);
    expect(rect.y).toBeCloseTo(300 * scale - 20, 6);
    expect(rect.width).toBeCloseTo(800 * scale + 40, 6);
    expect(rect.height).toBeCloseTo(1400 * scale + 40, 6);
  });

  it("maps overlay pixels through the pipeline's scale-down", () => {
    // The pipeline analysed a photo half the size of the still.
    const rect = computeResultFocusRect({
      stage,
      layout,
      overlayToStill: 2,
      overlay: {
        paperCorners: null,
        landmarksPx: [
          { x: 50, y: 100 },
          { x: 250, y: 400 },
        ],
      },
      labelAllowancePx: 0,
    });
    expect(rect.x).toBeCloseTo(100 * 0.39, 6);
    expect(rect.width).toBeCloseTo(400 * 0.39, 6);
  });

  it("follows the crop: points outside it fall outside the stage", () => {
    const cropped = {
      box: { x: -50, y: 0, width: 490, height: 844 },
      crop: { x: 100, y: 0, width: 800, height: 1378 },
    };
    const rect = computeResultFocusRect({
      stage,
      layout: cropped,
      overlayToStill: 1,
      overlay: { landmarksPx: [{ x: 100, y: 0 }], paperCorners: null },
      labelAllowancePx: 0,
    });
    expect(rect.x).toBeCloseTo(-50, 6);
  });

  it("with nothing located, the visible part of the photo", () => {
    expect(
      computeResultFocusRect({
        stage,
        layout: { ...layout, box: { x: -60, y: 20, width: 500, height: 900 } },
        overlayToStill: 1,
        overlay: null,
        labelAllowancePx: 10,
      }),
    ).toEqual({ x: 0, y: 20, width: 390, height: 824 });
  });

  it("with a photo box that misses the stage, the whole stage", () => {
    expect(
      computeResultFocusRect({
        stage,
        layout: { ...layout, box: { x: 0, y: 2000, width: 10, height: 10 } },
        overlayToStill: 1,
        overlay: null,
        labelAllowancePx: 0,
      }),
    ).toEqual({ x: 0, y: 0, width: 390, height: 844 });
  });
});

describe("overlayUnitsPerPx", () => {
  const layout = {
    box: { x: 0, y: 0, width: 400, height: 800 },
    crop: { x: 0, y: 0, width: 2000, height: 4000 },
  };

  it("is how many overlay pixels one screen pixel spans", () => {
    // 2000 still px over 400 screen px: 5 still px per screen px.
    expect(overlayUnitsPerPx(layout, 1, 1)).toBeCloseTo(5, 9);
  });

  it("is smaller when the overlay is in coarser units, larger when the layer is shrunk", () => {
    expect(overlayUnitsPerPx(layout, 2, 1)).toBeCloseTo(2.5, 9);
    expect(overlayUnitsPerPx(layout, 1, 0.9)).toBeCloseTo(5 / 0.9, 9);
  });
});

describe("clampInto: a label kept inside the visible photo", () => {
  it("leaves a box that is already inside where it is", () => {
    expect(clampInto(100, 40, 0, 300)).toBe(100);
    // touching either edge is inside
    expect(clampInto(20, 40, 0, 300)).toBe(20);
    expect(clampInto(280, 40, 0, 300)).toBe(280);
  });

  it("moves a box that hangs over the far edge back so it ends at the edge", () => {
    expect(clampInto(290, 40, 0, 300)).toBe(280);
  });

  it("moves a box that hangs over the near edge back so it starts at the edge", () => {
    expect(clampInto(5, 40, 10, 300)).toBe(30);
  });

  it("works from a start that is not 0 (a crop that begins part-way into the photo)", () => {
    expect(clampInto(500, 60, 100, 200)).toBe(270);
    expect(clampInto(100, 60, 100, 200)).toBe(130);
  });

  it("a box as wide as the space, or wider, is centred on it", () => {
    expect(clampInto(10, 200, 100, 200)).toBe(200);
    expect(clampInto(10, 300, 100, 200)).toBe(200);
  });
});

describe("computeOverlayToStill and the per-axis overlay ratios (A1)", () => {
  // R2's example: the analysed copy is rounded per axis, so the two ratios differ.
  const still = { width: 4001, height: 3000 };
  const analysed = computeDownscaleSize(still.width, still.height);
  const stage = { width: 390, height: 731 };

  it("4001x3000 is analysed at 3000x2249, with a ratio per axis", () => {
    expect(analysed).toEqual({ width: 3000, height: 2249 });
    const { x, y } = computeOverlayToStill(still, {
      imageWidth: analysed.width,
      imageHeight: analysed.height,
    });
    expect(x).toBeCloseTo(4001 / 3000, 12);
    expect(y).toBeCloseTo(3000 / 2249, 12);
    expect(y).not.toBeCloseTo(x, 4);
  });

  it("restores the bottom row to the still's bottom row: the 0.5837 px error is gone", () => {
    const { x, y } = computeOverlayToStill(still, {
      imageWidth: analysed.width,
      imageHeight: analysed.height,
    });
    const bottom = analysed.height; // the analysed copy's last edge
    expect(Math.abs(bottom * y - still.height)).toBeLessThan(1e-9);
    // The width ratio on its own (the old behaviour) was 0.5837 still px off.
    expect(bottom * x - still.height).toBeCloseTo(-0.5837, 4);
  });

  it("the focus rect puts a point where an independent mapping puts it, to 1e-6 still px", () => {
    const layout = computeFrozenPhotoLayout({ stage, stream: null, still });
    const ratio = computeOverlayToStill(still, {
      imageWidth: analysed.width,
      imageHeight: analysed.height,
    });
    const points = [
      { x: 100, y: analysed.height - 1 },
      { x: analysed.width - 1, y: 0 },
      { x: 1234.5, y: 987.25 },
    ];
    for (const point of points) {
      const focus = computeResultFocusRect({
        stage,
        layout,
        overlayToStill: ratio.x,
        overlayToStillY: ratio.y,
        overlay: { landmarksPx: [point] },
        labelAllowancePx: 0,
      });
      // Independent: scale by the true still/analysed sizes, no shared helper.
      const expected = photoPointToStage(
        {
          x: (point.x * still.width) / analysed.width,
          y: (point.y * still.height) / analysed.height,
        },
        layout,
      );
      const stillPerStagePx = layout.crop.width / layout.box.width;
      expect(Math.abs(focus.x - expected.x) * stillPerStagePx).toBeLessThan(
        1e-6,
      );
      expect(Math.abs(focus.y - expected.y) * stillPerStagePx).toBeLessThan(
        1e-6,
      );
    }
    // The width ratio alone misses the bottom point by more than half a still px.
    const old = computeResultFocusRect({
      stage,
      layout,
      overlayToStill: ratio.x,
      overlay: { landmarksPx: [points[0]] },
      labelAllowancePx: 0,
    });
    const want = photoPointToStage(
      {
        x: (points[0].x * still.width) / analysed.width,
        y: (points[0].y * still.height) / analysed.height,
      },
      layout,
    );
    expect(
      Math.abs(old.y - want.y) * (layout.crop.width / layout.box.width),
    ).toBeGreaterThan(0.5);
  });

  it("with a crop: the focus rect and the visible rect both follow their own axis", () => {
    // A 3:4 still under a 9:16 preview is cropped on the left and right.
    const stream = { width: 1080, height: 1920 };
    const croppedStill = { width: 3000, height: 4001 };
    const down = computeDownscaleSize(croppedStill.width, croppedStill.height);
    const ratio = computeOverlayToStill(croppedStill, {
      imageWidth: down.width,
      imageHeight: down.height,
    });
    const layout = computeFrozenPhotoLayout({
      stage,
      stream,
      still: croppedStill,
    });
    expect(layout.crop.x).toBeGreaterThan(0);
    const visible = overlayVisibleRect(layout.crop, ratio.x, ratio.y);
    expect(visible.x * ratio.x).toBeCloseTo(layout.crop.x, 9);
    expect(visible.y * ratio.y).toBeCloseTo(layout.crop.y, 9);
    expect(visible.width * ratio.x).toBeCloseTo(layout.crop.width, 9);
    expect(visible.height * ratio.y).toBeCloseTo(layout.crop.height, 9);
    // The overlay's last row maps to the still's last row, so it sits at the
    // visible rect's bottom when the crop reaches the still's bottom.
    const point = { x: down.width / 2, y: down.height - 1 };
    const focus = computeResultFocusRect({
      stage,
      layout,
      overlayToStill: ratio.x,
      overlayToStillY: ratio.y,
      overlay: { landmarksPx: [point] },
      labelAllowancePx: 0,
    });
    const expected = photoPointToStage(
      {
        x: (point.x * croppedStill.width) / down.width,
        y: (point.y * croppedStill.height) / down.height,
      },
      layout,
    );
    expect(focus.x).toBeCloseTo(expected.x, 9);
    expect(focus.y).toBeCloseTo(expected.y, 9);
  });

  it("equal ratios: both axes are the same and the old call (no Y) gives the same rect", () => {
    const same = { width: 2000, height: 1500 };
    const ratio = computeOverlayToStill(same, {
      imageWidth: 1000,
      imageHeight: 750,
    });
    expect(ratio).toEqual({ x: 2, y: 2 });
    const layout = computeFrozenPhotoLayout({
      stage,
      stream: null,
      still: same,
    });
    const overlay = {
      landmarksPx: [
        { x: 100, y: 200 },
        { x: 800, y: 700 },
      ],
    };
    const withoutY = computeResultFocusRect({
      stage,
      layout,
      overlayToStill: 2,
      overlay,
      labelAllowancePx: 10,
    });
    const withY = computeResultFocusRect({
      stage,
      layout,
      overlayToStill: 2,
      overlayToStillY: 2,
      overlay,
      labelAllowancePx: 10,
    });
    expect(withY).toEqual(withoutY);
    expect(overlayVisibleRect(layout.crop, 2)).toEqual(
      overlayVisibleRect(layout.crop, 2, 2),
    );
  });

  it("no overlay or no still: 1 on both axes; a missing height falls back to the width ratio", () => {
    expect(computeOverlayToStill(still, null)).toEqual({ x: 1, y: 1 });
    expect(
      computeOverlayToStill(null, { imageWidth: 100, imageHeight: 100 }),
    ).toEqual({ x: 1, y: 1 });
    expect(
      computeOverlayToStill(still, { imageWidth: 2000, imageHeight: 0 }),
    ).toEqual({ x: 4001 / 2000, y: 4001 / 2000 });
  });
});
