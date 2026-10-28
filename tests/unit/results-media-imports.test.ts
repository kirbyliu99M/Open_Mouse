import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MOUSE_PHOTO_HEIGHT,
  MOUSE_PHOTO_WIDTH,
} from "../../src/components/results/MousePhoto";

/**
 * A module being loaded: `from "x"`, `import "x"`, `import("x")`,
 * `require("x")`, in any quote style including a backtick template. \x60 is the
 * backtick.
 */
const LOAD = String.raw`(?:from\s*|import\s*\(?\s*|require\s*\(\s*)["'\x60]`;
const NOT_QUOTE = String.raw`[^"'\x60]*`;
const QUOTE = String.raw`["'\x60]`;
const CODE = /\.(?:ts|tsx|js|jsx|mjs)$/;

/** A source file without its comments, so a sentence that names a file is not read as an import. */
function code(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

describe("the loader pattern itself", () => {
  const load = (name: string) =>
    new RegExp(`${LOAD}${NOT_QUOTE}${name}\\.json${QUOTE}`);
  it.each([
    'import a from "@/data/mouse-media.json";',
    "import a from '../data/mouse-media.json';",
    'import "../data/mouse-media.json";',
    'export { a } from "../data/mouse-media.json";',
    'const a = await import("../data/mouse-media.json");',
    'const a = require("../data/mouse-media.json");',
    "const a = await import(`../data/mouse-media.json`);",
  ])("sees %s", (line) => {
    expect(load("mouse-media").test(line)).toBe(true);
  });

  it("does not see a mention in a comment or a string that is not a load", () => {
    expect(load("mouse-media").test("// reads mouse-media.json later")).toBe(
      false,
    );
    expect(load("mouse-media").test('const n = "mouse-media.json";')).toBe(
      false,
    );
  });
});

// `ResultsView` is under a client component, so anything it imports ships to
// the browser. The two data files are read only on the server: the photo path by
// `withPhotos` (`src/server/fit/core.ts`) and the links by the cached route
// `src/app/api/mice/[slug]/links/route.ts`, which the page reaches by fetch.
describe("the page code does not import the data files", () => {
  const client = [
    ...walk("src/components/results"),
    ...walk("src/lib/results"),
  ].filter((f) => CODE.test(f));

  it("scans a sensible number of files", () => {
    expect(client.length).toBeGreaterThan(25);
    expect(client.some((f) => f.endsWith("useMouseLinks.ts"))).toBe(true);
  });

  it.each(["purchase-links", "mouse-media"])(
    "nothing under src/components/results/ or src/lib/results/ imports %s.json",
    (name) => {
      const pattern = new RegExp(`${LOAD}${NOT_QUOTE}${name}\\.json${QUOTE}`);
      const offenders = client.filter((f) => pattern.test(code(f)));
      expect(offenders).toEqual([]);
    },
  );

  it("nothing there imports from src/data/ at all", () => {
    const pattern = new RegExp(`${LOAD}${NOT_QUOTE}/data/${NOT_QUOTE}${QUOTE}`);
    const offenders = client.filter((f) => pattern.test(code(f)));
    expect(offenders).toEqual([]);
  });

  it("only src/server/ and src/app/api/ read the two files", () => {
    const core = readFileSync("src/server/fit/core.ts", "utf8");
    expect(core).toContain("mouse-media.json");
    expect(core).not.toContain("purchase-links.json");
    const route = readFileSync(
      "src/app/api/mice/[slug]/links/route.ts",
      "utf8",
    );
    expect(route).toContain("mouse-media.json");
    expect(route).toContain("purchase-links.json");
    // And nowhere else in src/ outside those two places.
    const pattern = new RegExp(
      `${LOAD}${NOT_QUOTE}(?:mouse-media|purchase-links)\\.json${QUOTE}`,
    );
    const readers = walk("src")
      .filter((f) => CODE.test(f))
      .filter((f) => pattern.test(code(f)))
      .map((f) => f.replaceAll("\\", "/"))
      .sort();
    expect(readers).toEqual([
      "src/app/api/mice/[slug]/links/route.ts",
      "src/server/fit/core.ts",
      // The public mouse pages' photo and official link (SEO task 2026-10-28).
      "src/server/seo/catalogue.ts",
    ]);
  });
});

describe("the product photos match the size the <img> declares", () => {
  const dir = "public/images/mice";
  const photos = readdirSync(dir).filter((f) => f.endsWith(".webp"));

  /** Canvas size from a WebP header (VP8X, VP8L or VP8), or null. */
  function webpSize(buf: Buffer): { w: number; h: number } | null {
    if (buf.toString("ascii", 0, 4) !== "RIFF") return null;
    if (buf.toString("ascii", 8, 12) !== "WEBP") return null;
    const kind = buf.toString("ascii", 12, 16);
    if (kind === "VP8X") {
      return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
    }
    if (kind === "VP8L") {
      const bits = buf.readUInt32LE(21);
      return { w: 1 + (bits & 0x3fff), h: 1 + ((bits >> 14) & 0x3fff) };
    }
    if (kind === "VP8 ") {
      return {
        w: buf.readUInt16LE(26) & 0x3fff,
        h: buf.readUInt16LE(28) & 0x3fff,
      };
    }
    return null;
  }

  it("has the committed photos", () => {
    expect(photos.length).toBe(411);
  });

  it("every file is MOUSE_PHOTO_WIDTH x MOUSE_PHOTO_HEIGHT", () => {
    const wrong = photos.filter((f) => {
      const size = webpSize(readFileSync(join(dir, f)).subarray(0, 64));
      return (
        !size || size.w !== MOUSE_PHOTO_WIDTH || size.h !== MOUSE_PHOTO_HEIGHT
      );
    });
    expect(wrong).toEqual([]);
  });
});
