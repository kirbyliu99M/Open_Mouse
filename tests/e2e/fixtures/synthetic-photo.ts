/**
 * Builds a synthetic "top-down photo" entirely in-memory, for
 * tests/e2e/scan.spec.ts — issue #10 requires a synthetic image (rendered
 * from the sheet SVG's own geometry, never a real hand photo) with drawn
 * markers, a card and a "hand" region, under a known perspective.
 *
 * Geometry (marker positions, bit grids, card position) is computed
 * Node-side by importing the app's own real modules — the same source the
 * printed sheet (`src/app/sheet/page.tsx`) draws from — then handed as
 * plain data into a Playwright `page.evaluate`, which does the actual
 * pixel rasterization with the browser's real Canvas 2D API (Node has no
 * canvas implementation in this project).
 *
 * "Known perspective": every point is passed through one small, fixed,
 * genuinely projective homography (nonzero h31/h32, applied with this
 * repo's own `applyHomography`), not just a scale+translate — but kept
 * mild by design. `AR.Detector`'s candidate-finding (contour →
 * polygon-approximation) tolerates real photographic perspective, but a
 * synthetic marker has none of a real photo's anti-aliasing/lens softening
 * to help it, so a strong tilt risks flaking the "markers are found"
 * assertion for reasons that have nothing to do with this app's code. A
 * mild, known tilt exercises the same math path (reprojection error is
 * computed from a real non-degenerate homography) without that risk.
 */
import type { Page } from "@playwright/test";
import { computeSheetLayout } from "../../../src/client/sheet/layout";
import {
  markerBitGrid,
  ARUCO_GRID_SIZE,
  ARUCO_MARKER_MODULES,
} from "../../../src/client/sheet/aruco-codes";
import { SHEET } from "../../../src/lib/contracts/measurement";
import {
  applyHomography,
  type Homography,
  type Point2,
} from "../../../src/client/geometry/homography";

/** mm -> photo-px, with a small genuine perspective term (see file header). */
const PHOTO_HOMOGRAPHY: Homography = [
  [5, 0.05, 120],
  [-0.03, 5, 90],
  [0.00001, -0.000008, 1],
];

const CANVAS_WIDTH = 1400;
const CANVAS_HEIGHT = 2000;

interface MarkerQuadData {
  readonly id: number;
  /** Photo-px corners: [topLeft, topRight, bottomRight, bottomLeft]. */
  readonly corners: readonly [Point2, Point2, Point2, Point2];
  /** Row-major ARUCO_GRID_SIZE x ARUCO_GRID_SIZE, true = white cell. */
  readonly grid: boolean[][];
}

export interface SyntheticPhotoOptions {
  /** Omit the flat-flap markers entirely (the "no markers found" case). */
  readonly includeMarkers?: boolean;
}

function buildScene(options: SyntheticPhotoOptions): {
  markers: MarkerQuadData[];
  card: readonly [Point2, Point2, Point2, Point2];
  hand: readonly Point2[];
} {
  const layout = computeSheetLayout();
  const toPhotoPx = (p: Point2) => applyHomography(PHOTO_HOMOGRAPHY, p);

  const markers: MarkerQuadData[] =
    options.includeMarkers === false
      ? []
      : layout.markers
          .filter((m) =>
            (SHEET.flatMarkerIds as readonly number[]).includes(m.id),
          )
          .map((m) => ({
            id: m.id,
            corners: m.corners.map(toPhotoPx) as unknown as readonly [
              Point2,
              Point2,
              Point2,
              Point2,
            ],
            grid: markerBitGrid(m.id),
          }));

  const card = layout.cardOutline.corners.map(
    toPhotoPx,
  ) as unknown as readonly [Point2, Point2, Point2, Point2];

  // A plain oval "hand" placeholder, well below the flat markers' bounding
  // box (never overlapping them — a hand blob overlapping a marker's own
  // quad was an earlier bug here that made that one marker's detection
  // flaky) — MediaPipe is not expected to find a real hand in it (issue
  // #10's own premise); it only needs to exist so the photo isn't blank
  // there.
  const flatCorners = layout.markers
    .filter((m) => (SHEET.flatMarkerIds as readonly number[]).includes(m.id))
    .flatMap((m) => m.corners);
  const flatMaxYMm = Math.max(...flatCorners.map((c) => c.y));
  const flatCentreXMm =
    (Math.min(...flatCorners.map((c) => c.x)) +
      Math.max(...flatCorners.map((c) => c.x))) /
    2;
  const handCentreMm = { x: flatCentreXMm, y: flatMaxYMm + 75 };
  const handPointsMm: Point2[] = Array.from({ length: 24 }, (_, i) => {
    const angle = (i / 24) * Math.PI * 2;
    return {
      x: handCentreMm.x + Math.cos(angle) * 55,
      y: handCentreMm.y + Math.sin(angle) * 45,
    };
  });
  const hand = handPointsMm.map(toPhotoPx);

  return { markers, card, hand };
}

/**
 * Renders the scene to a PNG (lossless — avoids JPEG compression softening
 * the ArUco modules' hard edges) and returns it as a Buffer, ready for
 * `page.setInputFiles({ buffer, ... })`.
 */
export async function buildSyntheticTopDownPhotoPng(
  page: Page,
  options: SyntheticPhotoOptions = {},
): Promise<Buffer> {
  const scene = buildScene(options);
  const base64 = await page.evaluate(
    ({ scene, width, height, gridModules }) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);

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

      ctx.fillStyle = "#b0b0b0";
      ctx.beginPath();
      const [cardTl, cardTr, cardBr, cardBl] = scene.card;
      ctx.moveTo(cardTl.x, cardTl.y);
      ctx.lineTo(cardTr.x, cardTr.y);
      ctx.lineTo(cardBr.x, cardBr.y);
      ctx.lineTo(cardBl.x, cardBl.y);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = "#e8b98c";
      ctx.beginPath();
      scene.hand.forEach((p, i) => {
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.closePath();
      ctx.fill();

      return canvas.toDataURL("image/png").split(",")[1];
    },
    {
      scene,
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      gridModules: ARUCO_MARKER_MODULES,
    },
  );
  return Buffer.from(base64, "base64");
}

export const SYNTHETIC_PHOTO_MIME = "image/png";
export { ARUCO_GRID_SIZE };
