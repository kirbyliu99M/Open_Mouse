"use client";

import {
  cornerDrawPoint,
  isCornerReturning,
  type CornerStates,
} from "./cornerSmoother";
import type { Point } from "./quad";

const DOT_SIZE = 26;

/** A dot's position: a transform, never left/top (docs/design/scan-v2). */
function dotTransform(p: Point): string {
  return `translate3d(${p.x - DOT_SIZE / 2}px, ${p.y - DOT_SIZE / 2}px, 0)`;
}

/**
 * The line between two corners, as one 1 px wide element stretched and
 * turned by a transform, so it glides with the dots (same property, same
 * timing) instead of stepping with each sample.
 */
function edgeTransform(a: Point, b: Point): string {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  return `translate3d(${a.x}px, ${a.y}px, 0) rotate(${angle}rad) scaleX(${length})`;
}

const EDGES: readonly (readonly [number, number])[] = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 0],
];

/**
 * The four paper-corner dots (scan v2). Each sits where its smoothed state
 * says (`cornerSmoother.ts`), or on its guide position until it has been
 * seen. A found corner is a filled green check; a lost one is hollow and
 * stays where it was. A corner found for the first time pops in with one
 * pulse ring; both replay only when `foundCount` goes up (the `key`), so a
 * corner that blinks does not pulse again.
 */
export function EasyCorners({
  states,
  guide,
  hidden,
}: {
  readonly states: CornerStates;
  /** Guide positions (TL, TR, BR, BL) in stage pixels. */
  readonly guide: readonly [Point, Point, Point, Point];
  /** Fades the whole layer out (once the measured overlay draws its own). */
  readonly hidden: boolean;
}) {
  const points = states.map((state, i) => cornerDrawPoint(state, guide[i]));
  const allFound = states.every((state) => state.found);
  return (
    <div
      className={`easyCorners${hidden ? " hidden" : ""}`}
      data-testid="easy-corners"
      aria-hidden="true"
    >
      {EDGES.map(([from, to]) => (
        <span
          key={`edge-${from}`}
          className={`easyEdge${allFound ? " on" : ""}`}
          style={{ transform: edgeTransform(points[from], points[to]) }}
        />
      ))}
      {states.map((state, i) => (
        <div
          key={i}
          className={`easyCorner${isCornerReturning(state) ? " returning" : ""}`}
          data-found={state.found}
          style={{ transform: dotTransform(points[i]) }}
        >
          <span className="easyCornerRing" />
          {state.foundCount > 0 && (
            <>
              <span
                key={`fill-${state.foundCount}`}
                className={`easyCornerFill${state.found ? " found" : ""}`}
              >
                <svg viewBox="0 0 20 20">
                  <path d="M5 10.3 L8.4 13.7 L15 6.3" />
                </svg>
              </span>
              <span
                key={`pulse-${state.foundCount}`}
                className="easyCornerPulse"
              />
            </>
          )}
        </div>
      ))}
    </div>
  );
}
