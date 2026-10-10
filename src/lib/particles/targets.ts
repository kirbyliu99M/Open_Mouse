import { FINALE_SKETCH } from "./finale-targets";
import type { Polyline, Vec } from "./geometry";
import { LOGO_BOX, sampleLogoPoints } from "./logo";
import {
  type StrokeRun,
  type TargetPoint,
  sampleStrokeRuns,
  type SamplingStyle,
} from "./sampling";
import { parseSketchSvg } from "./svg-path";
import {
  A4_MM,
  HAND_MARGIN_MM,
  LANDMARKS_MM,
  LENGTH_LINE_MM,
  SKELETON,
  STAGE_SCALE,
  TICK_MM,
  WIDTH_LINE_MM,
  fillTemplateHand,
} from "./template-hand";

/**
 * The sampling half of the particle-target generator (PR A of Home v3; spec:
 * docs/design/home-v3-2026-10-03/README.md, "Targets"). Pure: no file access.
 * scripts/build-particle-targets.ts feeds it the sketches and writes the
 * results. Pairing and interpolation are PR B.
 *
 * Every point list is in "stage px": mice at a 340 px stage width, the hand
 * with its A4 sheet 340 px wide, the logo in its own 195 × 207 box.
 */

export const STAGE_WIDTH = 340;
/** Primary strokes are sampled about every 2.6 px, detail strokes about every 4.2 px. */
export const SAMPLING: SamplingStyle = { brightSpacing: 2.6, dimSpacing: 4.2 };
/** How many particles fill the template hand before resampling to the budget. */
export const HAND_FILL_COUNT = 1400;
export const DEFAULT_SEED = 20261003;

/** The two stroke colours the static sketches use (README, "Static images"). */
export const PRIMARY_STROKE = "#cfe0ff";
export const DETAIL_STROKE = "#6e9bf5";

export interface ShapeTarget {
  readonly width: number;
  readonly height: number;
  readonly points: readonly TargetPoint[];
  /** Which consecutive points make up each stroke (see `StrokeRun`). */
  readonly runs: readonly StrokeRun[];
}

export interface Line {
  readonly from: Vec;
  readonly to: Vec;
}

export interface HandTarget {
  /** The drawing's own viewBox, a little larger than the sheet so the ruler fits. */
  readonly viewBox: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly a4: { readonly width: number; readonly height: number };
  /** The particles that fill the hand. */
  readonly points: readonly TargetPoint[];
  /** The 21 MediaPipe landmarks, in order. */
  readonly landmarks: readonly Vec[];
  readonly skeleton: readonly (readonly [number, number])[];
  /** The hand-length ruler and its two extension lines, then the palm-width line. NO numbers. */
  readonly lengthLine: Line;
  readonly lengthExtensions: readonly [Line, Line];
  readonly widthLine: Line;
  /** The end ticks of both measurement lines: each a short line across the end. */
  readonly ticks: readonly Line[];
}

export interface ParticleTargets {
  readonly version: 1;
  readonly seed: number;
  readonly stageWidth: number;
  readonly logo: ShapeTarget;
  readonly hand: HandTarget;
  /** One entry per mouse sketch in public/images/sketches/ (all but the finale's), keyed by file name without the extension. */
  readonly mice: Readonly<Record<string, ShapeTarget>>;
}

/** Which tone a sketch's stroke colour stands for. Unknown colours throw. */
export function toneOfStroke(stroke: string): 0 | 1 {
  const colour = stroke.toLowerCase();
  if (colour === PRIMARY_STROKE) return 1;
  if (colour === DETAIL_STROKE) return 0;
  throw new Error(
    `Sketch stroke ${stroke} is neither the primary (${PRIMARY_STROKE}) nor the detail (${DETAIL_STROKE}) colour`,
  );
}

/** Sample one sketch at a 340 px stage width. */
export function sampleSketch(svg: string): ShapeTarget {
  const sketch = parseSketchSvg(svg);
  const scale = STAGE_WIDTH / sketch.viewBox.width;
  const strokes = sketch.strokes.map(({ polyline, stroke }) => ({
    tone: toneOfStroke(stroke),
    polyline: {
      closed: polyline.closed,
      points: polyline.points.map(([x, y]): Vec => [
        (x - sketch.viewBox.x) * scale,
        (y - sketch.viewBox.y) * scale,
      ]),
    } satisfies Polyline,
  }));
  return {
    width: STAGE_WIDTH,
    height: sketch.viewBox.height * scale,
    ...sampleStrokeRuns(strokes, SAMPLING),
  };
}

/** The Palmate mark's cloud of points (see logo.ts), in its own box. Not seeded by the generator: the logo is the same for every seed. */
export function sampleLogo(): ShapeTarget {
  return {
    width: LOGO_BOX.width,
    height: LOGO_BOX.height,
    ...sampleLogoPoints(),
  };
}

const px = ([x, y]: Vec): Vec => [x * STAGE_SCALE, y * STAGE_SCALE];

export function buildHand(seed: number, count = HAND_FILL_COUNT): HandTarget {
  const L = LENGTH_LINE_MM;
  const W = WIDTH_LINE_MM;
  const tick = (center: Vec, horizontal: boolean): Line => ({
    from: px(
      horizontal
        ? [center[0] - TICK_MM, center[1]]
        : [center[0], center[1] - TICK_MM],
    ),
    to: px(
      horizontal
        ? [center[0] + TICK_MM, center[1]]
        : [center[0], center[1] + TICK_MM],
    ),
  });
  const margin = HAND_MARGIN_MM;
  return {
    viewBox: {
      x: -margin.left * STAGE_SCALE,
      y: -margin.top * STAGE_SCALE,
      width: (A4_MM.width + margin.left + margin.right) * STAGE_SCALE,
      height: (A4_MM.height + margin.top + margin.bottom) * STAGE_SCALE,
    },
    a4: {
      width: A4_MM.width * STAGE_SCALE,
      height: A4_MM.height * STAGE_SCALE,
    },
    points: fillTemplateHand(count, seed),
    landmarks: LANDMARKS_MM.map(px),
    skeleton: SKELETON,
    lengthLine: { from: px([L.x, L.top]), to: px([L.x, L.bottom]) },
    lengthExtensions: [
      { from: px([L.topFrom, L.top]), to: px([L.x, L.top]) },
      { from: px([L.bottomFrom, L.bottom]), to: px([L.x, L.bottom]) },
    ],
    widthLine: { from: px([W.left, W.y]), to: px([W.right, W.y]) },
    ticks: [
      tick([L.x, L.top], true),
      tick([L.x, L.bottom], true),
      tick([W.left, W.y], false),
      tick([W.right, W.y], false),
    ],
  };
}

/**
 * Whether a drawing in public/images/sketches/ is a mouse sketch: every one is
 * except the finale's hand on a mouse (finale-targets.ts), which has its own
 * output file.
 */
export function isMouseSketch(name: string): boolean {
  return name !== FINALE_SKETCH;
}

/** Sample everything. `sketches` maps a sketch's name (file name without `.svg`) to its SVG text; the finale's drawing among them is skipped here. */
export function buildTargets(
  sketches: Readonly<Record<string, string>>,
  seed = DEFAULT_SEED,
): ParticleTargets {
  const mice: Record<string, ShapeTarget> = {};
  for (const name of Object.keys(sketches).filter(isMouseSketch).sort()) {
    mice[name] = sampleSketch(sketches[name]!);
  }
  return {
    version: 1,
    seed,
    stageWidth: STAGE_WIDTH,
    logo: sampleLogo(),
    hand: buildHand(seed),
    mice,
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * The JSON the browser will load (PR B): one file on one line, every number
 * rounded to 0.1 px, points as [x, y, tone] triples and each stroke of the logo
 * and the mice as a [start, count, closed] run over those points. The browser
 * never parses SVG.
 */
export function serializeTargets(targets: ParticleTargets): string {
  const pts = (points: readonly TargetPoint[]) =>
    points.map((p) => [round1(p.x), round1(p.y), p.tone]);
  const vec = (v: Vec) => [round1(v[0]), round1(v[1])];
  const line = (l: Line) => ({ from: vec(l.from), to: vec(l.to) });
  const shape = (s: ShapeTarget) => ({
    width: round1(s.width),
    height: round1(s.height),
    points: pts(s.points),
    // [start, count, closed] per stroke.
    runs: s.runs.map((r) => [r.start, r.count, r.closed ? 1 : 0]),
  });
  const { hand } = targets;
  return (
    JSON.stringify({
      version: targets.version,
      seed: targets.seed,
      stageWidth: targets.stageWidth,
      logo: shape(targets.logo),
      hand: {
        viewBox: Object.fromEntries(
          Object.entries(hand.viewBox).map(([k, v]) => [k, round1(v)]),
        ),
        a4: { width: round1(hand.a4.width), height: round1(hand.a4.height) },
        points: pts(hand.points),
        landmarks: hand.landmarks.map(vec),
        skeleton: hand.skeleton,
        lengthLine: line(hand.lengthLine),
        lengthExtensions: hand.lengthExtensions.map(line),
        widthLine: line(hand.widthLine),
        ticks: hand.ticks.map(line),
      },
      mice: Object.fromEntries(
        Object.entries(targets.mice).map(([name, s]) => [name, shape(s)]),
      ),
    }) + "\n"
  );
}
