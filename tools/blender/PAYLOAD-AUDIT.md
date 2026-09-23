# Published GLB payload audit

Run `python tools/blender/audit_payloads.py` from the repository root. The script
reads only the committed `public/models/` files. It checks the GLB header,
declared length, Draco extension, PNG image format, and agreement with the model
manifest, then reports embedded image bytes and total file sizes.

## Results (2026-09-23)

| Measure | Result |
| --- | ---: |
| Published GLBs | 31 (26 shells, 4 limited-view studies, 1 hand) |
| Total payload | 121,195,968 bytes (115.58 MiB) |
| Embedded PNG images | 82, totalling 117,993,130 bytes (112.53 MiB) |
| Image share of payload | 97.36% |
| Everything else, including Draco geometry and container overhead | 3,202,838 bytes (3.05 MiB) |
| Largest single model | M196, 7,864,596 bytes (7.50 MiB) |

All 31 GLBs declare `KHR_draco_mesh_compression`. The 26 reconstructed shells
embed three PNGs each; the four studies embed one each; the hand embeds none.
The audit found no missing or extra GLB relative to the manifest.

The first size reduction should target texture encoding or resolution. More
geometry compression can affect at most the remaining 2.64% of these files.
This is a byte audit, not a visual quality test or a phone loading benchmark.
The baked images derive from manufacturer appearances, so the existing public
serving decision remains open before these assets are used in the viewer.

## Read-only 1024 px experiment

`python tools/blender/audit_payloads.py --estimate-1024` decoded each embedded
PNG in memory, scaled images whose longest side exceeded 1024 px to that limit,
and re-encoded them as optimized PNGs. It did not modify or publish any GLB.
The estimated combined payload was **39,933,962 bytes (38.08 MiB)**, a **67.05%**
reduction from the current files. The five largest files would each fall from
5.50–7.50 MiB to approximately 1.65–2.19 MiB. This is a sizing experiment:
normal-map quality, small labels and seams, browser decoding, and appearance
under the intended lighting still need visual and phone testing before an asset
change. Kirby has prioritized the highest achievable visual quality, so the
estimate is not a decision to ship lower-resolution textures. The
public-serving rights question is unchanged.
