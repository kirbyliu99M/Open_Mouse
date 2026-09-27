# Published GLB payload audit

Run `python tools/blender/audit_payloads.py` from the repository root. The script
reads only the committed `public/models/` files. It checks the GLB header,
declared length, Draco extension, embedded image format, and agreement with the model
manifest, then reports embedded image bytes and total file sizes.

## Previous 2048 px PNG build (2026-09-23)

| Measure                                                          |                                         Result |
| ---------------------------------------------------------------- | ---------------------------------------------: |
| Published GLBs                                                   | 31 (26 shells, 4 limited-view studies, 1 hand) |
| Total payload                                                    |                 121,195,968 bytes (115.58 MiB) |
| Embedded PNG images                                              |   82, totalling 117,993,130 bytes (112.53 MiB) |
| Image share of payload                                           |                                         97.36% |
| Everything else, including Draco geometry and container overhead |                     3,202,838 bytes (3.05 MiB) |
| Largest single model                                             |               M196, 7,864,596 bytes (7.50 MiB) |

All 31 GLBs declare `KHR_draco_mesh_compression`. The 26 reconstructed shells
embed three PNGs each; the four studies embed one each; the hand embeds none.
The audit found no missing or extra GLB relative to the manifest.

The first size reduction targeted texture encoding and resolution. More
geometry compression can affect at most the remaining 2.64% of these files.
This is a byte audit, not a visual quality test or a phone loading benchmark.
Owner decision 2026-09-27 (recorded in docs/STATUS.md decisions log): publish. Logitech trademarks and the source 3D models are not covered by the project licence.

## Read-only 1024 px PNG experiment

`python tools/blender/audit_payloads.py --estimate-1024` decoded each embedded
PNG in memory, scaled images whose longest side exceeded 1024 px to that limit,
and re-encoded them as optimized PNGs. It did not modify or publish any GLB.
The estimated combined payload was **39,933,962 bytes (38.08 MiB)**, a **67.05%**
reduction from the former 2048 px PNG files. The five largest files would each fall from
5.50–7.50 MiB to approximately 1.65–2.19 MiB. This is a sizing experiment:
normal-map quality, small labels and seams, browser decoding, and appearance
under the intended lighting still need visual and phone testing before an asset
change. Kirby has prioritized the highest achievable visual quality, so the
estimate is not a decision to ship lower-resolution textures. Owner decision 2026-09-27 (recorded in docs/STATUS.md decisions log): publish. Logitech trademarks and the source 3D models are not covered by the project licence.

## Published 512 px JPEG build (2026-09-27, normal-map revision)

The 30 mice total **7,030,228 bytes (6.70 MiB)**; with the hand, the 31 GLBs
total **7,192,488 bytes (6.86 MiB)**. There are 82 embedded JPEG maps. Mouse files range from
**74.5 to 384.2 KiB**, and **4 of 30** meet the original 100 KiB per-model
target. The full catalogue is **6.70 MiB for
30 mice**, or **6.86 MiB including the hand**. Geometry remains 13,998–14,000
triangles per mouse. JPEG is a core glTF image format that GLTFLoader reads
without an additional texture decoder; the existing Draco geometry still needs
its decoder. Base colour and roughness remain JPEG q82. The 26 normal maps are
JPEG q90 with 4:4:4 chroma sampling. At 512 px those normal maps total
**2,008,757 bytes** versus **5,644,972 bytes** as PNG. Every normal map is
smaller as JPEG q90 4:4:4. Visual quality and phone performance remain to be reviewed.

### Delivered model sizes

| Model                             |   Bytes |
| --------------------------------- | ------: |
| logitech-ergo-m575                | 240,712 |
| logitech-g-pro-2-lightspeed       | 298,712 |
| logitech-g-pro-x-superlight-2     | 302,612 |
| logitech-g-pro-x-superlight-2-dex | 295,228 |
| logitech-g-pro-x-superlight-2-se  |  81,464 |
| logitech-g-pro-x-superlight-2c    | 311,696 |
| logitech-g203-lightsync           | 219,512 |
| logitech-g305-lightspeed          | 157,032 |
| logitech-g309                     | 393,416 |
| logitech-g403-hero                | 192,348 |
| logitech-g502-hero                | 251,940 |
| logitech-g502-x                   | 346,560 |
| logitech-g502-x-lightspeed        | 301,524 |
| logitech-g502-x-plus              | 267,616 |
| logitech-g703-lightspeed          | 198,948 |
| logitech-lift-vertical            | 261,156 |
| logitech-m100                     |  76,312 |
| logitech-m190                     | 260,380 |
| logitech-m196                     | 255,260 |
| logitech-m240                     | 210,324 |
| logitech-m550                     |  79,044 |
| logitech-m650                     | 322,536 |
| logitech-m705-marathon            |  80,568 |
| logitech-m720-triathlon           | 240,392 |
| logitech-mx-anywhere-3s           | 190,876 |
| logitech-mx-master-3s             | 202,760 |
| logitech-mx-master-4              | 284,360 |
| logitech-mx-vertical              | 179,812 |
| logitech-pebble-2-m350s           | 203,580 |
| logitech-pop-mouse                | 323,548 |
