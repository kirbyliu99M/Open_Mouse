/**
 * F10 item 2 (Kirby's second phone test 2026-10-21/22: 「手動調整後寬度誤差
 * 最大」), from R6 (review\R6-manual-width-parallax.md), candidate 未拍板.
 *
 * R6 F1: on a frame with no EXIF the focal length comes from the sheet's
 * homography, and hand-placed corners almost always make that estimate
 * "unreliable", which switches the parallax correction off (palm width
 * +3.0 mm, hand length +4.9 mm, simulated). Fix A: a frame placed on the same
 * photo keeps the automatic run's reliable focal length (`reusedFocal`).
 *
 * R6 F2: a sheet corner just out of frame was clamped to the photo's edge
 * when dragged (palm width +1.0 mm at 2 % out, simulated). A dragged corner
 * may now go as far out as `checkManualQuad` allows (10 %).
 *
 * Every number here is SIMULATED (模擬): R6's pinhole scene
 * (helpers/r6-scene.ts), no photo, no browser.
 */
import { describe, expect, it } from "vitest";
import { assumedFocalPxFromFov } from "../../src/client/paper/orientation";
import {
  resolveFocalPx,
  type ReusedFocal,
} from "../../src/client/geometry/parallax";
import { buildPaperHomography } from "../../src/client/paper/homography";
import {
  adjustReducer,
  clampToAllowed,
  fitPhoto,
  reusableFocal,
  reusedFocalFor,
  startAdjust,
  toScreen,
  type AdjustAction,
  type AdjustState,
} from "../../src/client/camera/paperAdjustState";
import {
  MANUAL_QUAD_LIMITS,
  type Quad4,
} from "../../src/client/paper/manualQuad";
import type { PhotoOverlay } from "../../src/client/photo/pipeline";
import { buildR6Scene, measureAuto, measurePlaced } from "./helpers/r6-scene";

// R6's frame: 1080x1920, true f 1442 px, no EXIF.
const FRAME = { w: 1080, h: 1920, f: 1442 };
const HINT = assumedFocalPxFromFov(FRAME.w);
const TILTED = buildR6Scene({ ...FRAME, pitchDeg: 10, rollDeg: 3 });

function autoOf(scene = TILTED) {
  return measureAuto(scene.corners, scene.raisedPx, FRAME, null);
}
function focalOf(auto: { source: string; fPx: number | null }): ReusedFocal {
  const f = reusableFocal({ source: auto.source, px: auto.fPx });
  if (!f) throw new Error("the automatic run had no usable focal length");
  return f;
}
function nudged(q: Quad4, index: number, dx: number, dy: number): Quad4 {
  return q.map((p, i) =>
    i === index ? { x: p.x + dx, y: p.y + dy } : { x: p.x, y: p.y },
  ) as unknown as Quad4;
}

describe("R6 F1: a placed frame keeps the automatic run's focal length (fix A)", () => {
  it("the scene: the automatic run is corrected from a reliable homography estimate", () => {
    const auto = autoOf();
    expect(auto.source).toBe("homography");
    expect(auto.corrected).toBe(true);
    // Corrected, it is close to the truth (simulated).
    expect(Math.abs(auto.len - TILTED.trueLen)).toBeLessThan(0.5);
    expect(Math.abs(auto.pw - TILTED.truePw)).toBeLessThan(0.5);
  });

  it("the same corners, placed by hand: hand length and palm width within 0.1 mm of the automatic run", () => {
    const auto = autoOf();
    const placed = measurePlaced(
      TILTED.corners,
      TILTED.raisedPx,
      FRAME,
      null,
      HINT,
      focalOf(auto),
    );
    expect(placed.corrected).toBe(true);
    expect(placed.source).toBe("homography");
    expect(Math.abs(placed.len - auto.len)).toBeLessThan(0.1);
    expect(Math.abs(placed.pw - auto.pw)).toBeLessThan(0.1);
  });

  it("one corner moved 1-5 px in any direction: the correction stays on, with the automatic run's focal length", () => {
    const auto = autoOf();
    const reused = focalOf(auto);
    let checked = 0;
    for (let index = 0; index < 4; index++)
      for (const px of [1, 2, 3, 4, 5])
        for (let k = 0; k < 8; k++) {
          const a = (k * Math.PI) / 4;
          const q = nudged(
            TILTED.corners,
            index,
            px * Math.cos(a),
            px * Math.sin(a),
          );
          const placed = measurePlaced(
            q,
            TILTED.raisedPx,
            FRAME,
            null,
            HINT,
            reused,
          );
          expect(placed.corrected, `corner ${index} ${px} px`).toBe(true);
          expect(placed.fPx).toBe(auto.fPx);
          checked += 1;
        }
    expect(checked).toBe(160);
  });

  it("without the fix the same nudges mostly lose it, and the palm reads wider (R6's finding, kept as the reason)", () => {
    const auto = autoOf();
    let lost = 0;
    let n = 0;
    const widerBy: number[] = [];
    for (let index = 0; index < 4; index++)
      for (const px of [1, 3, 5])
        for (let k = 0; k < 8; k++) {
          const a = (k * Math.PI) / 4;
          const q = nudged(
            TILTED.corners,
            index,
            px * Math.cos(a),
            px * Math.sin(a),
          );
          const placed = measurePlaced(
            q,
            TILTED.raisedPx,
            FRAME,
            null,
            HINT,
            null,
          );
          n += 1;
          if (!placed.corrected) {
            lost += 1;
            widerBy.push(placed.pw - auto.pw);
          }
        }
    expect(lost / n).toBeGreaterThan(0.5);
    const mean = widerBy.reduce((s, x) => s + x, 0) / widerBy.length;
    console.info(
      `[F10 F1, simulated] without reuse: ${lost}/${n} nudged frames lost the correction; palm width +${mean.toFixed(2)} mm on those`,
    );
    expect(mean).toBeGreaterThan(1.5);
  });

  it("the photo's own EXIF still comes first", () => {
    const homography = buildPaperHomography(TILTED.corners, "a4");
    const principalPoint = { cx: FRAME.w / 2, cy: FRAME.h / 2 };
    expect(
      resolveFocalPx({
        exifFocalPx: 1500,
        homography,
        principalPoint,
        reusedFocal: { fPx: 1442, source: "homography" },
      }),
    ).toEqual({ fPx: 1500, source: "exif" });
    expect(
      resolveFocalPx({
        exifFocalPx: null,
        homography,
        principalPoint,
        reusedFocal: { fPx: 1442, source: "homography" },
      }),
    ).toEqual({ fPx: 1442, source: "homography" });
  });

  it("the automatic path is exactly what it was: without reusedFocal nothing changes", () => {
    const homography = buildPaperHomography(TILTED.corners, "a4");
    const principalPoint = { cx: FRAME.w / 2, cy: FRAME.h / 2 };
    const before = resolveFocalPx({
      exifFocalPx: null,
      homography,
      principalPoint,
    });
    expect(
      resolveFocalPx({
        exifFocalPx: null,
        homography,
        principalPoint,
        reusedFocal: null,
      }),
    ).toEqual(before);
    // A straight-on frame: no reliable estimate, so no correction, as before.
    const flat = buildR6Scene({ ...FRAME });
    const flatAuto = autoOf(flat);
    expect(flatAuto.source).toBe("none");
    expect(
      reusableFocal({ source: flatAuto.source, px: flatAuto.fPx }),
    ).toBeNull();
  });
});

describe("reusableFocal / reusedFocalFor (pure)", () => {
  it("keeps EXIF and a reliable homography estimate, never none or a bad value", () => {
    expect(reusableFocal({ source: "exif", px: 2254 })).toEqual({
      fPx: 2254,
      source: "exif",
    });
    expect(reusableFocal({ source: "homography", px: 1442 })).toEqual({
      fPx: 1442,
      source: "homography",
    });
    expect(reusableFocal({ source: "none", px: null })).toBeNull();
    expect(reusableFocal({ source: "homography", px: null })).toBeNull();
    expect(reusableFocal({ source: "homography", px: 0 })).toBeNull();
    expect(reusableFocal({ source: "homography", px: NaN })).toBeNull();
    expect(reusableFocal(null)).toBeNull();
    expect(reusableFocal(undefined)).toBeNull();
  });

  it("is given only to a placed frame on the very same file", () => {
    const a = { name: "a" };
    const b = { name: "b" };
    const focal: ReusedFocal = { fPx: 1442, source: "homography" };
    const auto = { file: a, focal };
    expect(reusedFocalFor({ placedFrame: true, file: a, auto })).toBe(focal);
    expect(reusedFocalFor({ placedFrame: true, file: b, auto })).toBeNull();
    expect(reusedFocalFor({ placedFrame: false, file: a, auto })).toBeNull();
    expect(
      reusedFocalFor({ placedFrame: true, file: a, auto: null }),
    ).toBeNull();
  });
});

describe("R6 F2: a corner just out of frame is not clamped to the edge", () => {
  // The camera moved so the sheet's right side runs 2 % of the width off the
  // frame (R6 E3e). Both the frame and the photo with EXIF.
  const configs = [
    {
      name: "frame 1080x1920, no EXIF",
      w: 1080,
      h: 1920,
      f: 1442,
      exif: false,
      // No reliable focal length on this frame at all (see the known gap).
      correctable: false,
    },
    {
      name: "photo 2250x3000, EXIF",
      w: 2250,
      h: 3000,
      f: 2254,
      exif: true,
      correctable: true,
    },
  ];
  for (const c of configs)
    it(`${c.name}: dragged out to the true corner, palm width within 0.2 mm of ${c.correctable ? "the true hand" : "the automatic run (the true hand: known gap)"}`, () => {
      const image = { w: c.w, h: c.h };
      const base = buildR6Scene({
        w: c.w,
        h: c.h,
        f: c.f,
        pitchDeg: 5,
        rollDeg: 2,
      });
      const right = Math.max(base.corners[1].x, base.corners[2].x);
      const scene = buildR6Scene({
        w: c.w,
        h: c.h,
        f: c.f,
        pitchDeg: 5,
        rollDeg: 2,
        shiftX: c.w - right + 0.02 * c.w,
      });
      const exif = c.exif ? c.f : null;
      // Off the photo, but inside the 10 % allowed.
      const outX = Math.max(scene.corners[1].x, scene.corners[2].x);
      expect(outX).toBeCloseTo(c.w * 1.02, 6);
      const auto = measureAuto(scene.corners, scene.raisedPx, image, exif);
      const reused = reusableFocal({ source: auto.source, px: auto.fPx });
      const ref = measurePlaced(
        scene.corners,
        scene.raisedPx,
        image,
        exif,
        assumedFocalPxFromFov(c.w),
        reused,
      );
      // The person drags TR and BR from inside the photo out to the sheet's
      // corners, on the adjustment screen (screen px through the fit).
      const overlay: PhotoOverlay = {
        imageWidth: c.w,
        imageHeight: c.h,
        markers: [],
        card: null,
        landmarksPx: null,
        paperCorners: null,
      };
      let state: AdjustState = startAdjust({
        entry: "rescue",
        overlay,
        paperSize: "a4",
      });
      const fit = fitPhoto(
        { width: c.w, height: c.h },
        { width: 390, height: 600 },
        24,
      );
      const go = (s: AdjustState, a: AdjustAction) => adjustReducer(s, a);
      for (const index of [0, 1, 2, 3] as const) {
        const from = toScreen(state.corners[index], fit);
        const to = toScreen(scene.corners[index], fit);
        state = go(state, {
          type: "pointerDown",
          index,
          pointerId: index + 1,
          pointerType: "touch",
          point: from,
        });
        state = go(state, {
          type: "pointerMove",
          pointerId: index + 1,
          point: to,
          scale: fit.scale,
        });
        state = go(state, { type: "pointerUp", pointerId: index + 1 });
      }
      for (const index of [0, 1, 2, 3]) {
        expect(state.corners[index].x).toBeCloseTo(scene.corners[index].x, 6);
        expect(state.corners[index].y).toBeCloseTo(scene.corners[index].y, 6);
      }
      const placed = measurePlaced(
        state.corners,
        scene.raisedPx,
        image,
        exif,
        assumedFocalPxFromFov(c.w),
        reused,
      );
      // The same corners measured the same way (a pure function): the
      // frame dragged by hand is the true frame.
      expect(placed.pw).toBeCloseTo(ref.pw, 9);
      expect(placed.len).toBeCloseTo(ref.len, 9);
      // And as the automatic run would measure the true corners.
      expect(Math.abs(placed.pw - auto.pw)).toBeLessThan(0.2);
      expect(Math.abs(placed.len - auto.len)).toBeLessThan(0.2);
      if (c.correctable) {
        // Against the scene's true hand (R6's error), not the same corners
        // measured twice (review of F10: that difference is always 0).
        expect(placed.corrected).toBe(true);
        expect(Math.abs(placed.pw - scene.truePw)).toBeLessThan(0.2);
        expect(Math.abs(placed.len - scene.trueLen)).toBeLessThan(0.2);
      } else {
        // KNOWN GAP, not fixed by F10 (review of F10, simulated): with no
        // EXIF and the sheet partly out of frame, the automatic run finds no
        // reliable focal length either, so there is none to reuse, the
        // parallax correction stays off and the hand reads too big whatever
        // the corners. R6's shiftX moves the picture, not the camera (the
        // principal point leaves the centre), so how much of this a real
        // photo shows is 不確定. Pinned so a change to it is seen.
        expect(auto.source).toBe("none");
        expect(placed.corrected).toBe(false);
        expect(placed.pw - scene.truePw).toBeGreaterThan(3);
        expect(placed.len - scene.trueLen).toBeGreaterThan(3);
      }
      // What clamping to the edge (before F10) did to the same frame.
      const clamped = state.corners.map((p) => ({
        x: Math.min(c.w, Math.max(0, p.x)),
        y: Math.min(c.h, Math.max(0, p.y)),
      })) as unknown as Quad4;
      const old = measurePlaced(
        clamped,
        scene.raisedPx,
        image,
        exif,
        assumedFocalPxFromFov(c.w),
        reused,
      );
      console.info(
        `[F10 F2, simulated] ${c.name}: 2 % out, vs true hand: unclamped Δpw ${(placed.pw - scene.truePw).toFixed(3)} mm Δlen ${(placed.len - scene.trueLen).toFixed(3)} mm; clamped (before F10) Δpw ${(old.pw - scene.truePw).toFixed(3)} mm Δlen ${(old.len - scene.trueLen).toFixed(3)} mm`,
      );
      // Clamping (before F10) moved the palm width away from what the true
      // corners give (and, where the correction is on, from the true hand).
      expect(Math.abs(old.pw - auto.pw)).toBeGreaterThan(
        Math.abs(placed.pw - auto.pw) + 0.1,
      );
      if (c.correctable)
        expect(Math.abs(old.pw - scene.truePw)).toBeGreaterThan(
          Math.abs(placed.pw - scene.truePw),
        );
    });

  it("clampToAllowed stops a corner at 10 % beyond the photo, and leaves one inside alone", () => {
    const image = { width: 1000, height: 2000 };
    const m = MANUAL_QUAD_LIMITS.maxOutsideFraction;
    expect(clampToAllowed({ x: 500, y: 700 }, image)).toEqual({
      x: 500,
      y: 700,
    });
    expect(clampToAllowed({ x: 1020, y: -40 }, image)).toEqual({
      x: 1020,
      y: -40,
    });
    expect(clampToAllowed({ x: 5000, y: -5000 }, image)).toEqual({
      x: 1000 * (1 + m),
      y: -2000 * m,
    });
  });
});
