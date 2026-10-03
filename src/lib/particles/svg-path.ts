import {
  IDENTITY,
  type Matrix,
  type Polyline,
  type Vec,
  applyMatrix,
  distance,
  multiply,
} from "./geometry";

/**
 * Just enough SVG to read the sketches in public/images/sketches/: machine
 * generated (pen.dev exports), only <g transform>, <path d stroke> and the
 * commands M m L l H h V v C c Z z. Anything else throws, so a sketch that
 * needs more is noticed at build time instead of being sampled wrongly.
 */

const TOKEN = /([a-zA-Z])|(-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)/gi;
const SUPPORTED = new Set(["m", "l", "h", "v", "c", "z"]);

/** Flatten a cubic Bézier into at least 8 segments, about 1 unit each. */
function flattenCubic(p0: Vec, p1: Vec, p2: Vec, p3: Vec): Vec[] {
  const controlLength = distance(p0, p1) + distance(p1, p2) + distance(p2, p3);
  const steps = Math.max(8, Math.ceil(controlLength));
  const out: Vec[] = [];
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const u = 1 - t;
    out.push([
      u * u * u * p0[0] +
        3 * u * u * t * p1[0] +
        3 * u * t * t * p2[0] +
        t * t * t * p3[0],
      u * u * u * p0[1] +
        3 * u * u * t * p1[1] +
        3 * u * t * t * p2[1] +
        t * t * t * p3[1],
    ]);
  }
  return out;
}

/** Subpaths of a path's `d`, flattened to polylines in the path's own coordinates. */
export function parsePathData(d: string): Polyline[] {
  const tokens = [...d.matchAll(TOKEN)];
  const polylines: Polyline[] = [];
  let current: Vec[] = [];
  let pen: Vec = [0, 0];
  let start: Vec = [0, 0];
  let command = "";
  let i = 0;

  const flush = (closed: boolean) => {
    if (current.length > 1) polylines.push({ points: current, closed });
    current = [];
  };
  const next = (): number => {
    const token = tokens[i];
    if (!token || token[2] === undefined) {
      throw new Error(`SVG path: expected a number near "${d.slice(0, 40)}"`);
    }
    i += 1;
    return Number(token[2]);
  };

  while (i < tokens.length) {
    const token = tokens[i]!;
    if (token[1] !== undefined) {
      command = token[1];
      i += 1;
      if (!SUPPORTED.has(command.toLowerCase())) {
        throw new Error(`SVG path: unsupported command "${command}"`);
      }
      if (command === "Z" || command === "z") {
        flush(true);
        pen = start;
        continue;
      }
    } else if (command === "" || command === "Z" || command === "z") {
      throw new Error("SVG path: a number with no command");
    }
    const relative = command === command.toLowerCase();
    const ox = relative ? pen[0] : 0;
    const oy = relative ? pen[1] : 0;
    switch (command.toLowerCase()) {
      case "m": {
        flush(false);
        pen = [ox + next(), oy + next()];
        start = pen;
        current = [pen];
        // Further pairs after a moveto are implicit linetos.
        command = relative ? "l" : "L";
        break;
      }
      case "l": {
        pen = [ox + next(), oy + next()];
        current.push(pen);
        break;
      }
      case "h": {
        pen = [ox + next(), pen[1]];
        current.push(pen);
        break;
      }
      case "v": {
        pen = [pen[0], oy + next()];
        current.push(pen);
        break;
      }
      case "c": {
        const p1: Vec = [ox + next(), oy + next()];
        const p2: Vec = [ox + next(), oy + next()];
        const p3: Vec = [ox + next(), oy + next()];
        if (current.length === 0) current = [pen];
        current.push(...flattenCubic(pen, p1, p2, p3));
        pen = p3;
        break;
      }
    }
  }
  flush(false);
  return polylines;
}

/** `translate(a b) scale(a b) matrix(...)`, composed left to right. */
export function parseTransform(value: string | undefined): Matrix {
  if (!value) return IDENTITY;
  let matrix: Matrix = IDENTITY;
  for (const match of value.matchAll(/(\w+)\(([^)]*)\)/g)) {
    const args = (match[2] ?? "")
      .split(/[\s,]+/)
      .filter((part) => part !== "")
      .map(Number);
    if (args.some((n) => Number.isNaN(n))) {
      throw new Error(`SVG transform: bad number in "${value}"`);
    }
    let step: Matrix;
    switch (match[1]) {
      case "translate":
        step = [1, 0, 0, 1, args[0] ?? 0, args[1] ?? 0];
        break;
      case "scale":
        step = [args[0] ?? 1, 0, 0, args[1] ?? args[0] ?? 1, 0, 0];
        break;
      case "matrix":
        if (args.length !== 6) throw new Error("SVG transform: bad matrix()");
        step = args as unknown as Matrix;
        break;
      default:
        throw new Error(`SVG transform: unsupported "${match[1]}"`);
    }
    matrix = multiply(matrix, step);
  }
  return matrix;
}

export interface SketchStroke {
  readonly polyline: Polyline;
  /** The stroke colour as written, lower-case, e.g. "#cfe0ff". */
  readonly stroke: string;
}

export interface Sketch {
  readonly viewBox: { x: number; y: number; width: number; height: number };
  readonly strokes: readonly SketchStroke[];
}

const attr = (tag: string, name: string): string | undefined =>
  new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];

/** Read a pen.dev line sketch: its viewBox and every stroked path, transforms applied. */
export function parseSketchSvg(svg: string): Sketch {
  const root = /<svg\b[^>]*>/.exec(svg)?.[0];
  const viewBox = root && attr(root, "viewBox");
  if (!viewBox) throw new Error("Sketch SVG has no viewBox");
  const [x, y, width, height] = viewBox.split(/[\s,]+/).map(Number) as [
    number,
    number,
    number,
    number,
  ];

  const elements = new Set([...svg.matchAll(/<([a-zA-Z]+)/g)].map((m) => m[1]));
  for (const name of elements) {
    if (name !== "svg" && name !== "g" && name !== "path") {
      throw new Error(`Sketch SVG uses unsupported <${name}>`);
    }
  }

  const strokes: SketchStroke[] = [];
  for (const group of svg.matchAll(/<g\b([^>]*)>([\s\S]*?)<\/g>/g)) {
    const matrix = parseTransform(attr(group[1] ?? "", "transform"));
    for (const path of (group[2] ?? "").matchAll(/<path\b[^>]*>/g)) {
      const d = attr(path[0], "d");
      const stroke = attr(path[0], "stroke");
      if (!d || !stroke) throw new Error("Sketch path without d or stroke");
      for (const polyline of parsePathData(d)) {
        strokes.push({
          stroke: stroke.toLowerCase(),
          polyline: {
            closed: polyline.closed,
            points: polyline.points.map((p) => applyMatrix(matrix, p)),
          },
        });
      }
    }
  }
  if (strokes.length === 0) throw new Error("Sketch SVG has no strokes");
  return { viewBox: { x, y, width, height }, strokes };
}
