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

  it("adds a caller's class after its own", () => {
    const withClass = renderToStaticMarkup(
      createElement(BrandMark, { className: "x" }),
    );
    expect(withClass).toContain('class="brand-mark x"');
  });
});
