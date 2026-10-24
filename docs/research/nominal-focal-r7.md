# Nominal focal prior and the engine scale (R7 summary)

**Status: candidate (未拍板).** Kirby approved building it for V3.2 on 2026-10-22 (D1 = B, D2, D3, D5).
Every number here is **simulated (模擬)** unless it says measured (實測). The full design, its scripts and
their output live outside the repo (`v32-program-2026-10-21\DESIGN-nominal-focal.md`, `review\R7\`).
Measurement model: `landmark-raw-v3` (`MEASUREMENT_MODEL_VERSION`).

## What changed

A parallax correction needs a focal length. Before v3 a photo got one from its EXIF, else from the sheet's
homography when that estimate was judged reliable, else no correction at all. Frames of the live video
have no EXIF, and a phone held nearly flat above the sheet cannot fix a focal length from the sheet, so
almost every frame scan went uncorrected (Kirby's 10 recorded scans: all `none`, 實測). Uncorrected, a
190 mm hand reads about +4.7 mm long and its palm width about +2.4 mm.

Since v3 the order is (`resolveFocalPx`, `src/client/geometry/parallax.ts`):

1. EXIF.
2. A placed frame only (F10): the same photo's focal length from its automatic run; one that came from a
   homography estimate must be inside 0.7-1.4x of the prior.
3. A reliable homography estimate inside 0.7-1.4x of the prior (`FOCAL_PRIOR_RANGE`). At a tilt of 3
   degrees, 70 % of the estimates judged reliable are more than 20 % off.
4. The nominal prior: 18 mm equivalent on the WHOLE camera frame's long edge,
   `18 / 43.27 x 1.25 x long edge` (about 0.520 x; 998 px for 1920). V3.2 F17 (Kirby 2026-10-23,
   candidate 未拍板) moved it from 26 mm (1442 px) to Kirby's measured S25 homography estimates (實測,
   1024 x 1920 frames: 1055 and 1000.8 px with clean automatic corners, 902, 894 and 934.6 px hand-placed,
   1153 and 964 px on scans he judged unreliable; all 0.62-0.80 of 1442). One phone only; an iPhone is not
   verified (不確定). The range check keeps its ratios, now on the new prior (about 699-1398 px for a
   1920 px long edge). A frame of the video cut to the part
   on screen passes the stream's long edge (`frameFocalReferenceLongEdgePx`): a frame cut on its long side
   would otherwise read about 1.5-2 mm short. The 18 mm lens is for frames of the live video ONLY (F17
   review, candidate 未拍板): a still with no EXIF (an upload whose EXIF was stripped, or the camera's
   takePhoto picture) keeps 26 mm on its own long edge (`NOMINAL_FOCAL_EQUIV_MM_STILL`, about 0.751 x;
   3004 px for 4000), because the measurements are of video frames only and a 26 mm main-camera still
   would read 1.44x of an 18 mm prior, outside the range (模擬). Passing the stream's long edge is what
   marks a photo as a video frame (`frameNominalReferenceLongEdgePx`).
5. None.

The learning kit (`src/lib/learning/plane.ts`) passes no prior and is unchanged; the M2 baseline stays
named `landmark-raw-v2` (`M2_BASELINE_MODEL`).

## Error budget of the prior

R6's pinhole scene, frame 1024 x 1920, random azimuth, paper fill 0.55-0.80, palm width about 0.35 of the
length, 100 scenes per tilt, mean bias against the planar joint-centre truth
(tests/unit/nominal-focal-v3.test.ts):

| Prior / true focal | Tilt 0-15 degrees: hand length | Palm width        | No correction: hand length |
| ------------------ | ------------------------------ | ----------------- | -------------------------- |
| 0.9                | -0.46 to -0.78 mm              | -0.13 to -0.23 mm | +3.9 to +4.3 mm            |
| 1.0                | under 0.1 mm                   | under 0.1 mm      | —                          |
| 1.1                | +0.46 to +0.81 mm              | +0.12 to +0.24 mm | +4.8 to +5.3 mm            |

The design's own table (R7 §2) gives ±0.8 mm and ±0.26 mm for ±10 %. Not in this budget: the height
model (±20 % moves the hand length ±0.8 mm), a principal point off the centre and lens distortion (not
simulated, 不確定).

## The engine scale

The engine and everything around it were tuned on uncorrected frame scans. Fed the corrected numbers
directly, the V1 population's top-10 Jaccard against today drops to 0.30-0.67 and `predictGrip` flips for
24.5 % of hands. So a parallax-corrected scan reaches every reader on the engine's scale,
`FIT_SCALE_FROM_CORRECTED` (hand length 1.047, palm length 1.067, palm width 1.044; S25 measured at the 18 mm frame prior, 2026-10-24; a second person on an iPhone agreed), and the page shows
that same number (D1 = B). See docs/fit-algorithm.md §1 for the table and the population numbers.

## Still to do before production

- Kirby's S25 check (design §5.3): the attempt log's Copy JSON now keeps, locally only, the focal source,
  the homography estimate (used or not) and whether it was reliable, and the uncorrected and reported
  hand length, palm length and palm width (`parallaxCheck`). Analytics carries only the coarse buckets.
- Replace the simulated k by the measured median of uncorrected over corrected (D5), and the 26 mm prior
  by the measured stream focal length if it differs by more than 10 % (D2).
- The definition offset between landmark 0 and the wrist crease is one person's data (Kirby: corrected
  joint-centre length about 5.5-6.9 mm under the tape, 實測, 2 scans); a claim of "close to a tape measure"
  needs the 10-15-person mini collection first.
