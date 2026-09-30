/**
 * Synthetic learning-kit shots: a known hand, a known camera, and everything
 * the detectors would report, so a test can drive the pure report code and
 * compare with the truth. NOT a test file.
 *
 * Two independent ways to get a shot:
 *  - `syntheticShot`: the exact camera of `synthetic-camera.ts`. Planes are
 *    built from exact correspondences, so any error is the algorithm's.
 *  - `independentShot`: the separately written generator of
 *    `independent-scene.ts`, rendered to pixels and run through the REAL
 *    `detectPaperQuad`, so the paper-edge plane comes from an image.
 * The hand has 21 landmarks placed in millimetres with the product's own
 * per-landmark heights above the sheet, projected through the camera. The true
 * hand length (wrist to middle fingertip) is known exactly.
 */
import {
  estimateHomography,
  type Homography,
  type Point2,
} from "../../../src/client/geometry/homography";
import { LANDMARK_HEIGHTS_MM } from "../../../src/client/geometry/parallax";
import { detectPaperQuad } from "../../../src/client/paper/detect";
import { buildPaperHomography } from "../../../src/client/paper/homography";
import type { PaperSize } from "../../../src/lib/contracts/measurement";
import {
  SHEET_MM_MARKER_CORNERS,
  buildSyntheticCamera,
  projectSheetMm,
} from "./synthetic-camera";
import {
  independentSceneCamera,
  renderIndependentScene,
  type IndependentScene,
} from "./independent-scene";

/** 21 MediaPipe-ordered landmarks of a flat hand, in mm, centred near the origin. */
export const HAND_MM: readonly Point2[] = (
  [
    [100, 0],
    [85, 20],
    [70, 45],
    [55, 65],
    [45, 85],
    [80, 100],
    [75, 135],
    [65, 150],
    [55, 145],
    [100, 105],
    [100, 140],
    [100, 165],
    [100, 190],
    [130, 99],
    [131, 133],
    [131, 157],
    [131, 177],
    [160, 98],
    [162, 122],
    [163, 140],
    [163, 155],
  ] as const
).map(([x, y]) => ({ x: x - 100, y: y - 95 }));

const dist = (a: Point2, b: Point2) => Math.hypot(a.x - b.x, a.y - b.y);
export const TRUE_HAND_LENGTH_MM = dist(HAND_MM[0]!, HAND_MM[12]!);
export const TRUE_PALM_WIDTH_MM = dist(HAND_MM[5]!, HAND_MM[17]!);

export interface Shot {
  readonly imageSize: { readonly width: number; readonly height: number };
  /** The focal length a phone's EXIF would give, in px of this frame. */
  readonly exifFocalPx: number;
  readonly landmarksPx: readonly Point2[];
  /** Image px to sheet mm through the four corner markers. */
  readonly markerHomography: Homography;
  /** Image px to paper mm through the paper's edges. */
  readonly paperHomography: Homography;
}

const A4 = { width: 210, height: 297 } as const;

export function syntheticShot(
  options: {
    tiltDeg?: number;
    distanceMm?: number;
    fPx?: number;
  } = {},
): Shot {
  const fPx = options.fPx ?? 3800;
  const camera = buildSyntheticCamera({
    tiltDeg: options.tiltDeg ?? 20,
    distanceMm: options.distanceMm ?? 450,
    fPx,
  });
  const markerHomography = estimateHomography(
    SHEET_MM_MARKER_CORNERS.map((mm) => ({
      src: projectSheetMm(camera, mm, 0),
      dst: mm,
    })),
  );
  const corners = [
    { x: -A4.width / 2, y: -A4.height / 2 },
    { x: A4.width / 2, y: -A4.height / 2 },
    { x: A4.width / 2, y: A4.height / 2 },
    { x: -A4.width / 2, y: A4.height / 2 },
  ].map((mm) => projectSheetMm(camera, mm, 0)) as [
    Point2,
    Point2,
    Point2,
    Point2,
  ];
  return {
    imageSize: { width: camera.widthPx, height: camera.heightPx },
    exifFocalPx: fPx,
    landmarksPx: HAND_MM.map((mm, i) =>
      projectSheetMm(camera, mm, LANDMARK_HEIGHTS_MM[i]),
    ),
    markerHomography,
    paperHomography: buildPaperHomography(corners, "a4"),
  };
}

export const INDEPENDENT_SCENE: IndependentScene = {
  frameWidth: 750,
  frameHeight: 1000,
  paperWidthMm: A4.width,
  paperHeightMm: A4.height,
  rotationDeg: 20,
  tiltXDeg: 12,
  tiltYDeg: 8,
  background: "midGrey",
  seed: 7,
};

export interface IndependentShot extends Shot {
  readonly scene: IndependentScene;
  /** What `detectPaperQuad` returned on the rendered pixels. */
  readonly quad: ReturnType<typeof detectPaperQuad>;
  /** The exact paper-mm to image-px homography the generator used. */
  readonly paperToImage: readonly number[];
}

/**
 * Render the independent scene, find the paper in the pixels with the real
 * detector, and project the hand through the generator's own camera. The
 * marker plane is built from that same camera (no marker pixels are drawn).
 * `paperSize` is what the detector is told; the scene's own paper is `scene`'s.
 */
export function independentShot(
  scene: IndependentScene = INDEPENDENT_SCENE,
  paperSize: PaperSize = "a4",
): IndependentShot {
  const rendered = renderIndependentScene(scene);
  const image = {
    width: rendered.width,
    height: rendered.height,
    data: rendered.data,
  } as unknown as ImageData;
  const quad = detectPaperQuad(image, paperSize);
  const camera = independentSceneCamera(scene);
  const cx = scene.paperWidthMm / 2;
  const cy = scene.paperHeightMm / 2;
  const markerHomography = estimateHomography(
    SHEET_MM_MARKER_CORNERS.map((mm) => ({
      src: camera.project(mm.x + cx, mm.y + cy, 0),
      dst: mm,
    })),
  );
  const paperHomography = quad.corners
    ? buildPaperHomography(quad.corners, paperSize)
    : markerHomography; // never used when the detector failed; tests assert corners
  return {
    scene,
    quad,
    paperToImage: rendered.paperToImage,
    imageSize: { width: rendered.width, height: rendered.height },
    exifFocalPx: camera.focalPx,
    landmarksPx: HAND_MM.map((mm, i) =>
      camera.project(mm.x + cx, mm.y + cy, LANDMARK_HEIGHTS_MM[i]!),
    ),
    markerHomography,
    paperHomography,
  };
}
