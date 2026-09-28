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

## Current catalogue (generated from manifest)

The manifest has 31 shell entries (30 source-derived shells and 1 alias), 3 limited-view studies, and 4 NO_SHELL entries. There are 34 distinct GLBs including the hand, totalling **8,535,584 bytes (8.14 MiB)**, including **4,915,240 image bytes** across 93 JPEG maps.

Aliases share a delivered file; they do not add a GLB. Classification below comes from the current manifest. Earlier sections are historical payload experiments, not the current catalogue.

| Model                                 | Classification     | Delivered file                                      |   Bytes |
| ------------------------------------- | ------------------ | --------------------------------------------------- | ------: |
| logitech-ergo-m575                    | AR-derived shell   | `shells/logitech-ergo-m575.glb`                     | 242,904 |
| logitech-ergo-m575s                   | Shell alias        | `shells/logitech-ergo-m575.glb`                     | 242,904 |
| logitech-g-pro-2-lightspeed           | AR-derived shell   | `shells/logitech-g-pro-2-lightspeed.glb`            | 313,576 |
| logitech-g-pro-x-superlight-2         | AR-derived shell   | `shells/logitech-g-pro-x-superlight-2.glb`          | 302,612 |
| logitech-g-pro-x-superlight-2-dex     | AR-derived shell   | `shells/logitech-g-pro-x-superlight-2-dex.glb`      | 300,636 |
| logitech-g-pro-x-superlight-2-se      | AR-derived shell   | `shells/logitech-g-pro-x-superlight-2-se.glb`       | 305,720 |
| logitech-g-pro-x-superlight-2c        | AR-derived shell   | `shells/logitech-g-pro-x-superlight-2c.glb`         | 312,252 |
| logitech-g203-lightsync               | AR-derived shell   | `shells/logitech-g203-lightsync.glb`                | 219,512 |
| logitech-g305-lightspeed              | AR-derived shell   | `shells/logitech-g305-lightspeed.glb`               | 158,256 |
| logitech-g309                         | AR-derived shell   | `shells/logitech-g309.glb`                          | 397,556 |
| logitech-g403-hero                    | AR-derived shell   | `shells/logitech-g403-hero.glb`                     | 194,384 |
| logitech-g502-hero                    | AR-derived shell   | `shells/logitech-g502-hero.glb`                     | 251,940 |
| logitech-g502-x                       | AR-derived shell   | `shells/logitech-g502-x.glb`                        | 346,700 |
| logitech-g502-x-lightspeed            | AR-derived shell   | `shells/logitech-g502-x-lightspeed.glb`             | 301,816 |
| logitech-g502-x-plus                  | AR-derived shell   | `shells/logitech-g502-x-plus.glb`                   | 267,616 |
| logitech-g703-lightspeed              | AR-derived shell   | `shells/logitech-g703-lightspeed.glb`               | 198,948 |
| logitech-g903-hero                    | AR-derived shell   | `shells/logitech-g903-hero.glb`                     | 393,920 |
| logitech-lift-vertical                | AR-derived shell   | `shells/logitech-lift-vertical.glb`                 | 261,028 |
| logitech-m190                         | AR-derived shell   | `shells/logitech-m190.glb`                          | 260,380 |
| logitech-m196                         | AR-derived shell   | `shells/logitech-m196.glb`                          | 255,260 |
| logitech-m240                         | AR-derived shell   | `shells/logitech-m240.glb`                          | 209,888 |
| logitech-m550                         | AR-derived shell   | `shells/logitech-m550.glb`                          | 327,296 |
| logitech-m650                         | AR-derived shell   | `shells/logitech-m650.glb`                          | 331,176 |
| logitech-m720-triathlon               | AR-derived shell   | `shells/logitech-m720-triathlon.glb`                | 244,336 |
| logitech-m750                         | AR-derived shell   | `shells/logitech-m750.glb`                          | 331,092 |
| logitech-mx-anywhere-3s               | AR-derived shell   | `shells/logitech-mx-anywhere-3s.glb`                | 194,984 |
| logitech-mx-master-3s                 | AR-derived shell   | `shells/logitech-mx-master-3s.glb`                  | 207,976 |
| logitech-mx-master-4                  | AR-derived shell   | `shells/logitech-mx-master-4.glb`                   | 295,680 |
| logitech-mx-vertical                  | AR-derived shell   | `shells/logitech-mx-vertical.glb`                   | 183,740 |
| logitech-pebble-2-m350s               | AR-derived shell   | `shells/logitech-pebble-2-m350s.glb`                | 203,580 |
| logitech-pop-mouse                    | AR-derived shell   | `shells/logitech-pop-mouse.glb`                     | 325,364 |
| logitech-m325s                        | Limited-view study | `studies/logitech-m325s.glb`                        |  75,284 |
| logitech-m705-marathon                | Limited-view study | `studies/logitech-m705-marathon.glb`                |  80,568 |
| logitech-signature-comfort-plus-m850l | Limited-view study | `studies/logitech-signature-comfort-plus-m850l.glb` |  77,344 |

`logitech-ergo-m575s` aliases `logitech-ergo-m575`; shape identity remains a candidate assumption.
