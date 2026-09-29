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
   2. Measure with a ruler: hand length (wrist crease to middle fingertip)
      and palm width. Write both on their card, never their name.
   3. Photograph the card.
3. Work through G01 to G07 with the right hand, then G01 to G07 with the
   left. Scan a page's QR code for its instructions. Lift the hand and place
   it again between every photo.
4. Before the person leaves, open `/learn/check`, choose the session's
   photos, and retake anything marked **Retake**.
5. At the computer, run
   `npm run learn:sort -- --in "<folder of photos>"`. It copies (never moves
   or overwrites) photos to `../Fixtures/learning/<participant>/<pose>/<n>.jpg`,
   writes a `truth.json` template per person, and saves every photo's
   measured points to `runs/<time>.json`. Copy the ruler values from each
   `slate.jpg` into `truth.json`.

Keep the camera's file names: natural file-name order is capture order.

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

Detected handedness is recorded but **not compared yet**. The product's
`normalizeHandedness` reports the opposite hand for palm-down rear-camera
photos (see `docs/reviews/uiux-audit-2026-09-29.md`, finding 0). The page's
QR code is the ground truth for which hand is shown.

## Privacy and rules

- **Photos never leave the device** (hard rule 5). The checker decodes,
  detects and measures in the browser. The e2e test asserts that no request
  is sent while it runs.
- **Photos and `truth.json` stay outside the repo** (`../Fixtures/learning/`).
  The sorter refuses an output folder inside the repo and refuses to run in
  CI.
- **Participant numbers, never names.**
- **No medical claims.** G06 and G07 collect posture data for research into
  mouse fit and hand and wrist angles. The pages say so, and nothing
  diagnoses or advises.

## Changing the kit

A printed QR code is permanent. To change a pose, its page or the code
format, raise `LEARNING_KIT_VERSION` and add a `/l/v2/[token]` route. Keep
`/l/v1/[token]` answering for pages already printed. The sorter files only
the current version, so mixed-version photos are reported rather than mixed.

## Files

| Path                                                              | What                                                               |
| ----------------------------------------------------------------- | ------------------------------------------------------------------ |
| `src/lib/learning/kit.ts`                                         | Poses, QR payloads, capture order, photo sorter (pure, tested)     |
| `src/lib/learning/layout.ts`                                      | Page layouts in mm (pure, tested)                                  |
| `src/lib/learning/qr.ts`                                          | QR module matrix (round-trip tested with jsQR)                     |
| `src/lib/learning/checks.ts`                                      | Per-photo verdict (pure, tested)                                   |
| `src/client/learning/analyse.ts`                                  | In-browser analysis: QR, markers, paper edges, landmarks           |
| `src/components/learning/KitSvg.tsx`                              | Printed pose pages and participant cards                           |
| `src/app/learn/**`, `src/app/l/v1/**`                             | Kit index, print, cards, checker, QR landing pages (all `noindex`) |
| `scripts/learn-sort.ts`                                           | Folder sorter (never in CI)                                        |
| `tests/unit/learning-*.test.ts`, `tests/e2e/learning-kit.spec.ts` | Tests                                                              |
