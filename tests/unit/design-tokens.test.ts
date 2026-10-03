import { readFileSync } from "node:fs";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The dark theme's tokens (src/app/tokens.css) against the table in
 * docs/design/home-v3-2026-10-03/README.md ("Dark theme tokens"): the values
 * and the contrast ratios the spec states. The site is one dark theme, so
 * there is no light set to check.
 */
const tokensCss = readFileSync("src/app/tokens.css", "utf8");

const rootBlock = /:root\s*\{([^}]*)\}/.exec(
  tokensCss.replace(/\/\*[\s\S]*?\*\//g, ""),
)![1]!;
const token = (name: string): string => {
  const match = new RegExp(`${name}:\\s*([^;]+);`).exec(rootBlock);
  if (!match) throw new Error(`${name} is not in tokens.css`);
  return match[1]!.trim().toLowerCase();
};

function channels(hex: string): [number, number, number] {
  const digits = hex.replace("#", "").slice(0, 6);
  return [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16)) as [
    number,
    number,
    number,
  ];
}
function luminance([r, g, b]: [number, number, number]): number {
  const [lr, lg, lb] = [r, g, b].map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}
function ratio(a: [number, number, number], b: [number, number, number]) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (hi + 0.05) / (lo + 0.05);
}
const rgb = (name: string) => channels(token(name));
/** An 8-digit hex over `under`, as it looks on the page. */
function over(hex8: string, under: [number, number, number]) {
  const alpha = parseInt(hex8.slice(7, 9), 16) / 255;
  const top = channels(hex8);
  return top.map((c, i) => c * alpha + under[i]! * (1 - alpha)) as [
    number,
    number,
    number,
  ];
}

describe("the dark tokens", () => {
  it("carry the values in the spec's table", () => {
    expect(token("--bg")).toBe("#060709");
    expect(token("--text-primary")).toBe("#f5f5f7");
    expect(token("--text-secondary")).toBe("#a1a1a6");
    expect(token("--text-tertiary")).toBe("#8a8a8f");
    expect(token("--accent")).toBe("#1f6bf0");
    expect(token("--on-accent")).toBe("#ffffff");
    expect(token("--accent-pressed")).toBe("#1a5cd0");
    expect(token("--accent-text")).toBe("#7fa8ff");
    expect(token("--control-border")).toBe("#ffffff59");
    expect(token("--hairline")).toBe("#ffffff24");
    expect(token("--sketch-line")).toBe("#cfe0ff");
    expect(token("--sketch-line-detail")).toBe("#6e9bf5");
    expect(token("--glow")).toBe("#3b82f6");
  });

  it("is one dark theme: color-scheme is dark, and nothing follows the system's light/dark setting", () => {
    expect(token("color-scheme")).toBe("dark");
    expect(tokensCss).not.toContain("prefers-color-scheme");
  });

  it("keeps the contrast the spec states, to the first decimal", () => {
    const bg = rgb("--bg");
    const round = (n: number) => Math.round(n * 10) / 10;
    expect(round(ratio(rgb("--text-primary"), bg))).toBeGreaterThanOrEqual(
      18.5,
    );
    expect(round(ratio(rgb("--text-secondary"), bg))).toBeGreaterThanOrEqual(
      7.8,
    );
    expect(round(ratio(rgb("--text-tertiary"), bg))).toBeGreaterThanOrEqual(
      5.9,
    );
    expect(round(ratio(rgb("--accent-text"), bg))).toBeGreaterThanOrEqual(8.6);
    expect(round(ratio(rgb("--sketch-line"), bg))).toBeGreaterThanOrEqual(15.1);
    expect(
      round(ratio(rgb("--on-accent"), rgb("--accent"))),
    ).toBeGreaterThanOrEqual(4.7);
    expect(
      round(ratio(rgb("--on-accent"), rgb("--accent-pressed"))),
    ).toBeGreaterThanOrEqual(6);
    // The outline button's border, as it looks over the page (about 3.1:1).
    const border = ratio(over(token("--control-border"), bg), bg);
    expect(border).toBeGreaterThanOrEqual(3);
    expect(round(border)).toBeLessThanOrEqual(3.3);
  });

  it("never uses --accent for text: it is only 4.24:1 on the page background", () => {
    expect(ratio(rgb("--accent"), rgb("--bg"))).toBeLessThan(4.5);
    // ...and --accent-text on the selected-chip fill is above 4.5:1.
    const chipFill = channels("#1f3554");
    expect(ratio(rgb("--accent-text"), chipFill)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(rgb("--accent"), chipFill)).toBeLessThan(3);
  });

  it("makes a more-contrast user's borders solid and drops the glow", () => {
    const more =
      /@media \(prefers-contrast: more\)\s*\{\s*:root\s*\{([^}]*)\}/.exec(
        tokensCss,
      )![1]!;
    expect(more).toMatch(/--control-border:\s*#8a8a8f/i);
    expect(more).toMatch(/--hairline:\s*#8a8a8f/i);
    expect(more).toMatch(/--glow:\s*transparent/i);
    // Solid #8A8A8F is 5.9:1 on the page.
    expect(
      Math.round(ratio(channels("#8a8a8f"), rgb("--bg")) * 10) / 10,
    ).toBeGreaterThanOrEqual(5.9);
  });
});

/** Every .css file under src. */
function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory()
      ? cssFiles(path)
      : path.endsWith(".css")
        ? [path]
        : [];
  });
}

describe("the stylesheets", () => {
  const files = cssFiles("src");

  it("has no light/dark pair left: no stylesheet reads prefers-color-scheme, bar sheet.css's screen-only note", () => {
    for (const file of files) {
      const css = readFileSync(file, "utf8");
      expect(css, file).not.toMatch(/prefers-color-scheme/);
      expect(css, file).not.toMatch(/color-scheme:\s*light/);
    }
  });

  it("keeps no hard-coded accent hex outside the token file: one primary button, one accent text colour", () => {
    // #0a64e0 and #79adff were the two old accents; #a8ceff and #6aa8ff the
    // two old accent-text colours; #1f6bf0 and #7fa8ff are the tokens' own
    // values. Only tokens.css may write any of them.
    const banned =
      /#(0a64e0|79adff|a8ceff|6aa8ff|1f6bf0|7fa8ff|1a5cd0|2f7bff)\b/i;
    for (const file of files) {
      if (file.endsWith("tokens.css")) continue;
      const stripped = readFileSync(file, "utf8")
        // Comments may name an old colour when they explain a change.
        .replace(/\/\*[\s\S]*?\*\//g, "")
        // Print-only colours stay as they are.
        .replace(/@media print\s*\{(?:[^{}]|\{[^{}]*\})*\}/g, "");
      expect(stripped, file).not.toMatch(banned);
    }
  });

  it("sets an explicit light page for print", () => {
    const globals = readFileSync("src/app/globals.css", "utf8");
    expect(globals).toMatch(
      /@media print\s*\{\s*:root,\s*body\s*\{\s*background:\s*#fff;\s*color:\s*#000;\s*\}\s*\}/,
    );
  });

  it("keeps sheet.css's dark values inside its screen-only block, so print is unaffected", () => {
    const sheet = readFileSync("src/app/sheet/sheet.css", "utf8");
    // The callout, the secondary link and the after-sheet text are only
    // styled inside @media screen.
    const beforeScreen = sheet.slice(0, sheet.indexOf("@media screen"));
    expect(beforeScreen).not.toContain(".sheet-callout");
    expect(beforeScreen).not.toContain(".sheet-secondary");
    expect(sheet).toContain("@media screen");
  });
});
