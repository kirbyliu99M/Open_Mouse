import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { ARTIFACT_PATHS, SKETCH_DIR } from "@/lib/particles/artifacts";
import {
  FINALE_KINDS,
  FINALE_LOOK,
  FINALE_PARTS,
  FINALE_SKETCH,
  FINALE_TIERS,
  KIND,
  KIND_LEVELS,
  LINE_SPACING,
  boxOf,
  buildFinale,
  readFinaleDrawing,
  sampleFinale,
  serializeFinale,
  walkPolyline,
} from "@/lib/particles/finale-targets";
import { type Vec, distance } from "@/lib/particles/geometry";
import { parseFinaleTargets } from "@/lib/particles/load-finale";
import { DEFAULT_SEED } from "@/lib/particles/targets";

const svg = readFileSync(`${SKETCH_DIR}/${FINALE_SKETCH}.svg`, "utf8");
const drawing = readFinaleDrawing(svg);
const committed = readFileSync(ARTIFACT_PATHS.finale, "utf8");
const finale = parseFinaleTargets(JSON.parse(committed));

function distanceToPolyline(point: Vec, points: readonly Vec[]): number {
  let best = Infinity;
  for (let i = 0; i + 1 < points.length; i += 1) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    const t =
      l2 === 0
        ? 0
        : Math.max(
            0,
            Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / l2),
          );
    best = Math.min(best, distance(point, [a[0] + dx * t, a[1] + dy * t]));
  }
  return best;
}

describe("the finale's drawing", () => {
  it("names every path's part, with the hand first and the mouse after", () => {
    expect(drawing.paths.length).toBeGreaterThan(30);
    for (const p of drawing.paths) expect(FINALE_PARTS).toContain(p.part);
    const parts = new Set(drawing.paths.map((p) => p.part));
    expect(parts).toEqual(new Set(FINALE_PARTS));
    // Five nails, one mouse shell.
    expect(drawing.paths.filter((p) => p.part === "hand-nail")).toHaveLength(5);
    expect(drawing.paths.filter((p) => p.part === "mouse-shell")).toHaveLength(
      1,
    );
    const firstMouse = drawing.paths.findIndex((p) =>
      p.part.startsWith("mouse-"),
    );
    expect(
      drawing.paths.slice(firstMouse).every((p) => p.part.startsWith("mouse-")),
    ).toBe(true);
  });

  it("sits inside its viewBox, the mouse in the lower left of the figure", () => {
    const { viewBox } = drawing;
    const figure = boxOf(drawing.paths.flatMap((p) => p.points));
    expect(figure[0]).toBeGreaterThanOrEqual(viewBox.x);
    expect(figure[1]).toBeGreaterThanOrEqual(viewBox.y);
    expect(figure[2]).toBeLessThanOrEqual(viewBox.x + viewBox.width);
    expect(figure[3]).toBeLessThanOrEqual(viewBox.y + viewBox.height);
    const mouse = boxOf(
      drawing.paths
        .filter((p) => p.part.startsWith("mouse-"))
        .flatMap((p) => p.points),
    );
    expect(mouse[3]).toBeCloseTo(figure[3], 0);
    // Its centre is left of and below the figure's.
    expect(mouse[0] + mouse[2]).toBeLessThan(figure[0] + figure[2]);
    expect(mouse[1] + mouse[3]).toBeGreaterThan(figure[1] + figure[3]);
  });

  it("is only lines: no text, no images, no fills", () => {
    expect(svg).not.toMatch(/<text|<image|<use|font-|href=/);
    expect(svg).not.toMatch(/fill="#/);
  });

  it("refuses a path without a known part, and a drawing without the hand's outline or the mouse", () => {
    const one = (attrs: string) =>
      `<svg viewBox="0 0 10 10"><path ${attrs} stroke="#fff" d="M0 0L5 5"/></svg>`;
    expect(() => readFinaleDrawing(one(""))).toThrow(/missing/);
    expect(() => readFinaleDrawing(one('data-part="tail"'))).toThrow(/"tail"/);
    expect(() => readFinaleDrawing(one('data-part="hand-outline"'))).toThrow(
      /mouse-shell/,
    );
    expect(() => readFinaleDrawing(one('data-part="mouse-shell"'))).toThrow(
      /hand-outline/,
    );
  });
});

describe("FINALE_LOOK", () => {
  const rgb = (hex: string) => {
    expect(hex).toMatch(/^#[0-9A-F]{6}$/i);
    return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [
      number,
      number,
      number,
    ];
  };
  // Relative luminance (WCAG), from sRGB.
  const luminance = (hex: string) => {
    const [r, g, b] = rgb(hex).map((c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };

  it("stays in the page's blue-to-white family: blue is never weaker than red or green", () => {
    for (const kind of FINALE_KINDS) {
      for (const { colour } of FINALE_LOOK[kind]) {
        const [r, g, b] = rgb(colour);
        expect(b).toBeGreaterThanOrEqual(r);
        expect(b).toBeGreaterThanOrEqual(g);
      }
    }
    expect(FINALE_LOOK.highlight[0]!.colour.toUpperCase()).toBe("#FFFFFF");
  });

  it("stays blue: every colour that is not white has a hue of 210° to 230° (HSL)", () => {
    const hue = (hex: string) => {
      const [r, g, b] = rgb(hex).map((c) => c / 255) as [
        number,
        number,
        number,
      ];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      if (max === min) return null; // grey or white: no hue
      const d = max - min;
      const h =
        max === r
          ? ((g - b) / d) % 6
          : max === g
            ? (b - r) / d + 2
            : (r - g) / d + 4;
      return (h * 60 + 360) % 360;
    };
    for (const kind of FINALE_KINDS) {
      for (const { colour } of FINALE_LOOK[kind]) {
        const h = hue(colour);
        if (h === null) {
          expect(colour.toUpperCase()).toBe("#FFFFFF");
          continue;
        }
        expect(h).toBeGreaterThanOrEqual(210);
        expect(h).toBeLessThanOrEqual(230);
      }
    }
  });

  it("is never dark on the dark page: every colour has a relative luminance of at least 0.15", () => {
    for (const kind of FINALE_KINDS) {
      for (const { colour } of FINALE_LOOK[kind]) {
        expect(luminance(colour)).toBeGreaterThanOrEqual(0.15);
      }
    }
  });

  it("keeps every particle a dot: 0.5 to 3 px across", () => {
    for (const kind of FINALE_KINDS) {
      for (const { px } of FINALE_LOOK[kind]) {
        expect(px).toBeGreaterThanOrEqual(0.5);
        expect(px).toBeLessThanOrEqual(3);
      }
    }
  });

  it("makes each level lighter, bigger and no fainter than the one below it", () => {
    for (const kind of FINALE_KINDS) {
      const levels = FINALE_LOOK[kind];
      for (let i = 1; i < levels.length; i += 1) {
        expect(luminance(levels[i]!.colour)).toBeGreaterThan(
          luminance(levels[i - 1]!.colour),
        );
        expect(levels[i]!.px).toBeGreaterThan(levels[i - 1]!.px);
        expect(levels[i]!.alpha).toBeGreaterThanOrEqual(levels[i - 1]!.alpha);
      }
      for (const l of levels) {
        expect(l.alpha).toBeGreaterThan(0);
        expect(l.alpha).toBeLessThanOrEqual(1);
        expect(l.px).toBeGreaterThan(0);
      }
    }
  });
});

describe("walkPolyline", () => {
  it("starts half a step in and steps evenly along a straight line, with the normal (-dy, dx): going +x it points down the screen", () => {
    const { points, length } = walkPolyline(
      [
        [0, 0],
        [10, 0],
      ],
      () => 2,
    );
    expect(length).toBe(10);
    expect(points.map((p) => p.s)).toEqual([1, 3, 5, 7, 9]);
    for (const p of points) {
      expect(p.y).toBe(0);
      expect(p.nx).toBeCloseTo(0, 12);
      expect(p.ny).toBe(1);
    }
  });

  it("gives nothing for a line shorter than half a unit, or a single point", () => {
    expect(
      walkPolyline(
        [
          [0, 0],
          [0.4, 0],
        ],
        () => 1,
      ).points,
    ).toEqual([]);
    expect(walkPolyline([[3, 3]], () => 1).points).toEqual([]);
  });

  it("refuses a step that is not positive (it would never end)", () => {
    expect(() =>
      walkPolyline(
        [
          [0, 0],
          [10, 0],
        ],
        (s) => (s > 2 ? 0 : 1),
      ),
    ).toThrow(/positive/);
  });
});

describe("sampleFinale", () => {
  const desktop = sampleFinale(drawing, FINALE_TIERS.desktop, 7);

  it("is reproducible, and the seed changes only the random parts", () => {
    expect(sampleFinale(drawing, FINALE_TIERS.desktop, 7)).toEqual(desktop);
    const other = sampleFinale(drawing, FINALE_TIERS.desktop, 8);
    expect(other.points).not.toEqual(desktop.points);
    // The nails and the knuckle lines have no random step: the same either way.
    const details = (s: typeof desktop) =>
      s.points.filter(
        (p) => p.kind === KIND.detail || p.kind === KIND.highlight,
      );
    expect(details(other)).toEqual(details(desktop));
  });

  it("refuses a tier with no scale or spacing", () => {
    expect(() => sampleFinale(drawing, { scale: 0, spacing: 2 }, 1)).toThrow(
      /positive/,
    );
    expect(() => sampleFinale(drawing, { scale: 1, spacing: -1 }, 1)).toThrow(
      /positive/,
    );
    expect(() =>
      sampleFinale(drawing, { scale: 1, spacing: Number.NaN }, 1),
    ).toThrow(/positive/);
  });

  it("puts every main point on its own path, and the loose grains and the rim just beside it", () => {
    for (const run of desktop.runs) {
      const path = drawing.paths[run.path]!;
      const line = path.closed
        ? [...path.points, path.points[0]!]
        : path.points;
      const own = desktop.points.slice(run.start, run.start + run.count);
      own.forEach((p, i) => {
        const off = distanceToPolyline([p.x, p.y], line);
        const sc = FINALE_TIERS.desktop.scale;
        if (p.kind === KIND.satellite) {
          // 1.8 to 6.3 px (at the tier's scale) across the line from the dust
          // grain it follows, which is itself within 0.3 px of the line. (Its
          // distance to the whole line can be less where the line bends back.)
          const grain = own[i - 1]!;
          expect(grain.kind).toBe(KIND.dust);
          const m = Math.max(sc, 0.7);
          const gap = distance([p.x, p.y], [grain.x, grain.y]);
          expect(gap).toBeGreaterThan((1.8 * m - 0.3) / sc - 1e-9);
          expect(gap).toBeLessThan((6.3 * m + 0.3) / sc + 1e-9);
          expect(off).toBeLessThan((6.3 * m + 0.01) / sc);
        } else if (p.kind === KIND.rim) {
          expect(off).toBeLessThan(3.3 / FINALE_TIERS.desktop.scale + 0.01);
        } else if (p.kind === KIND.dust) {
          // Up to 0.3 px of jitter across the line.
          expect(off).toBeLessThan(0.31 / FINALE_TIERS.desktop.scale);
        } else {
          expect(off).toBeLessThan(1e-6);
        }
      });
    }
  });

  it("gives each part its kind: dust and grains on the hand's outline, details on the nails and lines, stars on the mouse", () => {
    for (const run of desktop.runs) {
      const part = drawing.paths[run.path]!.part;
      const kinds = new Set(
        desktop.points
          .slice(run.start, run.start + run.count)
          .map((p) => p.kind),
      );
      const allowed =
        part === "hand-outline"
          ? [KIND.dust, KIND.satellite]
          : part === "hand-nail"
            ? [KIND.detail, KIND.highlight]
            : part === "mouse-shell"
              ? [KIND.star, KIND.rim]
              : part.startsWith("mouse-")
                ? [KIND.star]
                : [KIND.detail];
      for (const k of kinds) expect(allowed).toContain(k);
    }
    // One highlight per nail.
    expect(
      desktop.points.filter((p) => p.kind === KIND.highlight),
    ).toHaveLength(5);
  });

  it("keeps every level inside its kind's looks, and u in 0 to 1, rising along a path", () => {
    for (const p of desktop.points) {
      expect(p.level).toBeGreaterThanOrEqual(0);
      expect(p.level).toBeLessThan(KIND_LEVELS[p.kind]!);
      expect(p.u).toBeGreaterThanOrEqual(0);
      expect(p.u).toBeLessThanOrEqual(1);
    }
    for (const run of desktop.runs) {
      const main = desktop.points
        .slice(run.start, run.start + run.count)
        .filter(
          (p) =>
            p.kind === KIND.dust ||
            p.kind === KIND.star ||
            p.kind === KIND.detail,
        );
      for (let i = 1; i < main.length; i += 1) {
        expect(main[i]!.u).toBeGreaterThan(main[i - 1]!.u);
      }
    }
    expect(KIND_LEVELS).toEqual(FINALE_KINDS.map((k) => FINALE_LOOK[k].length));
  });

  it("lights the hand toward the fingertips: the outline's lower-left half is brighter on average", () => {
    const dust = desktop.points.filter((p) => p.kind === KIND.dust);
    const box = boxOf(dust.map((p): Vec => [p.x, p.y]));
    const mid = (box[1] + box[3]) / 2;
    const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
    const low = mean(dust.filter((p) => p.y > mid).map((p) => p.level));
    const high = mean(dust.filter((p) => p.y <= mid).map((p) => p.level));
    expect(low).toBeGreaterThan(high + 0.5);
  });

  it("samples a phone more sparsely in drawing units, but more densely in its own px", () => {
    const mobile = sampleFinale(drawing, FINALE_TIERS.mobile, 7);
    expect(mobile.points.length).toBeLessThan(desktop.points.length);
    const perPx = (n: number, scale: number) => n / scale;
    // Points per CSS px of drawing: the phone's 1.75 px spacing is finer than 2.3.
    expect(
      perPx(mobile.points.length, FINALE_TIERS.mobile.scale),
    ).toBeGreaterThan(perPx(desktop.points.length, FINALE_TIERS.desktop.scale));
  });

  it("covers every point with one run per path, in order, with no gaps", () => {
    let next = 0;
    for (const run of desktop.runs) {
      expect(run.start).toBe(next);
      next += run.count;
    }
    expect(next).toBe(desktop.points.length);
  });
});

describe("the committed finale.generated.json", () => {
  it("is what the generator makes today (run `npm run particles:build` if this fails)", () => {
    expect(serializeFinale(buildFinale(svg, DEFAULT_SEED))).toBe(committed);
  });

  it("holds about the v8 point counts (estimates: v8 kept 1,871 desktop and 1,415 phone after cutting around the headline)", () => {
    const d = finale.tiers.desktop.points.length;
    const m = finale.tiers.mobile.points.length;
    // Before the headline's cut: v8's counts plus the 10 to 20 % the cut removes.
    expect(d).toBeGreaterThan(1871);
    expect(d).toBeLessThan(1871 * 1.25);
    expect(m).toBeGreaterThan(1415);
    expect(m).toBeLessThan(1415 * 1.25);
  });

  it("round-trips: the parsed file is the built targets rounded to 0.1 (u to 0.01)", () => {
    const built = buildFinale(svg, DEFAULT_SEED);
    expect(finale.seed).toBe(DEFAULT_SEED);
    for (const name of ["desktop", "mobile"] as const) {
      const a = built.tiers[name];
      const b = finale.tiers[name];
      expect(b.points).toHaveLength(a.points.length);
      expect(b.runs).toEqual(a.runs);
      a.points.forEach((p, i) => {
        const q = b.points[i]!;
        expect(Math.abs(q.x - p.x)).toBeLessThanOrEqual(0.05 + 1e-9);
        expect(Math.abs(q.y - p.y)).toBeLessThanOrEqual(0.05 + 1e-9);
        expect(Math.abs(q.u - p.u)).toBeLessThanOrEqual(0.005 + 1e-9);
        expect([q.kind, q.level]).toEqual([p.kind, p.level]);
      });
    }
    expect(finale.lines.map((l) => l.part)).toEqual(
      drawing.paths.map((p) => p.part),
    );
  });

  it("keeps a plain copy of every line, about LINE_SPACING apart, on the drawing", () => {
    finale.lines.forEach((line, i) => {
      const path = drawing.paths[i]!;
      const source = path.closed
        ? [...path.points, path.points[0]!]
        : path.points;
      for (let k = 1; k < line.points.length; k += 1) {
        expect(distance(line.points[k - 1]!, line.points[k]!)).toBeLessThan(
          LINE_SPACING * 1.5 + 0.2,
        );
      }
      for (const p of line.points) {
        expect(distanceToPolyline(p, source)).toBeLessThan(0.1);
      }
    });
  });

  it("stays small next to the stage's own targets file (gzip under 40 KB)", () => {
    expect(gzipSync(committed).length).toBeLessThan(40_000);
  });

  it("rejects a file the generator would not write", () => {
    const raw = JSON.parse(committed);
    const desktop = raw.tiers.desktop;
    const withPoint = (p: unknown) => ({
      ...raw,
      tiers: {
        ...raw.tiers,
        desktop: { ...desktop, points: [p, ...desktop.points.slice(1)] },
      },
    });
    expect(() => parseFinaleTargets({ ...raw, version: 2 })).toThrow(
      /version 1/,
    );
    expect(() => parseFinaleTargets(null)).toThrow(/version 1/);
    expect(() => parseFinaleTargets(withPoint([1, 2, 6, 0, 0]))).toThrow(
      /kind/,
    );
    expect(() => parseFinaleTargets(withPoint([1, 2, 0, 7, 0]))).toThrow(
      /level/,
    );
    expect(() => parseFinaleTargets(withPoint([1, 2, 1, 1, 0]))).toThrow(
      /level/,
    );
    expect(() => parseFinaleTargets(withPoint([1, 2, 0, 0, 1.5]))).toThrow(
      /u is/,
    );
    expect(() => parseFinaleTargets(withPoint([1, 2, 0, 0]))).toThrow(/points/);
    expect(() =>
      parseFinaleTargets({
        ...raw,
        tiers: {
          ...raw.tiers,
          mobile: { ...raw.tiers.mobile, runs: [[0, 1, 999]] },
        },
      }),
    ).toThrow(/path/);
    expect(() =>
      parseFinaleTargets({
        ...raw,
        tiers: {
          ...raw.tiers,
          mobile: {
            ...raw.tiers.mobile,
            runs: [
              [0, 3, 0],
              [2, 1, 1],
            ],
          },
        },
      }),
    ).toThrow(/overlaps/);
    expect(() =>
      parseFinaleTargets({ ...raw, lines: [[9, 0, [[0, 0]]]] }),
    ).toThrow(/part/);
    expect(() =>
      parseFinaleTargets({
        ...raw,
        bounds: { ...raw.bounds, mouse: [5, 5, 1, 1] },
      }),
    ).toThrow(/mouse box/);
    expect(() => parseFinaleTargets({ ...raw, tiers: { desktop } })).toThrow(
      /mobile/,
    );
  });

  describe("runs must cover the points back to back", () => {
    const raw = JSON.parse(committed);
    const runs: number[][] = raw.tiers.desktop.runs;
    const withRuns = (r: unknown) => ({
      ...raw,
      tiers: { ...raw.tiers, desktop: { ...raw.tiers.desktop, runs: r } },
    });

    it("accepts the generator's own runs", () => {
      expect(() => parseFinaleTargets(withRuns(runs))).not.toThrow();
    });

    it("rejects a single run that covers one point from the middle (a gap before it)", () => {
      expect(() => parseFinaleTargets(withRuns([[1, 1, 0]]))).toThrow(/gap/);
    });

    it("rejects runs with the first one removed (a gap at the start)", () => {
      expect(() => parseFinaleTargets(withRuns(runs.slice(1)))).toThrow(/gap/);
    });

    it("rejects runs with the last one removed (points left uncovered at the end)", () => {
      expect(() => parseFinaleTargets(withRuns(runs.slice(0, -1)))).toThrow(
        /uncovered/,
      );
    });

    it("rejects a gap between two runs", () => {
      const gapped = runs.map((r, i) =>
        i === 3 ? [r[0]! + 1, r[1]! - 1, r[2]!] : r,
      );
      expect(() => parseFinaleTargets(withRuns(gapped))).toThrow(/gap/);
    });

    it("rejects overlapping runs, and a path used twice or out of order", () => {
      const overlapping = runs.map((r, i) =>
        i === 3 ? [r[0]! - 1, r[1]! + 1, r[2]!] : r,
      );
      expect(() => parseFinaleTargets(withRuns(overlapping))).toThrow(
        /overlaps/,
      );
      const twice = runs.map((r, i) =>
        i === 3 ? [r[0]!, r[1]!, runs[2]![2]!] : r,
      );
      expect(() => parseFinaleTargets(withRuns(twice))).toThrow(/path/);
    });
  });

  it("rejects a viewBox with no area, or not a number", () => {
    const raw = JSON.parse(committed);
    for (const bad of [
      { width: 0 },
      { height: 0 },
      { width: -688 },
      { height: -1 },
      { width: Number.NaN },
      { height: "622" },
    ]) {
      expect(() =>
        parseFinaleTargets({ ...raw, viewBox: { ...raw.viewBox, ...bad } }),
      ).toThrow(/viewBox/);
    }
  });
});
