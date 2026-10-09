import type { Vec } from "./geometry";
import { mulberry32 } from "./random";
import { samplePolyline } from "./sampling";
import { parseSketchSvg } from "./svg-path";

/**
 * The home page's ending: a hand on a mouse, drawn in particles (home finale,
 * stage 1: data only, nothing on the page reads it yet). Pure: no file access.
 *
 * The drawing is public/images/sketches/finale-grip.svg, our own line art (the
 * Pencil illustration "Palm Grip Technical Diagram", pvhPT). Each of its paths
 * names its role with `data-part`, and each role becomes a kind of particle:
 *
 *   hand-outline                  dust: the hand's and forearm's outline,
 *                                 with a few loose grains beside it
 *   hand-nail / -crease / -hatch  detail: nails and knuckle lines, finer and
 *                                 brighter; each nail has one highlight
 *   mouse-shell / -edge / -button stars: the mouse, with an inner rim
 *
 * Sizes, brightness and spacing follow the v8 polish in Pencil (frames u0JLvw
 * desktop, A2SMol phone), 未拍板 (candidate) like every number here. The
 * points are in the drawing's own units (its viewBox), sampled once per
 * density tier: the stage scales them to its layout.
 */

/** The finale's drawing in public/images/sketches/ (file name without `.svg`). It is not a mouse sketch. */
export const FINALE_SKETCH = "finale-grip";

export const FINALE_PARTS = [
  "hand-outline",
  "hand-crease",
  "hand-hatch",
  "hand-nail",
  "mouse-shell",
  "mouse-edge",
  "mouse-button",
] as const;
export type FinalePart = (typeof FINALE_PARTS)[number];

export const isMousePart = (part: FinalePart): boolean =>
  part.startsWith("mouse-");

/**
 * The particle kinds, by number (the JSON stores the number):
 * 0 dust, 1 satellite (a loose grain beside the dust), 2 detail, 3 highlight
 * (a nail's bright spot), 4 star (the mouse), 5 rim (the mouse's inner edge).
 */
export const FINALE_KINDS = [
  "dust",
  "satellite",
  "detail",
  "highlight",
  "star",
  "rim",
] as const;
export type FinaleKindName = (typeof FINALE_KINDS)[number];
export type FinaleKind = 0 | 1 | 2 | 3 | 4 | 5;
export const KIND: Readonly<Record<FinaleKindName, FinaleKind>> = {
  dust: 0,
  satellite: 1,
  detail: 2,
  highlight: 3,
  star: 4,
  rim: 5,
};

/** One look per level, dimmest first: diameter (CSS px at the tier's scale), colour, opacity. */
export interface LevelLook {
  readonly px: number;
  readonly colour: string;
  readonly alpha: number;
}

const looks = (
  px: readonly number[],
  colour: readonly string[],
  alpha: readonly number[],
): readonly LevelLook[] =>
  px.map((p, i) => ({ px: p, colour: colour[i]!, alpha: alpha[i]! }));

/**
 * How each kind looks, level by level (the v8 layers; 未拍板). A kind's level
 * count is its list's length; the JSON's levels stay inside it.
 */
export const FINALE_LOOK: Readonly<
  Record<FinaleKindName, readonly LevelLook[]>
> = {
  dust: looks(
    [0.9, 1.1, 1.35, 1.6, 1.85, 2.1, 2.4],
    [
      "#6E9BF5",
      "#86A9F6",
      "#9DBCF8",
      "#B9CFFA",
      "#CFE0FF",
      "#E2ECFF",
      "#F5F8FF",
    ],
    [0.35, 0.45, 0.55, 0.66, 0.78, 0.9, 1],
  ),
  satellite: looks([0.85], ["#9DBCF8"], [0.42]),
  detail: looks(
    [0.8, 1.0, 1.25, 1.5, 1.8],
    ["#4F7FE0", "#6E9BF5", "#8FB2F8", "#BCD2FF", "#EAF1FF"],
    [0.45, 0.6, 0.75, 0.88, 1],
  ),
  // The core; the stage adds a 7 px #9DBCF8 halo at 0.4 behind it.
  highlight: looks([2.4], ["#FFFFFF"], [1]),
  star: looks(
    [0.9, 1.15, 1.4, 1.7, 2.0, 2.4],
    ["#1F6BF0", "#3B82F6", "#5B95F7", "#7FA8FF", "#A9C4FF", "#DCE8FF"],
    [0.5, 0.6, 0.7, 0.8, 0.9, 1],
  ),
  rim: looks([0.9], ["#3B82F6"], [0.5]),
};

/** How many levels each kind has, by kind number. */
export const KIND_LEVELS: readonly number[] = FINALE_KINDS.map(
  (name) => FINALE_LOOK[name].length,
);

/**
 * A density tier: the drawing's scale in the layout it was tuned for (CSS px
 * per drawing unit), and the base spacing along a line there (CSS px).
 *
 * The scales are measured from the v17 desktop (EdWeI) and v18 phone (s3nxQl)
 * frames: x_frame = scale · x_drawing + offset, fitted point to curve
 * (iterated closest points) to v8's nail and knuckle particles, which v8
 * placed exactly on 32 (desktop) and 33 (phone) of the drawing's detail
 * paths: desktop 0.8781 with offset (396.95, 30.50), every particle within
 * 0.07 px of its path; phone 0.5286 with offset (0.50, 129.73), within
 * 0.07 px. (The frames' faint outline layer gives 0.8789 / 0.5291 but is
 * itself off its curves by up to 2.5 px; see fit-report.md outside the repo.)
 * The spacings are v8's (2.3 px desktop, 1.75 px phone). 未拍板.
 */
export interface FinaleTier {
  readonly scale: number;
  readonly spacing: number;
}
export const FINALE_TIERS = {
  desktop: { scale: 0.878, spacing: 2.3 },
  mobile: { scale: 0.529, spacing: 1.75 },
} as const satisfies Record<string, FinaleTier>;
export type FinaleTierName = keyof typeof FINALE_TIERS;
export const FINALE_TIER_NAMES = Object.keys(FINALE_TIERS) as FinaleTierName[];

/** The spacing of the plain line copies (`lines`), in drawing units (about 3.5 px on a desktop: a chord across a nail's tightest curve strays about 0.2 units). */
export const LINE_SPACING = 4;

export interface FinalePath {
  readonly part: FinalePart;
  readonly closed: boolean;
  /** In drawing units. */
  readonly points: readonly Vec[];
}

export interface FinaleDrawing {
  readonly viewBox: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly paths: readonly FinalePath[];
}

export interface FinalePoint {
  readonly x: number;
  readonly y: number;
  readonly kind: FinaleKind;
  /** 0 (dimmest) to the kind's level count less one. */
  readonly level: number;
  /** Where along its path the point was sampled, 0 (start) to 1 (end). */
  readonly u: number;
}

/** One path's share of a tier's points: `count` points from `start`, all from `lines[path]`. */
export interface FinaleRun {
  readonly start: number;
  readonly count: number;
  readonly path: number;
}

export interface FinaleTierTargets extends FinaleTier {
  readonly points: readonly FinalePoint[];
  readonly runs: readonly FinaleRun[];
}

export type Box = readonly [x0: number, y0: number, x1: number, y1: number];

export interface FinaleTargets {
  readonly version: 1;
  readonly seed: number;
  readonly viewBox: FinaleDrawing["viewBox"];
  readonly tiers: Readonly<Record<FinaleTierName, FinaleTierTargets>>;
  /** Every path as a plain line, about LINE_SPACING apart: for the glow under the particles and for cutting around the headline. */
  readonly lines: readonly FinalePath[];
  /** The whole figure's box and the mouse's, in drawing units. */
  readonly bounds: { readonly figure: Box; readonly mouse: Box };
}

const isPart = (value: string | undefined): value is FinalePart =>
  (FINALE_PARTS as readonly string[]).includes(value ?? "");

/** Read the finale's drawing. Every path must name a known part; the hand's outline and the mouse's shell must be there. */
export function readFinaleDrawing(svg: string): FinaleDrawing {
  const sketch = parseSketchSvg(svg);
  const paths = sketch.strokes.map(({ polyline, part }) => {
    if (!isPart(part)) {
      throw new Error(
        `Finale drawing: a path's data-part is ${part === undefined ? "missing" : `"${part}"`}`,
      );
    }
    return { part, closed: polyline.closed, points: polyline.points };
  });
  for (const needed of ["hand-outline", "mouse-shell"] as const) {
    if (!paths.some((p) => p.part === needed)) {
      throw new Error(`Finale drawing has no ${needed}`);
    }
  }
  return { viewBox: sketch.viewBox, paths };
}

export function boxOf(points: readonly Vec[]): Box {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of points) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (v: number) => {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
};

interface WalkPoint {
  readonly x: number;
  readonly y: number;
  /** Arc length from the path's start. */
  readonly s: number;
  /** The unit normal (left of the direction of travel). */
  readonly nx: number;
  readonly ny: number;
}

/**
 * Points along a polyline at a varying step: the first half a step in, then
 * `step(s, point)` after each. With the normal at each point. (v8's walk.)
 */
export function walkPolyline(
  points: readonly Vec[],
  step: (s: number, at: Vec) => number,
): { points: WalkPoint[]; length: number } {
  const cum = [0];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!;
    const b = points[i]!;
    cum.push(cum[i - 1]! + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const length = cum[cum.length - 1]!;
  const out: WalkPoint[] = [];
  if (points.length < 2 || length < 0.5) return { points: out, length };
  let s = step(0, points[0]!) * 0.5;
  let j = 1;
  while (s < length) {
    while (j < cum.length - 1 && cum[j]! < s) j += 1;
    const a = points[j - 1]!;
    const b = points[j]!;
    const u = (s - cum[j - 1]!) / (cum[j]! - cum[j - 1]! || 1);
    const x = a[0] + (b[0] - a[0]) * u;
    const y = a[1] + (b[1] - a[1]) * u;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const dl = Math.hypot(dx, dy) || 1;
    out.push({ x, y, s, nx: -dy / dl, ny: dx / dl });
    const next = step(s, [x, y]);
    if (!(next > 0)) throw new RangeError("walk step must be positive");
    s += next;
  }
  return { points: out, length };
}

/**
 * Sample the drawing for one tier, the v8 way (in the tier's CSS px, then back
 * to drawing units). Same drawing, tier and seed give the same points.
 */
export function sampleFinale(
  drawing: FinaleDrawing,
  tier: FinaleTier,
  seed: number,
): { points: FinalePoint[]; runs: FinaleRun[] } {
  if (!(tier.scale > 0) || !(tier.spacing > 0)) {
    throw new RangeError("a tier's scale and spacing must be positive");
  }
  const sc = tier.scale;
  const sp = tier.spacing;
  const r = mulberry32(seed);
  // In the tier's px; a closed path ends where it began.
  const paths = drawing.paths.map((p) => {
    const pts = p.points.map(([x, y]): Vec => [x * sc, y * sc]);
    if (p.closed && pts.length > 1) pts.push(pts[0]!);
    return { part: p.part, pts };
  });
  const figure = boxOf(paths.flatMap((p) => p.pts));
  const mouse = boxOf(
    paths.filter((p) => isMousePart(p.part)).flatMap((p) => p.pts),
  );
  const mouseCentre: Vec = [
    (mouse[0] + mouse[2]) / 2,
    (mouse[1] + mouse[3]) / 2,
  ];
  // Brighter toward the fingertips and the mouse: low and left in the figure.
  const toward = (x: number, y: number) => {
    const nx = (x - figure[0]) / (figure[2] - figure[0] || 1);
    const ny = (y - figure[1]) / (figure[3] - figure[1] || 1);
    return smoothstep(0.62 * ny + 0.38 * (1 - nx));
  };

  const points: FinalePoint[] = [];
  const runs: FinaleRun[] = [];
  const push = (
    x: number,
    y: number,
    kind: FinaleKind,
    level: number,
    u: number,
  ) => {
    const top = KIND_LEVELS[kind]! - 1;
    points.push({
      x: x / sc,
      y: y / sc,
      kind,
      level: Math.max(0, Math.min(top, level)),
      u: clamp01(u),
    });
  };

  paths.forEach(({ part, pts }, index) => {
    const start = points.length;
    if (pts.length >= 2) {
      const phase = r() * 6.28;
      if (part === "hand-outline") {
        const walk = walkPolyline(
          pts,
          (_s, [x, y]) => sp * (1.9 - 0.6 * toward(x, y)) * (0.85 + 0.3 * r()),
        );
        const L = walk.length;
        for (const d of walk.points) {
          const taper =
            0.35 + 0.65 * smoothstep(Math.min(d.s, L - d.s) / (24 * sc + 4));
          const I = clamp01(
            (0.12 + 0.88 * toward(d.x, d.y)) *
              taper *
              (0.82 + 0.36 * (0.5 + 0.5 * Math.sin(d.s * 0.045 + phase))),
          );
          const j = (r() - 0.5) * 0.6;
          push(
            d.x + d.nx * j,
            d.y + d.ny * j,
            KIND.dust,
            Math.floor(I * 7),
            d.s / L,
          );
          if (r() < 0.16) {
            const off =
              (r() < 0.5 ? -1 : 1) * (1.8 + 4.5 * r()) * Math.max(sc, 0.7);
            push(
              d.x + d.nx * off,
              d.y + d.ny * off,
              KIND.satellite,
              0,
              d.s / L,
            );
          }
        }
      } else if (part === "hand-nail") {
        // The highlight sits at the nail's upper-left-most point.
        let hi = 0;
        let best = Infinity;
        pts.forEach(([x, y], i) => {
          const v = x * 0.45 + y;
          if (v < best) {
            best = v;
            hi = i;
          }
        });
        let hs = 0;
        for (let i = 1; i <= hi; i += 1) {
          hs += Math.hypot(
            pts[i]![0] - pts[i - 1]![0],
            pts[i]![1] - pts[i - 1]![1],
          );
        }
        const walk = walkPolyline(pts, () => sp * 0.7);
        const L = walk.length;
        for (const d of walk.points) {
          let dd = Math.abs(d.s - hs);
          dd = Math.min(dd, L - dd);
          const I = 0.3 + 0.7 * Math.exp(-((dd / (0.2 * L)) ** 2));
          push(d.x, d.y, KIND.detail, Math.floor(I * 5), d.s / L);
        }
        if (L >= 0.5) {
          const h = pts[hi]!;
          push(h[0], h[1], KIND.highlight, 0, hs / L);
        }
      } else if (
        part === "hand-crease" ||
        part === "hand-hatch" ||
        part === "mouse-button"
      ) {
        const hatch = part === "hand-hatch";
        const button = part === "mouse-button";
        const walk = walkPolyline(pts, () => sp * (hatch ? 1.0 : 0.8));
        const L = walk.length;
        for (const d of walk.points) {
          const I =
            (hatch
              ? 0.25
              : 0.3 + 0.7 * Math.exp(-(((d.s / L - 0.5) / 0.3) ** 2))) *
            (0.55 + 0.45 * toward(d.x, d.y));
          push(
            d.x,
            d.y,
            button ? KIND.star : KIND.detail,
            Math.floor(I * (button ? 6 : 5)),
            d.s / L,
          );
        }
      } else {
        // mouse-shell, mouse-edge: stars, brighter toward the mouse's front.
        const shell = part === "mouse-shell";
        let count = 0;
        const walk = walkPolyline(pts, () => sp * 1.15 * (0.9 + 0.2 * r()));
        const L = walk.length;
        for (const d of walk.points) {
          const my = clamp01((d.y - mouse[1]) / (mouse[3] - mouse[1] || 1));
          const taper =
            0.45 + 0.55 * smoothstep(Math.min(d.s, L - d.s) / (20 * sc + 4));
          const I = clamp01(
            (0.25 + 0.75 * my) * taper + 0.1 * Math.sin(d.s * 0.03 + phase),
          );
          push(d.x, d.y, KIND.star, Math.floor(I * 6), d.s / L);
          count += 1;
          if (shell && my > 0.35 && count % 2 === 0) {
            // A fainter grain just inside the shell, toward the mouse's centre.
            const vx = mouseCentre[0] - d.x;
            const vy = mouseCentre[1] - d.y;
            const sign = d.nx * vx + d.ny * vy > 0 ? 1 : -1;
            push(
              d.x + d.nx * sign * 3.2 * sc,
              d.y + d.ny * sign * 3.2 * sc,
              KIND.rim,
              0,
              d.s / L,
            );
          }
        }
      }
    }
    const count = points.length - start;
    if (count > 0) runs.push({ start, count, path: index });
  });
  return { points, runs };
}

/** Build the finale's targets from its drawing's SVG text. */
export function buildFinale(svg: string, seed: number): FinaleTargets {
  const drawing = readFinaleDrawing(svg);
  const tier = (name: FinaleTierName): FinaleTierTargets => {
    const { scale, spacing } = FINALE_TIERS[name];
    return {
      scale,
      spacing,
      ...sampleFinale(drawing, { scale, spacing }, seed),
    };
  };
  const tiers = { desktop: tier("desktop"), mobile: tier("mobile") };
  const lines = drawing.paths.map((p) => ({
    part: p.part,
    closed: p.closed,
    points: samplePolyline(p.points, LINE_SPACING, p.closed),
  }));
  return {
    version: 1,
    seed,
    viewBox: drawing.viewBox,
    tiers,
    lines,
    bounds: {
      figure: boxOf(drawing.paths.flatMap((p) => p.points)),
      mouse: boxOf(
        drawing.paths
          .filter((p) => isMousePart(p.part))
          .flatMap((p) => p.points),
      ),
    },
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The finale's JSON (finale.generated.json), one line: a tier's points as
 * [x, y, kind, level, u] (x, y to 0.1 drawing unit, u to 0.01), its runs as
 * [start, count, path], each line as [part, closed, [x, y]...]. Separate from
 * targets.generated.json so the page that does not show the finale never
 * downloads it.
 */
export function serializeFinale(finale: FinaleTargets): string {
  const box = (b: Box) => b.map(round1);
  return (
    JSON.stringify({
      version: finale.version,
      seed: finale.seed,
      viewBox: Object.fromEntries(
        Object.entries(finale.viewBox).map(([k, v]) => [k, round1(v)]),
      ),
      kinds: FINALE_KINDS,
      parts: FINALE_PARTS,
      tiers: Object.fromEntries(
        FINALE_TIER_NAMES.map((name) => {
          const t = finale.tiers[name];
          return [
            name,
            {
              scale: t.scale,
              spacing: t.spacing,
              points: t.points.map((p) => [
                round1(p.x),
                round1(p.y),
                p.kind,
                p.level,
                round2(p.u),
              ]),
              runs: t.runs.map((run) => [run.start, run.count, run.path]),
            },
          ];
        }),
      ),
      lines: finale.lines.map((line) => [
        FINALE_PARTS.indexOf(line.part),
        line.closed ? 1 : 0,
        line.points.map(([x, y]) => [round1(x), round1(y)]),
      ]),
      bounds: {
        figure: box(finale.bounds.figure),
        mouse: box(finale.bounds.mouse),
      },
    }) + "\n"
  );
}
