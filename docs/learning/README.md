# Learning kit — ground-truth hand photos

Kirby, 2026-09-27: _"we use QR code version paper to calibrate, then realize
the product with blank paper"_, with photos from many people's hands.
Kirby, 2026-09-29: the paper must carry QR codes for multiple hand gestures,
and be easy to access, test and identify.

This kit is that data-collection sequence. Every printed page shows one pose
for one hand and carries its own QR code. A photo therefore records which
pose it shows, and a folder of photos can be sorted and checked without
anyone keeping notes.

## Why this design

- **Ground truth and the product in one photo.** Each top-down page keeps the
  product sheet's four ArUco markers in exactly the same positions
  (`computeSheetLayout()`), and it is printed on A4.
  - The markers give a reference homography.
  - The paper's own edges give the homography the blank-paper product uses.
  - The checker measures the same 21 landmarks through both, so every photo
    is a paired sample for tuning the blank-paper scan.
- **The QR code, not the file order, says what a photo is.** A skipped or
  repeated photo cannot shift the ones after it. A participant card (the
  "slate") starts each person's block, like a film clapperboard.
- **Easy to access.** Each QR code is a URL (`/l/v1/G03R`). Scanning a page
  with the phone camera opens that pose's instructions and a link to the next
  pose.
- **Easy to test.** `/learn/check` reads photos on the device and says, per
  photo, what to retake and why. `npm run learn:sort` does the same for a
  whole folder and files the photos.
- **Nothing to re-derive later.** Each photo's record (the run log, format 2,
  below) holds the homographies, the landmarks in sheet millimetres and the
  parallax settings, so the mm values can be worked out again from the record
  alone, without the photo.

## Poses (kit v1)

| Code | Pose                   | Camera                     | Flap   | Photos per hand | For                                                                   |
| ---- | ---------------------- | -------------------------- | ------ | --------------- | --------------------------------------------------------------------- |
| G01  | Flat, fingers together | above                      | flat   | 5               | Hand, palm and finger lengths; the M2 accuracy and repeatability gate |
| G02  | Flat, fingers spread   | above                      | flat   | 3               | Finger lengths without occlusion; thumb-to-little-finger span         |
| G03  | Palm grip              | above                      | flat   | 3               | Grip aperture and thumb angle                                         |
| G04  | Claw grip              | above                      | flat   | 3               | Same, claw                                                            |
| G05  | Fingertip grip         | above                      | flat   | 3               | Same, fingertip                                                       |
| G06  | Side, hand flat        | table height, facing strip | folded | 3               | Palm thickness, knuckle height                                        |
| G07  | Side, palm grip        | table height, facing strip | folded | 3               | Knuckle height and hand pitch in a mouse posture (research only)      |

That is 23 photos per hand, plus one card photo per person. The source of
truth is `src/lib/learning/kit.ts`: the pages, the instruction pages and the
sorter all read from it.

**Side pages have a taller flap.** The product sheet's side strip puts its
markers 12.5–37.5 mm above the table, where a hand seen from the side would
cover them. Side pages fold 100 mm from the top instead, so the markers and
QR code stand 55–80 mm up, above the hand.

The hand's midline sits about half a palm width in front of the strip. The
palm width recorded on the card lets the analysis correct for that. This
correction is not built yet.

## A session

1. **Print once:**
   - `/learn/print?hands=both`: 14 A4 pages at 100%. Check the 100 mm line
     with a ruler.
   - `/learn/slates`: participant cards, 8 per page.

   Pages are reusable across people.

2. **Per person:**
   1. Ask their consent.
   2. Measure both hands with a ruler, following the **ruler protocol**
      below (a candidate). Write the four values on their card, in the Right
      and Left columns, never their name.
   3. Photograph the card.
3. Work through G01 to G07 with the right hand, then G01 to G07 with the
   left. Scan a page's QR code for its instructions. Lift the hand and place
   it again between every photo.
4. Before the person leaves, open `/learn/check`, choose the session's
   photos, and retake anything marked **Retake**.
5. At the computer, run
   `npm run learn:sort -- --in "<folder of photos>"`. It copies (never moves
   or overwrites) photos to `../Fixtures/learning/<participant>/<pose>/<n>.jpg`,
   writes a `truth.json` template per person, and saves the run log to
   `runs/<time>.json`. Copy the ruler values from each `slate.jpg` into
   `truth.json`, right hand and left hand apart.

Keep the camera's file names: natural file-name order is capture order.

**Pages printed on US Letter.** The kit is designed for A4. If a session uses
Letter paper, pass `--paper letter` to `learn:sort` (the checker page has a
"Sheet size of the pages" setting, and `/learn/check?paper=letter` presets it)
so the paper-edge plane assumes the right sheet size. Print at 100%: the marker
layout stays the A4 layout, and the run log records the size used.

## What each check means

| Check                    | Tone when it fails             | Why                                                                      |
| ------------------------ | ------------------------------ | ------------------------------------------------------------------------ |
| Kit QR code read         | not identified                 | Without it the photo cannot be filed                                     |
| Four corner markers      | retake                         | The reference homography needs all four (top-down pages)                 |
| Markers fit a flat sheet | retake                         | Reprojection error over 1.0 mm means a curled page or an ultra-wide lens |
| Both strip markers       | retake                         | Side pages: the strip is the reference plane                             |
| Sharp enough             | retake                         | Laplacian variance under 50                                              |
| Hand found               | retake (above), warning (side) | MediaPipe needs the whole hand                                           |
| Four paper corners       | warning                        | The photo still has ground truth but no blank-paper pair                 |
| Hand matches the page    | warning                        | Likeliest sign the wrong page was used; the photo is still filed         |

**Hand.** MediaPipe's hand label is compared with the page's hand. A
difference is a warning, not a retake: the photo is still filed (the page's QR
code is the ground truth of what was asked), and `learn:sort` lists it so the
wrong page can be spotted. The label is the hand in the photo since #77 (the
product's `normalizeHandedness` no longer swaps it). That was measured on
palm-down, rear-camera photos only. How reliable it is for the grip poses (G03
to G05) and for the side views (G06, G07) is not known yet; expect the first
real session to show it.

## Ruler protocol (candidate)

**Status: candidate.** How the ruler values are taken has not been agreed yet;
the W7 pre-agreement settles it. Until then this text is what `truth.json`
calls `candidate-v1`. If the protocol changes in substance, give the new one
another name so values taken under different rules are never mixed.

Both hands are measured, each on its own, by the same person for the whole
session. The hand rests on a table, fingers together and straight. Hold the
ruler against the skin without pressing. Read to 0.5 mm, measure twice, and
write the mean. If the two readings differ by more than 2 mm, measure again.

| Value           | Hand position | Where                                                                                                                                                                                                                         |
| --------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Hand length** | palm up       | From the wrist crease (where the palm meets the wrist) to the tip of the middle finger                                                                                                                                        |
| **Palm width**  | palm down     | Straight across the back of the hand, from the outer skin edge of the knuckle where the index finger meets the hand to the outer skin edge of the knuckle where the little finger meets it, ruler square to the middle finger |

The product's `palmWidthMm` is the distance between two joint centres
(landmarks 5 and 17), so the ruler's skin-to-skin value is expected to be
larger. The contract's comment puts the gap at roughly 10 to 20 mm, which is
unconfirmed. Do not correct for it when writing the card: the offset is to be
fitted from the data.

## Truth file

`npm run learn:sort` writes `../Fixtures/learning/<participant>/truth.json`
once, and never overwrites it. The two hands are apart because hands differ, and
a photo of the left hand is compared with the left hand's values.

```json
{
  "format": "open-mouse-learning-truth/2",
  "participant": "P007",
  "protocol": "candidate-v1",
  "right": { "handLengthMm": null, "palmWidthMm": null },
  "left": { "handLengthMm": null, "palmWidthMm": null },
  "note": "..."
}
```

Replace each `null` with millimetres. `truthSchema` in
`src/lib/learning/truth.ts` reads the file back and rejects a value outside the
product's ranges (hand length 100 to 280 mm, palm width 50 to 150 mm), a typo such
as `1850`, an unknown key and the old one-set-for-both-hands layout.

## Run log, format 2

`runs/<time>.json` from `learn:sort`. The checker page's **Download results**
button gives the same file without the folder name and the git commit, which a
page cannot know.

| Field                | Meaning                                                                                                                           |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `format`             | `open-mouse-learning-run/2`                                                                                                       |
| `createdAt`          | When the run happened (not when a photo was taken)                                                                                |
| `kitVersion`         | `LEARNING_KIT_VERSION` of the code that ran                                                                                       |
| `gitSha`, `gitDirty` | The commit of the checkout that served the checker, and whether it had uncommitted changes. `null` with `--base` (unknown server) |
| `paperSize`          | `a4` or `letter`: the sheet the pages are printed on, from `--paper` (default `a4`)                                               |
| `input`              | The photo folder, relative to where the command ran, with `/` separators (see Privacy)                                            |
| `sort`               | The sorter's result: where each photo was filed, and coverage                                                                     |
| `reports[]`          | One record per photo, below                                                                                                       |

Each entry of `reports[]` repeats `kitVersion`, `gitSha` and `gitDirty`, so a
single record can be lifted out and still say which code made it.

| Field                              | Meaning                                                                                                                                                                                                           |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `file`                             | The file's own name, never a path                                                                                                                                                                                 |
| `width`, `height`                  | The decoded frame (oriented, downscaled). Every px value in the record is in this frame                                                                                                                           |
| `paperSize`                        | As above, per photo                                                                                                                                                                                               |
| `exif`                             | `focalLengthMm`, `focalLengthIn35mmFilm`, `pixelXDimension`, `pixelYDimension`; `null` where missing. Nothing else (see EXIF white-list)                                                                          |
| `qrText`, `code`                   | The QR code as read, and what it means (`code.version` is the printed page's kit version)                                                                                                                         |
| `markers[]`                        | ArUco markers found: `id` and four corners in px                                                                                                                                                                  |
| `reprojectionErrorMm`              | How well the four flat markers fit one plane                                                                                                                                                                      |
| `paperCorners`, `paperCornersSeen` | The sheet's corners in px (TL, TR, BR, BL), and how many were seen                                                                                                                                                |
| `laplacianVariance`                | Sharpness                                                                                                                                                                                                         |
| `hand`                             | `landmarksPx` (21 points), `handedness` (`left`, `right` or `null`: the hand in the photo), `confidence`                                                                                                          |
| `markerPlane`, `paperPlane`        | The two calibration planes, below                                                                                                                                                                                 |
| `markerMm`, `paperMm`              | The hand measurements through each plane, **parallax-corrected exactly as the product's blank-paper path does it**. `null` if there is no hand, or a value fell outside the contract's ranges (a folded grip can) |
| `checks[]`, `verdict`              | What the checker told the operator                                                                                                                                                                                |

A plane (`markerPlane`, `paperPlane`):

| Field              | Meaning                                                                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `method`           | `markers` (printed squares, flat pages), `paper-edge` (the sheet's own edges), or `strip-markers` (the upright strip of a side page)                         |
| `homography`       | 3x3, row-major, image px to plane mm                                                                                                                         |
| `fit`              | `reprojectionErrorMm` (markers) or `edgeFitResidualMm` (paper edges); `null` where it does not apply                                                         |
| `landmarksSheetMm` | The 21 landmarks in the plane's mm: the points the measurements come from (back-projected at their own heights when `parallax.corrected`). `null` if no hand |
| `parallax`         | How the correction went, or `null` for a strip plane, where none is defined                                                                                  |

`parallax` holds `corrected`, `focalSource` (`exif`, `homography` or `none`),
`focalPx`, `exifFocalPx` (what EXIF offered before the policy chose),
`principalPoint`, `imageSize`, `heightsVersion` with the 21 `heightsMm` it used,
and `error` if the plane could not be turned into mm.

On a **side page** there is a `markerPlane` (`strip-markers`) and no
`paperPlane`. Its `landmarksSheetMm` are the landmarks projected onto the strip
as if the hand touched it. The hand actually stands about half a palm width in
front of the strip, so those mm values are **uncorrected for depth**, and no
measurements are derived from them yet.

## Recomputing from the log

`recomputePlane(landmarksPx, plane)` in `src/lib/learning/plane.ts` works the
points and the measurements out again from `hand.landmarksPx` and one plane's
recorded `homography` and `parallax`, and nothing else. It does not look up the
product's current heights or focal policy, so a log stays reproducible after
those change. The unit tests do this on synthetic scenes, including one rendered
to pixels and run through the real paper detector, and check that the recomputed
values equal the recorded ones exactly and sit within 0.5 mm of the known hand.

## EXIF white-list

A phone photo's EXIF holds GPS position, the time it was taken, the device's
serial number and more. The run log keeps only the four values in the `exif` row
above. `src/lib/learning/exif.ts` reads exactly those four tags from the Exif
sub-IFD and never looks at the others, and the report builder copies only those
keys, so nothing else can get in by accident. Tests build a JPEG full of GPS,
time and serial-number tags and search the finished log for them, in Vitest and
in a real browser. The focal length in px that the parallax correction used is
derived from the 35 mm value and recorded as a plain number
(`parallax.exifFocalPx`).

## Privacy and rules

- **Photos never leave the device** (hard rule 5). The checker decodes,
  detects and measures in the browser. The e2e test asserts that no request
  is sent while it runs.
- **Photos and `truth.json` stay outside the repo** (`../Fixtures/learning/`,
  next to the main checkout). The sorter refuses an output folder inside the
  repo or inside the main checkout that owns a worktree, also through a
  symlink or junction, and refuses to run in CI. Tests run the real script to
  check both refusals.
- **The run log holds no account name.** `input` is the photo folder relative
  to where the command ran; on another drive only the folder's own name is
  kept. A segment equal to the account name, or the one after `Users` or
  `home`, is replaced by `~`. Photo `file` values are file names, not paths.
- **Only white-listed EXIF** (above): no GPS, time or device serial number.
- **Participant numbers, never names.**
- **No medical claims.** G06 and G07 collect posture data for research into
  mouse fit and hand and wrist angles. The pages say so, and nothing
  diagnoses or advises.

## Changing the kit

A printed QR code is permanent. To change a pose, its page or the code
format, raise `LEARNING_KIT_VERSION` and add a `/l/v2/[token]` route. Keep
`/l/v1/[token]` answering for pages already printed. The sorter files only
the current version, so mixed-version photos are reported rather than mixed.

The participant card's layout changed on 2026-09-30: it now has a Right and a
Left column for the ruler values. Its QR code did not change, so a card printed
before that still identifies its participant, but it has one set of fields.
Reprint the cards before a session so each hand gets its own values.

## Files

| Path                                                              | What                                                               |
| ----------------------------------------------------------------- | ------------------------------------------------------------------ |
| `src/lib/learning/kit.ts`                                         | Poses, QR payloads, capture order, photo sorter (pure, tested)     |
| `src/lib/learning/layout.ts`                                      | Page layouts in mm (pure, tested)                                  |
| `src/lib/learning/qr.ts`                                          | QR module matrix (round-trip tested with jsQR)                     |
| `src/lib/learning/checks.ts`                                      | Per-photo verdict (pure, tested)                                   |
| `src/lib/learning/report.ts`, `findings.ts`, `plane.ts`           | The per-photo record, its planes, and recomputing from it (pure)   |
| `src/lib/learning/exif.ts`                                        | The EXIF white-list reader (pure)                                  |
| `src/lib/learning/runlog.ts`, `paths.ts`, `truth.ts`              | Run log, path rules for the sorter, `truth.json` schema            |
| `src/client/learning/analyse.ts`                                  | In-browser detection: QR, markers, paper edges, landmarks, EXIF    |
| `src/components/learning/KitSvg.tsx`                              | Printed pose pages and participant cards                           |
| `src/app/learn/**`, `src/app/l/v1/**`                             | Kit index, print, cards, checker, QR landing pages (all `noindex`) |
| `scripts/learn-sort.ts`                                           | Folder sorter (never in CI)                                        |
| `tests/unit/learning-*.test.ts`, `tests/e2e/learning-kit.spec.ts` | Tests                                                              |
