import type { Vec } from "./geometry";
import { OUTLINE_BOUNDS_MM, insideHandOutline } from "./hand-outline";
import { mulberry32 } from "./random";
import type { TargetPoint } from "./sampling";
import { STAGE_SCALE } from "./template-hand";

/**
 * The particle fill of the template hand: points spread evenly over the inside
 * of the hand's outline (hand-outline.ts). The outline and the fill are one
 * shape, so the particles reach the outline's edge everywhere (fingers, thumb,
 * palm, wrist) and never cross it.
 *
 * Until 2026-10-11 the fill had a shape of its own (capsules 5 to 9 mm
 * half-wide and a smaller palm polygon), drawn before the outline existed; the
 * outline's strokes are 9 to 11 mm half-wide, so the particles covered only
 * about 70 % of the outlined hand.
 */

/**
 * How far inside the outline's edge the particles stop, in mm. The edge is a
 * 1 CSS px line on the inside of the shape's boundary and a bright particle is
 * a 6 CSS px dot; at the smallest stage (a phone, about 1.4 CSS px per mm)
 * 1.5 mm keeps a bright dot's centre about 2 px clear of the line.
 */
export const FILL_INSET_MM = 1.5;

/** True when a point (mm on the A4 sheet) is in the area the particles fill: the outline's inside, `FILL_INSET_MM` in from its edge. */
export function insideHandFill(point: Vec): boolean {
  return insideHandOutline(point, FILL_INSET_MM);
}

/** The share of fill points that are drawn bright. */
const BRIGHT_SHARE = 0.3;

/**
 * A source of fill points for the template hand, in stage px (A4 340 px wide),
 * by seeded rejection sampling over the outline's bounding box, so the points
 * are uniform over the filled area. `next(n)` continues where the last call
 * stopped, so a big fill can be made in slices (the stage yields to the
 * browser between them) and still be the same points: the first n of a longer
 * fill are the n of a shorter one.
 */
export function createHandFiller(seed: number): {
  next(count: number): TargetPoint[];
} {
  const random = mulberry32(seed);
  const { x0, x1, y0, y1 } = OUTLINE_BOUNDS_MM;
  return {
    next(count: number): TargetPoint[] {
      const out: TargetPoint[] = [];
      while (out.length < count) {
        const x = x0 + random() * (x1 - x0);
        const y = y0 + random() * (y1 - y0);
        if (!insideHandFill([x, y])) continue;
        out.push({
          x: x * STAGE_SCALE,
          y: y * STAGE_SCALE,
          tone: random() < BRIGHT_SHARE ? 1 : 0,
        });
      }
      return out;
    },
  };
}

/** `count` points filling the template hand, in stage px (A4 340 px wide). */
export function fillTemplateHand(count: number, seed: number): TargetPoint[] {
  return createHandFiller(seed).next(count);
}
