/**
 * Renders a synthetic "camera view of the sheet" PNG, for building the
 * committed fake-camera video fixtures under tests/e2e/fixtures/camera/
 * (see tests/e2e/fixtures/gen-camera-fixtures.ts, the one-off generator
 * that shells out to ffmpeg). Deliberately separate from
 * synthetic-photo.ts's `buildSyntheticTopDownPhotoPng` (which always draws
 * all four flat-flap markers under one fixed homography) — this file needs
 * to render a *partial* view (only some marker ids present, as if the
 * camera hasn't been moved back far enough yet) for the "2/4 markers"
 * screenshot and cue-text e2e assertions.
 *
 * Same technique as synthetic-photo.ts: geometry computed Node-side from
 * this app's own real modules, then rasterized by a real browser's Canvas
 * 2D API via Playwright (Node has no canvas implementation here).
 */
import type { Page } from "@playwright/test";
import { computeSheetLayout } from "../../../src/client/sheet/layout";
import {
  markerBitGrid,
  ARUCO_MARKER_MODULES,
} from "../../../src/client/sheet/aruco-codes";
import { SHEET } from "../../../src/lib/contracts/measurement";
import {
  applyHomography,
  type Homography,
  type Point2,
} from "../../../src/client/geometry/homography";

export interface CameraSceneOptions {
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  readonly homography: Homography;
  /** Which flat-flap marker ids (0-3) to draw. Default: all four. */
  readonly markerIds?: readonly number[];
  /** Draw the card outline placeholder. Default true. */
  readonly includeCard?: boolean;
}

interface MarkerQuadData {
  readonly id: number;
  readonly corners: readonly [Point2, Point2, Point2, Point2];
  readonly grid: boolean[][];
}

function buildScene(options: CameraSceneOptions): {
  markers: MarkerQuadData[];
  card: readonly [Point2, Point2, Point2, Point2] | null;
} {
  const layout = computeSheetLayout();
  const toCanvasPx = (p: Point2) => applyHomography(options.homography, p);
  const ids = options.markerIds ?? (SHEET.flatMarkerIds as readonly number[]);

  const markers: MarkerQuadData[] = layout.markers
    .filter((m) => ids.includes(m.id))
    .map((m) => ({
      id: m.id,
      corners: m.corners.map(toCanvasPx) as unknown as readonly [
        Point2,
        Point2,
        Point2,
        Point2,
      ],
      grid: markerBitGrid(m.id),
    }));

  const card =
    options.includeCard === false
      ? null
      : (layout.cardOutline.corners.map(toCanvasPx) as unknown as readonly [
          Point2,
          Point2,
          Point2,
          Point2,
        ]);

  return { markers, card };
}

/** Renders the scene to a lossless PNG buffer. */
export async function buildCameraScenePng(
  page: Page,
  options: CameraSceneOptions,
): Promise<Buffer> {
  const scene = buildScene(options);
  const base64 = await page.evaluate(
    ({ scene, width, height, gridModules }) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d")!;
      // A light grey, not pure white: keeps the live loop's mean-luma
      // comfortably above the "too dark" floor while leaving headroom
      // below the "clipped/too bright" ceiling once the markers' white
      // modules (255) are mixed in.
      ctx.fillStyle = "#e6e6e6";
      ctx.fillRect(0, 0, width, height);

      function bilinearPoint(
        tl: { x: number; y: number },
        tr: { x: number; y: number },
        bl: { x: number; y: number },
        br: { x: number; y: number },
        u: number,
        v: number,
      ) {
        const top = { x: tl.x + (tr.x - tl.x) * u, y: tl.y + (tr.y - tl.y) * u };
        const bottom = {
          x: bl.x + (br.x - bl.x) * u,
          y: bl.y + (br.y - bl.y) * u,
        };
        return { x: top.x + (bottom.x - top.x) * v, y: top.y + (bottom.y - top.y) * v };
      }

      for (const marker of scene.markers) {
        const [tl, tr, br, bl] = marker.corners;
        for (let row = 0; row < gridModules; row++) {
          for (let col = 0; col < gridModules; col++) {
            const isBorder =
              row === 0 ||
              col === 0 ||
              row === gridModules - 1 ||
              col === gridModules - 1;
            const isWhite = !isBorder && marker.grid[row - 1][col - 1];
            const u0 = col / gridModules;
            const u1 = (col + 1) / gridModules;
            const v0 = row / gridModules;
            const v1 = (row + 1) / gridModules;
            const p00 = bilinearPoint(tl, tr, bl, br, u0, v0);
            const p10 = bilinearPoint(tl, tr, bl, br, u1, v0);
            const p11 = bilinearPoint(tl, tr, bl, br, u1, v1);
            const p01 = bilinearPoint(tl, tr, bl, br, u0, v1);
            ctx.fillStyle = isWhite ? "#ffffff" : "#000000";
            ctx.beginPath();
            ctx.moveTo(p00.x, p00.y);
            ctx.lineTo(p10.x, p10.y);
            ctx.lineTo(p11.x, p11.y);
            ctx.lineTo(p01.x, p01.y);
            ctx.closePath();
            ctx.fill();
          }
        }
      }

      if (scene.card) {
        ctx.fillStyle = "#b0b0b0";
        ctx.beginPath();
        const [cardTl, cardTr, cardBr, cardBl] = scene.card;
        ctx.moveTo(cardTl.x, cardTl.y);
        ctx.lineTo(cardTr.x, cardTr.y);
        ctx.lineTo(cardBr.x, cardBr.y);
        ctx.lineTo(cardBl.x, cardBl.y);
        ctx.closePath();
        ctx.fill();
      }

      return canvas.toDataURL("image/png").split(",")[1];
    },
    {
      scene,
      width: options.canvasWidth,
      height: options.canvasHeight,
      gridModules: ARUCO_MARKER_MODULES,
    },
  );
  return Buffer.from(base64, "base64");
}
