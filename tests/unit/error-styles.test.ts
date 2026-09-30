import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The error screens' colours, checked from the stylesheet itself. The e2e axe
 * run covers the not-found page and the error screen in both colour schemes,
 * but it can not reach global-error.tsx (it only appears when the root layout
 * fails), whose `.errorBody` brings its own background and text colour. This
 * reads errors.css and globals.css and holds every text and control colour to
 * WCAG contrast, so a change to a token fails here whichever screen it lands on.
 */
const errorsCss = readFileSync("src/components/errors/errors.css", "utf8");
const globalsCss = readFileSync("src/app/globals.css", "utf8");

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

function schemes(css: string) {
  const clean = withoutComments(css);
  const light = rules(withoutMedia(clean));
  const [darkBlock] = blockAfter(clean, "@media (prefers-color-scheme: dark)");
  const darkOverrides = rules(darkBlock);
  /** The value of `property` on `selector` in a scheme (dark falls back to light), if declared. */
  const optional = (
    scheme: "light" | "dark",
    selector: string,
    property: string,
  ): string | undefined => {
    const dark =
      scheme === "dark" ? darkOverrides.get(selector)?.[property] : undefined;
    return dark ?? light.get(selector)?.[property];
  };
  const value = (
    scheme: "light" | "dark",
    selector: string,
    property: string,
  ) => {
    const found = optional(scheme, selector, property);
    if (!found)
      throw new Error(`${selector} { ${property} } not found (${scheme})`);
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
/** `3px solid #0a64e0` -> `#0a64e0`; `1px solid #86868b` likewise. */
const colourOf = (shorthand: string) => /#[0-9a-f]{3,6}\b/i.exec(shorthand)![0];

const errors = schemes(errorsCss);
const globals = schemes(globalsCss);

describe.each(["light", "dark"] as const)(
  "error screen colours, %s",
  (scheme) => {
    const bg = errors.value(scheme, ".errorBody", "background");
    const text = errors.value(scheme, ".errorBody", "color");

    it("uses the site's own page background and text colour (global-error has no globals.css)", () => {
      expect(bg).toBe(globals.value(scheme, ":root", "background"));
      expect(text).toBe(globals.value(scheme, ":root", "color"));
    });

    it("body text is at least 7:1 on the page", () => {
      expect(contrast(text, bg)).toBeGreaterThanOrEqual(7);
    });

    it.each([
      ".errorScreen-eyebrow",
      ".errorScreen-message",
      ".errorScreen-reference",
    ])("%s is at least 4.5:1 on the page", (selector) => {
      expect(
        contrast(errors.value(scheme, selector, "color"), bg),
      ).toBeGreaterThanOrEqual(4.5);
    });

    it("the primary button's label is at least 4.5:1 on its fill", () => {
      expect(
        contrast(
          errors.value(scheme, ".errorAction-primary", "color"),
          errors.value(scheme, ".errorAction-primary", "background"),
        ),
      ).toBeGreaterThanOrEqual(4.5);
    });

    it("the primary button's fill is at least 3:1 on the page (WCAG 1.4.11)", () => {
      expect(
        contrast(
          errors.value(scheme, ".errorAction-primary", "background"),
          bg,
        ),
      ).toBeGreaterThanOrEqual(3);
    });

    it("the secondary button's outline is at least 3:1 on the page", () => {
      expect(
        contrast(
          errors.value(scheme, ".errorAction-secondary", "border-color"),
          bg,
        ),
      ).toBeGreaterThanOrEqual(3);
    });

    it("the focus ring is at least 3:1 on the page", () => {
      // Dark mode overrides only the colour; light declares the shorthand.
      const ring =
        errors.optional(
          scheme,
          ".errorAction:focus-visible",
          "outline-color",
        ) ??
        colourOf(errors.value(scheme, ".errorAction:focus-visible", "outline"));
      expect(contrast(ring, bg)).toBeGreaterThanOrEqual(3);
    });
  },
);
