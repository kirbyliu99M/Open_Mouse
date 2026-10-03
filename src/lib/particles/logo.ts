import type { Polyline, Vec } from "./geometry";

/**
 * The PLACEHOLDER logo of the home page hero (未拍板, candidate: the final logo
 * does not exist yet): the outline of a mouse seen from above, with a ruler
 * beside it. Geometry from docs/design/home-v3-2026-10-03/README.md ("Static
 * images"), in a 220 × 196 box with its centre at (90, 98).
 *
 * The static SVG (public/images/logo-placeholder.svg) and the particle target
 * are both made from these polylines, so they agree.
 */
export const LOGO_BOX = { width: 220, height: 196, cx: 90, cy: 98 } as const;

export interface LogoStroke {
  readonly polyline: Polyline;
  /** 1 is a primary stroke (bright), 0 a detail stroke (dim). */
  readonly tone: 0 | 1;
}

const OUTLINE_STEPS = 180;
const ELLIPSE_STEPS = 48;

export function logoStrokes(): LogoStroke[] {
  const { cx, cy } = LOGO_BOX;

  // x = cx + 58·(0.86 − 0.14·cos t)·sin t, y = cy − 88·cos t
  const outline: Vec[] = [];
  for (let i = 0; i < OUTLINE_STEPS; i += 1) {
    const t = (i / OUTLINE_STEPS) * Math.PI * 2;
    outline.push([
      cx + 58 * (0.86 - 0.14 * Math.cos(t)) * Math.sin(t),
      cy - 88 * Math.cos(t),
    ]);
  }

  const wheel: Vec[] = [];
  for (let i = 0; i < ELLIPSE_STEPS; i += 1) {
    const t = (i / ELLIPSE_STEPS) * Math.PI * 2;
    wheel.push([cx + 4.5 * Math.cos(t), cy - 56 + 9 * Math.sin(t)]);
  }

  const rulerX = cx + 84;
  return [
    { polyline: { points: outline, closed: true }, tone: 1 },
    // The button split, from the top of the shell down to the wheel.
    {
      polyline: {
        points: [
          [cx, cy - 88],
          [cx, cy - 22],
        ],
        closed: false,
      },
      tone: 1,
    },
    { polyline: { points: wheel, closed: true }, tone: 1 },
    // The ruler, with an end tick 5 px to each side at both ends.
    {
      polyline: {
        points: [
          [rulerX, cy - 88],
          [rulerX, cy + 88],
        ],
        closed: false,
      },
      tone: 0,
    },
    ...[cy - 88, cy + 88].map((y): LogoStroke => ({
      polyline: {
        points: [
          [rulerX - 5, y],
          [rulerX + 5, y],
        ],
        closed: false,
      },
      tone: 0,
    })),
  ];
}
