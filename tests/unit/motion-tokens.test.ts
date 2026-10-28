import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MOTION, leaveMs } from "../../src/lib/motion";

const css = readFileSync("src/app/tokens.css", "utf-8");
const token = (name: string) =>
  css.match(new RegExp(`--${name}:\s*([^;]+);`))?.[1]?.trim();

describe("motion tokens (V3.2 motion pass)", () => {
  it("the CSS tokens and MOTION say the same numbers", () => {
    expect(token("motion-fast")).toBe(`${MOTION.FAST_MS}ms`);
    expect(token("motion-base")).toBe(`${MOTION.BASE_MS}ms`);
    expect(token("motion-out")).toBe(`${MOTION.OUT_MS}ms`);
    expect(token("motion-sheet-in")).toBe(`${MOTION.SHEET_IN_MS}ms`);
    expect(token("motion-sheet-out")).toBe(`${MOTION.SHEET_OUT_MS}ms`);
    expect(token("motion-reduced")).toBe(`${MOTION.REDUCED_MS}ms`);
    expect(token("motion-shift")).toBe(`${MOTION.SHIFT_PX}px`);
    expect(token("ease-out")).toBe(MOTION.EASE_OUT);
    expect(token("ease-in")).toBe(MOTION.EASE_IN);
  });

  it("leaveMs: a sheet goes in 240 ms, a fade in 160 ms, both 120 ms under reduced motion", () => {
    expect(leaveMs("sheet", false)).toBe(240);
    expect(leaveMs("fade", false)).toBe(160);
    expect(leaveMs("sheet", true)).toBe(120);
    expect(leaveMs("fade", true)).toBe(120);
  });
});
