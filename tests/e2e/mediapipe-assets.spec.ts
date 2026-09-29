import { expect, test } from "@playwright/test";
import { buildSyntheticTopDownPhotoPng } from "./fixtures/synthetic-photo";
import { checkHandDetected } from "../../src/client/photo/gates";

// public/mediapipe/** holds the vendored hand detector (README there). Two
// things about it can break silently: a browser without WebAssembly SIMD needs
// the `_nosimd` build (MediaPipe picks it by feature detection, and would 404
// if the file were missing), and the files' cache header lives in
// next.config.ts. This spec exercises both against the real dev server.

const SIMD_FILES = [
  "/mediapipe/wasm/vision_wasm_internal.js",
  "/mediapipe/wasm/vision_wasm_internal.wasm",
];
const NOSIMD_FILES = [
  "/mediapipe/wasm/vision_wasm_nosimd_internal.js",
  "/mediapipe/wasm/vision_wasm_nosimd_internal.wasm",
];
const MODEL_FILE = "/mediapipe/models/hand_landmarker.task";

test.describe("vendored MediaPipe assets", () => {
  test("every vendored file is served, with the bounded cache header (never immutable)", async ({
    request,
  }) => {
    for (const path of [...SIMD_FILES, ...NOSIMD_FILES, MODEL_FILE]) {
      const res = await request.get(path);
      expect(res.status(), path).toBe(200);
      const cacheControl = res.headers()["cache-control"];
      expect(cacheControl, path).toContain("max-age=86400");
      expect(cacheControl, path).toContain("stale-while-revalidate=");
      expect(cacheControl, path).not.toContain("immutable");
    }
  });

  test("a browser with WebAssembly SIMD loads the SIMD build, not the fallback", async ({
    page,
  }) => {
    const requested: string[] = [];
    page.on("request", (r) => requested.push(new URL(r.url()).pathname));

    await page.goto("/scan");
    const png = await buildSyntheticTopDownPhotoPng(page, {
      includeMarkers: true,
    });
    await page.setInputFiles("#top-down-photo", {
      name: "sheet.png",
      mimeType: "image/png",
      buffer: png,
    });
    await expect(page.locator("[data-testid='scan-status']")).toHaveText(
      checkHandDetected(0)!.message,
      { timeout: 20_000 },
    );

    for (const path of SIMD_FILES) expect(requested).toContain(path);
    for (const path of NOSIMD_FILES) expect(requested).not.toContain(path);
  });

  test("a browser without WebAssembly SIMD falls back to the vendored _nosimd build and still detects", async ({
    page,
  }) => {
    // MediaPipe decides by instantiating a tiny module that uses a SIMD
    // instruction (FilesetResolver.forVisionTasks → isSimdSupported). Make
    // exactly that probe fail, as it would on a browser without SIMD.
    await page.addInitScript(() => {
      const instantiate = WebAssembly.instantiate.bind(WebAssembly);
      (WebAssembly as unknown as { instantiate: unknown }).instantiate = (
        source: BufferSource | WebAssembly.Module,
        imports?: WebAssembly.Imports,
      ) => {
        if (!(source instanceof WebAssembly.Module) && source.byteLength < 64) {
          return Promise.reject(new Error("SIMD not supported (test)"));
        }
        return instantiate(source as BufferSource, imports);
      };
    });

    const requested: string[] = [];
    page.on("request", (r) => requested.push(new URL(r.url()).pathname));

    await page.goto("/scan");
    const png = await buildSyntheticTopDownPhotoPng(page, {
      includeMarkers: true,
    });
    await page.setInputFiles("#top-down-photo", {
      name: "sheet.png",
      mimeType: "image/png",
      buffer: png,
    });
    // Reaching the hand gate means the detector really loaded and ran.
    await expect(page.locator("[data-testid='scan-status']")).toHaveText(
      checkHandDetected(0)!.message,
      { timeout: 30_000 },
    );

    for (const path of NOSIMD_FILES) expect(requested).toContain(path);
    for (const path of SIMD_FILES) expect(requested).not.toContain(path);
  });
});
