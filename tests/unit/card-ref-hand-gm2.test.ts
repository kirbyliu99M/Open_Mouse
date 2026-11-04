/**
 * Scan lab L10 P2 (2026-11-02, candidate): G0 (control, no overlay, still
 * for 1.5 s) and G-M2 (brackets + wrist line + card zone + level, the full
 * check table of proposal §2, mirrored for the left hand). Synthetic hands
 * only, no photos.
 */
import { describe, expect, it } from "vitest";
import { shutterStep, wantedHint } from "../../src/client/card/hand/guideState";
import { gm2, overflowArrows } from "../../src/client/card/hand/guides/gm2";
import type { GuideInput } from "../../src/client/card/hand/guides/types";
import {
  evaluateGm2Checks,
  GM2_COPY,
  GM2_THRESHOLDS,
  gm2AxisCheck,
  gm2DistanceCheck,
  gm2DistanceRatio,
  gm2FingersCheck,
  gm2HandCheck,
  gm2InFrame,
  gm2Layout,
  gm2SideCheck,
  gm2SteadyCheck,
  gm2TiltCheck,
  gm2WristCheck,
} from "../../src/client/card/hand/gm2Rules";
import type { Pt } from "../../src/client/card/hand/handGeometry";

// ── A synthetic right hand, palm down, fingers up ──────────────────────────

/** Table mm (x right, y down): wrist at (0, 0), middle tip 185 mm up. */
function tableHand(): Pt[] {
  const p: Pt[] = [];
  p[0] = { x: 0, y: 0 };
  // Thumb on the LEFT (right hand, palm down, seen from above), kept fairly
  // close to the hand so it fits G-M2's brackets.
  p[1] = { x: -22, y: -25 };
  p[2] = { x: -35, y: -45 };
  p[3] = { x: -42, y: -65 };
  p[4] = { x: -48, y: -85 };
  const finger = (base: number, x: number, lens: number[]) => {
    let y = -95;
    p[base] = { x, y };
    for (let i = 0; i < 3; i++) {
      y -= lens[i];
      p[base + i + 1] = { x, y };
    }
  };
  finger(5, -22, [42, 25, 20]);
  finger(9, 0, [47, 28, 15]); // tip at y = -185
  finger(13, 18, [44, 26, 20]);
  finger(17, 34, [34, 20, 18]);
  return p;
}

const VIEW = { width: 1080, height: 1920 };

/**
 * The hand in view 0..1: wrist at (`wx`, `wy`), 0→12 = `ratio` of the long
 * edge, turned `deg` clockwise on screen (in px), optionally mirrored
 * (a left hand).
 */
function viewHand(
  opts: {
    wx?: number;
    wy?: number;
    ratio?: number;
    deg?: number;
    mirror?: boolean;
    edit?: (p: Pt[]) => void;
  } = {},
): Pt[] {
  const { wx = 0.4, wy = 0.67, ratio = 0.44, deg = 0, mirror = false } = opts;
  const t = tableHand();
  opts.edit?.(t);
  const s = (ratio * Math.max(VIEW.width, VIEW.height)) / 185;
  const a = (deg * Math.PI) / 180;
  return t.map((q) => {
    const x = (mirror ? -q.x : q.x) * s;
    const y = q.y * s;
    // Clockwise on screen (y down): rotate by +a.
    const rx = x * Math.cos(a) - y * Math.sin(a);
    const ry = x * Math.sin(a) + y * Math.cos(a);
    return {
      x: (wx * VIEW.width + rx) / VIEW.width,
      y: (wy * VIEW.height + ry) / VIEW.height,
    };
  });
}

const input = (
  over: Partial<GuideInput> & { points?: Pt[]; confidence?: number } = {},
): GuideInput => {
  const { points, confidence, ...rest } = over;
  const pts = points ?? viewHand();
  const hand = {
    points: pts,
    z: null,
    atMs: 1000,
    ...(confidence !== undefined ? { confidence } : {}),
  };
  return {
    hand,
    previousHand: { points: pts, z: null, atMs: 500 },
    movement: 0,
    side: "right",
    view: VIEW,
    tiltDeg: 1,
    detectorReady: true,
    paper: null,
    nowMs: 1000,
    ...rest,
  };
};

const ids = (e: { checks: readonly { id: string }[] }) =>
  e.checks.map((c) => c.id);
const check = (
  e: {
    checks: readonly {
      id: string;
      level: string;
      value?: number | null;
      hint: string;
      blocks: boolean;
    }[];
  },
  id: string,
) => e.checks.find((c) => c.id === id)!;

// ── G0 ─────────────────────────────────────────────────────────────────────

// ── G-M2 layout ────────────────────────────────────────────────────────────

describe("G-M2 layout", () => {
  it("places the v3 right-hand numbers", () => {
    const l = gm2Layout("right");
    expect(l.handZone.x).toBeCloseTo(0.03, 9);
    expect(l.handZone.x + l.handZone.width).toBeCloseTo(0.66, 9);
    expect(l.handZone.y).toBeCloseTo(0.08, 9);
    expect(l.handZone.y + l.handZone.height).toBeCloseTo(0.88, 9);
    expect(l.wristLineY).toBe(0.7);
    expect(l.axisX).toBe(0.35);
    expect(l.cardZone.x).toBeCloseTo(0.68, 9);
    expect(l.cardZone.x + l.cardZone.width).toBeCloseTo(0.9, 9);
    expect(l.cardZone.y + l.cardZone.height / 2).toBeCloseTo(0.42, 9);
    expect(l.levelAt.x).toBeGreaterThan(0.5);
  });

  it("mirrors everything for the left hand", () => {
    const r = gm2Layout("right");
    const l = gm2Layout("left");
    const mirrored = (a: typeof r.handZone, b: typeof r.handZone) => {
      expect(b.x).toBeCloseTo(1 - a.x - a.width, 9);
      expect(b.width).toBeCloseTo(a.width, 9);
      expect(b.y).toBeCloseTo(a.y, 9);
      expect(b.height).toBeCloseTo(a.height, 9);
    };
    mirrored(r.handZone, l.handZone);
    mirrored(r.cardZone, l.cardZone);
    expect(l.axisX).toBeCloseTo(1 - r.axisX, 9);
    expect(l.levelAt.x).toBeCloseTo(1 - r.levelAt.x, 9);
    expect(l.wristLineY).toBe(r.wristLineY);
    // Card zone ≥ 10% of the width from either edge, on the pinky side.
    for (const z of [r.cardZone, l.cardZone]) {
      expect(z.x).toBeGreaterThanOrEqual(0.1 - 1e-9);
      expect(z.x + z.width).toBeLessThanOrEqual(0.9 + 1e-9);
    }
    expect(r.cardZone.x).toBeGreaterThan(r.handZone.x + r.handZone.width);
    expect(l.cardZone.x + l.cardZone.width).toBeLessThan(l.handZone.x);
  });

  it("keeps the layout and thresholds in the record, JSON-safe", () => {
    const rec = gm2.layout("left") as {
      thresholds: typeof GM2_THRESHOLDS;
      cardZone: { x: number };
    };
    expect(rec.thresholds.distanceMin).toBe(0.38);
    expect(rec.cardZone.x).toBeCloseTo(0.1, 9);
    expect(() => JSON.stringify(rec)).not.toThrow();
  });
});

// ── G-M2 checks ────────────────────────────────────────────────────────────

describe("G-M2 checks", () => {
  it("passes a well-placed right hand in the proposal's order", () => {
    const e = gm2.evaluate(input());
    expect(ids(e)).toEqual([
      "detector",
      "hand",
      "inFrame",
      "distance",
      "wrist",
      "axis",
      "fingers",
      "tilt",
      "steady",
      "side",
    ]);
    expect(e.checks.filter((c) => c.level !== "ok")).toEqual([]);
    expect(shutterStep(e)).toBe("fill");
    expect(wantedHint(e).text).toBe("就是這樣，保持不動");
    expect(gm2.holdMs).toBe(1200);
    expect(gm2.hintHoldMs).toBe(700);
    expect(gm2.placeholder).toBeUndefined();
  });

  it("passes the mirrored hand on the left layout", () => {
    const e = gm2.evaluate(
      input({ side: "left", points: viewHand({ wx: 0.6, mirror: true }) }),
    );
    expect(e.checks.filter((c) => c.level !== "ok")).toEqual([]);
    // The right-hand layout does not fit a left hand placed for the left one.
    const wrong = gm2.evaluate(
      input({ side: "right", points: viewHand({ wx: 0.6, mirror: true }) }),
    );
    expect(check(wrong, "inFrame").level).toBe("fail");
  });

  it("waits for the detector, then a hand", () => {
    const loading = gm2.evaluate(input({ detectorReady: false }));
    expect(wantedHint(loading).text).toBe("準備中…");
    expect(shutterStep(loading)).toBe("reset");
    const none = gm2.evaluate(input({ hand: null, movement: null }));
    expect(wantedHint(none).text).toBe(GM2_COPY.noHand);
    expect(shutterStep(none)).toBe("reset");
    // The frame and level are drawn anyway; no wrist dot without a hand.
    const kinds = none.overlay.map((s) => s.kind);
    expect(kinds).toContain("brackets");
    expect(kinds).toContain("level");
    expect(kinds).toContain("zone");
    expect(kinds).not.toContain("dot");
  });

  it("judges the hand's confidence at 0.7 when the page passes one", () => {
    expect(gm2HandCheck(input({ confidence: 0.69 })).level).toBe("fail");
    expect(gm2HandCheck(input({ confidence: 0.7 })).level).toBe("ok");
    expect(gm2HandCheck(input()).level).toBe("ok");
  });

  it("in frame: 2% tolerance, arrows on the side the hand sticks out of", () => {
    const l = gm2Layout("right");
    const right = gm2InFrame(viewHand({ wx: 0.55 }), l);
    expect(right.check.level).toBe("fail");
    expect(right.out.right).toBeGreaterThan(0);
    expect(right.out.left).toBe(0);
    const arrows = overflowArrows(l, right.out);
    expect(arrows).toHaveLength(1);
    expect(arrows[0].kind).toBe("polyline");
    // The chevron points back in (its tip is left of its arms).
    const pts = (arrows[0] as unknown as { points: Pt[] }).points;
    expect(pts[1].x).toBeLessThan(pts[0].x);

    // The middle fingertip sticking 1.5% past the top edge is tolerated; 3% is not.
    const tipAt = (y: number) => {
      const h = viewHand();
      const top = Math.min(...h.map((p) => p.y));
      return h.map((p) => ({ x: p.x, y: p.y + (y - top) }));
    };
    expect(gm2InFrame(tipAt(0.08 - 0.015), l).check.level).toBe("ok");
    expect(gm2InFrame(tipAt(0.08 - 0.03), l).check.level).toBe("fail");

    const e = gm2.evaluate(input({ points: viewHand({ wx: 0.55 }) }));
    expect(wantedHint(e).text).toBe("整隻手放進框內");
    expect(e.overlay.filter((s) => s.kind === "polyline")).toHaveLength(1);
  });

  it("distance: 0→12 over the long edge in 0.38–0.56 (v3)", () => {
    expect(gm2DistanceRatio(viewHand({ ratio: 0.45 }), VIEW)).toBeCloseTo(
      0.45,
      9,
    );
    const near = gm2DistanceCheck(viewHand({ ratio: 0.37 }), VIEW);
    expect(near.level).toBe("fail");
    expect(near.hint).toBe("手機再靠近一點");
    const far = gm2DistanceCheck(viewHand({ ratio: 0.57 }), VIEW);
    expect(far.level).toBe("fail");
    expect(far.hint).toBe("手機再拿高一點");
    expect(gm2DistanceCheck(viewHand({ ratio: 0.39 }), VIEW).level).toBe("ok");
    // v2's upper end (0.50) and Kirby's 0.517 now pass.
    expect(gm2DistanceCheck(viewHand({ ratio: 0.51 }), VIEW).level).toBe("ok");
    expect(gm2DistanceCheck(viewHand({ ratio: 0.55 }), VIEW).level).toBe("ok");
    // Landscape view: the long edge is the width.
    const wide = { width: 1920, height: 1080 };
    const pts = [
      { x: 0.5, y: 0.9 },
      ...Array(11).fill({ x: 0.5, y: 0.5 }),
      { x: 0.5, y: 0.0 },
    ];
    expect(gm2DistanceRatio(pts, wide)).toBeCloseTo((0.9 * 1080) / 1920, 9);
  });

  it("wrist (v3): inside the box with y 0.55–0.88, no line to sit on", () => {
    const l = gm2Layout("right");
    for (const wy of [0.56, 0.6, 0.7, 0.75, 0.87])
      expect(gm2WristCheck(viewHand({ wy }), l).level).toBe("ok");
    // v2 failed these two (0.06 band above the 0.70 line).
    expect(gm2WristCheck(viewHand({ wy: 0.75 }), l).level).toBe("ok");
    expect(gm2WristCheck(viewHand({ wy: 0.6 }), l).level).toBe("ok");
    const low = gm2WristCheck(viewHand({ wy: 0.92 }), l);
    expect(low.level).toBe("fail");
    expect(low.value).toBeCloseTo(0.92, 9);
    expect(low.hint).toBe("手往上移一點");
    const high = gm2WristCheck(viewHand({ wy: 0.5 }), l);
    expect(high.level).toBe("fail");
    expect(high.hint).toBe("手往下移一點");
    // Sideways out of the box: the in-frame words.
    const out = gm2WristCheck(viewHand({ wx: 0.72 }), l);
    expect(out.level).toBe("fail");
    expect(out.hint).toBe(GM2_COPY.inFrame);
    expect(
      gm2WristCheck(
        viewHand({ wx: 0.25, wy: 0.7, mirror: true }),
        gm2Layout("left"),
      ).level,
    ).toBe("fail");
    expect(Object.values(GM2_COPY).join("")).not.toMatch(/底線/);
    expect(gm2.instructions.join("")).not.toMatch(/底線/);
  });

  it("draws the wrist line as a faint reference, coloured by nothing", () => {
    const e = gm2.evaluate(input({ points: viewHand({ wy: 0.85 }) }));
    const l = gm2Layout("right");
    const line = e.overlay.find(
      (s) =>
        s.kind === "line" &&
        (s as { from: Pt }).from.y === l.wristLineY &&
        (s as { to: Pt }).to.y === l.wristLineY,
    ) as { tone: string; dashed?: boolean; width?: number } | undefined;
    expect(line).toBeDefined();
    expect(line!.tone).toBe("neutral");
    expect(line!.dashed).toBe(true);
    expect(line!.width).toBeLessThanOrEqual(2);
    const labels = e.overlay
      .filter((s) => s.kind === "label")
      .map((s) => (s as { text: string }).text);
    expect(labels.join("")).not.toMatch(/放這條線/);
    expect(gm2.label).toBe("G-M2 極簡框＋卡片槽 v3");
  });

  it("alignment: 0→9 within 15° of vertical (v3), measured in px not view units", () => {
    expect(gm2AxisCheck(viewHand({ deg: 14 }), VIEW).level).toBe("ok");
    expect(gm2AxisCheck(viewHand({ deg: -14 }), VIEW).level).toBe("ok");
    const off = gm2AxisCheck(viewHand({ deg: 16 }), VIEW);
    expect(off.level).toBe("fail");
    expect(off.value).toBeCloseTo(16, 6);
    expect(off.hint).toBe("手放正，中指對準中線");
  });

  it("fingers: a bent finger fails, a natural spread does not", () => {
    // Index tip and DIP pulled back toward the palm (a curled finger).
    const bent = viewHand({
      edit: (p) => {
        p[7] = { x: -30, y: -150 };
        p[8] = { x: -36, y: -128 };
      },
    });
    const f = gm2FingersCheck(bent, VIEW);
    expect(f.level).toBe("fail");
    expect(f.value).toBeLessThan(0.9);
    expect(f.hint).toMatch(/自然/);
    // Fingers fanned out but straight: fine (the spread is only recorded).
    const fanned = viewHand({
      edit: (p) => {
        for (const [base, dx] of [
          [5, -12],
          [13, 10],
          [17, 18],
        ] as const)
          for (let i = 1; i <= 3; i++)
            p[base + i] = { x: p[base + i].x + (dx * i) / 3, y: p[base + i].y };
      },
    });
    expect(gm2FingersCheck(fanned, VIEW).level).toBe("ok");
  });

  it("tilt: ≤ 4° green, 4–8° amber (not held), > 8° blocks", () => {
    expect(gm2TiltCheck(3.9).level).toBe("ok");
    const amber = gm2TiltCheck(6);
    expect(amber.level).toBe("warn");
    expect(amber.blocks).toBe(false);
    expect(gm2TiltCheck(8).level).toBe("warn");
    expect(gm2TiltCheck(8.1).level).toBe("fail");
    expect(gm2TiltCheck(null).level).toBe("warn");

    const a = gm2.evaluate(input({ tiltDeg: 6 }));
    expect(shutterStep(a)).toBe("fill");
    expect(wantedHint(a).text).toBe("手機放平");
    const level = a.overlay.find((s) => s.kind === "level") as { tone: string };
    expect(level.tone).toBe("warn");
    expect(shutterStep(gm2.evaluate(input({ tiltDeg: 9 })))).toBe("reset");
  });

  it("steady: movement < 0.03 of the diagonal", () => {
    expect(gm2SteadyCheck(0.029).level).toBe("ok");
    expect(gm2SteadyCheck(0.03).level).toBe("fail");
    expect(gm2SteadyCheck(null).level).toBe("fail");
    const e = gm2.evaluate(input({ movement: 0.05 }));
    expect(wantedHint(e).text).toBe("拿穩，不要動");
    expect(shutterStep(e)).toBe("reset");
  });

  it("flags a thumb-side hand that differs from the choice, without holding", () => {
    const r = viewHand();
    expect(gm2SideCheck(r, "right").level).toBe("ok");
    const mismatch = gm2SideCheck(r, "left");
    expect(mismatch.level).toBe("warn");
    expect(mismatch.blocks).toBe(false);
    expect(mismatch.hint).toBe(GM2_COPY.sideRight);
  });

  it("shows the first problem in priority order", () => {
    // Too far, wrist too low and tilted: the distance hint comes first.
    const e = gm2.evaluate(
      input({ points: viewHand({ ratio: 0.34, wy: 0.89 }), tiltDeg: 9 }),
    );
    expect(check(e, "inFrame").level).toBe("ok");
    expect(check(e, "wrist").level).toBe("fail");
    expect(check(e, "tilt").level).toBe("fail");
    expect(wantedHint(e).checkId).toBe("distance");
    expect(evaluateGm2Checks(input()).out).toEqual({
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
    });
  });

  it("never throws on odd input", () => {
    const flat = Array(21).fill({ x: 0.5, y: 0.5 }) as Pt[];
    expect(() => gm2.evaluate(input({ points: flat }))).not.toThrow();
    expect(shutterStep(gm2.evaluate(input({ points: flat })))).toBe("reset");
    expect(() =>
      gm2.evaluate(input({ view: { width: 0, height: 0 } })),
    ).not.toThrow();
  });

  it("uses natural-posture wording only", () => {
    const text = [...gm2.instructions, ...Object.values(GM2_COPY)].join("");
    expect(text).not.toMatch(/手指併攏|併攏手指|微開/);
    expect(gm2.instructions.join("")).toMatch(/自然/);
  });
});

// ── v2 regression: Kirby's first session (landmarks only, no photo) ───────

describe("G-M2 (v2 and v3) against a real framing", () => {
  // Shot 1 of 2026-11-02 (right hand, natural spread), landmarks in capture
  // px of the 1080 x 1732 visible picture. v1 (box x 0.08-0.62, wrist line
  // 0.78, distance 0.46-0.58) failed distance + wrist on every reading.
  const PX: [number, number][] = [
    [480.9, 1136.1],
    [310.2, 1065.4],
    [228.7, 943.2],
    [180.5, 830.2],
    [111.6, 768.7],
    [332.7, 784.3],
    [308.6, 626.6],
    [298.7, 540.1],
    [294.0, 466.4],
    [428.4, 770.6],
    [418.2, 596.0],
    [419.1, 494.7],
    [423.7, 422.5],
    [507.0, 793.0],
    [509.4, 638.5],
    [513.4, 543.9],
    [515.5, 473.0],
    [580.0, 836.4],
    [609.5, 725.0],
    [624.0, 656.0],
    [634.8, 595.8],
  ];
  const view = { width: 1080, height: 1732 };
  const pts = PX.map(([x, y]) => ({ x: x / view.width, y: y / view.height }));

  it("passes the placement checks as framed", () => {
    const l = gm2Layout("right");
    expect(gm2InFrame(pts, l).check.level).toBe("ok");
    expect(gm2DistanceCheck(pts, view).level).toBe("ok");
    expect(gm2WristCheck(pts, l).level).toBe("ok");
    expect(gm2AxisCheck(pts, view).level).toBe("ok");
  });

  it("the box holds a natural spread at the far end of the band", () => {
    // Bounding width over 0->12 length (view units), scaled to 0.50.
    const xs = pts.map((p) => p.x);
    const w = Math.max(...xs) - Math.min(...xs);
    const len = gm2DistanceRatio(pts, view)!;
    const l = gm2Layout("right");
    const room = l.handZone.width + 2 * GM2_THRESHOLDS.inFrameTolerance;
    expect((w / len) * GM2_THRESHOLDS.distanceMax).toBeLessThanOrEqual(room);
  });
});

// ── v3 regression: Kirby's session 3 (2026-11-05, landmarks only) ─────────

describe("G-M2 v3 against session 3's shots", () => {
  // The nine G-M2 v2 shots of 2026-11-05 (right hand, setup R; records
  // n = 1, 3, 4, 5, 6, 13, 14, 15, 16), full-resolution landmarks in px of
  // the 1080 x 1768 visible picture, as the shutter fired. Kirby's own
  // hand, no photo.
  const SHOTS: [number, [number, number][]][] = [
    [
      1,
      [
        [457.9, 1239.5],
        [250.5, 1149.7],
        [169.9, 1006.2],
        [161.4, 855],
        [128.3, 753.7],
        [314.6, 818],
        [274, 635.5],
        [251.4, 528.1],
        [239.2, 442.1],
        [433.2, 811.2],
        [408.6, 607.9],
        [395, 488.9],
        [388.3, 403.8],
        [525.8, 842.9],
        [533.9, 654],
        [541.6, 539.8],
        [551.2, 457.1],
        [606.8, 901.8],
        [635.7, 761.7],
        [650.4, 680.9],
        [664.5, 616.2],
      ],
    ],
    [
      3,
      [
        [423.4, 1202.1],
        [268.5, 1122.9],
        [203.3, 1002.5],
        [185.8, 882.8],
        [158.3, 799.9],
        [334.4, 854.1],
        [328.2, 702.3],
        [327.2, 614.1],
        [332.2, 542.3],
        [428.9, 856.9],
        [420.2, 690.5],
        [417.5, 591.9],
        [424.6, 522.9],
        [505.1, 890.2],
        [517.6, 735.3],
        [526.1, 643.6],
        [535.4, 577.1],
        [568.9, 942.6],
        [602.7, 832.2],
        [621.5, 764.8],
        [638.3, 710],
      ],
    ],
    [
      4,
      [
        [415.1, 1208.1],
        [241.1, 1121.1],
        [159.8, 982.7],
        [128.2, 850],
        [78.6, 769.5],
        [309.2, 816],
        [289.6, 654.4],
        [282.4, 556.8],
        [281.4, 477.1],
        [412.3, 818.8],
        [407.1, 641.8],
        [405.5, 532.7],
        [412.6, 454.9],
        [496.5, 858.3],
        [511.7, 694],
        [520.7, 591.6],
        [529.3, 516.9],
        [567.2, 916.8],
        [610.5, 797.8],
        [633.4, 722.9],
        [654.2, 661.2],
      ],
    ],
    [
      5,
      [
        [398.7, 1220.6],
        [229.1, 1135.9],
        [153.8, 1004.4],
        [125.8, 876.8],
        [84.1, 800.2],
        [300.9, 841.4],
        [283.7, 680.2],
        [276, 586.7],
        [274.6, 511.2],
        [401.8, 845.1],
        [399.1, 667.2],
        [398.5, 563],
        [406, 490.8],
        [480.8, 882.5],
        [496.5, 718.5],
        [508, 619.2],
        [519.2, 549],
        [548.8, 942.2],
        [592.3, 823.1],
        [616.6, 750.1],
        [637.3, 691.5],
      ],
    ],
    [
      6,
      [
        [423.5, 1162.8],
        [240.4, 1080.8],
        [169.2, 941.4],
        [166.5, 802],
        [146.5, 704.5],
        [308.5, 769.8],
        [299.7, 597.8],
        [297.5, 497.9],
        [301.8, 419.2],
        [417.2, 772.2],
        [412, 584],
        [411, 470.6],
        [418.2, 394.4],
        [503.3, 807.2],
        [515.7, 632.3],
        [519.8, 528],
        [525, 455.1],
        [576.7, 862.7],
        [610, 734.4],
        [625.4, 657],
        [639.3, 595.8],
      ],
    ],
    [
      13,
      [
        [393.4, 1191.7],
        [229.2, 1112.9],
        [157.7, 993.5],
        [126.2, 874.8],
        [82.4, 798.3],
        [295.3, 834.8],
        [280.9, 677.5],
        [275.2, 585.4],
        [275.3, 512.3],
        [394.6, 835.7],
        [389.6, 661.5],
        [386.6, 559.5],
        [392, 488.7],
        [472.7, 868.3],
        [485.2, 711.4],
        [491.7, 614.5],
        [497.2, 543.5],
        [536.4, 921.8],
        [570, 807.1],
        [586.9, 736.6],
        [599.8, 680.5],
      ],
    ],
    [
      14,
      [
        [402.4, 1197.6],
        [233.6, 1123.3],
        [160.2, 1003.4],
        [127.1, 883.1],
        [82.5, 806.4],
        [296.5, 835.7],
        [280.2, 677.4],
        [274.1, 584.2],
        [274.3, 511.7],
        [396.3, 835],
        [390, 658.9],
        [386.3, 556.7],
        [391.5, 486.4],
        [476.2, 866.9],
        [488.2, 709.6],
        [494.7, 611.5],
        [500.4, 540.1],
        [543.2, 922.2],
        [577.4, 805.2],
        [593.3, 732.4],
        [604.5, 674.5],
      ],
    ],
    [
      15,
      [
        [382.1, 1168.4],
        [212.1, 1102.2],
        [135.5, 987.2],
        [100.6, 867.6],
        [55.2, 790.8],
        [269.8, 818.9],
        [249.5, 666.5],
        [241.2, 574.9],
        [239.8, 503.6],
        [367.4, 817],
        [356.4, 646.5],
        [351.1, 546.4],
        [356, 477.5],
        [445.7, 847.6],
        [455.2, 694.2],
        [459.2, 598.1],
        [463.8, 529.1],
        [513.8, 899.9],
        [545.1, 782.8],
        [559.3, 710.1],
        [570.2, 652.7],
      ],
    ],
    [
      16,
      [
        [396.7, 1219.5],
        [232.9, 1142.1],
        [159.5, 1021.9],
        [130.3, 904.6],
        [90.5, 828],
        [298.8, 861.7],
        [283.7, 708],
        [277.5, 619.4],
        [276, 549.4],
        [396.3, 862.5],
        [390.1, 691.2],
        [387.3, 592.5],
        [393.1, 525.2],
        [473.3, 894.3],
        [482, 739.4],
        [486.5, 647],
        [490.4, 580.1],
        [537.3, 947.6],
        [568.8, 834.7],
        [584.5, 766.4],
        [596.2, 711.2],
      ],
    ],
  ];
  const view = { width: 1080, height: 1768 };
  const toView = (px: [number, number][]) =>
    px.map(([x, y]) => ({ x: x / view.width, y: y / view.height }));

  it.each(SHOTS)(
    "shot %i passes in-frame, wrist, distance and axis",
    (_n, px) => {
      const pts = toView(px);
      const l = gm2Layout("right");
      expect(gm2InFrame(pts, l).check.level).toBe("ok");
      expect(gm2WristCheck(pts, l).level).toBe("ok");
      expect(gm2DistanceCheck(pts, view).level).toBe("ok");
      expect(gm2AxisCheck(pts, view).level).toBe("ok");
    },
  );

  it("the session's extremes are inside v3 (thumb x 0.051, ratio 0.384–0.517)", () => {
    const all = SHOTS.map(([, px]) => toView(px));
    const thumbX = Math.min(...all.map((p) => p[4].x));
    expect(thumbX).toBeLessThan(0.06);
    const ratios = all.map((p) => gm2DistanceRatio(p, view)!);
    expect(Math.max(...ratios)).toBeLessThanOrEqual(GM2_THRESHOLDS.distanceMax);
    expect(Math.min(...ratios)).toBeGreaterThanOrEqual(
      GM2_THRESHOLDS.distanceMin,
    );
  });

  it("still blocks: wrist 0.50 / 0.92, distance 0.57, thumb at x 0.00", () => {
    const l = gm2Layout("right");
    const base = toView(SHOTS[0][1]);
    const shiftY = (dy: number) => base.map((p) => ({ x: p.x, y: p.y + dy }));
    const w0 = base[0].y;
    expect(gm2WristCheck(shiftY(0.5 - w0), l).level).toBe("fail");
    expect(gm2WristCheck(shiftY(0.92 - w0), l).level).toBe("fail");
    // Distance 0.57: the hand scaled about its wrist.
    const r = gm2DistanceRatio(base, view)!;
    const k = 0.57 / r;
    const big = base.map((p) => ({
      x: base[0].x + (p.x - base[0].x) * k,
      y: base[0].y + (p.y - base[0].y) * k,
    }));
    expect(gm2DistanceRatio(big, view)).toBeCloseTo(0.57, 6);
    expect(gm2DistanceCheck(big, view).level).toBe("fail");
    // The thumb tip at the picture's left edge.
    const thumbOut = base.map((p, i) => (i === 4 ? { x: 0, y: p.y } : p));
    expect(gm2InFrame(thumbOut, l).check.level).toBe("fail");
  });
});
