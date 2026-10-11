/**
 * The maths of the enlarged-photo dialog (pinch, drag, wheel, keyboard). Pure:
 * the component only reads events, calls these, and writes one CSS transform.
 *
 * Model: the photo fills a box of `width` x `height` and is drawn with
 * `transform-origin: 50% 50%; transform: translate(x px, y px) scale(s)`. A
 * point `p` (measured from the box centre, in unzoomed pixels) therefore lands
 * at `x + s * p`. Every function takes and returns a `ZoomView`; none mutates.
 */

export const MIN_SCALE = 1;
export const MAX_SCALE = 3;
/** What a double tap or double click zooms to from 1x (Kirby: 2.5x). */
export const DOUBLE_TAP_SCALE = 2.5;
/** One keyboard `+` or `-` press multiplies or divides the scale by this. */
export const KEY_ZOOM_FACTOR = 1.25;
/** One arrow key press moves the photo by this many pixels. */
export const KEY_PAN_STEP = 48;

export interface ZoomView {
  scale: number;
  x: number;
  y: number;
}

export interface Box {
  width: number;
  height: number;
}

/** A point in box-centre coordinates: (0, 0) is the middle of the box. */
export interface Point {
  x: number;
  y: number;
}

export const RESET_VIEW: ZoomView = { scale: 1, x: 0, y: 0 };

/** `scale` held to [MIN_SCALE, MAX_SCALE]; a non-finite value gives 1. */
export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return MIN_SCALE;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/**
 * How far the photo may be moved from the centre on each axis at `scale`:
 * the part of the zoomed photo that sticks out of the box, split in two.
 * 0 at 1x (nothing to pan), so a photo can never leave the box.
 */
export function maxPan(scale: number, box: Box): Point {
  const extra = clampScale(scale) - 1;
  return {
    x: Math.max(0, (extra * box.width) / 2),
    y: Math.max(0, (extra * box.height) / 2),
  };
}

function clampAxis(value: number, limit: number): number {
  if (!Number.isFinite(value)) return 0;
  // `+ 0` turns -0 into 0 so a reset view compares equal to RESET_VIEW.
  return Math.min(limit, Math.max(-limit, value)) + 0;
}

/** The view with its scale and pan held inside the allowed range. */
export function clampView(view: ZoomView, box: Box): ZoomView {
  const scale = clampScale(view.scale);
  const limit = maxPan(scale, box);
  return {
    scale,
    x: clampAxis(view.x, limit.x),
    y: clampAxis(view.y, limit.y),
  };
}

/**
 * Change the scale to `nextScale` while the point under `focal` stays under
 * it (zoom around the pointer, the pinch centre, or the box centre).
 */
export function zoomAt(
  view: ZoomView,
  nextScale: number,
  focal: Point,
  box: Box,
): ZoomView {
  const scale = clampScale(nextScale);
  const ratio = scale / view.scale;
  return clampView(
    {
      scale,
      x: focal.x - (focal.x - view.x) * ratio,
      y: focal.y - (focal.y - view.y) * ratio,
    },
    box,
  );
}

/** Move the photo by (dx, dy) pixels, held inside the box. */
export function panBy(
  view: ZoomView,
  dx: number,
  dy: number,
  box: Box,
): ZoomView {
  return clampView({ ...view, x: view.x + dx, y: view.y + dy }, box);
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** What a two-finger gesture remembers from the moment the second finger went down. */
export interface PinchStart {
  view: ZoomView;
  distance: number;
  center: Point;
}

/**
 * The view for a pinch in progress. The scale follows the ratio of the finger
 * distance now to the distance at the start; the photo point that was under
 * the starting centre stays under the current centre, so the gesture also pans.
 * A zero starting distance (two fingers on one pixel) changes nothing.
 */
export function pinchView(
  start: PinchStart,
  now: { distance: number; center: Point },
  box: Box,
): ZoomView {
  if (!(start.distance > 0) || !Number.isFinite(now.distance)) {
    return clampView(start.view, box);
  }
  const scale = clampScale(start.view.scale * (now.distance / start.distance));
  // The photo point (unzoomed) under the starting centre.
  const px = (start.center.x - start.view.x) / start.view.scale;
  const py = (start.center.y - start.view.y) / start.view.scale;
  return clampView(
    {
      scale,
      x: now.center.x - scale * px,
      y: now.center.y - scale * py,
    },
    box,
  );
}

/** Double tap or double click: back to 1x when zoomed, otherwise 2.5x around `focal`. */
export function toggleZoom(view: ZoomView, focal: Point, box: Box): ZoomView {
  // Anything visibly zoomed counts as zoomed; a hair above 1x does not.
  if (view.scale > MIN_SCALE + 0.01) return { ...RESET_VIEW };
  return zoomAt(view, DOUBLE_TAP_SCALE, focal, box);
}

/**
 * The scale factor of one wheel event. Trackpad pinch arrives as ctrl+wheel
 * with small deltas, so it gets a larger gain; `deltaMode` 1 is in lines.
 */
export function wheelFactor(
  deltaY: number,
  deltaMode: number,
  ctrlKey: boolean,
): number {
  const pixels = deltaMode === 1 ? deltaY * 16 : deltaY;
  return Math.exp(-pixels * (ctrlKey ? 0.01 : 0.0015));
}

/** Zoom by wheel around `focal`. */
export function wheelZoom(
  view: ZoomView,
  deltaY: number,
  deltaMode: number,
  ctrlKey: boolean,
  focal: Point,
  box: Box,
): ZoomView {
  return zoomAt(
    view,
    view.scale * wheelFactor(deltaY, deltaMode, ctrlKey),
    focal,
    box,
  );
}

/** Keyboard `+` (direction 1) or `-` (direction -1), around the box centre. */
export function keyZoom(view: ZoomView, direction: 1 | -1, box: Box): ZoomView {
  const factor = direction === 1 ? KEY_ZOOM_FACTOR : 1 / KEY_ZOOM_FACTOR;
  return zoomAt(view, view.scale * factor, { x: 0, y: 0 }, box);
}

export type ZoomKeyAction =
  | { kind: "zoom"; direction: 1 | -1 }
  | { kind: "reset" }
  | { kind: "pan"; dx: number; dy: number };

/**
 * What a key press means in the dialog, or `null` when it is not ours.
 * Arrow keys only pan when zoomed (at 1x there is nothing to move, so they are
 * left alone). Chords with Ctrl, Meta or Alt are the browser's own zoom.
 */
export function zoomKeyAction(
  event: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean },
  zoomed: boolean,
): ZoomKeyAction | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  switch (event.key) {
    case "+":
    case "=":
      return { kind: "zoom", direction: 1 };
    case "-":
    case "_":
      return { kind: "zoom", direction: -1 };
    case "0":
      return { kind: "reset" };
    // Arrow keys move the VIEW in the direction of the arrow, so the photo
    // itself moves the other way (ArrowRight: dx < 0).
    case "ArrowLeft":
      return zoomed ? { kind: "pan", dx: KEY_PAN_STEP, dy: 0 } : null;
    case "ArrowRight":
      return zoomed ? { kind: "pan", dx: -KEY_PAN_STEP, dy: 0 } : null;
    case "ArrowUp":
      return zoomed ? { kind: "pan", dx: 0, dy: KEY_PAN_STEP } : null;
    case "ArrowDown":
      return zoomed ? { kind: "pan", dx: 0, dy: -KEY_PAN_STEP } : null;
    default:
      return null;
  }
}

/** Apply a key action to a view. */
export function applyKeyAction(
  view: ZoomView,
  action: ZoomKeyAction,
  box: Box,
): ZoomView {
  switch (action.kind) {
    case "zoom":
      return keyZoom(view, action.direction, box);
    case "reset":
      return { ...RESET_VIEW };
    case "pan":
      return panBy(view, action.dx, action.dy, box);
  }
}

/** The CSS `transform` value for a view. */
export function viewTransform(view: ZoomView): string {
  return `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale})`;
}

/** Two taps in a row count as a double tap within this time and distance. */
export const DOUBLE_TAP_MS = 300;
export const DOUBLE_TAP_SLOP = 30;
/** A press that moves less than this and ends quickly is a tap, not a drag. */
export const TAP_SLOP = 10;
export const TAP_MAX_MS = 300;

export interface Tap {
  time: number;
  point: Point;
}

/** Whether `next` is the second tap of a double tap that began with `previous`. */
export function isDoubleTap(previous: Tap | null, next: Tap): boolean {
  if (!previous) return false;
  return (
    next.time - previous.time <= DOUBLE_TAP_MS &&
    distance(previous.point, next.point) <= DOUBLE_TAP_SLOP
  );
}
