import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AuthButton } from "../../src/app/account/AuthButton";
import { zhTW } from "../../src/lib/copy/account";

const ROOT = join(__dirname, "..", "..");

// No LocaleProvider (it needs the app router): the button reads the default
// locale from the context's default value, which is zh-TW.
const render = (action: "in" | "out") =>
  renderToStaticMarkup(createElement(AuthButton, { action }));

describe("the sign-in button's Google mark", () => {
  it("shows Google's G as decoration, left of the text, and keeps the text as its name", () => {
    const html = render("in");
    expect(html).toContain('src="/images/google-g.png"');
    expect(html).toContain('alt=""');
    expect(html).toContain('class="account-google-mark"');
    expect(html).toContain(`aria-label="${zhTW.continueWithGoogle}"`);
    // The image comes before the text in the button.
    expect(html.indexOf("<img")).toBeLessThan(
      html.indexOf(zhTW.continueWithGoogle, html.indexOf("<img")),
    );
  });

  it("is not on the sign-out button", () => {
    expect(render("out")).not.toContain("<img");
  });

  it("ships the file as a 128 x 128 PNG, not enlarged, and the mark is not recoloured by CSS", () => {
    const png = readFileSync(join(ROOT, "public", "images", "google-g.png"));
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    // IHDR: width and height are the two big-endian words after "IHDR".
    expect(png.readUInt32BE(16)).toBe(128);
    expect(png.readUInt32BE(20)).toBe(128);
    const css = readFileSync(join(ROOT, "src/app/account/account.css"), "utf8");
    const block = css.slice(
      css.indexOf(".account-google-mark {"),
      css.indexOf("}", css.indexOf(".account-google-mark {")),
    );
    // Google's branding rules: no filter, opacity, shadow, transform, animation
    // or blend on the mark.
    for (const banned of [
      "filter",
      "opacity",
      "shadow",
      "transform",
      "animation",
      "transition",
      "mix-blend",
    ])
      expect(block, banned).not.toContain(banned);
  });

  it("drops the mark in forced-colors mode, where its white tile would show", () => {
    const css = readFileSync(join(ROOT, "src/app/account/account.css"), "utf8");
    expect(css).toMatch(
      /@media \(forced-colors: active\)\s*\{\s*\.account-google-mark\s*\{\s*display:\s*none;/,
    );
  });
});
