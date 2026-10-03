import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `public/mediapipe/` holds third-party binaries copied by hand. Nothing else
 * stops a copy from being truncated, replaced by another version or listed in
 * `public/mediapipe/README.md` with the wrong digest. The four `wasm/` files
 * must be byte-identical to the npm package's (the README and NOTICE say so),
 * and every row of the README table must describe the real file.
 */
const root = process.cwd();
const vendored = (path: string) => join(root, "public/mediapipe", path);
const packageDir = join(root, "node_modules/@mediapipe/tasks-vision");

const WASM_FILES = [
  "vision_wasm_internal.js",
  "vision_wasm_internal.wasm",
  "vision_wasm_nosimd_internal.js",
  "vision_wasm_nosimd_internal.wasm",
];
const MODEL_FILE = "models/hand_landmarker.task";

const sha256 = (buffer: Buffer) =>
  createHash("sha256").update(buffer).digest("hex");
const md5 = (buffer: Buffer) => createHash("md5").update(buffer).digest("hex");

interface Row {
  path: string;
  version: string;
  bytes: number;
  sha256: string;
  line: string;
}
/** Rows of the file table in public/mediapipe/README.md. */
function readmeRows(): Row[] {
  const readme = readFileSync(vendored("README.md"), "utf8");
  return readme
    .split("\n")
    .filter((line) => /^\| `(wasm|models)\//.test(line))
    .map((line) => {
      const cells = line.split("|").map((cell) => cell.trim());
      // cells: "", file, source, version, bytes, sha256 (+ md5), ""
      const digest = /`([0-9a-f]{64})`/.exec(cells[5]!);
      expect(digest, `a SHA-256 digest in: ${line}`).not.toBeNull();
      return {
        path: cells[1]!.replace(/`/g, ""),
        version: cells[3]!,
        bytes: Number(cells[4]!.replace(/,/g, "")),
        sha256: digest![1]!,
        line,
      };
    });
}

describe("vendored MediaPipe files", () => {
  it("has exactly the files the README table lists (plus the README and the licence text), and no others anywhere under public/mediapipe", () => {
    // Recursive, so a stray file in wasm/, models/, a new sub-directory or the
    // top folder all fail; so does a listed file that is missing.
    const found = (readdirSync(vendored(""), { recursive: true }) as string[])
      .map((entry) => entry.replace(/\\/g, "/"))
      .filter((entry) => statSync(vendored(entry)).isFile())
      .sort();
    const expected = [
      ...readmeRows().map((row) => row.path),
      "README.md",
      "LICENSE-mediapipe.txt",
    ].sort();
    expect(found).toEqual(expected);
  });

  it.each(WASM_FILES)(
    "wasm/%s is byte-identical to the npm package's copy",
    (file) => {
      const ours = readFileSync(vendored(`wasm/${file}`));
      const theirs = readFileSync(join(packageDir, "wasm", file));
      expect(ours.length).toBeGreaterThan(0);
      expect(ours.equals(theirs)).toBe(true);
    },
  );

  it("is the version of @mediapipe/tasks-vision that is installed", () => {
    const installed = JSON.parse(
      readFileSync(join(packageDir, "package.json"), "utf8"),
    ) as { version: string };
    for (const row of readmeRows().filter((r) => r.path.startsWith("wasm/"))) {
      expect(row.version, row.path).toBe(installed.version);
    }
  });
});

describe("public/mediapipe/README.md file table", () => {
  const rows = readmeRows();

  it("has one row for each of the four wasm files and the model", () => {
    expect(rows.map((r) => r.path).sort()).toEqual(
      [...WASM_FILES.map((f) => `wasm/${f}`), MODEL_FILE].sort(),
    );
  });

  it.each([...WASM_FILES.map((f) => `wasm/${f}`), MODEL_FILE])(
    "%s: the listed byte count and SHA-256 equal the real file's",
    (path) => {
      const row = rows.find((r) => r.path === path);
      expect(row, `a README row for ${path}`).toBeDefined();
      const actual = readFileSync(vendored(path));
      expect(row!.bytes).toBe(actual.length);
      expect(row!.sha256).toBe(sha256(actual));
    },
  );

  it("gives the model's MD5 in the README and in NOTICE, and it is the real one", () => {
    const actual = md5(readFileSync(vendored(MODEL_FILE)));
    const modelRow = rows.find((r) => r.path === MODEL_FILE)!;
    expect(modelRow.line).toContain(actual);
    const notice = readFileSync(join(root, "NOTICE"), "utf8");
    expect(notice).toContain(actual);
    expect(notice).toContain(
      readFileSync(vendored(MODEL_FILE)).length.toLocaleString("en-US"),
    );
  });
});
