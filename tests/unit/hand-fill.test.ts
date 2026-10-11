import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ARTIFACT_PATHS } from "@/lib/particles/artifacts";
import type { Vec } from "@/lib/particles/geometry";
import {
  FILL_INSET_MM,
  fillTemplateHand,
  insideHandFill,
} from "@/lib/particles/hand-fill";
import {
  OUTLINE_FINGERS,
  OUTLINE_PALM,
  distanceToPolyline,
  insideHandOutline,
} from "@/lib/particles/hand-outline";
import { parseTargets } from "@/lib/particles/load-targets";
import { STAGE_SCALE } from "@/lib/particles/template-hand";

const targets = parseTargets(
  JSON.parse(readFileSync(ARTIFACT_PATHS.targets, "utf8")),
);
const toMm = (x: number, y: number): Vec => [x / STAGE_SCALE, y / STAGE_SCALE];
const FINGER_NAMES = ["thumb", "index", "middle", "ring", "pinky"] as const;

/** A dense fill, so the statistics below are stable: 20,000 points in mm. */
const dense: Vec[] = fillTemplateHand(20000, 20261011).map((p) =>
  toMm(p.x, p.y),
);

function insidePolygon([x, y]: Vec, polygon: readonly Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, yi] = polygon[i]!;
    const [xj, yj] = polygon[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Which part of the outline a point is in: 0-4 a finger (thumb first), 5 the palm, -1 none. */
function partOf(p: Vec): number {
  const { polygon, width } = OUTLINE_PALM;
  if (
    insidePolygon(p, polygon) ||
    distanceToPolyline(p, polygon, true) <= width / 2
  ) {
    return 5;
  }
  let best = -1;
  let bestDistance = Infinity;
  OUTLINE_FINGERS.forEach(({ chain, width: w }, i) => {
    const d = distanceToPolyline(p, chain);
    if (d <= w / 2 && d < bestDistance) {
      best = i;
      bestDistance = d;
    }
  });
  return best;
}

describe("the hand's particle fill: the outline's own shape", () => {
  it("keeps every committed particle (1,400) and 20,000 more at least the inset inside the outline", () => {
    const committed = targets.hand.points.map((p) => toMm(p.x, p.y));
    expect(committed).toHaveLength(1400);
    // The committed points are rounded to 0.1 stage px (up to 0.044 mm off
    // diagonally), so they get 0.05 mm of that back; the unrounded ones none.
    for (const p of committed) {
      expect(insideHandOutline(p, FILL_INSET_MM - 0.05), `${p}`).toBe(true);
    }
    for (const p of dense) {
      expect(insideHandOutline(p, FILL_INSET_MM), `${p}`).toBe(true);
    }
  });

  it("reaches across each finger: the particles' spread is at least 80 % of the outline's half-width", () => {
    // The two outer segments of each finger (PIP to DIP, DIP to tip), away
    // from the palm. For the points over the middle 60 % of a segment, the
    // 99th percentile of their distance from the segment's line, against the
    // outline's half-width there. Measured with this fill: 0.83-0.86 (inset
    // 1.5 mm of 9.2-11.2). With the capsule fill used until 2026-10-11 it was
    // 0.55-0.70 (the capsules were 5-7 mm half-wide there).
    OUTLINE_FINGERS.forEach(({ chain, width }, f) => {
      for (const i of [1, 2]) {
        const a = chain[i]!;
        const b = chain[i + 1]!;
        const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const u: Vec = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
        const offsets: number[] = [];
        for (const p of dense) {
          const t = ((p[0] - a[0]) * u[0] + (p[1] - a[1]) * u[1]) / length;
          if (t < 0.2 || t > 0.8) continue;
          const d = Math.abs((p[0] - a[0]) * -u[1] + (p[1] - a[1]) * u[0]);
          if (d < width) offsets.push(d);
        }
        offsets.sort((x, y) => x - y);
        const spread = offsets[Math.floor(offsets.length * 0.99)]!;
        expect(
          spread / (width / 2),
          `${FINGER_NAMES[f]} segment ${i}`,
        ).toBeGreaterThan(0.8);
      }
    });
  });

  it("covers the outline's area: at least 88 % of it, and every part of it", () => {
    // On a 0.5 mm grid. Measured: 90.6 % of the whole (the rest is the 1.5 mm
    // band inside the edge). The capsule fill covered 71.5 %.
    const step = 0.5;
    const outline = new Array<number>(6).fill(0);
    const filled = new Array<number>(6).fill(0);
    for (let x = 0; x <= 210; x += step) {
      for (let y = 0; y <= 297; y += step) {
        const p: Vec = [x, y];
        if (!insideHandOutline(p)) continue;
        const part = partOf(p);
        outline[part] += 1;
        if (insideHandFill(p)) filled[part] += 1;
      }
    }
    const total = filled.reduce((s, n) => s + n, 0);
    const whole = outline.reduce((s, n) => s + n, 0);
    expect(total / whole).toBeGreaterThan(0.88);
    // Each finger and the palm on its own. Measured: fingers 0.81-0.85 (the
    // pinky, the narrowest, lowest), palm 0.96; the capsule fill had fingers
    // 0.58-0.66 and palm 0.79.
    [...FINGER_NAMES, "palm"].forEach((name, i) => {
      expect(filled[i]! / outline[i]!, name).toBeGreaterThan(0.8);
    });
  });

  it("is as dense in the fingers and thumb as in the palm (within 15 %)", () => {
    // Density = points per mm² of the filled area of each part, from the dense
    // fill. Rejection sampling is uniform, so this holds up to noise (measured
    // 0.99-1.02 of the palm's); the bound is there to catch a fill that favours
    // one part.
    const step = 0.5;
    const area = new Array<number>(6).fill(0);
    for (let x = 0; x <= 210; x += step) {
      for (let y = 0; y <= 297; y += step) {
        const p: Vec = [x, y];
        if (insideHandFill(p)) area[partOf(p)] += step * step;
      }
    }
    const count = new Array<number>(6).fill(0);
    for (const p of dense) count[partOf(p)] += 1;
    const palm = count[5]! / area[5]!;
    FINGER_NAMES.forEach((name, i) => {
      const ratio = count[i]! / area[i]! / palm;
      expect(ratio, name).toBeGreaterThan(0.85);
      expect(ratio, name).toBeLessThan(1.15);
    });
  });

  it("fills the places the old fill left empty: the palm's little-finger side, the wrist and the fingers' sides", () => {
    // Each point is inside the outline and was outside the capsule fill.
    const samples: [string, Vec][] = [
      ["palm, little-finger side", [160, 215]],
      ["wrist, above the base", [115, 252]],
      ["thumb web", [80, 205]],
      ["middle finger, left side", [115.3 - 8.5, 90]],
      ["index finger, right side", [77.5 + 8.5, 95]],
    ];
    for (const [name, p] of samples) {
      expect(insideHandFill(p), name).toBe(true);
    }
  });
});
