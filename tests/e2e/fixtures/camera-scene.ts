/**
 * Renders a synthetic "camera view of a blank sheet of paper on a dark
 * table" PNG, for building the committed fake-camera video fixtures under
 * tests/e2e/fixtures/camera/ (see gen-camera-fixtures.spec.ts, the one-off
 * generator that shells out to ffmpeg).
 *
 * Kirby's 2026-09-25 direction change: the real product has no printed
 * calibration sheet, no ArUco markers and no bank card any more — just a
 * blank A4/Letter sheet, whose corners a (separately-owned) paper-edge
 * detector will find from its edges. This app's *current* live loop still
 * runs on a temporary `createMarkerBasedQuadSource` adapter
 * (src/client/camera/quad-source.ts) until that lands, so this fixture
 * draws the white paper rectangle Kirby asked for (on a dark background,
 * no card) but still embeds the existing ArUco markers near its corners so
 * that temporary adapter keeps working today.
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
  /** The blank paper's size, mm — its 4 corners are drawn white on a dark background. */
  readonly paperSizeMm: { readonly width: number; readonly height: number };
  /** Which flat-flap marker ids (0-3) to draw (the temporary adapter's lock-on target). Default: all four. */
  readonly markerIds?: readonly number[];
}

interface MarkerQuadData {
  readonly id: number;
  readonly corners: readonly [Point2, Point2, Point2, Point2];
  readonly grid: boolean[][];
}

function buildScene(options: CameraSceneOptions): {
  paper: readonly [Point2, Point2, Point2, Point2];
  markers: MarkerQuadData[];
} {
  const layout = computeSheetLayout();
  const toCanvasPx = (p: Point2) => applyHomography(options.homography, p);
  const ids = options.markerIds ?? (SHEET.flatMarkerIds as readonly number[]);

  const { width: pw, height: ph } = options.paperSizeMm;
  const paper = [
    { x: 0, y: 0 },
    { x: pw, y: 0 },
    { x: pw, y: ph },
    { x: 0, y: ph },
  ].map(toCanvasPx) as unknown as readonly [Point2, Point2, Point2, Point2];

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

  return { paper, markers };
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

      // Dark table, then the blank white paper on top of it — a real
      // document-scanner-style setup, and good contrast for the paper-edge
      // detector this fixture will eventually exercise.
      ctx.fillStyle = "#2b2b2e";
      ctx.fillRect(0, 0, width, height);

      ctx.fillStyle = "#f4f4f0";
      ctx.beginPath();
      const [pTl, pTr, pBr, pBl] = scene.paper;
      ctx.moveTo(pTl.x, pTl.y);
      ctx.lineTo(pTr.x, pTr.y);
      ctx.lineTo(pBr.x, pBr.y);
      ctx.lineTo(pBl.x, pBl.y);
      ctx.closePath();
      ctx.fill();

      function bilinearPoint(
        tl: { x: number; y: number },
        tr: { x: number; y: number },
        bl: { x: number; y: number },
        br: { x: number; y: number },
        u: number,
        v: number,
      ) {
        const top = {
          x: tl.x + (tr.x - tl.x) * u,
          y: tl.y + (tr.y - tl.y) * u,
        };
        const bottom = {
          x: bl.x + (br.x - bl.x) * u,
          y: bl.y + (br.y - bl.y) * u,
        };
        return {
          x: top.x + (bottom.x - top.x) * v,
          y: top.y + (bottom.y - top.y) * v,
        };
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
