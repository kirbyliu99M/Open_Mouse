/**
 * The share preview's stylesheet (V3.2 F21, brief AC 1): with reduced motion
 * the spinner stops and its words are shown in its place.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  join(process.cwd(), "src/components/results/share/share.css"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

/** Every reduced-motion block, joined (the file has more than one). */
function reducedMotion(): string {
  const head = "@media (prefers-reduced-motion: reduce)";
  const blocks: string[] = [];
  for (let at = css.indexOf(head); at >= 0; at = css.indexOf(head, at + 1)) {
    // A block ends at the first line that is a lone closing brace.
    blocks.push(css.slice(at, css.indexOf("\n}", at)));
  }
  expect(blocks.length, "a reduced-motion block exists").toBeGreaterThan(0);
  return blocks.join("\n");
}

function rule(source: string, selector: string): string {
  const at = source.indexOf(`${selector} {`);
  expect(at, `${selector} has a rule`).toBeGreaterThanOrEqual(0);
  return source.slice(at, source.indexOf("}", at));
}

describe("share.css with reduced motion", () => {
  it("the spinner turns by default", () => {
    expect(rule(css, ".sharePreview-spinner")).toMatch(
      /animation:\s*sharePreview-spin/,
    );
  });

  it("the spinner stops", () => {
    expect(rule(reducedMotion(), ".sharePreview-spinner")).toMatch(
      /animation:\s*none;/,
    );
  });

  it("the loading words are no longer clipped away", () => {
    const text = rule(reducedMotion(), ".sharePreview-loadingText");
    expect(text).toMatch(/clip-path:\s*none;/);
    expect(text).toMatch(/position:\s*static;/);
    expect(text).toMatch(/overflow:\s*visible;/);
  });
});
