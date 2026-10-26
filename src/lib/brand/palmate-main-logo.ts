/**
 * The Main Palmate Logo as data (Pencil "Palmate · UI Brand Tokens & Anatomy",
 * node x2w44 "Palmate Hero Mark", with the key light behind it and WITHOUT
 * the two scanner rings: Kirby 2026-10-26, candidate / 未拍板). The share card
 * draws it on a canvas and `public/images/brand/palmate-main-logo.svg` is
 * written from the same numbers (a unit test keeps the two in step).
 *
 * Units are the Pencil pixels: a 220 x 220 box (the key light) holding the
 * 160 x 170 hand at (30, 25). The hand is the official path
 * (`PALMATE_MARK_PATH`) with its viewBox STRETCHED onto that box, as Pencil
 * draws it, and a 2.8 px line that does not scale with the stretch.
 */
import { PALMATE_MARK_PATH, PALMATE_MARK_VIEWBOX } from "./palmate-mark";

export const MAIN_LOGO_SIZE = 220;

export const MAIN_LOGO_HAND = {
  path: PALMATE_MARK_PATH,
  viewBox: PALMATE_MARK_VIEWBOX,
  x: 30,
  y: 25,
  w: 160,
  h: 170,
  stroke: "#7FA8FF",
  /** In logo pixels, not in viewBox units. */
  strokeWidth: 2.8,
} as const;

/** The core dot, in the hand box's pixels (its top-left corner and diameter). */
export const MAIN_LOGO_CORE = {
  x: 77,
  y: 103,
  d: 8,
  fill: "#CFE0FF",
  stroke: "#2463EB",
  strokeWidth: 2,
} as const;

/** The key light: a radial glow over the whole box, centre to edge. */
export const MAIN_LOGO_GLOW = [
  { color: "#2463EB", alpha: 0x50 / 255, at: 0 },
  { color: "#2463EB", alpha: 0, at: 1 },
] as const;

/** The 34 light dots, in the hand box's pixels (top-left corner, diameter). */
export const MAIN_LOGO_PARTICLES: readonly {
  x: number;
  y: number;
  d: number;
  color: string;
}[] = [
  { x: 24, y: 31, d: 6, color: "#CFE0FF" },
  { x: 45, y: 16, d: 6, color: "#CFE0FF" },
  { x: 78.8, y: 10.8, d: 6.4, color: "#CFE0FF" },
  { x: 120, y: 26, d: 6, color: "#CFE0FF" },
  { x: 17.8, y: 51.8, d: 4.4, color: "#8DB8FF" },
  { x: 22, y: 70, d: 4, color: "#8DB8FF" },
  { x: 40.8, y: 43.8, d: 4.4, color: "#8DB8FF" },
  { x: 38, y: 63, d: 4, color: "#8DB8FF" },
  { x: 62.6, y: 35.6, d: 4.8, color: "#E6F0FF" },
  { x: 79.8, y: 39.8, d: 4.4, color: "#8DB8FF" },
  { x: 81, y: 66, d: 4, color: "#8DB8FF" },
  { x: 105.8, y: 43.8, d: 4.4, color: "#8DB8FF" },
  { x: 115.8, y: 65.8, d: 4.4, color: "#8DB8FF" },
  { x: 139.4, y: 89.4, d: 5.2, color: "#CFE0FF" },
  { x: 135.6, y: 119.6, d: 4.8, color: "#8DB8FF" },
  { x: 114.4, y: 149.4, d: 5.2, color: "#CFE0FF" },
  { x: 84.6, y: 151.6, d: 4.8, color: "#8DB8FF" },
  { x: 52.4, y: 145.4, d: 5.2, color: "#CFE0FF" },
  { x: 32.8, y: 119.8, d: 4.4, color: "#8DB8FF" },
  { x: 30.6, y: 95.6, d: 4.8, color: "#8DB8FF" },
  { x: 61.4, y: 109.4, d: 5.2, color: "#CFE0FF" },
  { x: 88.6, y: 102.6, d: 4.8, color: "#E6F0FF" },
  { x: 86.8, y: 85.8, d: 4.4, color: "#8DB8FF" },
  { x: 63.6, y: 80.6, d: 4.8, color: "#CFE0FF" },
  { x: 49.8, y: 90.8, d: 4.4, color: "#8DB8FF" },
  { x: 133.5, y: 48.5, d: 3, color: "#E6F0FF" },
  { x: 13.5, y: 78.5, d: 3, color: "#E6F0FF" },
  { x: 70.5, y: 163.5, d: 3, color: "#E6F0FF" },
  { x: 103.4, y: 14.4, d: 3.2, color: "#E6F0FF" },
  { x: 58.4, y: 16.4, d: 3.2, color: "#E6F0FF" },
  { x: 146.6, y: 108.6, d: 2.8, color: "#8DB8FF" },
  { x: 23.6, y: 138.6, d: 2.8, color: "#8DB8FF" },
  { x: 96.2, y: 123.2, d: 3.6, color: "#CFE0FF" },
  { x: 73.2, y: 130.2, d: 3.6, color: "#8DB8FF" },
];

const n = (value: number) => String(Math.round(value * 1000) / 1000);

/**
 * The logo as a standalone SVG (`public/images/brand/palmate-main-logo.svg`,
 * written by `npm run brand:main-logo`). SVG has no "unscaled line" for a
 * stretched path, so the line width is divided by the mean of the two scales.
 */
export function mainLogoSvg(): string {
  const hand = MAIN_LOGO_HAND;
  const sx = hand.w / hand.viewBox.w;
  const sy = hand.h / hand.viewBox.h;
  const at = (x: number, y: number, d: number) =>
    `cx="${n(hand.x + x + d / 2)}" cy="${n(hand.y + y + d / 2)}" r="${n(d / 2)}"`;
  const core = MAIN_LOGO_CORE;
  const stops = MAIN_LOGO_GLOW.map(
    (s) =>
      `<stop offset="${s.at}" stop-color="${s.color}" stop-opacity="${n(s.alpha)}"/>`,
  ).join("");
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${MAIN_LOGO_SIZE}" height="${MAIN_LOGO_SIZE}" viewBox="0 0 ${MAIN_LOGO_SIZE} ${MAIN_LOGO_SIZE}" fill="none" aria-hidden="true">`,
    `<defs><radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">${stops}</radialGradient></defs>`,
    `<rect width="${MAIN_LOGO_SIZE}" height="${MAIN_LOGO_SIZE}" fill="url(#glow)"/>`,
    `<path d="${hand.path}" transform="translate(${hand.x} ${hand.y}) scale(${n(sx)} ${n(sy)}) translate(${-hand.viewBox.x} ${-hand.viewBox.y})" stroke="${hand.stroke}" stroke-width="${n(hand.strokeWidth / ((sx + sy) / 2))}" stroke-linecap="round" stroke-linejoin="round"/>`,
    `<circle ${at(core.x, core.y, core.d)} fill="${core.fill}" stroke="${core.stroke}" stroke-width="${core.strokeWidth}"/>`,
    ...MAIN_LOGO_PARTICLES.map(
      (p) => `<circle ${at(p.x, p.y, p.d)} fill="${p.color}"/>`,
    ),
    "</svg>",
    "",
  ].join("\n");
}

/**
 * Where the hand's box lands when the logo is drawn into the square `box`
 * (the glow's box): left, top, right, bottom in the box's pixels. The share
 * card lines the logo up by this box, not by the glow, which fades out well
 * outside the hand. Every light dot lies inside it.
 */
export function mainLogoHandEdges(box: { x: number; y: number; w: number }) {
  const scale = box.w / MAIN_LOGO_SIZE;
  const hand = MAIN_LOGO_HAND;
  return {
    left: box.x + hand.x * scale,
    top: box.y + hand.y * scale,
    right: box.x + (hand.x + hand.w) * scale,
    bottom: box.y + (hand.y + hand.h) * scale,
  };
}
