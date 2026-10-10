import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The error screens' colours, checked from the stylesheet itself. The site is
 * one dark theme (Kirby, 2026-10-03), so there is a single set of colours to
 * hold to WCAG contrast. The e2e axe run covers the not-found page and the
 * error screen, but it can not reach global-error.tsx (it only appears when
 * the root layout fails), whose `.errorBody` brings its own background and text
 * colour. This reads errors.css, tokens.css and globals.css and resolves the
 * `var(--token)` colours, so a change to a token fails here whichever screen
 * it lands on.
 */
const errorsCss = readFileSync("src/components/errors/errors.css", "utf8");
const tokensCss = readFileSync("src/app/tokens.css", "utf8");
const globalsCss = readFileSync("src/app/globals.css", "utf8");
const errorScreenTsx = readFileSync(
  "src/components/errors/ErrorScreen.tsx",
  "utf8",
);

const withoutComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** The text between the braces that follow `header`, braces matched. */
function blockAfter(css: string, header: string, from = 0): [string, number] {
  const start = css.indexOf(header, from);
  if (start < 0) throw new Error(`no ${header} in the stylesheet`);
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        return [css.slice(css.indexOf("{", start) + 1, i), i + 1];
      }
    }
  }
  throw new Error(`unbalanced braces after ${header}`);
}

/** Every `@media ... { }` block removed: what applies with no media query. */
function withoutMedia(css: string): string {
  let out = css;
  for (;;) {
    const at = out.indexOf("@media");
    if (at < 0) return out;
    const [, end] = blockAfter(out, "@media", at);
    out = out.slice(0, at) + out.slice(end);
  }
}

type Declarations = Record<string, string>;

/** selector -> declarations for a flat list of `a, b { x: y; }` rules. */
function rules(css: string): Map<string, Declarations> {
  const out = new Map<string, Declarations>();
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const declarations: Declarations = {};
    for (const line of match[2]!.split(";")) {
      const colon = line.indexOf(":");
      if (colon > 0) {
        declarations[line.slice(0, colon).trim()] = line
          .slice(colon + 1)
          .trim();
      }
    }
    for (const selector of match[1]!.split(",")) {
      const key = selector.trim();
      out.set(key, { ...(out.get(key) ?? {}), ...declarations });
    }
  }
  return out;
}

const tokens = rules(withoutMedia(withoutComments(tokensCss))).get(":root")!;

/** `var(--bg)` -> the token's value; anything else is returned as written. */
function resolve(value: string): string {
  return value.replace(/var\((--[a-z-]+)\)/g, (_, name: string) => {
    const found = tokens[name];
    if (!found) throw new Error(`${name} is not defined in tokens.css`);
    return found;
  });
}

function sheet(css: string) {
  const flat = rules(withoutMedia(withoutComments(css)));
  /** The resolved value of `property` on `selector`, if declared. */
  const optional = (selector: string, property: string): string | undefined => {
    const found = flat.get(selector)?.[property];
    return found === undefined ? undefined : resolve(found);
  };
  const value = (selector: string, property: string) => {
    const found = optional(selector, property);
    if (!found) throw new Error(`${selector} { ${property} } not found`);
    return found;
  };
  return { value, optional };
}

function luminance(hex: string): number {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) throw new Error(`not a hex colour: ${hex}`);
  const digits =
    match[1]!.length === 3
      ? [...match[1]!].map((d) => d + d).join("")
      : match[1]!;
  const [r, g, b] = [0, 2, 4].map((i) => {
    const channel = parseInt(digits.slice(i, i + 2), 16) / 255;
    return channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (hi + 0.05) / (lo + 0.05);
}
/** `3px solid #7fa8ff` -> `#7fa8ff`; `1px solid #6e6e73` likewise. */
const colourOf = (shorthand: string) => /#[0-9a-f]{3,6}\b/i.exec(shorthand)![0];

const errors = sheet(errorsCss);
const globals = sheet(globalsCss);

describe("error screen colours (the one dark theme)", () => {
  const bg = errors.value(".errorBody", "background");
  const text = errors.value(".errorBody", "color");

  it("uses the site's own page background and text colour (global-error has no globals.css)", () => {
    expect(bg).toBe(globals.value(":root", "background"));
    expect(text).toBe(globals.value(":root", "color"));
    expect(bg).toBe(tokens["--bg"]);
    expect(text).toBe(tokens["--text-primary"]);
  });

  it("brings the tokens along itself, because global-error replaces the root layout", () => {
    expect(errorScreenTsx).toMatch(/import "\.\.\/\.\.\/app\/tokens\.css";/);
    expect(errors.value(".errorBody", "color-scheme")).toBe("dark");
  });

  it("body text is at least 7:1 on the page", () => {
    expect(contrast(text, bg)).toBeGreaterThanOrEqual(7);
  });

  it.each([
    ".errorScreen-eyebrow",
    ".errorScreen-message",
    ".errorScreen-reference",
    ".errorScreen-status",
  ])("%s is at least 4.5:1 on the page", (selector) => {
    expect(
      contrast(errors.value(selector, "color"), bg),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("the primary button's label is at least 4.5:1 on its fill, and on its pressed fill", () => {
    const fill = errors.value(".errorAction-primary", "background");
    const label = errors.value(".errorAction-primary", "color");
    expect(contrast(label, fill)).toBeGreaterThanOrEqual(4.5);
    // Pressing darkens the fill; it never lowers the opacity (README, Buttons).
    expect(
      contrast(
        label,
        errors.value(".errorAction-primary:active", "background"),
      ),
    ).toBeGreaterThanOrEqual(4.5);
    expect(errors.optional(".errorAction-primary:active", "opacity")).toBe(
      undefined,
    );
    expect(errors.optional(".errorAction:active", "opacity")).toBe(undefined);
  });

  it("the primary button's fill is at least 3:1 on the page (WCAG 1.4.11)", () => {
    expect(
      contrast(errors.value(".errorAction-primary", "background"), bg),
    ).toBeGreaterThanOrEqual(3);
  });

  it("the secondary button is a text link in the accent text colour: 4.5:1 on the page, no visible border or underline (BTN-1, style B)", () => {
    const label = colourOf(errors.value(".errorAction-secondary", "color"));
    expect(label).toBe(tokens["--accent-text"]);
    expect(contrast(label, bg)).toBeGreaterThanOrEqual(4.5);
    expect(errors.value(".errorAction-secondary", "border-color")).toBe(
      "transparent",
    );
    expect(errors.value(".errorAction-secondary", "text-decoration")).toBe(
      "none",
    );
  });

  it("the focus ring is at least 3:1 on the page, and is the accent text colour", () => {
    const ring = colourOf(
      errors.value(".errorAction:focus-visible", "outline"),
    );
    expect(ring).toBe(tokens["--accent-text"]);
    expect(contrast(ring, bg)).toBeGreaterThanOrEqual(3);
  });
});

describe("the Try again button while a retry runs", () => {
  // aria-disabled, not disabled (see RetryButton): only the stylesheet makes it
  // look busy, so the rule must exist.
  it("looks busy", () => {
    const selector = '.errorAction[aria-disabled="true"]';
    expect(errors.value(selector, "cursor")).toBe("progress");
    const opacity = Number(errors.value(selector, "opacity"));
    expect(opacity).toBeGreaterThan(0.5);
    expect(opacity).toBeLessThan(1);
  });
});
