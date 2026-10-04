import type { Vec } from "./geometry";
import type { TargetPoint } from "./sampling";
import type { Line, ParticleTargets, ShapeTarget } from "./targets";

/**
 * Reads `targets.generated.json` (the one-line file scripts/build-particle-
 * targets.ts writes; see `serializeTargets`) back into typed point lists, so
 * the browser never parses SVG. Rejects a file that is not what the generator
 * writes, instead of drawing nonsense.
 */

type Json = unknown;

function fail(what: string): never {
  throw new TypeError(`particle targets: ${what}`);
}

function isRecord(value: Json): value is Record<string, Json> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function num(value: Json, what: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(what);
  return value;
}

function vec(value: Json, what: string): Vec {
  if (!Array.isArray(value) || value.length !== 2) fail(what);
  return [num(value[0], what), num(value[1], what)];
}

function line(value: Json, what: string): Line {
  if (!isRecord(value)) fail(what);
  return { from: vec(value.from, what), to: vec(value.to, what) };
}

function points(value: Json, what: string): TargetPoint[] {
  if (!Array.isArray(value) || value.length === 0) fail(what);
  return value.map((triple) => {
    if (!Array.isArray(triple) || triple.length !== 3) fail(what);
    const tone = triple[2];
    if (tone !== 0 && tone !== 1) fail(`${what}: a tone is 0 or 1`);
    return { x: num(triple[0], what), y: num(triple[1], what), tone };
  });
}

function shape(value: Json, what: string): ShapeTarget {
  if (!isRecord(value)) fail(what);
  return {
    width: num(value.width, what),
    height: num(value.height, what),
    points: points(value.points, what),
  };
}

export function parseTargets(json: Json): ParticleTargets {
  if (!isRecord(json) || json.version !== 1) fail("expected version 1");
  const { hand, mice } = json;
  if (!isRecord(hand)) fail("hand");
  if (!isRecord(mice)) fail("mice");
  const box = hand.viewBox;
  const a4 = hand.a4;
  if (!isRecord(box) || !isRecord(a4)) fail("hand frame");
  const skeleton = hand.skeleton;
  if (!Array.isArray(skeleton)) fail("skeleton");
  const extensions = hand.lengthExtensions;
  if (!Array.isArray(extensions) || extensions.length !== 2) {
    fail("length extensions");
  }
  const ticks = hand.ticks;
  if (!Array.isArray(ticks)) fail("ticks");
  const landmarks = hand.landmarks;
  if (!Array.isArray(landmarks) || landmarks.length !== 21) {
    fail("expected 21 landmarks");
  }
  return {
    version: 1,
    seed: num(json.seed, "seed"),
    stageWidth: num(json.stageWidth, "stage width"),
    logo: shape(json.logo, "logo"),
    hand: {
      viewBox: {
        x: num(box.x, "viewBox"),
        y: num(box.y, "viewBox"),
        width: num(box.width, "viewBox"),
        height: num(box.height, "viewBox"),
      },
      a4: { width: num(a4.width, "a4"), height: num(a4.height, "a4") },
      points: points(hand.points, "hand points"),
      landmarks: landmarks.map((p) => vec(p, "landmark")),
      skeleton: skeleton.map((pair) => {
        const [a, b] = vec(pair, "skeleton edge");
        return [a, b] as const;
      }),
      lengthLine: line(hand.lengthLine, "length line"),
      lengthExtensions: [
        line(extensions[0], "length extension"),
        line(extensions[1], "length extension"),
      ],
      widthLine: line(hand.widthLine, "width line"),
      ticks: ticks.map((t) => line(t, "tick")),
    },
    mice: Object.fromEntries(
      Object.entries(mice).map(([name, m]) => [
        name,
        shape(m, `mouse ${name}`),
      ]),
    ),
  };
}
