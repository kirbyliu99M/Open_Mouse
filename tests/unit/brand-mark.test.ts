import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BrandMark } from "../../src/components/brand/BrandMark";

describe("BrandMark", () => {
  const html = renderToStaticMarkup(createElement(BrandMark));

  it("is a decorative, unfocusable 28 px SVG on a 32 x 32 grid", () => {
    expect(html.startsWith("<svg")).toBe(true);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('focusable="false"');
    expect(html).toContain('viewBox="0 0 32 32"');
    expect(html).toContain('width="28"');
    expect(html).toContain('height="28"');
    expect(html).toContain('data-testid="brand-mark"');
  });

  it("carries no text, link, button or tab stop", () => {
    expect(html).not.toMatch(/<(a|button|text|title)\b/);
    expect(html).not.toContain("tabindex");
    expect(html).not.toContain("<animate");
  });

  it("takes every colour from CSS classes, none written in the markup", () => {
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(html).not.toMatch(/\b(?:stroke|fill)="(?!none")/);
    expect(html).toContain("brand-mark-plate");
    expect(html).toContain("brand-mark-hand");
  });

  // A verbatim copy of the L2 artwork (Kirby, 2026-10-10), kept here on
  // purpose: an edit to the component's geometry fails these checks.
  const L2_PATH =
    "M38 48c0 4 4 6 7 4 3-2 3-8-1-11-6-4-16 1-18 11-2 12 10 20 22 20 12 0 22-8 24-22 1-12-4-24-8-28-2-2-5-1-5 2 0 8 4 20 3 30m-4-16c0-12-2-22-6-24-2-2-5-1-6 2-2 8 0 20 0 30m-2-14c-1-8-3-14-7-16-2-2-5-1-6 2-2 8 1 20 3 28m-4-10c-2-6-5-12-8-12-3 0-4 3-3 8 1 8 3 16 5 22";

  it("keeps the L2 geometry: the frame, the group transform and the hand path", () => {
    // The frame: an inset rounded square, so its stroke lies inside the viewBox.
    expect(html).toContain(
      '<rect class="brand-mark-plate" x="0.5" y="0.5" width="31" height="31" rx="7.5"></rect>',
    );
    // The hand: the group transform, the path and its stroke style.
    expect(html).toContain('<g transform="translate(-5.16 -2.4) scale(0.46)">');
    expect(html).toContain(
      `<path class="brand-mark-hand" d="${L2_PATH}" fill="none" stroke-width="7.5" stroke-linecap="round" stroke-linejoin="round"></path>`,
    );
  });

  it("draws the frame with a 1-unit stroke (a CSS rule, in globals.css)", () => {
    const css = readFileSync(
      join(process.cwd(), "src", "app", "globals.css"),
      "utf8",
    );
    const rule = /\n\.brand-mark-plate \{([^}]*)\}/.exec(css);
    expect(rule).not.toBeNull();
    expect(rule![1]).toMatch(/stroke-width:\s*1;/);
  });

  it("adds a caller's class after its own", () => {
    const withClass = renderToStaticMarkup(
      createElement(BrandMark, { className: "x" }),
    );
    expect(withClass).toContain('class="brand-mark x"');
  });
});
