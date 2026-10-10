import {
  type Box,
  FINALE_KINDS,
  FINALE_PARTS,
  FINALE_TIER_NAMES,
  type FinaleKind,
  type FinalePath,
  type FinalePoint,
  type FinaleRun,
  type FinaleTargets,
  type FinaleTierName,
  type FinaleTierTargets,
  KIND_LEVELS,
} from "./finale-targets";
import { type Json, fail, isRecord, num, vec } from "./load-targets";

/**
 * Reads `finale.generated.json` (see `serializeFinale`) back into typed
 * lists. A module of its own, so the page that never shows the finale does not
 * carry its reader or its tables.
 */

function box(value: Json, what: string): Box {
  if (!Array.isArray(value) || value.length !== 4) fail(what);
  const [x0, y0, x1, y1] = value.map((n) => num(n, what)) as [
    number,
    number,
    number,
    number,
  ];
  if (x1 < x0 || y1 < y0) fail(what);
  return [x0, y0, x1, y1];
}

function finaleTier(
  value: Json,
  lineCount: number,
  what: string,
): FinaleTierTargets {
  if (!isRecord(value)) fail(what);
  const scale = num(value.scale, `${what} scale`);
  const spacing = num(value.spacing, `${what} spacing`);
  if (!(scale > 0) || !(spacing > 0)) fail(`${what}: scale and spacing > 0`);
  if (!Array.isArray(value.points) || value.points.length === 0) {
    fail(`${what} points`);
  }
  const list: FinalePoint[] = value.points.map((tuple) => {
    if (!Array.isArray(tuple) || tuple.length !== 5) fail(`${what} points`);
    const [x, y, kind, level, u] = tuple as unknown[];
    if (!Number.isInteger(kind) || (kind as number) < 0) {
      fail(`${what}: a kind is 0 to ${KIND_LEVELS.length - 1}`);
    }
    const levels = KIND_LEVELS[kind as number];
    if (levels === undefined) {
      fail(`${what}: a kind is 0 to ${KIND_LEVELS.length - 1}`);
    }
    if (
      !Number.isInteger(level) ||
      (level as number) < 0 ||
      (level as number) >= levels
    ) {
      fail(`${what}: a level is inside its kind's levels`);
    }
    const along = num(u, `${what} u`);
    if (along < 0 || along > 1) fail(`${what}: u is 0 to 1`);
    return {
      x: num(x, what),
      y: num(y, what),
      kind: kind as FinaleKind,
      level: level as number,
      u: along,
    };
  });
  if (!Array.isArray(value.runs) || value.runs.length === 0) {
    fail(`${what} runs`);
  }
  let next = 0;
  let lastPath = -1;
  const runList: FinaleRun[] = value.runs.map((triple) => {
    if (!Array.isArray(triple) || triple.length !== 3) fail(`${what} runs`);
    const [start, count, path] = triple as unknown[];
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(count) ||
      !Number.isInteger(path)
    ) {
      fail(`${what}: a run is [start, count, path]`);
    }
    const from = start as number;
    const length = count as number;
    const line = path as number;
    // The generator writes the runs back to back: each starts where the last
    // ended, and together they cover every point.
    if (from > next) fail(`${what}: a gap between runs`);
    if (from < next || length < 1 || from + length > list.length) {
      fail(`${what}: a run lies outside the points or overlaps another`);
    }
    // One run per path at most, in path order.
    if (line <= lastPath || line >= lineCount) fail(`${what}: a run's path`);
    lastPath = line;
    next = from + length;
    return { start: from, count: length, path: line };
  });
  if (next !== list.length) fail(`${what}: the runs leave points uncovered`);
  return { scale, spacing, points: list, runs: runList };
}

/** Read `finale.generated.json` (see `serializeFinale`) back into typed lists. Rejects anything the generator would not write. */
export function parseFinaleTargets(json: Json): FinaleTargets {
  if (!isRecord(json) || json.version !== 1) fail("finale: expected version 1");
  const { viewBox, tiers, lines, bounds } = json;
  // The file names its kinds and parts; a file written with another order
  // would be read wrong, so they must match this build's lists exactly.
  const sameList = (value: Json, list: readonly string[]) =>
    Array.isArray(value) &&
    value.length === list.length &&
    value.every((v, i) => v === list[i]);
  if (!sameList(json.kinds, FINALE_KINDS))
    fail("finale kinds differ from FINALE_KINDS");
  if (!sameList(json.parts, FINALE_PARTS))
    fail("finale parts differ from FINALE_PARTS");
  if (!isRecord(viewBox)) fail("finale viewBox");
  if (!isRecord(tiers)) fail("finale tiers");
  if (!isRecord(bounds)) fail("finale bounds");
  if (!Array.isArray(lines) || lines.length === 0) fail("finale lines");
  const lineList: FinalePath[] = lines.map((entry) => {
    if (!Array.isArray(entry) || entry.length !== 3) fail("finale line");
    const [part, closed, pts] = entry as unknown[];
    const name = FINALE_PARTS[part as number];
    if (!Number.isInteger(part) || name === undefined) {
      fail("finale line: unknown part");
    }
    if (closed !== 0 && closed !== 1) fail("finale line: closed is 0 or 1");
    if (!Array.isArray(pts) || pts.length === 0) fail("finale line points");
    return {
      part: name,
      closed: closed === 1,
      points: pts.map((p) => vec(p, "finale line point")),
    };
  });
  const frame = {
    x: num(viewBox.x, "finale viewBox"),
    y: num(viewBox.y, "finale viewBox"),
    width: num(viewBox.width, "finale viewBox"),
    height: num(viewBox.height, "finale viewBox"),
  };
  if (!(frame.width > 0) || !(frame.height > 0)) {
    fail("finale viewBox: width and height > 0");
  }
  const parsedTiers = Object.fromEntries(
    FINALE_TIER_NAMES.map((name) => [
      name,
      finaleTier(tiers[name], lineList.length, `finale ${name}`),
    ]),
  ) as Record<FinaleTierName, FinaleTierTargets>;
  return {
    version: 1,
    seed: num(json.seed, "finale seed"),
    viewBox: frame,
    tiers: parsedTiers,
    lines: lineList,
    bounds: {
      figure: box(bounds.figure, "finale figure box"),
      mouse: box(bounds.mouse, "finale mouse box"),
    },
  };
}
