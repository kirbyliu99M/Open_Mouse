# Vendored Draco decoder

The 3D viewer's shell and hand models are Draco-compressed GLBs. three's
`DRACOLoader` fetches its decoder from this app's own origin (`/draco/`), so
nothing is loaded from a CDN and the Content-Security-Policy (`'self'` only)
stays as it is. Provenance and licence are in the repository's
[`NOTICE`](../../NOTICE), section 1.4.

| File | Source | Bytes | SHA-256 |
|---|---|---|---|
| `draco_decoder.wasm` | `three` 0.186.1, `examples/jsm/libs/draco/gltf/` | 192,420 | `a680d927bed9cb864ddbd63521868891af2bfbe755092761b4837487618df8ac` |
| `draco_wasm_wrapper.js` | same folder | 58,456 | `8bb2952d2ba7d67e1414f8df819410cb0434a666be53f671fff75f68843d76f6` |
| `draco_decoder.js` | same folder (pure-JS decoder for a browser without WebAssembly) | 512,465 | `8625489da79a805f4f2a7d511c3e52d8b4085608a9d2a4d5f4f9de5db0aea04f` |

The files are byte-identical to the ones in the npm package. Do not edit them.
After upgrading `three`, run `npm run viewer:draco` and commit the result;
`tests/unit/viewer-draco-decoder.test.ts` fails while the copy differs from
`node_modules`.
