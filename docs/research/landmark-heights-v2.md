# Landmark heights v2: a ratio of the hand's length

**Status: candidate (未拍板).** Kirby approved the method on 2026-10-04: heights
as a ratio of the photo's hand length, a pooled male-female ratio, and the old
values kept for the wrist, the thumb CMC and every fingertip. The numbers below
are a best estimate from published data. They are **not calibrated against any
hand**, and there is no ground truth to calibrate against (docs/PLAN.md, prereg
v2). Nothing here is a decided figure until Kirby says so.

Version string in the code: `landmark-heights-v2` (`LANDMARK_HEIGHTS_MM_VERSION`
in `src/client/geometry/parallax.ts`). The previous table was
`landmark-heights-v1`: 21 fixed millimetres, guessed.

## Why heights matter

MediaPipe's 21 landmarks are joint centres, so they sit above the paper, by
roughly 6 to 20 mm. Mapping them through the sheet homography as if they lay on
the paper inflates every distance (issue #16: +2.6 mm on a 190 mm hand at 450 mm
and 20 degrees of tilt). The correction back-projects each landmark's ray onto
the plane at that landmark's own height, so the heights are an input to every
millimetre the product reports.

## Method

For each landmark `i`:

    height_i = k_i × L

- `L` is the hand length of this photo, measured by the app (see below).
- `k_i` is worked out in the code from the source data, not typed in as a
  decimal (`LANDMARK_HEIGHT_RATIOS` in `parallax.ts`).

For a joint Garrett measured, with the mean joint depth (thickness) `d` and the
mean hand length `H` of each sex:

    k_M = (d_M / 2) / H_M
    k_F = (d_F / 2) / H_F
    k   = (k_M + k_F) / 2

- **Half the depth.** A joint centre is assumed to sit at half the joint's
  depth above the surface under it.
- **Pooled.** The male and female ratios are averaged with equal weight (not
  weighted by sample size).
- **Landmarks Garrett did not measure** are proxies, marked below. The wrist,
  the thumb CMC and every fingertip keep their v1 values, as a fraction of
  190 mm: `20/190`, `18/190`, `6/190`.

### Where `L` comes from

The heights need `L`, but `L` can only be measured from corrected points. The
code (`correctLandmarksByHandLength` in `src/client/geometry/measurements.ts`)
takes two passes:

1. Back-project the 21 landmarks at the heights of a 190 mm hand (`k × 190`)
   and measure the hand length `L1` from those points.
2. Back-project again at `k × L1`.

**Definition of the hand length (not changed by this work).** The contract's
`MEASUREMENT_DEFINITIONS.handLengthMm`: the straight distance in sheet mm from
landmark 0 (wrist) to landmark 12 (middle fingertip). The code reads it from the
contract, and a unit test pins it.

A third pass would change the hand length by under 0.05 mm; unit tests check this
on synthetic hands of 160, 190 and 220 mm, at 0 and 20 degrees of tilt, 450 mm
from the sheet. `options.heightsMm` of `computeCorrectedHandMeasurements` still
overrides the heights (and then there is no second pass).

## Sources

Both reports are US Government works whose cover says: _"This document has been
approved for public release and sale; its distribution is unlimited."_ (PDF p.1
of each; the page numbers below count from the cover.)

| Sex    | Report                                                                                                | DTIC      | Sample                                 | Mean hand length | Hand length page |
| ------ | ----------------------------------------------------------------------------------------------------- | --------- | -------------------------------------- | ---------------- | ---------------- |
| Male   | Garrett, J. W. (1970). _Anthropometry of the Hands of Male Air Force Flight Personnel_. AMRL-TR-69-42 | AD0709883 | 148 men, right hand, sliding caliper   | 19.72 cm         | PDF p.11         |
| Female | Garrett, J. W. _Anthropometry of the Air Force Female Hand_                                           | AD0710202 | 211 women, right hand, sliding caliper | 17.93 cm         | PDF p.15         |

Garrett's hand length is "the distance from the wrist crease baseline to the
tip of the longest finger" (male report p.11, female report p.15).

### Depths used (means, cm)

| Variable (Garrett's number) | Joint                                   | Male | Male page | Female | Female page |
| --------------------------- | --------------------------------------- | ---- | --------- | ------ | ----------- |
| 8                           | Hand thickness at metacarpale III       | 3.29 | 18        | 2.76   | 22          |
| 11                          | Interphalangeal joint, digit 1          | 2.02 | 20        | 1.66   | 24          |
| 14                          | Distal interphalangeal joint, digit 2   | 1.55 | 21        | 1.28   | 25          |
| 17                          | Proximal interphalangeal joint, digit 2 | 1.94 | 22        | 1.62   | 26          |
| 20                          | Distal interphalangeal joint, digit 3   | 1.60 | 23        | 1.31   | 27          |
| 23                          | Proximal interphalangeal joint, digit 3 | 2.01 | 24        | 1.67   | 28          |
| 26                          | Distal interphalangeal joint, digit 4   | 1.51 | 25        | 1.25   | 29          |
| 29                          | Proximal interphalangeal joint, digit 4 | 1.89 | 26        | 1.57   | 30          |
| 32                          | Distal interphalangeal joint, digit 5   | 1.37 | 27        | 1.13   | 31          |
| 35                          | Proximal interphalangeal joint, digit 5 | 1.67 | 28        | 1.39   | 32          |

Only the means are kept here, not the full statistics tables. The values were read
from the scanned pages. One value was misread on the first pass: the female index DIP depth (variable 14,
p.25) is **1.28 cm** (0.51 in), not 1.23. Its last digit is uncertain, 1.28 or
1.29, because 0.51 in is 1.295 cm; the table uses 1.28.

## The table

`k_M`, `k_F` and `k` are the male, female and pooled ratios. `v2` is `k × 190`.
`v1` is the old fixed value. `proxy` marks a landmark whose own joint Garrett did
not measure.

| Landmark      | Source                                   | k_M      | k_F      | k (pooled)          | v2 at L = 190 (mm) | v1 (mm) |
| ------------- | ---------------------------------------- | -------- | -------- | ------------------- | ------------------ | ------- |
| 0 wrist       | kept from v1                             | -        | -        | 0.105263 (= 20/190) | 20.00              | 20      |
| 1 thumb CMC   | kept from v1                             | -        | -        | 0.094737 (= 18/190) | 18.00              | 18      |
| 2 thumb MCP   | variable 11, thumb IP depth (proxy)      | 0.051217 | 0.046291 | 0.048754            | 9.26               | 15      |
| 3 thumb IP    | variable 11                              | 0.051217 | 0.046291 | 0.048754            | 9.26               | 11      |
| 4 thumb TIP   | kept from v1                             | -        | -        | 0.031579 (= 6/190)  | 6.00               | 6       |
| 5 index MCP   | variable 8, middle MCP thickness (proxy) | 0.083418 | 0.076966 | 0.080192            | 15.24              | 13      |
| 6 index PIP   | variable 17                              | 0.049189 | 0.045176 | 0.047182            | 8.96               | 10      |
| 7 index DIP   | variable 14                              | 0.039300 | 0.035694 | 0.037497            | 7.12               | 8       |
| 8 index TIP   | kept from v1                             | -        | -        | 0.031579            | 6.00               | 6       |
| 9 middle MCP  | variable 8                               | 0.083418 | 0.076966 | 0.080192            | 15.24              | 13      |
| 10 middle PIP | variable 23                              | 0.050963 | 0.046570 | 0.048766            | 9.27               | 10      |
| 11 middle DIP | variable 20                              | 0.040568 | 0.036531 | 0.038549            | 7.32               | 8       |
| 12 middle TIP | kept from v1                             | -        | -        | 0.031579            | 6.00               | 6       |
| 13 ring MCP   | variable 8, middle MCP thickness (proxy) | 0.083418 | 0.076966 | 0.080192            | 15.24              | 13      |
| 14 ring PIP   | variable 29                              | 0.047921 | 0.043781 | 0.045851            | 8.71               | 10      |
| 15 ring DIP   | variable 26                              | 0.038286 | 0.034858 | 0.036572            | 6.95               | 8       |
| 16 ring TIP   | kept from v1                             | -        | -        | 0.031579            | 6.00               | 6       |
| 17 little MCP | variable 8, middle MCP thickness (proxy) | 0.083418 | 0.076966 | 0.080192            | 15.24              | 13      |
| 18 little PIP | variable 35                              | 0.042343 | 0.038762 | 0.040552            | 7.70               | 10      |
| 19 little DIP | variable 32                              | 0.034736 | 0.031511 | 0.033124            | 6.29               | 8       |
| 20 little TIP | kept from v1                             | -        | -        | 0.031579            | 6.00               | 6       |

The ratios are rounded to six decimals here; the code uses the unrounded
values. A unit test (`tests/unit/landmark-heights.test.ts`) pins this table
against the code: every ratio within 0.000002, every height at L = 190 within
0.01 mm.

Heights scale linearly with `L`. At L = 160 mm the wrist is 16.8 mm up and the
middle MCP 12.8 mm; at L = 220 mm, 23.2 mm and 17.6 mm.

## How big the uncertainty is

Own calculations from the source statistics, not guarantees:

- **Male against female:** at L = 190 the male and female ratios give joint
  heights 0.6 to 1.2 mm apart.
- **Within one sex:** the 5th to 95th percentile range of a joint's height is
  about plus or minus 1 to 1.5 mm.
- **Effect on hand length:** a height error of 1.5 mm, at a camera distance of
  about 450 mm, changes the measured hand length by roughly 190 × 1.5 / 450,
  about 0.6 mm.

## Limits and what is not decided

1. **Palm compression is not corrected.** Garrett measured a hand held in the
   air, with nothing under it. A hand lying on paper compresses its palm-side
   soft tissue, so the true heights are probably a little lower. The size is
   unknown.
2. **The app's hand length is not Garrett's.** Garrett's runs from the wrist
   crease to the tip of the longest finger, skin to skin. The app's runs between
   two joint-centre landmarks, so it is somewhat shorter; the heights come out
   slightly low for that reason too. The size is unknown.
3. **Proxies.** The thumb MCP borrows the thumb IP depth. The index, ring and
   little MCPs borrow the middle MCP thickness. The wrist, the thumb CMC and every
   fingertip keep guessed v1 values: Garrett measured none of them.
4. **Air Force samples.** Male flight personnel and Air Force women, from
   reports decades old (the male one is dated March 1970). They are not a
   sample of today's users.
5. **Pooling.** Male and female ratios have equal weight, not weighted by the
   users the product will meet.
6. **Thumb rotation.** The thumb depth direction changes as the thumb rotates;
   treating it as thickness perpendicular to the paper is an assumption.
7. **All of these numbers need checking on a real phone.** No ruler truth
   exists; any claim about accuracy stays out until there is one.

Not decided by this document, and left to Kirby: whether v2 replaces v1 as the
product's default, whether the pooled ratio, the half-depth rule and the kept
values stay, and whether any palm-compression offset is added.

## What a stored record says

A learning-kit run log records, per plane, `heightsVersion` and the 21
`heightsMm` the correction really used (`src/lib/learning/plane.ts`). Under v2
they differ from photo to photo, since they follow that photo's hand length. A
log written under v1 (the same 21 mm for every photo) is recomputed from the
heights it recorded, never from the current version's; a unit test pins this.

The measurement contract (`src/lib/contracts/`) does not carry the heights
version: a scan stored by the server cannot say whether it was measured under v1
or v2. That is a question for Claude, who owns the contract.
