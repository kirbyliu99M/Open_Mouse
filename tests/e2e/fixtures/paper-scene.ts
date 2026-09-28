/**
 * Renders a synthetic "camera view of a blank sheet of paper on a dark
 * table, with a hand crossing the bottom edge" PNG, for the paper-edge
 * fake-camera video fixture (tests/e2e/fixtures/gen-camera-fixtures.spec.ts)
 * and for direct detector verification (see gen-camera-fixtures.spec.ts's
 * "logs real detector timing" test). Unlike camera-scene.ts (the
 * printed-sheet fixture, still used for that e2e path), this draws NO
 * markers — paper-edge mode locks onto the blank paper's own edges via the
 * real `detectPaperQuad` (src/client/paper/detect.ts).
 *
 * A genuine (non-affine) perspective homography and a skin-tone occluder
 * that crosses the paper's bottom edge exercise exactly the two things
 * `detectPaperQuad`'s own header describes handling: perspective distortion
 * and a hand/wrist cutting a concave notch out of the paper's silhouette.
 */
import type { Page } from "@playwright/test";
import {
  applyHomography,
  type Homography,
  type Point2,
} from "../../../src/client/geometry/homography";

export interface PaperSceneOptions {
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  readonly homography: Homography;
  readonly paperSizeMm: { readonly width: number; readonly height: number };
  /** Include the skin-tone hand occluder crossing the bottom edge. Default true. */
  readonly includeHand?: boolean;
}

function buildScene(options: PaperSceneOptions): {
  paper: readonly [Point2, Point2, Point2, Point2];
  handPolygon: readonly Point2[];
} {
  const toCanvasPx = (p: Point2) => applyHomography(options.homography, p);
  const { width: pw, height: ph } = options.paperSizeMm;
  const paper = [
    { x: 0, y: 0 },
    { x: pw, y: 0 },
    { x: pw, y: ph },
    { x: 0, y: ph },
  ].map(toCanvasPx) as unknown as readonly [Point2, Point2, Point2, Point2];

  // A rounded-blob "hand/wrist" in SHEET mm space: centred on the bottom
  // edge, extending both up into the paper and down past it, so it both
  // occludes part of the paper AND crosses the true bottom edge — the
  // "concave notch" case. Widened at the very bottom (the wrist).
  const cx = pw / 2;
  const bottomY = ph;
  const handPointsMm: Point2[] = [];
  const steps = 32;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const angle = Math.PI * t; // 0..PI, a half-ellipse "into" the paper
    const rx = pw * 0.16;
    const ry = ph * 0.14;
    handPointsMm.push({
      x: cx + Math.cos(angle) * rx,
      y: bottomY - Math.sin(angle) * ry * 1.6, // bulges upward into the paper
    });
  }
  // Wrist: extend straight down past the bottom edge on both sides.
  handPointsMm.push({ x: cx - pw * 0.16, y: bottomY + ph * 0.09 });
  handPointsMm.push({ x: cx + pw * 0.16, y: bottomY + ph * 0.09 });

  const handPolygon = handPointsMm.map(toCanvasPx);
  return { paper, handPolygon };
}

/** Renders the scene to a lossless PNG buffer. */
export async function buildPaperScenePng(
  page: Page,
  options: PaperSceneOptions,
): Promise<Buffer> {
  const scene = buildScene(options);
  const base64 = await page.evaluate(
    ({ scene, width, height, includeHand }) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d")!;

      // Dark grey table.
      ctx.fillStyle = "#3a3a3d";
      ctx.fillRect(0, 0, width, height);

      // Blank white paper.
      ctx.fillStyle = "#f6f6f2";
      ctx.beginPath();
      const [pTl, pTr, pBr, pBl] = scene.paper;
      ctx.moveTo(pTl.x, pTl.y);
      ctx.lineTo(pTr.x, pTr.y);
      ctx.lineTo(pBr.x, pBr.y);
      ctx.lineTo(pBl.x, pBl.y);
      ctx.closePath();
      ctx.fill();

      if (includeHand) {
        ctx.fillStyle = "#e0ac8a"; // skin tone — well above the detector's saturation cutoff
        ctx.beginPath();
        scene.handPolygon.forEach((p, i) => {
          if (i === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        });
        ctx.closePath();
        ctx.fill();
      }

      return canvas.toDataURL("image/png").split(",")[1];
    },
    {
      scene,
      width: options.canvasWidth,
      height: options.canvasHeight,
      includeHand: options.includeHand ?? true,
    },
  );
  return Buffer.from(base64, "base64");
}
