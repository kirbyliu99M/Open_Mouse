# Geometry audit (Phase D0)

Claude, 2026-09-28. Kirby's direction: **model quality, not colour.** This audit measures how
closely every delivered AR-derived shell follows its official AR source. It is read-only on
assets. Reproduce with `geometry_audit.py` (Blender), then `geometry_audit_report.py` (external
Python); outputs go to `out/geometry-audit/` (ignored).

## Method

- **Frame.** The reconstruction frame, where `source_surface` has calibrated the AR source
  (including cable trims) and the shell was fitted. No re-registration, so the numbers include
  any calibration error.
- **Surface distance.** 20,000 area-weighted random points on the shell (seed 0), each measured
  to the nearest point on the source. The sign comes from the source normal there: **outside**
  means the shell lies over a recess, seam or opening (it seals it); **inside** means the shell
  lies below source geometry, so a bump or part is missing.
- **Silhouette IoU.** Orthographic top, side and front views at 1024 px, shell against source.
  Source triangles more than 1 mm outside the calibrated product box are dropped, so trimmed
  cables do not count.
- Studies (M325s, M550, M705, M850L) are measured against photos instead. See B3 (M550) and
  D1 (Codex's baselines for the other three).
- Aliases (M575S) and inherited shells (SE, identical to Superlight 2) are not listed separately.

## Results

Ranked by lowest silhouette IoU, then by p95 distance.

| Rank | Shell                    | IoU top | IoU side | IoU front | Distance mean / p95 / max (mm) | > 2 mm | of which shell outside / inside | Cable trimmed |
| ---: | ------------------------ | ------: | -------: | --------: | ------------------------------ | -----: | ------------------------------- | ------------- |
|    1 | g502-hero                |  0.9874 |   0.9823 |    0.9908 | 0.18 / 0.43 / 4.17             |   0.2% | 0.2% / 0.0%                     | yes           |
|    2 | g203-lightsync           |  0.9930 |   0.9848 |    0.9956 | 0.11 / 0.22 / 3.68             |   0.2% | 0.1% / 0.1%                     | yes           |
|    3 | g502-x                   |  0.9906 |   0.9857 |    0.9873 | 0.32 / 1.38 / 5.27             |   3.6% | 3.0% / 0.6%                     | yes           |
|    4 | g-pro-2-lightspeed       |  0.9959 |   0.9858 |    0.9945 | 0.49 / 3.23 / 10.80            |   6.6% | 6.6% / 0.0%                     |               |
|    5 | g502-x-lightspeed        |  0.9923 |   0.9889 |    0.9872 | 0.26 / 0.45 / 5.64             |   1.3% | 1.3% / 0.0%                     |               |
|    6 | g502-x-plus              |  0.9923 |   0.9889 |    0.9872 | 0.26 / 0.45 / 5.64             |   1.3% | 1.3% / 0.0%                     |               |
|    7 | g403-hero                |  0.9945 |   0.9876 |    0.9963 | 0.17 / 0.32 / 9.96             |   1.3% | 1.3% / 0.0%                     | yes           |
|    8 | g903-hero                |  0.9951 |   0.9877 |    0.9908 | 0.47 / 2.22 / 8.22             |   5.8% | 4.2% / 1.6%                     |               |
|    9 | m750                     |  0.9949 |   0.9885 |    0.9923 | 0.37 / 1.50 / 11.02            |   4.4% | 4.1% / 0.3%                     |               |
|   10 | g309                     |  0.9949 |   0.9890 |    0.9947 | 0.40 / 2.31 / 7.58             |   6.1% | 6.1% / 0.0%                     |               |
|   11 | m650                     |  0.9942 |   0.9893 |    0.9920 | 0.48 / 2.78 / 11.23            |   5.7% | 4.5% / 1.2%                     |               |
|   12 | g-pro-x-superlight-2     |  0.9942 |   0.9901 |    0.9945 | 0.18 / 0.58 / 3.42             |   1.0% | 1.0% / 0.0%                     |               |
|   13 | pebble-2-m350s           |  0.9981 |   0.9904 |    0.9935 | 0.09 / 0.26 / 0.57             |   0.0% | 0.0% / 0.0%                     |               |
|   14 | m196                     |  0.9964 |   0.9905 |    0.9904 | 0.16 / 0.36 / 1.69             |   0.0% | 0.0% / 0.0%                     |               |
|   15 | pop-mouse                |  0.9972 |   0.9904 |    0.9947 | 0.16 / 0.47 / 2.98             |   0.2% | 0.2% / 0.0%                     |               |
|   16 | mx-anywhere-3s           |  0.9963 |   0.9910 |    0.9928 | 0.13 / 0.25 / 1.32             |   0.0% | 0.0% / 0.0%                     |               |
|   17 | m240                     |  0.9976 |   0.9911 |    0.9925 | 0.13 / 0.25 / 2.24             |   0.0% | 0.0% / 0.0%                     |               |
|   18 | g-pro-x-superlight-2c    |  0.9961 |   0.9918 |    0.9963 | 0.13 / 0.39 / 2.77             |   0.3% | 0.3% / 0.0%                     |               |
|   19 | mx-master-3s             |  0.9959 |   0.9961 |    0.9925 | 0.10 / 0.23 / 0.88             |   0.0% | 0.0% / 0.0%                     |               |
|   20 | g703-lightspeed          |  0.9941 |   0.9927 |    0.9958 | 0.19 / 0.42 / 9.47             |   1.3% | 1.3% / 0.0%                     |               |
|   21 | ergo-m575                |  0.9965 |   0.9953 |    0.9931 | 0.15 / 0.39 / 5.55             |   1.0% | 1.0% / 0.0%                     |               |
|   22 | m720-triathlon           |  0.9963 |   0.9932 |    0.9941 | 0.12 / 0.28 / 2.58             |   0.1% | 0.1% / 0.0%                     |               |
|   23 | m190                     |  0.9953 |   0.9937 |    0.9941 | 0.14 / 0.44 / 7.42             |   0.7% | 0.2% / 0.4%                     |               |
|   24 | mx-master-4              |  0.9962 |   0.9954 |    0.9939 | 0.12 / 0.30 / 1.72             |   0.0% | 0.0% / 0.0%                     |               |
|   25 | g-pro-x-superlight-2-dex |  0.9965 |   0.9941 |    0.9965 | 0.33 / 2.16 / 7.52             |   5.4% | 5.4% / 0.0%                     |               |
|   26 | g305-lightspeed          |  0.9973 |   0.9943 |    0.9962 | 0.06 / 0.24 / 1.04             |   0.0% | 0.0% / 0.0%                     |               |
|   27 | mx-vertical              |  0.9971 |   0.9983 |    0.9956 | 0.08 / 0.19 / 0.88             |   0.0% | 0.0% / 0.0%                     |               |
|   28 | lift-vertical            |  0.9982 |   0.9980 |    0.9971 | 0.06 / 0.17 / 0.76             |   0.0% | 0.0% / 0.0%                     |               |

## Findings

1. **Silhouettes are good everywhere:** every shell's IoU is ≥ 0.982 in all three views. No shell
   has a wrong overall shape, proportion or orientation.
2. **Most > 2 mm deviation is sealing by design.** Deviation maps
   (`out/geometry-audit/<slug>-deviation.png`, blue = outside, red = inside) show the blue
   bands follow part seams, button gaps, wheel wells and underside recesses (skates, sensor
   window, battery door). G Pro 2's 6.6% is entirely on the underside. A closed hand-contact
   shell is meant to span these.
3. **Real shape loss ("inside") is small and local:**
   - **Scroll wheels:** M190 (0.4%), M750, M650 (1.2%) and G903. The shell sits more than 2 mm
     below the wheel crown, the part a finger touches. This is the geometric side of O2.
   - **G903's central button channel and wing seams** (1.6% inside, 4.2% outside): the shell
     smooths over its layered top.
   - **G502 X** front-left underside pocket (0.6%).
4. **O6 is a comparison artefact, not a model problem.** G203, G403, G502 Hero and G502 X are
   exactly the four shells whose AR source includes a USB cable. `phase_c_colour.reference()`
   normalised the reference render by the source's full bbox, cable included, so the reference
   was squashed along the length. With the bbox taken from the product body only (fixed on this
   branch), reference-vs-shell render IoU goes from 0.80–0.87 to 0.96–0.98 and top-view ΔE2000
   from 3.1–9.2 to 1.6–3.7. Their geometry here is among the best: G502 Hero p95 0.43 mm,
   G203 0.22 mm.

| Cable shell | Render IoU vs reference, old → fixed (top / side / hero) |
| ----------- | -------------------------------------------------------- |
| G203        | 0.858 → 0.978 / 0.867 → 0.963 / 0.867 → 0.976            |
| G403        | 0.810 → 0.977 / 0.812 → 0.961 / 0.824 → 0.974            |
| G502 Hero   | 0.802 → 0.977 / 0.794 → 0.961 / 0.798 → 0.974            |
| G502 X      | 0.828 → 0.981 / 0.831 → 0.968 / 0.824 → 0.978            |

## Recommendations

- **D4 (proposed): local outward fit where the shell is inside the source.** Move only shell vertices
  that lie more than 1 mm inside the source onto its outer surface, then fair them smoothly.
  Targets: the four wheels and G903's channel. Sealed seams and openings stay sealed. Gate:
  inside share > 2 mm → about 0, silhouette IoU not lower in any view, clean topology, support ≥ 5 mm,
  calibrated bbox unchanged.
- The Phase C install decisions for G203 and G502 Hero ("kept") were colour decisions based on
  the squashed reference. Colour is now out of scope, so they are not revisited.
