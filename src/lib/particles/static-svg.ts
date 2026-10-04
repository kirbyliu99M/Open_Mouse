import type { Polyline, Vec } from "./geometry";
import { logoStrokes, LOGO_BOX } from "./logo";
import type { HandTarget } from "./targets";

/**
 * The static end states of the particle story (PR A; the fallback for reduced
 * motion, no JS and small screens in PR B). An <img> can not read CSS
 * variables, so the colours are written out: primary strokes #CFE0FF, detail
 * strokes #6E9BF5, the glow #3B82F6 (README, "Static images" and the token
 * table). Output is deterministic, so a test can compare it with the
 * committed files.
 */
const PRIMARY = "#CFE0FF";
const DETAIL = "#6E9BF5";
const GLOW = "#3B82F6";

const num = (n: number): string =>
  String(Math.round(n * 10) / 10).replace(/^-0$/, "0");
const pair = ([x, y]: Vec) => `${num(x)} ${num(y)}`;

function pathOf(polylines: readonly Polyline[]): string {
  return polylines
    .map(
      ({ points, closed }) =>
        `M${points.map(pair).join("L")}${closed ? "Z" : ""}`,
    )
    .join("");
}

/** The placeholder logo, as plain lines (docs/design/home-v3-2026-10-03/screens/logo-placeholder-vector.png). */
export function renderLogoSvg(): string {
  const strokes = logoStrokes();
  const primary = pathOf(
    strokes.filter((s) => s.tone === 1).map((s) => s.polyline),
  );
  const detail = pathOf(
    strokes.filter((s) => s.tone === 0).map((s) => s.polyline),
  );
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${LOGO_BOX.width} ${LOGO_BOX.height}" fill="none" stroke-linecap="round" stroke-linejoin="round">\n` +
    `<path d="${detail}" stroke="${DETAIL}" stroke-width="1.4"/>\n` +
    `<path d="${primary}" stroke="${PRIMARY}" stroke-width="1.8"/>\n` +
    `</svg>\n`
  );
}

/** A dot is a zero-length segment with a round cap: compact, and the size is one stroke-width. */
const dots = (points: readonly { x: number; y: number }[]): string =>
  points.map((p) => `M${num(p.x)} ${num(p.y)}h0`).join("");

/**
 * The template hand on an A4 sheet: the particles, the 21 landmarks, the
 * skeleton, the two measurement lines with end ticks, and the sheet's corner
 * marks (its outline is a CSS border laid over the image: see `handSheetFrame`).
 * No numbers anywhere: the values on this page are an illustration, never a
 * user's result.
 */
export function renderHandSvg(hand: HandTarget): string {
  const { viewBox, a4 } = hand;
  const line = (l: { from: Vec; to: Vec }) => `M${pair(l.from)}L${pair(l.to)}`;
  const corner = 14; // mm-ish bracket length, in stage px
  const brackets = [
    `M0 ${num(corner)}V0H${num(corner)}`,
    `M${num(a4.width - corner)} 0H${num(a4.width)}V${num(corner)}`,
    `M${num(a4.width)} ${num(a4.height - corner)}V${num(a4.height)}H${num(a4.width - corner)}`,
    `M${num(corner)} ${num(a4.height)}H0V${num(a4.height - corner)}`,
  ].join("");
  const bright = hand.points.filter((p) => p.tone === 1);
  const dim = hand.points.filter((p) => p.tone === 0);
  const skeleton = hand.skeleton
    .map(([a, b]) => line({ from: hand.landmarks[a]!, to: hand.landmarks[b]! }))
    .join("");
  const measure = [
    line(hand.lengthLine),
    line(hand.widthLine),
    ...hand.ticks.map(line),
  ].join("");
  const extensions = hand.lengthExtensions.map(line).join("");
  const halos = hand.landmarks
    .map((p) => `<circle cx="${num(p[0])}" cy="${num(p[1])}" r="6.5"/>`)
    .join("");
  const cores = hand.landmarks
    .map((p) => `<circle cx="${num(p[0])}" cy="${num(p[1])}" r="2.4"/>`)
    .join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${num(viewBox.x)} ${num(viewBox.y)} ${num(viewBox.width)} ${num(viewBox.height)}" fill="none" stroke-linecap="round" stroke-linejoin="round">\n` +
    // The sheet's own outline is NOT drawn here: the page draws it as a CSS
    // border in --hairline over this image (an <img> can not read the
    // variable, so a drawn outline would ignore `prefers-contrast: more`). Only
    // the four corner marks belong to the drawing.
    `<path d="${brackets}" stroke="#FFFFFF" stroke-opacity=".4" stroke-width="1.4"/>\n` +
    `<path d="${dots(dim)}" stroke="${DETAIL}" stroke-opacity=".75" stroke-width="1.7"/>\n` +
    `<path d="${dots(bright)}" stroke="${PRIMARY}" stroke-width="2.3"/>\n` +
    `<path d="${skeleton}" stroke="${DETAIL}" stroke-opacity=".9" stroke-width="1"/>\n` +
    `<g fill="${GLOW}" fill-opacity=".35">${halos}</g>\n` +
    `<g fill="${PRIMARY}">${cores}</g>\n` +
    `<path d="${extensions}" stroke="${DETAIL}" stroke-opacity=".55" stroke-width="1"/>\n` +
    `<path d="${measure}" stroke="${DETAIL}" stroke-width="1.4"/>\n` +
    `</svg>\n`
  );
}
