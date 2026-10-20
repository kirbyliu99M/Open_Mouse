import { describe, expect, it } from "vitest";
import { keyboardInset } from "../../src/lib/scan/sheetGesture";

describe("keyboardInset: how much of the layout viewport the keyboard covers", () => {
  it("is 0 when nothing shrinks the visual viewport", () => {
    expect(keyboardInset(844, 844, 0)).toBe(0);
  });

  it("is the covered height when the keyboard shrinks only the visual viewport (iOS)", () => {
    expect(keyboardInset(844, 508, 0)).toBe(336);
  });

  it("subtracts how far the page was panned down", () => {
    expect(keyboardInset(844, 508, 120)).toBe(216);
  });

  it("is 0 when the browser resized the layout viewport itself (Android Chrome)", () => {
    expect(keyboardInset(508, 508, 0)).toBe(0);
  });

  it("ignores a few pixels (rounding, a collapsing toolbar)", () => {
    expect(keyboardInset(844, 810, 0)).toBe(0);
    expect(keyboardInset(844, 803, 0)).toBe(41);
  });

  it("is never negative, and 0 for numbers that are not finite", () => {
    expect(keyboardInset(500, 700, 0)).toBe(0);
    expect(keyboardInset(Number.NaN, 500, 0)).toBe(0);
    expect(keyboardInset(844, Number.POSITIVE_INFINITY, 0)).toBe(0);
  });
});
