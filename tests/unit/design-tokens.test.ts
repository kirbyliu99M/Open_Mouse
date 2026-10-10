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
    expect(token("--button-primary-bg")).toBe("#f5f5f7");
    expect(token("--on-button-primary")).toBe("#060709");
    expect(token("--button-primary-pressed")).toBe("#d1d1d6");
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

// ── Reading the stylesheets themselves ─────────────────────────────────────

/** One rule of a stylesheet, with the @media query it sits in (null: none). */
interface Rule {
  readonly media: string | null;
  readonly selectors: readonly string[];
  readonly decls: Readonly<Record<string, string>>;
}

/** A flat list of rules, one @media level deep (the stylesheets go no deeper). */
function parseRules(css: string): Rule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: Rule[] = [];
  const walk = (source: string, media: string | null) => {
    let i = 0;
    while (i < source.length) {
      const open = source.indexOf("{", i);
      if (open < 0) break;
      let depth = 0;
      let close = open;
      for (; close < source.length; close += 1) {
        if (source[close] === "{") depth += 1;
        if (source[close] === "}") {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      const head = source.slice(i, open).trim();
      const body = source.slice(open + 1, close);
      if (head.startsWith("@media")) {
        walk(body, head.slice("@media".length).trim());
      } else if (!head.startsWith("@")) {
        const decls: Record<string, string> = {};
        for (const line of body.split(";")) {
          const colon = line.indexOf(":");
          if (colon > 0) {
            decls[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
          }
        }
        rules.push({
          media,
          selectors: head.split(",").map((s) => s.trim()),
          decls,
        });
      }
      i = close + 1;
    }
  };
  walk(text, null);
  return rules;
}

const rulesOf = (path: string) => parseRules(readFileSync(path, "utf8"));

/** The last value declared for `property` on exactly `selector` in `media`. */
function declared(
  rules: readonly Rule[],
  selector: string,
  property: string,
  media: string | null = null,
): string | undefined {
  let found: string | undefined;
  for (const rule of rules) {
    if (
      rule.media === media &&
      rule.selectors.includes(selector) &&
      property in rule.decls
    ) {
      found = rule.decls[property];
    }
  }
  return found;
}

/** `var(--token)` replaced by the dark token's value; any other value as written. */
const resolve = (value: string) =>
  value.replace(/var\((--[a-z-]+)\)/g, (_, name: string) => token(name));

/** A colour laid over an opaque one at `alpha`, as the eye sees it. */
function blend(
  top: [number, number, number],
  alpha: number,
  under: [number, number, number],
) {
  return top.map((c, i) => c * alpha + under[i]! * (1 - alpha)) as [
    number,
    number,
    number,
  ];
}

describe("the filled buttons: a near-white fill with a near-black label", () => {
  // The primary button is a near-white pill with a near-black label (BTN-1).
  // A selected toggle takes the same fill and label, in its own shape.
  // Dropping the opacity of a pressed button would fade the label, so every
  // filled button darkens its fill to the pressed token instead.
  const PRIMARY: readonly (readonly [string, string, string | null])[] = [
    ["src/app/scan/scan.css", ".uploadButton", null],
    ["src/app/scan/scan.css", ".primaryButton", null],
    ["src/app/learn/learn.css", ".learn-button", null],
    ["src/app/globals.css", ".button-primary", null],
    ["src/app/account/account.css", ".account-start-button", null],
    ["src/components/results/results.css", ".results-page-action", null],
    ["src/components/errors/errors.css", ".errorAction-primary", null],
    ["src/app/sheet/sheet.css", ".sheet-primary", "screen"],
    ["src/client/camera/camera.css", ".cameraUsePhoto", null],
    ["src/client/camera/camera.css", ".cameraResumeButton", null],
    ["src/client/camera/easy-scan.css", ".easyCopyLink", null],
    ["src/client/camera/easy-scan.css", ".easyUploadFallbackButton", null],
  ];

  it("the primary button tokens keep the contrast their comments state", () => {
    const bg = rgb("--button-primary-bg");
    const on = rgb("--on-button-primary");
    expect(ratio(on, bg)).toBeGreaterThanOrEqual(18);
    expect(ratio(on, rgb("--button-primary-pressed"))).toBeGreaterThanOrEqual(
      4.5,
    );
    // The white pill stands out from the page it sits on.
    expect(ratio(bg, rgb("--bg"))).toBeGreaterThanOrEqual(18);
    // A disabled pill fades as a whole over the page: the label and fill
    // both blend towards --bg, and the pair must still read at 3:1.
    const opacity = Number(token("--button-primary-disabled-opacity"));
    expect(opacity).toBeGreaterThan(0);
    expect(opacity).toBeLessThan(1);
    const page = rgb("--bg");
    expect(
      ratio(blend(on, opacity, page), blend(bg, opacity, page)),
    ).toBeGreaterThanOrEqual(3);
  });

  it("prints as a black pill with a white label, so it does not vanish on white paper", () => {
    const print = parseRules(tokensCss).find(
      (r) => r.media === "print" && r.selectors.includes(":root"),
    )!;
    const bg = channels(print.decls["--button-primary-bg"]!);
    expect(ratio(bg, channels(print.decls["--bg"]!))).toBeGreaterThanOrEqual(
      18,
    );
    expect(
      ratio(channels(print.decls["--on-button-primary"]!), bg),
    ).toBeGreaterThanOrEqual(18);
    expect(
      ratio(
        channels(print.decls["--on-button-primary"]!),
        channels(print.decls["--button-primary-pressed"]!),
      ),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it.each(PRIMARY)(
    "%s %s: a pill in the primary tokens; pressing darkens the fill and never lowers the opacity",
    (file, selector, media) => {
      const rules = rulesOf(file);
      const fill = declared(rules, selector, "background", media);
      expect(fill && resolve(fill), "its fill").toBe(
        token("--button-primary-bg"),
      );
      const label = declared(rules, selector, "color", media);
      expect(label && resolve(label), "its label").toBe(
        token("--on-button-primary"),
      );
      expect(declared(rules, selector, "border-radius", media), "pill").toBe(
        "999px",
      );

      const pressed = declared(
        rules,
        `${selector}:active`,
        "background",
        media,
      );
      expect(pressed && resolve(pressed), "pressed fill").toBe(
        token("--button-primary-pressed"),
      );
      expect(
        ratio(rgb("--on-button-primary"), channels(resolve(pressed!))),
        "label on the pressed fill",
      ).toBeGreaterThanOrEqual(4.5);

      for (const rule of rules) {
        if (
          rule.selectors.includes(`${selector}:active`) &&
          "opacity" in rule.decls
        ) {
          expect(Number(rule.decls.opacity), `${rule.media} opacity`).toBe(1);
        }
      }
    },
  );

  const FILLED: readonly (readonly [string, string, string | null])[] = [
    ["src/app/scan/scan.css", ".pickerButton.selected", null],
    ["src/client/camera/camera.css", ".cameraPaperToggleButton.selected", null],
    [
      "src/components/results/results.css",
      '.results-demoControls-buttons button[aria-pressed="true"]',
      null,
    ],
  ];

  it.each(FILLED)(
    "%s %s (selected toggle): the primary fill; pressing darkens the fill and never lowers the opacity",
    (file, selector, media) => {
      const rules = rulesOf(file);
      const fill = declared(rules, selector, "background", media);
      expect(fill && resolve(fill), "its fill").toBe(
        token("--button-primary-bg"),
      );
      const label = declared(rules, selector, "color", media);
      expect(label && resolve(label), "its label").toBe(
        token("--on-button-primary"),
      );

      const pressed = declared(
        rules,
        `${selector}:active`,
        "background",
        media,
      );
      expect(pressed && resolve(pressed), "pressed fill").toBe(
        token("--button-primary-pressed"),
      );
      expect(
        ratio(rgb("--on-button-primary"), channels(resolve(pressed!))),
        "label on the pressed fill",
      ).toBeGreaterThanOrEqual(4.5);

      // No pressed rule anywhere, in any media query (reduced motion included),
      // fades the button.
      for (const rule of rules) {
        if (
          rule.selectors.includes(`${selector}:active`) &&
          "opacity" in rule.decls
        ) {
          expect(Number(rule.decls.opacity), `${rule.media} opacity`).toBe(1);
        }
      }
    },
  );

  it("the selected toggles' pressed state also darkens their border, so the outline does not stay light", () => {
    for (const [file, selector] of [
      ["src/client/camera/camera.css", ".cameraPaperToggleButton.selected"],
      [
        "src/components/results/results.css",
        '.results-demoControls-buttons button[aria-pressed="true"]',
      ],
    ] as const) {
      expect(
        resolve(declared(rulesOf(file), `${selector}:active`, "border-color")!),
        selector,
      ).toBe(token("--button-primary-pressed"));
    }
  });

  it("the upload and primary buttons of the scan flow transition only transform and opacity: the pressed fill snaps (design-guidelines.md, Motion; the AC5 e2e)", () => {
    const rules = rulesOf("src/app/scan/scan.css");
    for (const selector of [".uploadButton", ".primaryButton"]) {
      const properties = (declared(rules, selector, "transition") ?? "")
        .split(",")
        .map((part) => part.trim().split(/\s+/)[0]);
      for (const property of properties) {
        expect(["transform", "opacity"], `${selector} ${property}`).toContain(
          property,
        );
      }
    }
    // Under reduced motion too.
    const reduced = rules
      .filter((r) => r.media === "(prefers-reduced-motion: reduce)")
      .flatMap((r) => (r.decls.transition ? [r.decls.transition] : []));
    for (const transition of reduced) {
      expect(transition).not.toContain("background");
    }
  });

  it("the picker chip's pressed state also darkens its border, so the outline does not stay light", () => {
    const rules = rulesOf("src/app/scan/scan.css");
    expect(
      resolve(
        declared(rules, ".pickerButton.selected:active", "border-color")!,
      ),
    ).toBe(token("--button-primary-pressed"));
  });

  it("under reduced motion the filled buttons keep full opacity, and only an unfilled chip fades", () => {
    for (const file of ["src/app/scan/scan.css", "src/app/learn/learn.css"]) {
      const rules = rulesOf(file);
      const reduced = rules.filter(
        (r) => r.media === "(prefers-reduced-motion: reduce)",
      );
      const opacityOf = (selector: string) =>
        reduced
          .filter((r) => r.selectors.includes(selector))
          .map((r) => r.decls.opacity)
          .pop();
      const filled = file.endsWith("scan.css")
        ? [
            ".pickerButton.selected:active",
            ".uploadButton:active",
            ".primaryButton:active",
          ]
        : [".learn-button:active"];
      for (const selector of filled) {
        expect(opacityOf(selector), `${file} ${selector}`).toBe("1");
      }
    }
  });
});

describe("the secondary buttons: a text link in --accent-text, no fill, no border (BTN-1, style B)", () => {
  const SECONDARY: readonly (readonly [string, string, string | null])[] = [
    ["src/app/globals.css", ".button-secondary", null],
    ["src/app/learn/learn.css", ".learn-button-secondary", null],
    ["src/components/errors/errors.css", ".errorAction-secondary", null],
    ["src/app/sheet/sheet.css", ".sheet-secondary", "screen"],
    [
      "src/app/scan/scan.css",
      ".scanMain .uploadSlot-measured .uploadButton",
      null,
    ],
    ["src/client/camera/camera.css", ".cameraRetake", null],
    ["src/components/results/results.css", ".results-analysis-retry", null],
  ];
  it.each(SECONDARY)("%s %s", (file, selector, media) => {
    const rules = rulesOf(file);
    const label = declared(rules, selector, "color", media)!;
    expect(["var(--accent-text)", "var(--learn-accent)"]).toContain(label);
    expect(ratio(rgb("--accent-text"), rgb("--bg"))).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(["none", "transparent"]).toContain(
      declared(rules, selector, "background", media),
    );
    const border =
      declared(rules, selector, "border-color", media) ??
      declared(rules, selector, "border", media)!;
    expect(border).toMatch(/transparent/);
    expect(declared(rules, selector, "text-decoration", media)).toBe(
      "underline",
    );
  });
});

describe("the hand ghost over the paper", () => {
  const camera = rulesOf("src/client/camera/camera.css");
  // The e2e fixtures' paper is a light grey, a real sheet is nearer white.
  const PAPERS: readonly (readonly [string, [number, number, number]])[] = [
    ["white", [255, 255, 255]],
    ["the fixtures' grey paper (#f6f6f2)", [246, 246, 242]],
  ];

  it.each(PAPERS)(
    "its outline keeps 3:1 against %s at the ghost's own opacity (WCAG 1.4.11)",
    (_, paper) => {
      const outline = resolve(
        declared(camera, ".cameraHandGhostOutline", "stroke")!,
      );
      const opacity = Number(declared(camera, ".cameraHandGhost", "opacity"));
      expect(opacity).toBeGreaterThan(0);
      expect(opacity).toBeLessThanOrEqual(1);
      const seen = blend(channels(outline), opacity, paper);
      expect(ratio(seen, paper)).toBeGreaterThanOrEqual(3);
    },
  );

  it("is --accent-pressed: --accent itself would fall under 3:1 at that opacity", () => {
    expect(declared(camera, ".cameraHandGhostOutline", "stroke")).toBe(
      "var(--accent-pressed)",
    );
    expect(declared(camera, ".cameraHandGhostOutline", "fill")).toBe(
      "var(--accent-pressed)",
    );
    const opacity = Number(declared(camera, ".cameraHandGhost", "opacity"));
    const white: [number, number, number] = [255, 255, 255];
    expect(ratio(blend(rgb("--accent"), opacity, white), white)).toBeLessThan(
      3,
    );
  });
});

describe("the dimension lines over the user's photo", () => {
  const scan = rulesOf("src/app/scan/scan.css");
  const white: [number, number, number] = [255, 255, 255];

  it("are --accent, not --accent-text (2.35:1 on a white sheet of paper)", () => {
    for (const selector of [".overlayDimensionLine", ".overlayDimensionTick"]) {
      expect(declared(scan, selector, "stroke"), selector).toBe(
        "var(--accent)",
      );
    }
    expect(ratio(rgb("--accent-text"), white)).toBeLessThan(3);
  });

  it("keep 3:1 on the white paper, on the page's black, and against their own white halo", () => {
    expect(ratio(rgb("--accent"), white)).toBeGreaterThanOrEqual(3);
    expect(ratio(rgb("--accent"), rgb("--bg"))).toBeGreaterThanOrEqual(3);
    const halo = declared(scan, ".overlayDimensionHalo", "stroke")!;
    expect(halo).toBe("#fff");
    expect(ratio(rgb("--accent"), channels("#ffffff"))).toBeGreaterThanOrEqual(
      3,
    );
    // The halo is nearly opaque and wider than the line, so a dark or mid-grey
    // picture shows the halo around the line, not the line on the picture.
    expect(
      Number(declared(scan, ".overlayDimensionHalo", "stroke-opacity")),
    ).toBeGreaterThanOrEqual(0.8);
    expect(
      Number(declared(scan, ".overlayDimensionHalo", "stroke-width")),
    ).toBeGreaterThan(
      Number(declared(scan, ".overlayDimensionLine", "stroke-width")),
    );
  });

  it("are drawn with a halo under every stroke: one halo per line and per tick", () => {
    const tsx = readFileSync("src/app/scan/ScanClient.tsx", "utf8");
    const count = (name: string) =>
      (tsx.match(new RegExp(`className="${name}"`, "g")) ?? []).length;
    expect(count("overlayDimensionHalo")).toBe(
      count("overlayDimensionLine") + count("overlayDimensionTick"),
    );
    expect(count("overlayDimensionLine")).toBeGreaterThan(0);
  });
});

describe("print", () => {
  const tokenRules = parseRules(tokensCss);
  const print = tokenRules.find(
    (r) => r.media === "print" && r.selectors.includes(":root"),
  )!;

  it("redefines the text and background tokens, so text that takes its colour from a token prints dark on white", () => {
    expect(print).toBeDefined();
    const bg = channels(print.decls["--bg"]!);
    expect(bg).toEqual([255, 255, 255]);
    expect(
      ratio(channels(print.decls["--text-primary"]!), bg),
    ).toBeGreaterThanOrEqual(12);
    expect(
      ratio(channels(print.decls["--text-secondary"]!), bg),
    ).toBeGreaterThanOrEqual(7);
    expect(
      ratio(channels(print.decls["--text-tertiary"]!), bg),
    ).toBeGreaterThanOrEqual(7);
    expect(
      ratio(channels(print.decls["--accent-text"]!), bg),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("leaves the fills and their white label alone, and takes the glow away", () => {
    expect(print.decls["--accent"]).toBeUndefined();
    expect(print.decls["--on-accent"]).toBeUndefined();
    expect(print.decls["--glow"]).toBe("transparent");
  });

  it("covers every token a headline, wordmark, subhead, caption or link takes its colour from", () => {
    const textTokens = [
      "--text-primary",
      "--text-secondary",
      "--text-tertiary",
      "--accent-text",
    ];
    for (const name of textTokens) {
      expect(print.decls[name], name).toBeDefined();
    }
    // ...and the page rule beside them sets the root and body.
    const globals = rulesOf("src/app/globals.css");
    expect(declared(globals, ":root", "background", "print")).toBe("#fff");
    expect(declared(globals, "body", "color", "print")).toBe("#000");
  });
});

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
    // #0a64e0 and #79adff were the two old accents; #a8ceff, #6aa8ff and #9fc4ff
    // the old accent-text colours; #1f6bf0 and #7fa8ff are the tokens own
    // values. Only tokens.css may write any of them.
    const banned =
      /#(0a64e0|79adff|a8ceff|6aa8ff|9fc4ff|1f6bf0|7fa8ff|1a5cd0|2f7bff)\b/i;
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

  it("keeps none of the light theme's greys as a text colour (#55555d, #57575c): use a token", () => {
    for (const file of files) {
      const stripped = readFileSync(file, "utf8").replace(
        /\/\*[\s\S]*?\*\//g,
        "",
      );
      expect(stripped, file).not.toMatch(/#(55555d|57575c)\b/i);
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
