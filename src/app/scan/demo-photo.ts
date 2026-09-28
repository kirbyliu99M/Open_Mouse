/**
 * A synthetic "photo" (an inline SVG data URI — no real photo exists for
 * these fixtures) plus a plausible 21-point MediaPipe-shaped landmark
 * layout, shared by `/scan/measured-demo` (printed-sheet) and
 * `/scan/paper-edge-measured-demo` (paper-edge) so both can screenshot the
 * measured-state overlay (skeleton, knuckle emphasis, hand-length/palm-
 * width dimension lines — see ScanClient's "ok" branch) against something
 * that actually looks like a hand, not blank space. Positions are
 * illustrative, not measured from anything real; each route's own
 * `DEMO_SUBMISSION.measurements` are the only numbers actually drawn.
 *
 * The filled skin-tone silhouette reuses `buildHandSilhouette` — the exact
 * same geometry the live-viewfinder hand ghost synthesises from a tracked
 * paper quad — but built from these REAL landmark positions, so the
 * overlay drawn on top of it (by ScanClient) lines up with an actual hand
 * shape underneath instead of empty paper.
 */
import {
  buildHandSilhouette,
  silhouetteLandmarksFromHandLandmarks,
} from "@/client/geometry/handSilhouette";
import type { Point2 } from "@/client/geometry/homography";

// Sized close to a real decoded photo's scale (src/client/photo/decode.ts's
// MAX_LONG_EDGE_PX is 3000) rather than an arbitrary small canvas — the
// dimension-line offset (ScanClient.tsx's `DimensionLinesOverlay`, 16-24
// image px) is sized for real-photo resolutions, and looked cramped
// against the hand at a much smaller demo canvas.
export const DEMO_IMAGE_WIDTH = 1600;
export const DEMO_IMAGE_HEIGHT = 2000;

export const DEMO_LANDMARKS_PX: readonly Point2[] = [
  { x: 800, y: 1800 }, // 0 wrist
  { x: 680, y: 1700 }, // 1 thumb CMC
  { x: 600, y: 1560 }, // 2 thumb MCP
  { x: 540, y: 1440 }, // 3 thumb IP
  { x: 500, y: 1340 }, // 4 thumb tip
  { x: 760, y: 1300 }, // 5 index MCP
  { x: 740, y: 1040 }, // 6 index PIP
  { x: 730, y: 880 }, // 7 index DIP
  { x: 720, y: 740 }, // 8 index tip
  { x: 840, y: 1260 }, // 9 middle MCP
  { x: 830, y: 960 }, // 10 middle PIP
  { x: 820, y: 760 }, // 11 middle DIP
  { x: 810, y: 600 }, // 12 middle tip
  { x: 920, y: 1300 }, // 13 ring MCP
  { x: 916, y: 1020 }, // 14 ring PIP
  { x: 912, y: 840 }, // 15 ring DIP
  { x: 908, y: 700 }, // 16 ring tip
  { x: 1000, y: 1340 }, // 17 pinky MCP
  { x: 1010, y: 1120 }, // 18 pinky PIP
  { x: 1016, y: 980 }, // 19 pinky DIP
  { x: 1020, y: 860 }, // 20 pinky tip
];

function handSilhouetteSvgFragment(): string {
  const geo = buildHandSilhouette(
    silhouetteLandmarksFromHandLandmarks(DEMO_LANDMARKS_PX),
  );
  const SKIN = "#e0ac8a";
  const capsule = (f: { from: Point2; to: Point2; widthPx: number }) =>
    `<line x1="${f.from.x}" y1="${f.from.y}" x2="${f.to.x}" y2="${f.to.y}" ` +
    `stroke="${SKIN}" stroke-width="${f.widthPx}" stroke-linecap="round"/>`;
  return (
    `<path d="${geo.palmPathD}" fill="${SKIN}"/>` +
    geo.fingers.map(capsule).join("") +
    capsule(geo.thumb)
  );
}

/**
 * Builds the demo photo's data-URI src. `background` is `"paper"` (a
 * single blank light sheet, paper-edge mode) or `"sheet"` (today's
 * printed-sheet look — still just a plain card; that route's overlay
 * markers/card arrays are empty too, unchanged pre-existing behaviour).
 */
export function buildDemoPhotoUrl(background: "paper" | "sheet"): string {
  const backgroundRect =
    background === "paper"
      ? `<rect x="20" y="20" width="${DEMO_IMAGE_WIDTH - 40}" height="${DEMO_IMAGE_HEIGHT - 40}" rx="12" fill="#f6f6f2" stroke="#d5d5dc" stroke-width="2"/>`
      : `<rect x="20" y="20" width="${DEMO_IMAGE_WIDTH - 40}" height="${DEMO_IMAGE_HEIGHT - 40}" rx="24" fill="#f7f8fa" stroke="#d5d5dc" stroke-width="2"/>`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${DEMO_IMAGE_WIDTH}" height="${DEMO_IMAGE_HEIGHT}">` +
    `<rect width="${DEMO_IMAGE_WIDTH}" height="${DEMO_IMAGE_HEIGHT}" fill="#eef0f2"/>` +
    backgroundRect +
    handSilhouetteSvgFragment() +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
