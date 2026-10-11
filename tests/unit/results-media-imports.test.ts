import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MOUSE_PHOTO_HEIGHT,
  MOUSE_PHOTO_WIDTH,
} from "../../src/components/results/MousePhoto";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

// `ResultsView` is under a client component, so anything it imports ships to
// the browser. The two data files are read on the server (`withMedia`, in
// `src/server/fit/core.ts`) and reach the page as entry fields.
describe("the results components do not import the data files", () => {
  const files = walk("src/components/results").filter((f) =>
    /\.(ts|tsx)$/.test(f),
  );

  it("scans a sensible number of files", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it.each(["purchase-links", "mouse-media"])(
    "nothing under src/components/results/ imports %s.json",
    (name) => {
      // import x from "..", import ".."; export ... from ".."; import(".."); require("..")
      const pattern = new RegExp(
        `(?:from\\s*|import\\s*\\(?\\s*|require\\s*\\(\\s*)["'][^"']*${name}\\.json["']`,
      );
      const offenders = files.filter((f) =>
        pattern.test(readFileSync(f, "utf8")),
      );
      expect(offenders).toEqual([]);
    },
  );

  it("nothing under src/components/results/ imports from src/data/ at all", () => {
    const pattern = /(?:from\s*|import\s*\(?\s*)["'][^"']*\/data\/[^"']*["']/;
    const offenders = files.filter((f) =>
      pattern.test(readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("the server enrichment is where the two files are read", () => {
    const core = readFileSync("src/server/fit/core.ts", "utf8");
    expect(core).toContain("mouse-media.json");
    expect(core).toContain("purchase-links.json");
    expect(core).toContain("withMedia");
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
    expect(photos.length).toBe(404);
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
