import type { Polyline, Vec } from "./geometry";
import { type Mask, maskAt } from "./text-mask";

/**
 * The finale's hand and mouse lines pass around the headline's letters, not
 * under them (the v7 look: a line is cut only where it meets a letter, grown
 * by a few px, so it threads between the letters). Pure: the mask is the
 * headline's (text-mask.ts), already grown with `dilateMask`.
 *
 * A line is walked in steps of at most `step` px; every step's point inside
 * the mask is dropped, and the line is cut into the pieces between. The cut is
 * accurate to a step. A piece keeps the line's own vertices and adds a point
 * where it was cut, so a line the mask never touches comes back exactly as it
 * was, and one it covers completely comes back as nothing.
 */
export function clipPolyline(
  line: Polyline,
  blocked: Mask,
  step = 1,
): Polyline[] {
  if (!(step > 0) || !Number.isFinite(step)) {
    throw new RangeError("step must be a positive number");
  }
  const src = line.points;
  if (src.length === 0) return [];
  const path: Vec[] =
    line.closed && src.length > 1 ? [...src, src[0]!] : [...src];

  // The walk: every vertex, and points at most `step` apart between them.
  const walk: { p: Vec; vertex: boolean }[] = [{ p: path[0]!, vertex: true }];
  for (let i = 1; i < path.length; i += 1) {
    const a = path[i - 1]!;
    const b = path[i]!;
    const n = Math.max(
      1,
      Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step),
    );
    for (let k = 1; k <= n; k += 1) {
      const t = k / n;
      walk.push({
        p: k === n ? b : [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
        vertex: k === n,
      });
    }
  }
  const free = walk.map(({ p }) => !maskAt(blocked, p[0], p[1]));
  if (free.every(Boolean)) {
    return [{ points: [...src], closed: line.closed }];
  }

  // Runs of free walk points; keep vertices and each run's two ends.
  const pieces: Vec[][] = [];
  let current: Vec[] | null = null;
  for (let i = 0; i < walk.length; i += 1) {
    const { p, vertex } = walk[i]!;
    if (!free[i]) {
      if (current) pieces.push(current);
      current = null;
      continue;
    }
    const first = current === null;
    const last = i === walk.length - 1 || !free[i + 1];
    current ??= [];
    if (first || last || vertex) current.push(p);
  }
  if (current) pieces.push(current);

  // A closed line cut somewhere: its last piece runs on into its first.
  if (line.closed && pieces.length > 1 && free[0] && free[walk.length - 1]) {
    const head = pieces.shift()!;
    const tail = pieces.pop()!;
    // The tail ends on the start point and the head begins on it: keep one.
    pieces.push([...tail, ...head.slice(1)]);
  }
  return pieces
    .filter((piece) => piece.length >= 2)
    .map((points) => ({ points, closed: false }));
}

/** Clip every line; see `clipPolyline`. */
export function clipPolylines(
  lines: readonly Polyline[],
  blocked: Mask,
  step = 1,
): Polyline[] {
  return lines.flatMap((line) => clipPolyline(line, blocked, step));
}
