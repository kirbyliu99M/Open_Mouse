# Vendored MediaPipe assets

Served from this app's own origin, so loading the hand detector fetches nothing
from a third-party CDN (hard rule 5 in `AGENTS.md`: photos and everything
downstream of them stay on the device). Licences and provenance are in the
repository's [`NOTICE`](../../NOTICE); the Apache-2.0 text is in
[`LICENSE-mediapipe.txt`](LICENSE-mediapipe.txt).

| File | Source | Version | Bytes | SHA-256 |
|---|---|---|---|---|
| `wasm/vision_wasm_internal.js` | `@mediapipe/tasks-vision` npm package, `wasm/vision_wasm_internal.js` | 1.0.1 | 323,377 | `e170ee67dd4e16c1a6fcd8840a206687e5a59b22c20e4a902bc445b095454d73` |
| `wasm/vision_wasm_internal.wasm` | same package, `wasm/vision_wasm_internal.wasm` | 1.0.1 | 11,756,954 | `8da277a733926eacd0474b8704b36742d6ec3231c57a860c5b889dff8f1df886` |
| `wasm/vision_wasm_nosimd_internal.js` | same package, `wasm/vision_wasm_nosimd_internal.js` | 1.0.1 | 323,180 | `e81d715a3d42cc3373602eb2f7aff795d164934db680e32496b65dab537f9658` |
| `wasm/vision_wasm_nosimd_internal.wasm` | same package, `wasm/vision_wasm_nosimd_internal.wasm` | 1.0.1 | 10,960,242 | `a28483cd42e74e855bf5ebdb6b40d9b66a5b49e35e95020bc97669e6822a3192` |
| `models/hand_landmarker.task` | `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task` | float16, revision 1 | 7,819,105 | `fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1` (MD5 `15318430ea3851670fe9914116a9cfad`) |

The four `wasm/` files are byte-identical to the npm package's. The `.task` file
is a zip of two TensorFlow Lite models (`hand_detector.tflite`,
`hand_landmarks_detector.tflite`).

## Which WASM build is used

`src/client/photo/landmarks.ts` calls `FilesetResolver.forVisionTasks("/mediapipe/wasm")`
and points `HandLandmarker`'s `modelAssetPath` at
`/mediapipe/models/hand_landmarker.task`, both same-origin static files.

`forVisionTasks` chooses the build in the browser, with no network probe: it
tries to instantiate a tiny WebAssembly module that uses a SIMD instruction. If
that works it loads `vision_wasm_internal.*`; if it throws, it loads
`vision_wasm_nosimd_internal.*` (the `_nosimd` file names are built in
`@mediapipe/tasks-vision@1.0.1`'s `vision_bundle.mjs`). Both builds are vendored,
so a browser without WebAssembly SIMD still gets a working detector. The fallback
lacks SIMD acceleration, so expect slower inference (not measured here); its two
files add up to 11.3 MB.

`tests/e2e/mediapipe-assets.spec.ts` covers this: a normal browser must request
the SIMD pair and not the fallback; with the SIMD probe made to fail, it must
request the `_nosimd` pair and still reach the "no hand found" gate on a
synthetic photo. That test fails if the fallback files are missing.

The `_module` (worker) build, which `forVisionTasks(path, true)` would select, is
not vendored: nothing here asks for it.

## Caching

`next.config.ts` sends `Cache-Control: public, max-age=86400,
stale-while-revalidate=604800` for `/mediapipe/:path*`. Without it Vercel serves
these files as `max-age=0, must-revalidate`, so every page load makes a
conditional request per file.

The file names carry no hash, so the header is deliberately not `immutable`.
**Do not replace these files in place.** The JS glue and the WASM binary must come
from the same version, and browsers expire them one by one, so an in-place
upgrade can leave a browser with a glue file from one version and a binary from
the other for up to a day. To upgrade `@mediapipe/tasks-vision`, put the new files
in a new versioned directory (for example `public/mediapipe/1.0.2/`), change the
two paths in `src/client/photo/landmarks.ts`, and only then remove the old
directory. A versioned path also makes `immutable` safe; the cache header can be
lengthened at that point.

## Usage metrics

`@mediapipe/tasks-vision`'s own privacy notice says the Tasks APIs send
performance and usage metrics to Google (not the input images). The bundle's
logger flushes on a 60-second timer, by POSTing to
`https://odml.pa.googleapis.com/v1/log`. The app's Content-Security-Policy
(`connect-src 'self'`, in `next.config.ts`) blocks the request; the browser logs a
CSP violation and nothing is sent (observed on 2026-09-30, within 80 seconds of loading the
detector). Do not widen
`connect-src` without deciding what to do about this.

## Updating

1. Change the version of `@mediapipe/tasks-vision` (in its own PR).
2. Copy `wasm/vision_wasm_internal.{js,wasm}` and
   `wasm/vision_wasm_nosimd_internal.{js,wasm}` from `node_modules/@mediapipe/tasks-vision/wasm/`
   into a new versioned directory (see Caching), and update the table above,
   including the SHA-256 digests (`sha256sum`).
3. Re-check the licences in `NOTICE`.

These files are machine-generated third-party build output, not hand-written
source, so `eslint.config.mjs` and `.prettierignore` exclude `public/mediapipe/**`.
