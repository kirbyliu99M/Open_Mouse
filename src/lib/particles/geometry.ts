export type Vec = readonly [x: number, y: number];

/** A flattened subpath. `closed` means the last point joins back to the first. */
export interface Polyline {
  readonly points: readonly Vec[];
  readonly closed: boolean;
}

/** Affine matrix [a, b, c, d, e, f], as in SVG's matrix(). */
export type Matrix = readonly [
  a: number,
  b: number,
  c: number,
  d: number,
  e: number,
  f: number,
];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** a × b: apply b first, then a (the order SVG composes a transform list in). */
export function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

export function applyMatrix(m: Matrix, [x, y]: Vec): Vec {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

export function distance(a: Vec, b: Vec): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

/** Length of the path through `points` (plus the closing edge when `closed`). */
export function polylineLength(points: readonly Vec[], closed = false): number {
  let length = 0;
  for (let i = 1; i < points.length; i += 1) {
    length += distance(points[i - 1]!, points[i]!);
  }
  if (closed && points.length > 1) {
    length += distance(points[points.length - 1]!, points[0]!);
  }
  return length;
}
