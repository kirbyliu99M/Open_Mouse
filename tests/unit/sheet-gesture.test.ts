import { describe, expect, it } from "vitest";
import {
  CLICK_GUARD_MS,
  CLOSE_DRAG_SHARE,
  createClickGuard,
  closesFromDrag,
  HANDLE_FOLLOW_MAX_PX,
  handleOffset,
  isDrag,
  isJitteryTap,
  OPEN_DRAG_PX,
  opensFromDrag,
  TAP_MAX_TRAVEL_PX,
  TAP_SLOP_PX,
} from "../../src/lib/scan/sheetGesture";

describe("the manual-entry sheet gestures", () => {
  it("treats a small movement as a tap, a larger one as a drag", () => {
    expect(isDrag(0, 0)).toBe(false);
    expect(isDrag(TAP_SLOP_PX, 0)).toBe(false);
    expect(isDrag(0, TAP_SLOP_PX + 1)).toBe(true);
    expect(isDrag(6, 6)).toBe(true);
  });

  it("counts a wobbly press as a tap: it stayed within the travel limit and barely went down", () => {
    expect(isJitteryTap(0, 0)).toBe(true);
    expect(isJitteryTap(10, 0)).toBe(true); // sideways
    expect(isJitteryTap(12, 0)).toBe(true); // up only: never below the start
    expect(isJitteryTap(Math.hypot(16, 16), 0)).toBe(true); // diagonal up, ~22.6
    expect(isJitteryTap(TAP_MAX_TRAVEL_PX, 0)).toBe(true);
    expect(isJitteryTap(TAP_MAX_TRAVEL_PX, TAP_SLOP_PX)).toBe(true);
  });

  it("rejects a press that got too far from the start at any point", () => {
    expect(isJitteryTap(TAP_MAX_TRAVEL_PX + 0.01, 0)).toBe(false);
    expect(isJitteryTap(Math.hypot(18, 16), 0)).toBe(false); // ~24.08
    expect(isJitteryTap(Math.hypot(20, 20), 0)).toBe(false);
    // Far sideways, only a little down: the total still decides.
    expect(isJitteryTap(Math.hypot(24, 8), TAP_SLOP_PX)).toBe(false);
  });

  it("never counts a drag downward as a tap, even one that came back", () => {
    expect(isJitteryTap(TAP_SLOP_PX, TAP_SLOP_PX)).toBe(true);
    expect(isJitteryTap(TAP_SLOP_PX + 1, TAP_SLOP_PX + 1)).toBe(false);
    expect(isJitteryTap(12, 12)).toBe(false);
    // Down 20 px and back to where it started: farthest 20, down 20.
    expect(isJitteryTap(20, 20)).toBe(false);
  });

  it("opens when the handle is dragged up far enough, however slowly", () => {
    expect(opensFromDrag(OPEN_DRAG_PX, 2000)).toBe(true);
    expect(opensFromDrag(OPEN_DRAG_PX - 1, 2000)).toBe(false);
  });

  it("opens on a short fast flick, not on a short slow one, not on a drag down", () => {
    expect(opensFromDrag(20, 30)).toBe(true);
    expect(opensFromDrag(20, 400)).toBe(false);
    expect(opensFromDrag(-60, 100)).toBe(false);
    expect(opensFromDrag(0, 100)).toBe(false);
  });

  it("closes when the sheet is dragged down by a share of its height or flicked", () => {
    const height = 500;
    expect(closesFromDrag(height * CLOSE_DRAG_SHARE + 1, 3000, height)).toBe(
      true,
    );
    expect(closesFromDrag(height * CLOSE_DRAG_SHARE - 1, 3000, height)).toBe(
      false,
    );
    expect(closesFromDrag(40, 40, height)).toBe(true);
    expect(closesFromDrag(40, 400, height)).toBe(false);
    expect(closesFromDrag(10, 5, height)).toBe(false);
  });

  it("makes the handle follow the finger up to a limit, and never down", () => {
    expect(handleOffset(10)).toBe(-10);
    expect(handleOffset(500)).toBe(-HANDLE_FOLLOW_MAX_PX);
    expect(Math.abs(handleOffset(-30))).toBe(0);
  });
});

describe("the click guard after a drag of the handle", () => {
  it("swallows the one click that follows a drag, once", () => {
    const guard = createClickGuard();
    guard.armAfterDrag();
    expect(guard.swallows(1)).toBe(true);
    expect(guard.swallows(1)).toBe(false);
  });

  it("lets a click through when no drag armed it", () => {
    expect(createClickGuard().swallows(1)).toBe(false);
  });

  it("is cleared by the next press or by the timeout: a drag with no click must not eat a later tap", () => {
    const guard = createClickGuard();
    guard.armAfterDrag();
    guard.reset();
    expect(guard.swallows(1)).toBe(false);
    expect(CLICK_GUARD_MS).toBeGreaterThan(0);
    expect(CLICK_GUARD_MS).toBeLessThanOrEqual(300);
  });

  it("never swallows a keyboard click (detail 0), and the keyboard click consumes the guard", () => {
    const guard = createClickGuard();
    guard.armAfterDrag();
    expect(guard.swallows(0)).toBe(false);
    expect(guard.swallows(1)).toBe(false);
  });
});
