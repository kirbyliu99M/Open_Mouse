import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Kirby, 2026-10-24: the cookie banner follows the colour tokens strictly. It
// is glass over the page, so every colour in it must come from tokens.css (a
// colour-mix of a token with transparent is a token's own colour at some
// opacity, not a new colour).
const css = readFileSync("src/components/consent/cookie-banner.css", "utf8");
const tokens = readFileSync("src/app/tokens.css", "utf8");
const rules = css.replace(/\/\*[\s\S]*?\*\//g, "");

describe("cookie-banner.css", () => {
  it("writes no colour of its own: no hex, rgb(), hsl(), oklch() or colour keyword", () => {
    expect(rules).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(rules).not.toMatch(
      /\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i,
    );
    expect(rules).not.toMatch(
      /(?<![-\w])(white|black|red|green|blue|gray|grey|silver|navy|teal|orange|yellow|purple|pink)(?![-\w])/i,
    );
  });

  it("uses only custom properties that tokens.css defines (or that it defines itself)", () => {
    const defined = new Set(
      [...tokens.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1]),
    );
    for (const m of rules.matchAll(/(--[a-z0-9-]+)\s*:/gi)) defined.add(m[1]!);
    const used = [...rules.matchAll(/var\((--[a-z0-9-]+)/gi)].map((m) => m[1]!);
    expect(used.length).toBeGreaterThan(8);
    for (const name of used) expect(defined.has(name), name).toBe(true);
  });

  it("mixes only a token with transparent, never two raw colours", () => {
    for (const m of rules.matchAll(/color-mix\(([^;]*)\)\s*;/g)) {
      expect(m[1]).toMatch(/var\(--[a-z-]+\)\s+\d+%\s*,\s*transparent/);
    }
  });

  it("is a glass layer per the guidelines, with solid fallbacks", () => {
    expect(rules).toContain("blur(20px) saturate(180%)");
    expect(rules).toContain("prefers-reduced-transparency: reduce");
    expect(rules).toContain("prefers-contrast: more");
    expect(rules).toMatch(/@supports not/);
  });

  it("sizes the two answers to the 44 px touch target", () => {
    expect(rules).toMatch(
      /\.cookieBanner-button\s*\{[^}]*min-height:\s*2\.75rem/,
    );
  });
});
