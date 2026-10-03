"use client";

import { useRef } from "react";
import {
  cornerDrawPoints,
  isCornerReturning,
  type CornerStates,
} from "./cornerSmoother";
import { edgeTransform, placeEdges } from "./edgeGeometry";
import type { Point } from "./quad";

const DOT_SIZE = 26;

/** A dot's position: a transform, never left/top (docs/design/scan-v2). */
function dotTransform(p: Point): string {
  return `translate3d(${p.x - DOT_SIZE / 2}px, ${p.y - DOT_SIZE / 2}px, 0)`;
}

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
  const points = cornerDrawPoints(states, guide);
  const allFound = states.every((state) => state.found);
  // Each edge keeps its last angle, so a new one is taken as the equivalent
  // nearest to it and a rotation never sweeps more than a quarter turn (see
  // edgeGeometry.ts). Assigning here is safe to repeat: the same points give
  // the same angles.
  const edgeAngles = useRef<(number | null)[]>([null, null, null, null]);
  const { placements, angles } = placeEdges(points, edgeAngles.current);
  edgeAngles.current = angles;
  return (
    <div
      className={`easyCorners${hidden ? " hidden" : ""}`}
      data-testid="easy-corners"
      aria-hidden="true"
    >
      {placements.map((edge, i) => (
        <span
          key={i}
          className={`easyEdge${allFound ? " on" : ""}`}
          style={{ transform: edgeTransform(edge) }}
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
