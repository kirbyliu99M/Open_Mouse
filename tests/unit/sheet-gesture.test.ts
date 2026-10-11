import { describe, expect, it } from "vitest";
import {
  CLOSE_DRAG_SHARE,
  closesFromDrag,
  HANDLE_FOLLOW_MAX_PX,
  handleOffset,
  isDrag,
  OPEN_DRAG_PX,
  opensFromDrag,
  TAP_SLOP_PX,
} from "../../src/lib/scan/sheetGesture";

describe("the manual-entry sheet gestures", () => {
  it("treats a small movement as a tap, a larger one as a drag", () => {
    expect(isDrag(0, 0)).toBe(false);
    expect(isDrag(TAP_SLOP_PX, 0)).toBe(false);
    expect(isDrag(0, TAP_SLOP_PX + 1)).toBe(true);
    expect(isDrag(6, 6)).toBe(true);
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
