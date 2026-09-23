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
