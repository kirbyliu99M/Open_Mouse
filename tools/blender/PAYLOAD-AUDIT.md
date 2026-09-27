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

## Current catalogue after independent review (2026-09-27)

The manifest has 27 shell entries (26 source-derived shells and one M575S alias), 8 limited-view studies, and 3 NO_SHELL entries. The alias points to the M575 GLB, so 35 distinct GLBs including the hand are published. They total **7,533,076 bytes (7.18 MiB)**, including **4,058,711 image bytes** across 88 JPEG maps. The 26 source-derived GLBs and SE, M550, and M705 study GLBs are byte-identical to the prior build.

MX Ergo S has no shell: only front-oblique side photos were available and its study was not recognisable. M575S is a candidate shape alias of ERGO M575 because their published dimensions are both 134 × 100 × 48 mm. Its manifest entry uses `shells/logitech-ergo-m575.glb` without publishing a second file.

### Lowest base Z by length tenth

Values are millimetres in Blender desk coordinates, rear to nose. Each value is the lowest decoded GLB mesh vertex in that length tenth. The five changed studies have a flat base within 0.021 mm after Draco quantisation. SE, M550, and M705 retain their prior GLBs.

| Study                        | Before (mm, rear → nose)                                             | After (mm, rear → nose)                                              |
| ---------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------- |
| m100                         | 8.172, 6.030, 4.607, 3.442, 2.585, 1.714, 0.657, 0.064, 0.000, 0.822 | 0.001, 0.005, 0.002, 0.006, 0.006, 0.002, 0.006, 0.005, 0.001, 0.000 |
| g903-hero                    | 6.422, 4.327, 3.577, 3.286, 2.087, 0.872, 0.179, 0.000, 0.179, 1.200 | 0.000, 0.004, 0.006, 0.001, 0.006, 0.001, 0.005, 0.001, 0.014, 0.000 |
| signature-comfort-plus-m850l | 3.134, 0.761, 0.128, 0.000, 0.030, 0.275, 0.827, 1.396, 1.867, 2.850 | 0.000, 0.018, 0.006, 0.002, 0.007, 0.006, 0.006, 0.001, 0.000, 0.000 |
| m750                         | 0.648, 0.004, 0.002, 0.163, 0.110, 0.261, 0.564, 0.000, 0.000, 0.590 | 0.000, 0.004, 0.001, 0.020, 0.001, 0.006, 0.001, 0.014, 0.004, 0.000 |
| m325s                        | 0.575, 0.001, 0.020, 0.487, 0.449, 0.448, 0.461, 0.122, 0.000, 0.077 | 0.001, 0.005, 0.006, 0.021, 0.001, 0.005, 0.001, 0.005, 0.004, 0.000 |
| g-pro-x-superlight-2-se      | 0.000, 0.015, 0.005, 0.001, 0.071, 0.073, 0.008, 0.001, 0.000, 0.221 | 0.000, 0.015, 0.005, 0.001, 0.071, 0.073, 0.008, 0.001, 0.000, 0.221 |
| m550                         | 0.651, 0.000, 0.004, 0.127, 0.124, 0.214, 0.556, 0.001, 0.000, 0.582 | 0.651, 0.000, 0.004, 0.127, 0.124, 0.214, 0.556, 0.001, 0.000, 0.582 |
| m705-marathon                | 0.923, 0.266, 0.011, 0.000, 0.080, 0.252, 0.534, 0.796, 1.039, 1.438 | 0.923, 0.266, 0.011, 0.000, 0.080, 0.252, 0.534, 0.796, 1.039, 1.438 |

The five before/after top, left, right, and back sheets and `combined.png` are in the review scratchpad `new-shells-v3/`. The Logitech gallery photos remain outside the repository.
