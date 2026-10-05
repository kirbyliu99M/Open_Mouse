import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const FILES = [
  "draco_decoder.js",
  "draco_decoder.wasm",
  "draco_wasm_wrapper.js",
];

describe("public/draco (the self-hosted Draco decoder)", () => {
  it.each(FILES)(
    "%s is byte-identical to three's copy (run `npm run viewer:draco` after upgrading three)",
    (file) => {
      const vendored = readFileSync(join(root, "public/draco", file));
      const original = readFileSync(
        join(root, "node_modules/three/examples/jsm/libs/draco/gltf", file),
      );
      expect(vendored.equals(original)).toBe(true);
    },
  );

  it("holds a WebAssembly module", () => {
    const wasm = readFileSync(join(root, "public/draco/draco_decoder.wasm"));
    expect([...wasm.subarray(0, 4)]).toEqual([0x00, 0x61, 0x73, 0x6d]);
  });
});
