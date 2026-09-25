/**
 * Independent synthetic-scene generator for cross-checking `detectPaperQuad`
 * (2026-09-25 PR #59 review, M1: "port what you need... an INDEPENDENT
 * generator — do not tune and test on the same one").
 *
 * This is a clean-room TypeScript implementation of the SAME idea the
 * reviewer's own review generator used (a real pinhole camera, in-plane
 * rotation + tilt, a shadow band, a second white object, capsule-based
 * hand/finger occluders) — written separately from
 * `tests/unit/helpers/synthetic-paper.ts` on purpose: `synthetic-paper.ts`
 * is what the algorithm was TUNED against (thresholds picked by looking at
 * its output), so a bug shared between the algorithm's assumptions and
 * that generator's quirks would never show up there. This file shares no
 * code with `synthetic-paper.ts` (different projection setup, different
 * anti-aliasing, different RNG usage, different hand model) so it can
 * catch exactly that kind of blind spot.
 */
import type { Point2 } from "../../../src/client/geometry/homography";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Row-major 3×3, flattened to 9 numbers. */
type Mat9 = readonly number[];

function matMul(a: Mat9, b: Mat9): Mat9 {
  const out = new Array<number>(9).fill(0);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      let sum = 0;
      for (let k = 0; k < 3; k++) sum += a[r * 3 + k] * b[k * 3 + c];
      out[r * 3 + c] = sum;
    }
  }
  return out;
}

function matApply(h: Mat9, p: Point2): Point2 {
  const w = h[6] * p.x + h[7] * p.y + h[8];
  return {
    x: (h[0] * p.x + h[1] * p.y + h[2]) / w,
    y: (h[3] * p.x + h[4] * p.y + h[5]) / w,
  };
}

export interface IndependentScene {
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly paperWidthMm: number;
  readonly paperHeightMm: number;
  /** In-plane rotation of the paper, 0 = upright portrait. */
  readonly rotationDeg?: number;
  readonly tiltXDeg?: number;
  readonly tiltYDeg?: number;
  /** How much of the frame's limiting dimension the paper's long side fills, ~0-1. */
  readonly fillFraction?: number;
  readonly background:
    "midGrey" | "brightGrey" | "lightGrey" | "nearWhiteDesk" | "woodgrain";
  /** Only for "lightGrey" — overrides its default brightness. */
  readonly lightGreyLevel?: number;
  /** A second, smaller white rectangle near the paper. */
  readonly secondWhiteObject?: "touching" | "separate" | "none";
  /** A hard diagonal brightness band crossing the paper. */
  readonly shadowBand?: boolean;
  readonly shadowBandFactor?: number;
  readonly hand?: "none" | "normal" | "coveringCorner" | "overTopEdge";
  readonly noiseAmplitude?: number;
  readonly seed: number;
}

export interface IndependentRender {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  /** Exact TL, TR, BR, BL image corners of the paper. */
  readonly corners: readonly [Point2, Point2, Point2, Point2];
  /** The exact paper-mm → image-px homography used to render it. */
  readonly paperToImage: Mat9;
}

function smoothstep(loEdge: number, hiEdge: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - loEdge) / (hiEdge - loEdge)));
  return t * t * (3 - 2 * t);
}

/** Perpendicular signed distance from `p` to a convex polygon's boundary — positive inside. */
function insidePolygonDistance(p: Point2, poly: readonly Point2[]): number {
  let signedArea = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    signedArea += a.x * b.y - b.x * a.y;
  }
  const winding = signedArea > 0 ? 1 : -1;
  let minDist = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const len = Math.hypot(ex, ey) || 1;
    const dist = (winding * (ex * (p.y - a.y) - ey * (p.x - a.x))) / len;
    minDist = Math.min(minDist, dist);
  }
  return minDist;
}

/** Signed "inside" distance to a capsule (a thick line segment) — positive inside. */
function insideCapsuleDistance(
  p: Point2,
  a: Point2,
  b: Point2,
  radius: number,
): number {
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const segLenSq = ex * ex + ey * ey || 1;
  const t = Math.max(
    0,
    Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / segLenSq),
  );
  const closest = { x: a.x + t * ex, y: a.y + t * ey };
  return radius - Math.hypot(p.x - closest.x, p.y - closest.y);
}

function buildPaperToImage(scene: IndependentScene): Mat9 {
  const { frameWidth: W, frameHeight: H } = scene;
  const focalPx = 0.8 * Math.max(W, H);
  const fill = scene.fillFraction ?? 0.7;
  const longSideMm = Math.max(scene.paperWidthMm, scene.paperHeightMm);
  const targetLongPx = fill * Math.min(W, H);
  const distanceMm = (focalPx * longSideMm) / targetLongPx;

  const rotationRad = ((scene.rotationDeg ?? 0) * Math.PI) / 180;
  const tiltXRad = ((scene.tiltXDeg ?? 0) * Math.PI) / 180;
  const tiltYRad = ((scene.tiltYDeg ?? 0) * Math.PI) / 180;

  const centre: Mat9 = [
    1,
    0,
    -scene.paperWidthMm / 2,
    0,
    1,
    -scene.paperHeightMm / 2,
    0,
    0,
    1,
  ];
  const spin: Mat9 = [
    Math.cos(rotationRad),
    -Math.sin(rotationRad),
    0,
    Math.sin(rotationRad),
    Math.cos(rotationRad),
    0,
    0,
    0,
    1,
  ];
  const cX = Math.cos(tiltXRad);
  const sX = Math.sin(tiltXRad);
  const cY = Math.cos(tiltYRad);
  const sY = Math.sin(tiltYRad);
  const tiltX: Mat9 = [1, 0, 0, 0, cX, -sX, 0, sX, cX];
  const tiltY: Mat9 = [cY, 0, sY, 0, 1, 0, -sY, 0, cY];
  const tilt = matMul(tiltY, tiltX);
  const worldToImage: Mat9 = [
    tilt[0],
    tilt[1],
    0,
    tilt[3],
    tilt[4],
    0,
    tilt[6],
    tilt[7],
    distanceMm,
  ];
  const intrinsics: Mat9 = [focalPx, 0, W / 2, 0, focalPx, H / 2, 0, 0, 1];
  return matMul(intrinsics, matMul(worldToImage, matMul(spin, centre)));
}

export function renderIndependentScene(
  scene: IndependentScene,
): IndependentRender {
  const { frameWidth: W, frameHeight: H } = scene;
  const rng = mulberry32(scene.seed);
  const paperToImage = buildPaperToImage(scene);
  const corners = [
    { x: 0, y: 0 },
    { x: scene.paperWidthMm, y: 0 },
    { x: scene.paperWidthMm, y: scene.paperHeightMm },
    { x: 0, y: scene.paperHeightMm },
  ].map((p) => matApply(paperToImage, p)) as [Point2, Point2, Point2, Point2];
  const toImage = (mmX: number, mmY: number): Point2 =>
    matApply(paperToImage, { x: mmX, y: mmY });

  let secondWhite: readonly Point2[] | null = null;
  if (scene.secondWhiteObject === "separate") {
    secondWhite = [
      toImage(scene.paperWidthMm + 20, 40),
      toImage(scene.paperWidthMm + 90, 40),
      toImage(scene.paperWidthMm + 90, 250),
      toImage(scene.paperWidthMm + 20, 250),
    ];
  } else if (scene.secondWhiteObject === "touching") {
    secondWhite = [
      toImage(scene.paperWidthMm - 1, 60),
      toImage(scene.paperWidthMm + 80, 60),
      toImage(scene.paperWidthMm + 80, 200),
      toImage(scene.paperWidthMm - 1, 200),
    ];
  }

  const handCapsules: [Point2, Point2, number][] = [];
  if (scene.hand && scene.hand !== "none") {
    const pxPerMm =
      Math.hypot(corners[1].x - corners[0].x, corners[1].y - corners[0].y) /
      scene.paperWidthMm;
    let originX = scene.paperWidthMm * 0.5;
    let originY = scene.paperHeightMm * 0.64;
    let fingerScale = 1;
    if (scene.hand === "coveringCorner") {
      originX = scene.paperWidthMm * 0.83;
      originY = scene.paperHeightMm * 0.84;
    }
    if (scene.hand === "overTopEdge") {
      originY = scene.paperHeightMm * 0.37;
      fingerScale = 1.4;
    }
    const palmRadius = 42 * pxPerMm;
    handCapsules.push([
      toImage(originX, originY - 15),
      toImage(originX, originY + 30),
      palmRadius,
    ]);
    handCapsules.push([
      toImage(originX, originY + 30),
      toImage(originX + 5, originY + 400),
      30 * pxPerMm,
    ]);
    const fingerOffsetsX = [-27, -9, 9, 27];
    const fingerLengths = [70, 80, 75, 60].map((l) => l * fingerScale);
    for (let i = 0; i < 4; i++) {
      handCapsules.push([
        toImage(originX + fingerOffsetsX[i], originY - 30),
        toImage(
          originX + fingerOffsetsX[i] * 1.1,
          originY - 30 - fingerLengths[i],
        ),
        8 * pxPerMm,
      ]);
    }
    handCapsules.push([
      toImage(originX - 40, originY + 10),
      toImage(originX - 75, originY - 25),
      10 * pxPerMm,
    ]);
  }

  const shadowLine = scene.shadowBand
    ? ([
        toImage(-50, scene.paperHeightMm * 0.4),
        toImage(scene.paperWidthMm + 90, scene.paperHeightMm * 0.68),
      ] as const)
    : null;

  const noiseAmplitude = scene.noiseAmplitude ?? 4;
  const lightFreqX = 0.3 + rng() * 0.9;
  const lightFreqY = 0.3 + rng() * 0.9;
  const lightPhase = rng() * Math.PI * 2;

  const n = W * H;
  const rendered = new Float32Array(n);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p: Point2 = { x: x + 0.5, y: y + 0.5 };
      const light =
        1 +
        0.1 *
          Math.sin(
            2 * Math.PI * (lightFreqX * (x / W) + lightFreqY * (y / H)) +
              lightPhase,
          );

      let value: number;
      switch (scene.background) {
        case "midGrey":
          value = 110;
          break;
        case "brightGrey":
          value = 175;
          break;
        case "lightGrey":
          value = scene.lightGreyLevel ?? 205;
          break;
        case "nearWhiteDesk":
          value = 227;
          break;
        case "woodgrain": {
          const grain =
            Math.sin((y / H) * 90 + 3 * Math.sin((x / W) * 7)) * 0.5 + 0.5;
          value = 150 + 50 * grain;
          break;
        }
      }

      const paperAlpha = smoothstep(
        -0.6,
        0.6,
        insidePolygonDistance(p, corners),
      );
      value = value * (1 - paperAlpha) + 236 * paperAlpha;

      if (secondWhite) {
        const objAlpha = smoothstep(
          -0.6,
          0.6,
          insidePolygonDistance(p, secondWhite),
        );
        value = value * (1 - objAlpha) + 244 * objAlpha;
      }

      if (shadowLine) {
        const [a, b] = shadowLine;
        const ex = b.x - a.x;
        const ey = b.y - a.y;
        const dist =
          (ex * (p.y - a.y) - ey * (p.x - a.x)) / (Math.hypot(ex, ey) || 1);
        const inBand = Math.abs(dist) < Math.min(W, H) * 0.06;
        if (inBand) value *= scene.shadowBandFactor ?? 0.6;
      }

      let handAlpha = 0;
      for (const [a, b, radius] of handCapsules) {
        handAlpha = Math.max(
          handAlpha,
          smoothstep(-0.6, 0.6, insideCapsuleDistance(p, a, b, radius)),
        );
      }
      // Hand pixels render darker/warmer than paper so they're excluded by
      // the saturation gate downstream — approximated here as a flat
      // mid-brightness value (independent scene doesn't need exact skin
      // colour, just "not paper, not background").
      value = value * (1 - handAlpha) + 165 * handAlpha;

      const noise = (rng() - 0.5) * 2 * noiseAmplitude;
      rendered[y * W + x] = value * light + noise;
    }
  }

  const data = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const v = rendered[i];
    const o = i * 4;
    data[o] = v;
    data[o + 1] = v;
    data[o + 2] = v;
    data[o + 3] = 255;
  }

  return { data, width: W, height: H, corners, paperToImage };
}

export function applyMat9(h: Mat9, p: Point2): Point2 {
  return matApply(h, p);
}
