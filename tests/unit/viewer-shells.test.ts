import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import shellIndex from "../../src/lib/viewer/shell-index.generated.json";
import {
  SHELL_URL_PREFIX,
  buildShellIndex,
  shellUrl,
  type ShellManifest,
} from "../../src/lib/viewer/shells";

const root = process.cwd();
const manifest = JSON.parse(
  readFileSync(join(root, "public/models/manifest.json"), "utf8"),
) as {
  shells: { slug: string; path: string }[];
  noShell: { slug: string }[];
};

const SMALL: ShellManifest = {
  shells: [
    { slug: "logitech-g309", path: "shells/logitech-g309.glb" },
    { slug: "logitech-ergo-m575", path: "shells/logitech-ergo-m575.glb" },
    { slug: "logitech-ergo-m575s", path: "shells/logitech-ergo-m575.glb" },
  ],
  noShell: [{ slug: "logitech-m100" }],
};

describe("shellUrl", () => {
  it("returns the served URL of a slug that is in the manifest", () => {
    expect(shellUrl("logitech-g309", SMALL)).toBe(
      "/models/shells/logitech-g309.glb",
    );
  });

  it("follows an alias to the file the manifest names (ERGO M575S uses the M575 GLB)", () => {
    expect(shellUrl("logitech-ergo-m575s", SMALL)).toBe(
      "/models/shells/logitech-ergo-m575.glb",
    );
  });

  it("returns null for a mouse the manifest lists as having no shell", () => {
    expect(shellUrl("logitech-m100", SMALL)).toBeNull();
  });

  it("returns null for a slug the manifest does not know", () => {
    expect(shellUrl("logitech-g502-hero", SMALL)).toBeNull();
    expect(shellUrl("razer-basilisk", SMALL)).toBeNull();
  });

  it("returns null when a slug is on both lists (a no-shell entry wins)", () => {
    const both: ShellManifest = {
      shells: [{ slug: "logitech-g309", path: "shells/logitech-g309.glb" }],
      noShell: [{ slug: "logitech-g309" }],
    };
    expect(shellUrl("logitech-g309", both)).toBeNull();
  });

  it.each([
    ["", "empty"],
    [" ", "a space"],
    ["../etc/passwd", "a parent-directory path"],
    ["..", "two dots"],
    ["../../models/manifest", "a longer traversal"],
    ["%2e%2e", "percent-encoded dots"],
    ["%2e%2e%2f%2e%2e%2fsecret", "percent-encoded traversal"],
    ["..%2f..%2fsecret", "half-encoded traversal"],
    ["%252e%252e", "double-encoded dots"],
    ["logitech-g309/../../x", "a traversal after a real slug"],
    ["logitech-g309/", "a trailing slash"],
    ["/logitech-g309", "a leading slash"],
    ["logitech-g309.glb", "a slug with its extension"],
    ["logitech-g309\u0000", "a NUL byte"],
    ["logitech-g309\n", "a trailing newline"],
    ["LOGITECH-G309", "upper case"],
    ["logitech-g309?x=1", "a query string"],
    ["logitech-g309#x", "a fragment"],
    ["logitech\\g309", "a backslash"],
    ["https://evil.example/x", "an absolute URL"],
    ["//evil.example/x", "a protocol-relative URL"],
    ["__proto__", "a prototype key"],
    ["constructor", "an Object.prototype name"],
    ["a".repeat(500), "a very long slug"],
  ])("returns null for a hostile or malformed slug: %j (%s)", (slug) => {
    expect(shellUrl(slug, SMALL)).toBeNull();
  });

  it.each([[null], [undefined], [42], [{}], [["logitech-g309"]], [true]])(
    "returns null for a value that is not a string: %j",
    (value) => {
      expect(shellUrl(value, SMALL)).toBeNull();
    },
  );

  it("refuses a manifest entry whose path is not a plain shells/<name>.glb", () => {
    const bad = (path: string): ShellManifest => ({
      shells: [{ slug: "logitech-g309", path }],
      noShell: [],
    });
    for (const path of [
      "../manifest.json",
      "shells/../manifest.json",
      "shells/../../secret.glb",
      "studies/logitech-m325s.glb",
      "shells/sub/logitech-g309.glb",
      "/shells/logitech-g309.glb",
      "shells/logitech-g309.glb?x",
      "shells/logitech-g309.gltf",
      "shells/%2e%2e/x.glb",
      "https://evil.example/x.glb",
      "",
    ]) {
      expect(shellUrl("logitech-g309", bad(path)), path).toBeNull();
    }
  });

  it("never returns a URL outside /models/shells/ for any input it is given", () => {
    const inputs = [
      "logitech-g309",
      "logitech-ergo-m575s",
      "../x",
      "%2e%2e",
      "",
      "logitech-m100",
      ...manifest.shells.map((s) => s.slug),
      ...manifest.noShell.map((s) => s.slug),
    ];
    for (const input of inputs) {
      const url = shellUrl(input, shellIndex);
      if (url === null) continue;
      expect(url.startsWith(SHELL_URL_PREFIX)).toBe(true);
      expect(url).toMatch(/^\/models\/shells\/[a-z0-9-]+\.glb$/);
    }
  });
});

describe("the committed shell index", () => {
  it("is exactly the compact form of public/models/manifest.json (run `npm run viewer:index` if this fails)", () => {
    expect(shellIndex).toEqual(buildShellIndex(manifest));
  });

  it("serves a real file for every shell the manifest lists", () => {
    for (const { slug } of manifest.shells) {
      const url = shellUrl(slug, shellIndex);
      expect(url, slug).not.toBeNull();
      expect(existsSync(join(root, "public", url!)), slug).toBe(true);
    }
  });

  it("says no shell for the four mice the manifest has none for, and for nothing else", () => {
    expect(manifest.noShell).toHaveLength(4);
    for (const { slug } of manifest.noShell) {
      expect(shellUrl(slug, shellIndex), slug).toBeNull();
    }
    const withShell = new Set(manifest.shells.map((s) => s.slug));
    for (const { slug } of manifest.noShell) {
      expect(withShell.has(slug)).toBe(false);
    }
  });

  it("is small: slugs and paths only", () => {
    expect(JSON.stringify(shellIndex).length).toBeLessThan(4000);
    expect(JSON.stringify(shellIndex)).not.toContain("resource.logitech.com");
  });
});
