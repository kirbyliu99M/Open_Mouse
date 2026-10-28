"use client";

import {
  useLayoutEffect,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import { leaveShieldStyle, type ShieldBox } from "./scanMotion";

/**
 * A transparent layer over something that is leaving (V3.2 motion pass, e2e
 * round 2, candidate / 未拍板): it takes the taps that land where the piece
 * was, so a double tap (重拍 pressed twice) does not reach the control that is
 * coming back under it.
 *
 * The leaving piece itself is inert, and the HTML spec has an inert node
 * hit-tested as if `pointer-events: none`: on its own it would let the tap
 * through. This layer is not inert and has no handler, so the tap ends here
 * and does nothing. It covers the box the piece had when its leave began (the
 * whole screen for a full-screen one), just above it (its own z-index), for
 * as long as the piece is mounted to leave; a new screen in the top layer (a
 * modal dialog) stays above it and usable.
 *
 * Render it only while `leaving`; it measures its target once, before paint.
 * It places itself (fixed, transparent) so it works on pages without
 * easy-scan.css too: the results page's feedback sheet and the cookie banner
 * use it for the same reason.
 */
export function LeaveShield({
  target,
}: {
  target: RefObject<HTMLElement | null>;
}) {
  const [box, setBox] = useState<ShieldBox | null>(null);
  useLayoutEffect(() => {
    const el = target.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setBox({
      left: r.left,
      top: r.top,
      width: r.width,
      height: r.height,
      zIndex: getComputedStyle(el).zIndex,
    });
  }, [target]);
  const placed = box ? leaveShieldStyle(box) : null;
  if (!placed) return null;
  const style: CSSProperties = {
    position: "fixed",
    background: "transparent",
    ...placed,
  };
  return (
    <div
      className="easyLeaveShield"
      data-testid="leave-shield"
      aria-hidden="true"
      style={style}
    />
  );
}
