# Vendored MediaPipe assets

Served from this app's own origin so hand-landmark detection makes **zero**
requests to a third-party CDN at runtime (docs/PLAN.md hard rule 5).

| File | Source | Version | Size |
|---|---|---|---|
| `wasm/vision_wasm_internal.js` | `@mediapipe/tasks-vision` npm package, `wasm/vision_wasm_internal.js` | 1.0.1 | 323 KB |
| `wasm/vision_wasm_internal.wasm` | `@mediapipe/tasks-vision` npm package, `wasm/vision_wasm_internal.wasm` | 1.0.1 | 11.2 MB |
| `models/hand_landmarker.task` | `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task` | float16, revision 1 | 7.8 MB (7,819,105 bytes), MD5 `15318430ea3851670fe9914116a9cfad` |

Only the SIMD, non-worker build (`vision_wasm_internal.*`) is vendored —
`FilesetResolver.forVisionTasks` picks it by default (`useModule=false`,
and it feature-detects WASM SIMD locally via `WebAssembly.instantiate`, not
a network probe). The `_module` (worker) and `_nosimd` variants aren't
vendored since Chromium (this app's tested target, including Playwright's
`chromium` and `mobile` projects) has supported WASM SIMD since 2021.

`src/client/photo/landmarks.ts` points `FilesetResolver.forVisionTasks` at
`/mediapipe/wasm` and `HandLandmarker`'s `modelAssetPath` at
`/mediapipe/models/hand_landmarker.task` — both same-origin, static files.

These files are machine-generated / third-party build output, not
hand-written source, so `eslint.config.mjs` excludes `public/mediapipe/**`
from linting.
