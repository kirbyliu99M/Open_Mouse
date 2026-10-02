# Learning kit — ground-truth hand photos

Kirby, 2026-09-27: _"we use QR code version paper to calibrate, then realize
the product with blank paper"_, with photos from many people's hands.
Kirby, 2026-09-29: the paper must carry QR codes for multiple hand gestures,
and be easy to access, test and identify.

This kit is that data-collection sequence. Every printed page shows one pose
for one hand and carries its own QR code. A photo therefore records which
pose it shows, and a folder of photos can be sorted and checked without
anyone keeping notes.

## Kit v2 (protocol `agreed-v2`, 2026-10-02)

Kit v2 replaces the seven-pose pages with **one A4 sheet, one card per
participant and a fixed shooting order**. It is the collection protocol frozen
in `docs/design/learning-kit-v2-proposal-2026-10-02/` (`prereg-2026-10-02-v2.frozen.txt`,
which supersedes version 1; never edited). The rest of this file describes
kit v1 unless a heading says otherwise.

**What it can claim.** There is no ruler truth: the reference is the millimetre
value measured through the marker plane on the same sheet. Results are
**agreement with the marker-sheet reference** and **retake repeatability**,
never "accurate to x mm" or "accurate against real hands". The M2 gate "within
2 mm against the ruler" is dormant (it can neither pass nor fail).

**Sheet B is built, not used for now (Kirby, 2026-10-02).** Only sheet A is
used. B's code (layout, six-marker plane, tests) stays in the repo and works,
but nothing below asks for it.

| Kit v1 (ruler truth)                           | Kit v2 (`agreed-v2`)                                                               |
| ---------------------------------------------- | ---------------------------------------------------------------------------------- |
| 7 poses, 14 pages, a QR code on each           | One A4 page for both hands, no pose QR                                             |
| Pose and hand from the page's QR code          | Pose from the shooting order; hand from `participant.json`                         |
| A card photographed before each person's run   | A participant card in the sheet's slot, so every photo names its participant       |
| Ruler values written on the card, `truth.json` | No truth. `participant.json` and `session.json` hold what the consent flow records |
| Run log format 2                               | Run log format 3 (`protocol`, `session`, `sheet`)                                  |
| Filed copies keep their EXIF                   | Filed copies are EXIF-stripped (only Orientation stays)                            |

### The sheet and the card

Print from the local server (`npm run dev`), A4, **100% / Actual size**:

- `http://localhost:3000/learn/print?sheet=A`: sheet A. The product sheet's four
  markers exactly (`computeSheetLayout()`'s), the centre line the middle finger
  goes along, the wrist line, the card slot at the top, and a **100 mm line**.
  Check it with a ruler at the start of every session and write what you
  measure in `session.json` (`printCheckMm`). It checks the print scale, not the
  hand.
- `?sheet=B`: sheet B (built, not used for now). Six markers (ids 0 to 5) on the
  outer ring and a blank hand area. Its scale check is the 180 mm from the outer
  edge of marker 0 to the outer edge of marker 1.
- `http://localhost:3000/learn/slates?kit=2&from=901&count=12`: participant
  cards, 24 to a page. P901 to P912 is the S0 pilot; `?kit=2&from=1&count=48`
  prints P001 to P048. Each card is 60 × 30 mm: a `P###` QR code and the number
  in 9 mm bold type (so a person can read it when the QR code will not decode).
  Cut along the dashed line and put one in the slot, inside its four corner
  marks, before a person's first photo. A card names a participant, never a name.

Everything on both sheets sits at or above y = 282 mm (a 15 mm margin at the foot
of the page). Geometry: `src/lib/learning/layoutv2.ts`; the print route's PDF
output is measured in `tests/e2e/learning-kit-print.spec.ts` (sheet A's 100 mm
line prints at 99.998 mm, sheet B's 180 mm at 179.997 mm).

The QR code on a card is `https://open-mouse.vercel.app/l/v2/P007`. Like kit
v1's, it is a name, not a link: the checker reads the text out of the photo,
and the pages are not served in production. There is no `/l/v2/...` page.

### A session

1. **Once per session**, write `session.json` in a folder of its own (outside
   the repo), and measure the sheet's printed line with a ruler. Every field
   is required:

   | Field          | Meaning                                                                                  |
   | -------------- | ---------------------------------------------------------------------------------------- |
   | `format`       | `open-mouse-learning-session/1`                                                          |
   | `session`      | `S001`, `S002`, ...                                                                      |
   | `protocol`     | `agreed-v2`                                                                              |
   | `date`         | `YYYY-MM-DD`                                                                             |
   | `timeBlock`    | `morning`, `afternoon` or `evening`                                                      |
   | `venue`        | Where, in words                                                                          |
   | `light`        | The lighting, in words                                                                   |
   | `phone`        | The phone and lens, by hand: the EXIF white-list deliberately drops make and model       |
   | `holding`      | How the phone was held (hand-held, stand, ...)                                           |
   | `sheet`        | `A`. Sheet B is built but not used for now, and the sorter refuses a session that says B |
   | `paperSize`    | `a4` (kit v2 is A4 only; `letter` is refused)                                            |
   | `printCheckMm` | The printed 100 mm line as measured with a ruler, in mm; `null` if not done              |
   | `note`         | Anything else                                                                            |

   The sorter puts the whole record into the run log, so it holds no name and no
   contact detail; its text is copied as typed. The free-text fields refuse an
   e-mail address or a long run of digits. A file saved by a Windows editor with a
   UTF-8 byte-order mark in front is read as it is.

2. **Per person** (about 30 seconds of photography; consent and the form are
   apart from it):
   1. Their consent is signed separately. Record under their `P###` (not in the
      photo) in `participant.json`, below.
   2. Put their card in the slot.
   3. Photograph their **mouse hand** on the sheet: **G02 × 3** (flat, fingers
      spread), then **G04 × 2** (claw: knuckles raised, fingertips curled towards
      the palm). Lift the hand and place it again before every photo. Do not retake
      because the product would refuse a photo: a refused photo is data.
   4. **One extra photo** is allowed per person, only when the hand is clearly off
      the sheet or a corner is covered. Note it: the sorter does not work out where
      it goes. Write `shotCounts` in that person's `participant.json` (below).

   `participant.json` (one per participant, `<out>/P###/participant.json`; the
   sorter writes the template and never overwrites it):

   | Field                                | Meaning                                                                                                                                                                                                                                           |
   | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `format`                             | `open-mouse-learning-participant/1`                                                                                                                                                                                                               |
   | `participant`, `protocol`, `session` | `P###`, `agreed-v2`, `S###`: set by the template                                                                                                                                                                                                  |
   | `mouseHand`                          | `right` or `left`: the hand they use a mouse with (`null` until filled in)                                                                                                                                                                        |
   | `gripSelf`                           | Their own description: `palm`, `claw`, `fingertip` or `unsure`                                                                                                                                                                                    |
   | `ageBand`                            | Optional: `under-20`, `20-29`, `30-39`, `40-49`, `50-59`, `60-plus`                                                                                                                                                                               |
   | `shotCounts`                         | `null` (as planned: 3 G02 then 2 G04) or `{ "G02": n, "G04": m }`, how many of each were actually taken, in shooting order (all G02 first). Fill it in only when the count is not the planned five: an extra shot (at most one), or a missing one |
   | `note`                               | Anything else; no name                                                                                                                                                                                                                            |

3. At the computer, run

   ```
   npm run learn:sort -- --in "<folder of photos>" --session "<folder>\session.json"
   ```

   The sorter **refuses to run without a valid `session.json`**. It starts its
   own dev server (see "A session (kit v1)": `--port`, `--base`, `--dry-run`
   and `--out` are as before) and checks the photos as kit v2 on
   `/learn/check?paper=<size>&sheet=<sheet>`. `--paper a4` is optional (kit v2 is A4 only; any other
   value is refused, and so is a session whose `paperSize` is not `a4`).
   `--show-checks` adds the pose-check and hand flags to the summary, after a
   line saying to label first; by default the summary shows counts and file names
   only (blind labelling, below).

4. Fill in each new `participant.json`, then run the sorter again. The first run
   cannot know the mouse hand (nothing was filled in yet), so its hand check is
   empty; the second run reads `participant.json` and checks MediaPipe's label
   against it. An existing `participant.json`, copy or labels file is never
   overwritten.
5. **Label the photos blind, then look at anything the product says** (below).

Keep the camera's file names: natural file-name order is the shooting order. The
sorter warns when, in that order, a photo's file time is older than the one
before it (a phone that restarted its numbering, or two cards merged).

### What the sorter does

Kit v2 sorting is `sortPhotosV2` in `src/lib/learning/sortv2.ts` (kit v1's
`sortPhotos` is unchanged). In order:

1. **Participant.** The QR code of the card, on every photo. Photos are grouped
   by it wherever they sit in the folder. A photo with no readable card is
   `no-code`; a kit v1 card or page is `version-mismatch`; neither is filed, and
   neither names a participant.
2. **Pose, from the order, and nothing else.** The plan is the contract's
   `planShots(count, shotCounts)`. Five photos take the slots G02, G02, G02, G04,
   G04 (`AGREED_V2_SEQUENCE`). Any other count, **including fewer than five**, is
   placed only if `shotCounts` in the participant's `participant.json` says how
   many G02 and how many G04 were taken (at most one more than planned in all, and
   adding up to the photos). Nothing is read from the file name or the folder, and
   **the pose check takes no part**.
3. **Otherwise the participant is `needs-review`.** None of their photos is
   filed, each is marked `needs-review`, and the sorter tells you to write
   `shotCounts` in `participant.json` and run it again. The reasons are
   `photo-count-not-planned` (no `shotCounts`), `shot-counts-do-not-match`
   (`shotCounts` is there but does not add up, or allows two extras) and
   `unreadable-photo-in-run` (a photo with no readable card sits beside this run
   and may be theirs; write `shotCounts`, `{ "G02": 3, "G04": 2 }` if all was as
   planned, to confirm it is not). The extra shot is the last photo of the pose
   that has one more than planned (`extraShot: true`): a **candidate
   convention**, because the order cannot tell a retake from the photo it
   replaces, so treat a pose's photos as a set.
   Every photo that names a participant keeps its slot in the order, whatever the
   checker thinks of it: dropping a photo would shift the poses of the rest.
4. **Hand.** `mouseHand` in the participant's `participant.json`. MediaPipe's
   label is only a check: a difference is `hand-mismatch`, filed all the same.
5. **The pose check never places or moves a photo.** It only fills `poseCheck`
   and, when it disagrees with the order for a photo, the `pose-mismatch` flag;
   that photo stays where the order put it.
6. **A photo that cannot be filed keeps its slot.** Every image-like file in the
   folder (`.jpg`, `.jpeg`, `.png`, `.heic`, `.heif`, any case) is analysed in
   file-name order. If a photo that names a participant cannot be copied (a PNG, a
   damaged JPEG), it keeps its place in the order, so the photos after it do not
   shift pose, but it has no `destination`, a status naming why (`not-a-jpeg`,
   `damaged-jpeg`, `copy-failed`), and is absent from `labels.json`. The summary
   lists it and the participants whose sequence it is missing from. A HEIC the
   browser cannot read has no readable card, so it counts as an unreadable photo
   (item 1): export it to JPEG and run again.

**The pose check** (`src/lib/learning/posecheck.ts`) says whether a photo's 21
image-space landmarks look like G02 or G04. It uses one ratio and no absolute
pixel: the mean over the index, middle, ring and little finger of
|fingertip − MCP| ÷ |wrist − middle MCP|, the "reach". A flat hand shows its
fingers at nearly full length; a claw, seen from above, foreshortens them.
Spread fingers are not used: a flat hand with the fingers together reads as G02.

| Threshold (`POSE_CHECK_THRESHOLDS`) | Candidate value | Meaning                                       |
| ----------------------------------- | --------------- | --------------------------------------------- |
| `flatReachMin`                      | 0.62            | Reach at or above: G02                        |
| `clawReachMax`                      | 0.50            | Reach at or below: G04                        |
| `maxPlausibleReach`                 | 1.5             | Above this the points are not a hand: abstain |

Between the two, with no hand, with fewer or more than 21 landmarks, or with a
point that is not a finite number, it abstains. **These numbers are candidates
(未拍板)**, set from the proportions of an adult hand and not from any photo:
S0 (P901 to P912) will check them against real G02 and G04 photos before a run
is trusted. They live in one place, so S0 changes one constant.

**Statuses** in `sort.photos[]`:

| `status`           | Meaning                                                           | Filed |
| ------------------ | ----------------------------------------------------------------- | ----- |
| `ok`               | Placed by order; nothing to flag                                  | yes   |
| `pose-mismatch`    | Placed by order; the pose check says the other pose               | yes   |
| `hand-mismatch`    | Placed by order; MediaPipe's hand differs from `participant.json` | yes   |
| `needs-review`     | The participant's photos cannot be placed without guessing        | no    |
| `not-a-jpeg`       | Placed by order, but its copy cannot be made: not a JPEG          | no    |
| `damaged-jpeg`     | Placed by order, but its copy cannot be made: damaged JPEG        | no    |
| `copy-failed`      | Placed by order, but the stripped copy failed its own check       | no    |
| `no-code`          | No readable participant card (a pose page's code is not one)      | no    |
| `version-mismatch` | A code of another kit version (a kit v1 card or page)             | no    |

When a photo is both `pose-mismatch` and `hand-mismatch`, `pose-mismatch` is
the status.

### What is filed, and what the copies lose

```
<out>/P007/G02/1.jpg … 3.jpg      the extra shot continues the numbering (4.jpg)
<out>/P007/G04/1.jpg … 2.jpg
<out>/P007/participant.json       template; never overwritten
<out>/runs/<time>.json            the run log, format 3
<folder of session.json>/labels.json   blank labels; never overwritten
```

No `truth.json` is written. The copies are named by pose and shot, so the
camera's file name (which can hold the time of the shot) is not in the folder;
it stays in the run log's `file`.

**EXIF stripping.** Each filed copy is the original's bytes with the metadata
removed (`src/lib/learning/exifstrip.ts`, a pure byte-level function). The
original in the input folder is only read, never touched. Per segment:

| Dropped                                                                          | Kept, byte for byte                                         |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| APP1 (Exif with its GPS, time, make, model, serial; XMP), APP13 (IPTC), comments | APP0 only as a plain 18-byte JFIF header (no thumbnail)     |
| JFXX and any JFIF with an embedded thumbnail                                     | APP2 only when it begins `ICC_PROFILE\0`                    |
| Every other APPn (maker notes, multi-picture index), every JPGn (0xF0 to 0xFD)   | APP14 only as the 12-byte Adobe header                      |
| Any other APP2 or APP14, and reserved markers                                    | The tables, frame header and every scan: the picture itself |
| Anything after the end-of-image marker (a gain map, a motion-photo video)        |                                                             |

**Orientation: rebuilt minimal EXIF.** A phone often stores a portrait photo
sideways with an Orientation tag that turns it upright, and the checker decodes
it upright, so every pixel coordinate in the run log is in the upright frame. A
copy must decode upright too. So the copy gets a rebuilt 36-byte EXIF that holds
**only the Orientation tag**, where the original's Exif block was (no GPS, time,
device or anything else). The mode is `orientation-only` (`EXIF_STRIP_MODE`); the
sorter prints it. A real browser decodes an original and its stripped copy to the
same size and the same plane, and a copy with Orientation dropped lies on its
side (`tests/e2e/learning-kit-v2.spec.ts`).

The **EXIF white-list** (focal length, pixel dimensions) in the run log comes from
the checker's analysis of the ORIGINAL file (the reports are made before anything
is filed); the copy has none. `prepareFiledCopy` also reads it from the original
before stripping, to hand it back with the copy. A copy is checked by content
before it is written (`problemsInFiledCopy`: each kept header segment must be
exactly a plain JFIF header, an ICC profile or an Adobe header, and any Exif must
be byte for byte the minimal Orientation-only one), and a file that is not a
complete JPEG (a PNG, a HEIC, a damaged file) is **not copied at all**: it is
listed as above.

### Run log, format 3

Format 3 is format 2 (below) plus three top-level fields, which are `null` in a
kit v1 log:

| Field      | Meaning                                                                                                                             |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `protocol` | `agreed-v2` for a kit v2 run; `null` for kit v1 (its values are `candidate-v1`, never mixed with these)                             |
| `session`  | The whole `session.json` record, read by the sorter. `null` in a kit v1 log and in a download from the checker page, which has none |
| `sheet`    | `A` (or `B`, not used for now), the sheet the photos were taken on; `null` for kit v1                                               |

Other fields, in a kit v2 log: `kitVersion` is 2 (each report's too, and each
`code.version`); `paperSize` is the session's. A report has a participant
`code` and, like any hand photo, a `hand`, planes and measurements: the card's
code does not make it a card. Its `checks` are the kit v2 ones: the participant
card was read; sheet A's four markers (B: any four of six); the fit; the paper
corners; sharpness; a hand. A photo with no hand still has a verdict (`retake`),
but it is filed.

`sort.photos[]`, one entry per photo in capture order:

| Field         | Meaning                                                                                                                                                                             |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `file`        | The input file's name                                                                                                                                                               |
| `status`      | As the table above                                                                                                                                                                  |
| `participant` | `P###` from the card; `null` for `no-code` and `version-mismatch`                                                                                                                   |
| `gesture`     | `G02` or `G04`, from the order; `null` for needs-review, no card and another kit version (a photo placed but not filed keeps it)                                                    |
| `hand`        | `participant.json`'s `mouseHand` (`left`, `right`); `null` until it is filled in                                                                                                    |
| `shot`        | 1-based position within the pose, the extra shot included                                                                                                                           |
| `destination` | `P007/G02/1.jpg`, relative to the output folder; `null` when not filed (needs-review, no card, another kit version, or a copy that cannot be made)                                  |
| `poseSource`  | Always `order`: the pose never comes from a QR code in kit v2                                                                                                                       |
| `extraShot`   | `true` for the one photo beyond the planned shots (the last of its pose)                                                                                                            |
| `poseCheck`   | `{ predicted, agrees }`: the pose check's call (`G02`, `G04` or `null`) and whether it agrees with the order (`null` when it abstained or there was no hand). `null` when not filed |

`sort.coverage[]`: `participant`, `gesture`, `hand`, `expected` (3 or 2), `got`
(filed under the pose, the extra included) and `extra` (how many of them are the
extra shot); none for a participant in review. `sort.participants[]`:
`participant`, `photos`, `status` (`ok` or `needs-review`), `reason`
(`photo-count-not-planned`, `shot-counts-do-not-match`, `unreadable-photo-in-run`
or `null`), `hand`, `unfiled` (photos placed but not filed because their copy
cannot be made), and `predictedPoses` (the pose check's call on each of their
photos in order, for a person looking at a review case).

**The run log holds the product's verdict for every photo** (`verdict`,
`productGates`, the millimetre values). Do not open it before the labels are done.

### Labels, made blind (`labels.json`)

Judgement correctness (prereg v2, 2.1) is how often the product's accept or
retake agrees with Kirby's own call, so the call must be made **without seeing
the product's**. After a session the sorter writes `labels.json` **next to
`session.json`**: one blank entry per filed photo, in shooting order, holding
nothing but the photos' relative names (`P007/G02/1.jpg`) and empty fields: no
verdict and no millimetre value. It is never written where the run logs are, and
never overwritten. If one is already there, the sorter says which filed photos it
has no entry for (for example a participant reviewed by hand and filed later).

| Field                 | Meaning                                                                                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `format`              | `open-mouse-learning-labels/1`                                                                                                                                     |
| `session`, `protocol` | The session and `agreed-v2`                                                                                                                                        |
| `blind`               | `true` for a template; set it to `false` yourself if you looked at the product's verdict first: such a session is reported apart                                   |
| `labels[].file`       | The filed photo's `destination`, verbatim; a photo that is not filed is not listed, and a file may appear once                                                     |
| `labels[].label`      | `good` or `bad` (`null` until you decide)                                                                                                                          |
| `labels[].reasons`    | A bad photo needs at least one, a good one has none: from `hand-off-sheet`, `corner-hidden`, `blur`, `wrong-pose`, `fingers-not-per-protocol`, `lighting`, `other` |
| `labels[].note`       | Required when the reason `other` is used; empty otherwise                                                                                                          |

**How to fill it in.** Open the photos (the copies under the output folder, not
the checker) and, for each, ask: _would I measure from this photo?_ **Good** means
yes. A **bad** photo takes one or more reasons from the list, which describe the
photo and never the person (no health or injury reason); the reason `other` needs
a note saying what. Do it **before** you open the run log or `/learn/check`: both
show the product's verdict, and the checker page says so when a kit is chosen.
After you finish, do not change a label; a mistake found later is disclosed in
the report. The sorter's own summary shows counts and file names only, so you
can read it first: no verdict, no pose-check call, no MediaPipe hand flag, no
millimetre value. Those are in the run log; `--show-checks` prints the pose-check
disagreements and hand flags too, after a line saying to label first. `labelsRecordSchema` in
`src/lib/learning/session.ts` rejects a good photo with reasons, a bad one with
none, an `other` without a note, a file listed twice, and a file that is not a
relative `/`-separated path.

### Checking photos on the page

`/learn/check` has a **Kit** selector. It starts on sheet A (`?sheet=v1` selects the earlier
kit's pose pages, `?sheet=B` the unused sheet B; the
sorter opens it with `?sheet=A`). With a sheet chosen the page analyses the photos as kit v2 and
files them by participant and order, lists any participant in review, and its
download is a format 3 log with `session: null`. Its per-photo verdicts are the
product's: see the labelling rule above.

### Not settled (candidates, 未拍板)

- The pose-check thresholds (above): S0 will check them.
- The extra-shot convention (the last photo of the pose that has one more than
  planned is the extra).
- "Capture order" is camera file-name order, as in kit v1, because the EXIF time
  is deliberately not read. Two phones in one folder, or a numbering that restarts,
  break it: the sorter warns when the file times disagree.
- Only complete JPEGs are filed: a HEIC export must be converted to JPEG first
  (the checker already says so).
- Kit v1 photos can no longer be filed by `learn:sort`, which is kit v2 only. Kit
  v1's `sortPhotos` and `sortReports` are unchanged; the checker's Kit selector
  still checks v1 photos.

## Why this design (kit v1)

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
- **Easy to identify.** Each QR code holds a name in the form of a URL
  (`https://open-mouse.vercel.app/l/v1/G03R`). The checker and the sorter read
  that text from the photo. The URL is a name, not a link (see "Where the
  pages live").
- **Easy to test.** `/learn/check` reads photos on the device and says, per
  photo, what to retake and why. `npm run learn:sort` does the same for a
  whole folder and files the photos.
- **Nothing to re-derive later.** Each photo's record (the run log, format 2,
  below) holds the homographies, the landmarks in sheet millimetres and the
  parallax settings, so the mm values can be worked out again from the record
  alone, without the photo.

## Where the pages live

Kirby's decision, 2026-09-30: the learning data is collected by hand, on his own
machine, and **the production site does not serve the kit**. `/learn`,
`/learn/print`, `/learn/slates`, `/learn/check` and every `/l/v1/...` page
answer 404 in production (each page calls `guardDemoRouteFromProduction()`
first, like the demo pages). They are served by a local dev server, which is
also what `npm run learn:sort` starts, and by Vercel previews.

- **The QR codes encode the production address**, for example
  `https://open-mouse.vercel.app/l/v1/G03R` (`LEARNING_QR_BASE_URL` in
  `src/lib/learning/kit.ts`). **Scanning a printed code with a phone opens the
  production site and shows a 404. That is expected.** The checker only reads
  the code's text out of the photo and never goes online, so the pose, hand and
  participant are identified all the same.
- **Print from the local server.** Run `npm run dev`, then open
  `http://localhost:3000/learn/print?hands=both` and
  `http://localhost:3000/learn/slates`.
- **The check page is local too.** Open `http://localhost:3000/learn/check` on
  the computer that has the photos.
- `/l/v1/[token]` (the page a code names) exists on the local server and on
  previews only; no participant reaches it by scanning.

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

## A session (kit v1)

_Kit v1 only. `npm run learn:sort` is kit v2 only since 2026-10-02: it no longer files kit v1 photos (see
"Kit v2"). The steps below are how kit v1 sessions ran, and `/learn/check` with the Kit selector on "Kit v1"
still checks v1 photos._

1. **Print once**, from the local dev server (`npm run dev`):
   - `http://localhost:3000/learn/print?hands=both`: 14 A4 pages at 100%. Check
     the 100 mm line with a ruler.
   - `http://localhost:3000/learn/slates`: participant cards, 8 per page.

   Pages are reusable across people.

2. **Per person:**
   1. Ask their consent.
   2. Measure both hands with a ruler, following the **ruler protocol**
      below (a candidate). Write the four values on their card, in the Right
      and Left columns, never their name.
   3. Photograph the card.
3. Work through G01 to G07 with the right hand, then G01 to G07 with the
   left, following the instructions on each printed page. Lift the hand and
   place it again between every photo.
4. Before the person leaves, open `http://localhost:3000/learn/check` on the
   computer, choose the session's photos, and retake anything marked
   **Retake**.
5. At the computer, run (kit v1; the command now needs `--session` and files kit v2)
   `npm run learn:sort -- --in "<folder of photos>"`. It copied (never moves
   or overwrites) photos to `../Fixtures/learning/<participant>/<pose>/<n>.jpg`,
   wrote a `truth.json` template per person, and saved the run log to
   `runs/<time>.json`. Copy the ruler values from each `slate.jpg` into
   `truth.json`, right hand and left hand apart.

   The sorter starts its own dev server on `--port` (default 3401) and always
   stops it again, also on Ctrl+C. It refuses to start if anything already
   listens on that port (a stale server would make the recorded git commit
   wrong), and stops with the server's own last words if the server dies while
   starting. To use a server you started yourself, pass `--base <url>`.

Keep the camera's file names: natural file-name order is capture order.

**Pages printed on US Letter (kit v1 only).** The kit is designed for A4. Kit v2 is A4
only: `learn:sort` takes no Letter and refuses a Letter session. For kit v1, on
Letter paper, `--paper letter` was passed to `learn:sort` (the checker page has a
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

Kit v1: `npm run learn:sort` wrote `../Fixtures/learning/<participant>/truth.json`
once, and never overwrote it. Kit v2 has no ruler truth and writes none. The two hands are apart because hands differ, and
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

## Run log, formats 2 and 3

Format 3 (2026-10-02) is format 2 plus `protocol`, `session` and `sheet` (see "Kit v2"); kit v1 logs written before
that date are format 2. Everything below holds for both.

`runs/<time>.json` from `learn:sort`. The checker page's **Download results**
button gives the same file without the folder name and the git commit, which a
page cannot know.

Format 2 was completed before any real session was recorded (2026-09-30: the
paper detector's values and the product's gate verdicts were added, and
`qrText` was narrowed to kit codes). No data exists in an earlier shape, so the
format name did not change.

| Field                | Meaning                                                                                                                           |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `format`             | `open-mouse-learning-run/3` (`/2` before 2026-10-02)                                                                              |
| `createdAt`          | When the run happened (not when a photo was taken)                                                                                |
| `kitVersion`         | 1 (kit v1) or 2 (kit v2): the kit the run was made as                                                                             |
| `gitSha`, `gitDirty` | The commit of the checkout that served the checker, and whether it had uncommitted changes. `null` with `--base` (unknown server) |
| `paperSize`          | `a4` or `letter`: the sheet the pages are printed on (kit v2: always `a4`, from the session; kit v1 logs: from `--paper`)         |
| `input`              | The photo folder, relative to where the command ran, with `/` separators (see Privacy)                                            |
| `sort`               | The sorter's result: where each photo was filed, and coverage (kit v2: see "Kit v2")                                              |
| `reports[]`          | One record per photo, below                                                                                                       |

Each entry of `reports[]` repeats `kitVersion`, `gitSha` and `gitDirty`, so a
single record can be lifted out and still say which code made it.

| Field                              | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `file`                             | The file's own name, never a path                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `width`, `height`                  | The decoded frame (oriented, downscaled). Every px value in the record is in this frame                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `paperSize`                        | As above, per photo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `exif`                             | `focalLengthMm`, `focalLengthIn35mmFilm`, `pixelXDimension`, `pixelYDimension`; `null` where missing. Nothing else (see EXIF white-list)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `qrText`, `code`                   | The kit QR code as read, and what it means (`code.version` is the printed page's kit version). `qrText` is kept **only when it parsed as a kit code**; any other QR code in the photo (a shop link, a Wi-Fi code) is ignored and never recorded, and the reader keeps looking for the kit code                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `markers[]`                        | ArUco markers found: `id` and four corners in px                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `reprojectionErrorMm`              | How well the four flat markers fit one plane                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `paperCorners`, `paperCornersSeen` | The sheet's corners in px (TL, TR, BR, BL), and how many were seen                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `paperEdge`                        | What the paper detector saw, kept even when it found fewer than four corners: `regionFound`, `minSideCoverage` (smallest fraction of any side seen, 0 to 1), `edgeFitResidualPx`, `worstSideIndex`, `cornersFound` (four booleans). `null` on cards and side pages, where paper detection does not run                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `productGates`                     | Would the product's blank-paper flow take this photo, and if not why: `paper` (found, four corners, edge coverage, not curled: `checkPaperEdgeGatesOnly`), `hand` (detected, label agrees with the page, confident, inside the sheet, sharp: `runPaperEdgeHandGates`; `null` when there is no paper homography, because the product would have stopped at the paper, and also `null` when `runPaperEdgeHandGates` itself threw; the record does not say which), and `accepted`. Each group is `{ ok, errorCodes, warningCodes }` with the product's `GateFailureCode`s. Worked out with the product's own functions from values recorded next to it, so it can be re-derived from the record. `null` where `paperEdge` is |
| `laplacianVariance`                | Sharpness                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `hand`                             | `landmarksPx` (21 points), `handedness` (`left`, `right` or `null`: the hand in the photo), `confidence`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `markerPlane`, `paperPlane`        | The two calibration planes, below                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `markerMm`, `paperMm`              | The hand measurements through each plane, **parallax-corrected exactly as the product's blank-paper path does it**. `null` if there is no hand, or a value fell outside the contract's ranges (a folded grip can)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `checks[]`, `verdict`              | What the checker told the operator                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `error`, `errorKind`               | Only on a photo that could not be analysed: a fixed sentence, and the error's class name (`TypeError`, ...). Never the error's message, which can quote a path or pixel values. The other photos in the batch are analysed as usual                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

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

## Evaluation (`npm run m2:evaluate`)

The M2 gate tool. It judges a measurement model from the v2 run logs and the
`truth.json` files alone, and never opens a photo. It is not machine learning:
it recomputes, compares and counts.

```
npm run m2:evaluate -- \
  --log ../Fixtures/learning/runs \
  --truth ../Fixtures/learning \
  --out ../Fixtures/evaluations/baseline.json
```

| Option                   | Meaning                                                                                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--log <file or folder>` | A run log, or a folder of `*.json` run logs. Repeat freely                                                                                                    |
| `--truth <file or dir>`  | A `truth.json`, or a folder that holds `<participant>/truth.json`                                                                                             |
| `--path`                 | `markers`, `paper-edge` or `both` (default): which calibration plane to judge                                                                                 |
| `--gesture G01[,G02]`    | Poses to judge. Default `G01`, the pose the M2 gate is defined on (grips fold the fingers, so their hand length is not a ruler hand length)                   |
| `--participants P1,P2`   | Only these participants: a cross-validation fold, or the held-out set                                                                                         |
| `--thresholds <file>`    | JSON limits, for example `{"accuracyMm":{"handLengthMm":2}}`. Checked strictly: an unknown key or measurement name is an error. Default: the candidates below |
| `--out <file>`           | Write the JSON report here. Never overwritten, never inside the repo or any git worktree (the same rule as `learn:sort`). Summary goes to stdout              |

It never runs in CI. The code is `src/lib/m2/` (pure) and `scripts/m2-evaluate.ts`.

**The command line is checked strictly** (`src/lib/m2/cli.ts`). A misspelt or
unknown flag (`--participant`), a flag with no value, an empty value, a
single-value flag given twice, and a list with an empty or malformed entry
(`--participants P001,,P002`, `P01`, `p001`; `--gesture G99`) are errors: the
message names the flag, the usage follows, the exit code is 1 and nothing is
evaluated. `--participants` never falls back to "everyone" because it was
mistyped. Only `--log` and `--truth` may be repeated. If a participant you asked
for has no measured photo, stderr says so, and the run goes on.

**What is printed.** The Markdown summary goes to stdout. On stderr, a failure is
its message only, never a stack, with the paths given on the command line shown
relative to where the command ran and the account name as `~`. That holds for
file system errors too (an unreadable folder, a report that cannot be written).
After a report is written stderr says only `JSON report written.`, not the file
name, which is yours and can say who or when. Exit codes: 0 done; 1 refused,
bad input or failure; 2 nothing could be evaluated, and the message says why
(no reports, everything of another pose or participant, or which reasons kept
the photos from being measured).

An unknown option is echoed by name only when it is a plain option name
(`--partcipants`); anything else, such as a path with two dashes in front of it,
is reported as "an unrecognised option". A real option written with `=`
(`--participants=P001`) is answered by its name: "takes its value after a
space, not after `=`". Any other absolute path a tool prints is shown as
`<path>`, and stack frames are left out, exactly as in `learn:sort` (same
filter, `src/lib/m2/terminal.ts`). `--log`, `--truth`, `--thresholds` and
`--out` given in Git Bash, Cygwin or WSL spelling (`/c/Users/me/...`,
`/cygdrive/c/...`, `/mnt/c/...`) are refused on Windows (Node would read them
as a folder tree on the current drive, and `--out` would create it): use
`C:\Users\me\...`.

**Not covered: npm's own lines.** Run as `npm run m2:evaluate -- ...`, npm itself
prints the whole command line, your paths included, to stderr (`npm notice run
tsx scripts/m2-evaluate.ts --log C:\Users\...`) before the script starts. That is
npm's output, outside the script's control. `npm run --silent m2:evaluate -- ...`
hides it; use that when the output is going to be pasted somewhere.

### What it does

1. **Pairs** each report with its place in the session (participant, pose, hand,
   shot) through the run log's own `sort`. Participant cards are not counted.
2. **Recomputes** the millimetre values with `recomputePlane`, from the recorded
   landmarks, homography and parallax settings only. The recorded `markerMm` and
   `paperMm` are not read, so a log stays evaluable after the product's
   constants change, and a model correction can be applied on top.
3. **Asks the recorded `productGates`** whether the blank-paper flow would take
   the photo, and reports two groups side by side: the photos the product
   accepts, and all measured photos. Every photo the product refuses is listed
   with its reason codes (`paper:PAPER_CORNER_HIDDEN`, `hand:HANDEDNESS_MISMATCH`, ...).
   A photo the kit's own checker said to **retake** is measured too when its
   record still has the page's code and the planes: it stays in "all measured
   photos" (its value is a real measurement of the page's hand), never enters
   "accepted", and is listed as `KIT_RETAKE:<check id>` for each check that
   failed. (`learn:sort` does not file it, so the sort has no place for it; the
   page's code in the record supplies the pose and hand.)
4. **Compares** each measurement with the ruler value of the **same hand of the
   same participant**. The page's hand decides which one, so a left-hand photo is
   never compared with the right-hand value, even if the hand detector
   disagreed with the page. Such a photo (`hand-mismatch` in the sort) is
   filed and evaluated like any other.
5. **Counts** accuracy and repeatability per path.

A photo that cannot be measured or compared is listed under `excluded` with a
reason and a stage; nothing is ever counted as zero:

| Stage         | Reasons                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `measurement` | `NOT_FILED:<status>` (no readable code, no card before it, another kit version), `NOT_IN_SORT`, `AMBIGUOUS_FILE_NAME`, `DUPLICATE_DESTINATION` (`learn:sort` never overwrites, so the first copy counts), `NO_HAND`, `NO_PLANE`, `RECOMPUTE_FAILED`, `NO_MEASUREMENT` (a folded grip can fall outside the contract's ranges), `CALIBRATION_INVALID` (a correction returned a missing or non-finite value, or threw) |
| `kit`         | `KIT_RETAKE:<check id>`: measured, but the kit's checker said to retake it, so it is out of "accepted" and stays in "all"                                                                                                                                                                                                                                                                                           |
| `truth`       | `NO_TRUTH_FILE`, `NO_TRUTH_VALUE:<hand>`. The photo still counts for repeatability, which needs no ruler value                                                                                                                                                                                                                                                                                                      |
| `product`     | The product's gate codes, `NO_PRODUCT_GATES` when the record has none                                                                                                                                                                                                                                                                                                                                               |

### Statistics (candidate definitions, 待 W7 前置協議拍板)

With `e = measured - ruler value` for one photo:

| Statistic               | Definition                                                                                                                                                                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| n                       | Photos compared with a ruler value                                                                                                                                                                                                                                 |
| bias                    | mean(e)                                                                                                                                                                                                                                                            |
| MAE                     | mean(\|e\|)                                                                                                                                                                                                                                                        |
| largest \|error\|       | max(\|e\|)                                                                                                                                                                                                                                                         |
| SD                      | sample SD of e, divided by (n - 1); none for n < 2                                                                                                                                                                                                                 |
| 95% limits of agreement | Bland-Altman: bias +/- 1.96 x SD; none for n < 2                                                                                                                                                                                                                   |
| repeatability           | One row per participant, hand and pose with at least two photos: range = max - min, SD (n - 1), largest deviation from the group mean. Summary over the rows: mean and worst range, mean and pooled SD (sqrt of the (n-1)-weighted mean variance), worst deviation |

Each is computed once per path and per measurement: `handLengthMm` and
`palmWidthMm` (the values a `truth.json` holds).

### Limits are candidates, and no reading is chosen

`docs/PLAN.md` says "accuracy <= +/-2 mm on hand length vs. ruler" and
"repeatability <= +/-1.5 mm across 5 photos", but not which statistic decides
it. That is **未拍板 (candidate)** until the W7 pre-agreement. The evaluator
reads the limits from configuration (defaults: hand length 2 mm and 1.5 mm) and
reports **every reading**, so the agreement can pick one without a re-run:

- accuracy: MAE within the limit; largest |error| within the limit; 95% limits of agreement within +/- the limit;
- repeatability, for the worst group: range within the limit; half-range (range / 2) within the limit, i.e. +/- the limit; deviation from the group mean within the limit.

The three readings can disagree, and the report does not say which one is the verdict.
In the summary a value is shown with two decimals, except where that would make
it look equal to its limit while the verdict says otherwise (the verdict uses
the unrounded value): then it gets as many decimals as it takes to tell them
apart, for example `2.004 mm against 2.00 mm: OUTSIDE`.

### The report

A JSON report (`open-mouse-m2-evaluation/1`) and a Markdown summary. They hold
totals, the anonymous participant codes (`P007`), and photo ids like
`P007/G01R/3` (participant, pose and hand as printed, shot). They hold **no file
name, folder, account name, EXIF or landmark**; a test searches both for them.
The model judged is named (`landmark-raw-v1` for the baseline); a correction
such as the frozen `calibrated-v1` plugs in as `calibration` in
`EvaluateOptions` and is applied after the recompute, so both models are judged
by the same code.

### Held-out participants are evaluated once

The plan is to tune on some participants, freeze the model as `calibrated-v1`,
and evaluate the held-out participants **once**. So:

- **Claude runs the held-out evaluation, once, on the frozen model.** It is not in a workflow, and not re-run after looking at the result (a second look would make the held-out set a tuning set).
- Cross-validation folds use `--participants`; the held-out set is the participants no fold ever contained.
- `--out` refuses to overwrite, so a report cannot be quietly replaced.

`scripts/m2-gate-replay.ts` (the old replay through `/scan`) is gone: it failed
on blank-paper photos and had no parallax correction. This tool replaces it.

## Privacy and rules

- **Photos never leave the device** (hard rule 5). The checker decodes,
  detects and measures in the browser. The e2e tests assert that no
  non-GET request is sent while it runs (the page and its scripts are GETs;
  nothing is POSTed, PUT or otherwise sent).
- **Photos, `participant.json` and (kit v1) `truth.json` stay outside the repo** (`../Fixtures/learning/`,
  next to the main checkout). The sorter refuses an output folder inside the
  repo, inside the main checkout, or inside **any other git worktree** (it asks
  `git worktree list`), also through a symlink or junction, and refuses to run
  in CI. `.gitignore` also ignores `Fixtures/learning/` wherever it lands, as a
  second line of defence. Tests run the real script to check the refusals.
- **The run log holds no account name.** `input` is the photo folder relative
  to where the command ran; on another drive only the folder's own name is
  kept. Any path segment that contains the account name, in any letter case
  (`Kirby Photos`, `kirby-DCIM`, `C--Users-kirby-Desktop-...`), and the segment
  after `Users` or `home`, is replaced by `~`. (An account name shorter than
  three characters is only matched as a whole segment, since it would match
  half of every path.) Photo `file` values are file names, not paths.
- **The terminal holds no absolute path, stack or account name.** Everything
  `learn:sort` prints goes through one filter (`src/lib/learning/terminal.ts`):
  - A failure is its **message only**, never the stack. That covers a folder
    that cannot be listed or read, as well as errors from the dev server, from
    Playwright and from anything that escapes uncaught (the last line of
    defence is a filter too).
  - Folders the sorter knows are shown short: the working folder and the
    sorter's own checkout as `.`, other checkouts as `<checkout>`, the photo
    and output folders relative to where the command ran, and any path segment
    holding the account name as `~`.
  - **Any other absolute path**, which comes from tools that name their own
    folders (for example Playwright's "Executable doesn't exist at ..."),
    becomes `<path>`: a drive path (`C:\...`), a UNC path (`\\server\share\...`),
    a `file://` URL, and a POSIX path of two or more segments whatever its
    first folder is (`/home/...`, `/data/...`, `/workspace/...`). A POSIX path
    is recognised after the start of the text, white space, a quote, a
    backtick, `(`, `[`, `{`, `<`, `,`, `;`, `:` or `=`; it is not one after a
    letter, digit, `.`, `~`, `/`, `-`, `>` or a closing bracket, so URLs
    (`http://127.0.0.1:3401/learn/check`), relative paths (`../x/y`,
    `~/x/y`, `<path>/x`), fractions (`3/4`) and dates (`2026/09/30`) stay.
    A route in prose (`open /learn/print`) looks like a path and is hidden.
    A path under a system root (`/home`, `/Users`, `/tmp`, `/Applications`,
    `/Library`, ...) and a Windows or UNC path run to the next quote or line
    end and may contain spaces, so words after such a path on the same line go
    with it: better to hide too much than to leave a folder name. Other POSIX
    paths end at white space.
  - In the dev server's last words, stack frames (`    at f (file:1:1)`) are
    replaced by one `(stack frames omitted)` line.
  - The account name is masked wherever else it appears in text, in any letter
    case (names of one or two characters are not, as they would match half of
    every message).
  - **Not covered: npm's own lines.** Run as `npm run learn:sort -- ...`, npm
    itself prints the whole command line, your paths included, to stderr
    (`npm notice run tsx scripts/learn-sort.ts --in C:\Users\...`) before the
    script starts. That is npm's output, outside the script's control. `npm run
--silent learn:sort -- ...` hides it (checked); use that when the output is
    going to be pasted somewhere.
  - `--in`, `--out` and `--session` given in Git Bash, Cygwin or WSL spelling
    (`/c/Users/me/...`, `/cygdrive/c/...`, `/mnt/c/...`) are refused on
    Windows: Node would read that as a folder tree on the current drive and
    create it. Use the Windows form (`C:\Users\me\...`).
- **Only white-listed EXIF in the run log** (above): no GPS, time or device
  serial number. Two things it does not cover:
  - **File names.** Phone cameras often put the time of the shot in the file
    name (`IMG_20260930_101530.jpg`). `file` in the run log, and the file
    names of the copies `learn:sort` files, keep it.
  - **The filed photos themselves.** Kit v1's `learn:sort` copied each original
    unchanged, so kit v1 copies under `Fixtures/learning/` still carry their full
    EXIF: GPS position, time, the device's serial number. Think before sharing,
    zipping or uploading them. Kit v2's copies are EXIF-stripped (see "Kit v2"):
    only Orientation stays. They are named `P###/G0x/n.jpg`, so the camera's file
    name (which can hold the time of the shot) is not in the folder, and kit v2 has
    no `truth.json`.
- **Participant numbers, never names.**
- **No medical claims.** G06 and G07 collect posture data for research into
  mouse fit and hand and wrist angles. The pages say so, and nothing
  diagnoses or advises.

## Changing the kit

A printed QR code is permanent. To change a pose, its page or the code
format, raise `LEARNING_KIT_VERSION` (2 since kit v2; `KIT_V1_VERSION` is the
first kit's). Keep `/l/v1/[token]` answering (locally) for pages already printed.
Kit v2 has no `/l/v2/...` page: its cards are read from the photo, not opened.
The sorter files only the current version, so mixed-version photos are reported
(`version-mismatch`) rather than mixed.

The participant card's layout changed on 2026-09-30: it now has a Right and a
Left column for the ruler values. Its QR code did not change, so a card printed
before that still identifies its participant, but it has one set of fields.
Reprint the cards before a session so each hand gets its own values.

## M2 evaluator for kit v2

`npm run m2:evaluate` judges kit v2 runs (protocol `agreed-v2`, frozen prereg
version 2, 2026-10-02) as well as kit v1 runs. The two are told apart by the
run logs and are **never mixed**. This section is the agreed-v2 side; the
"Evaluation" section above stays true for candidate-v1.

| Run logs                                             | Protocol       | Needs                                            | Reference                                    |
| ---------------------------------------------------- | -------------- | ------------------------------------------------ | -------------------------------------------- |
| format 2, or format 3 with `protocol: null` (kit v1) | `candidate-v1` | `--truth` (ruler `truth.json`)                   | the ruler                                    |
| format 3 with `protocol: "agreed-v2"` (kit v2)       | `agreed-v2`    | nothing; `--records` and `--labels` add the rest | the marker plane of the same sheet, no ruler |

```
npm run m2:evaluate -- \
  --log ../Fixtures/learning-v2/runs \
  --records ../Fixtures/learning-v2 \
  --labels ../Fixtures/learning-v2/S001 \
  --out ../Fixtures/evaluations/v2-calibration.json
```

| Option             | Meaning                                                                                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--protocol`       | `agreed-v2` or `candidate-v1`: the protocol the run logs must be of. Default: theirs. A mismatch is an error                                                                         |
| `--records <path>` | A `participant.json`, or a folder holding `participant.json` or `<P###>/participant.json`: the grip a person reports and the hand they use. Repeat freely                            |
| `--session <path>` | A `session.json` (or a folder holding one). Only a fallback: the sorter embeds the whole session record in its run log, which is where the phone comes from. Repeat freely           |
| `--labels <path>`  | A `labels.json` (or a folder holding `labels.json` or `<session>/labels.json`): the blind good/bad calls. Repeat freely. Without it the headline is not computed, and nothing errors |
| `--gesture`        | The poses of the field-by-field tables. Default **G02** (candidate-v1: G01). The per-person statistics always use G02 and G04                                                        |
| `--held-out`       | Only the held-out participants. **Meant to be run once, by Claude, after the model is frozen**; the run prints a loud notice, on stderr and at the top of the summary                |
| `--s0`             | Only the S0 pilot (P901-P912)                                                                                                                                                        |
| `--aggregate-only` | Drop every per-person and per-photo row from the JSON and the summary, for text pasted into a pull request                                                                           |
| `--participants`   | Narrows the chosen set (a fold). Not with `--held-out`                                                                                                                               |

`--truth` is refused with agreed-v2 logs (a candidate-v1 truth file is the
forbidden mix; any other is simply not read), `--thresholds` too (the criteria
are frozen in the prereg), and `--held-out`, `--s0`, `--records`, `--session` and
`--labels` are refused with candidate-v1.

### Who is evaluated

By the prereg's held-out rule (`src/lib/m2/heldout.ts`): participants come in
blocks of four (P001-P004, P005-P008, ...); in each **complete** block the
participant whose lowercase hex SHA-256 of `bec9449f79d85ac5:<P###>` is smallest
is held out. A test reproduces the 50 ids the prereg lists for P001-P200.

- **Default:** the calibration set. Held-out and S0 participants are left out, and
  so are participants in a block that is not complete yet (their block could still
  turn out to give them the smallest hash). The summary and stderr say how many were left out and why.
- `--held-out`: only the held-out set. `--s0`: only the S0 pilot.
- A block is complete when all four ids appear in the inputs (a run log's sort, or a participant record).

### What is reported (all report-only except the target)

| Statistic                  | Definition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Judgement correctness**  | The headline. For each labelled photo, the product's accept/retake verdict against the label (good/bad). **The verdict is the product's photo-quality gates (the recorded paper and hand gates) with the handedness gate left out**: a kit v2 report computes it with no stated hand, because the mouse hand comes from `participant.json` only after the browser analysis. Agreement rate, false accepts and false rejects (counts, share of all labelled, share of bad or good), by pose, and by reason. **Target 95 %, shown as a target and never as pass or fail.** Unlabelled photos are left out and counted. Labels from sessions with `blind: false` are reported apart and are not in the headline |
| G02 retake repeatability   | Pooled within-person SD of hand length on the marker path: `sqrt(sum((n-1) SD^2) / sum(n-1))` over people with 2+ G02 photos, with the people and photos behind it. 1.0 mm is shown as a **reference value**, not a verdict (prereg v2)                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Path agreement             | Paper-edge minus marker hand length per G02 photo, averaged **within each person first**, then bias and SD across people. The photo-level numbers are shown too, labelled photo-level                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Curl ratio                 | A G04 photo's wrist-to-middle-fingertip length on the marker plane (from the recomputed sheet-mm landmarks, so it exists even when a claw's measurements fall outside the contract's ranges) divided by the same person's mean G02 hand length. Per-person mean, retake SD, overall distribution                                                                                                                                                                                                                                                                                                                                                                                                             |
| Product-gate acceptance    | Accepted / all, per pose, by the recorded gates as they are. Also the hand-detection rate and how often MediaPipe's hand label agrees with the participant record (the S0 checks): **hand-label agreement is reported on its own and is not part of judgement correctness**                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Coverage                   | People by 10 mm bin of their mean G02 hand length; people and photos by phone, light, sheet and mouse hand. Phone and light are shown as the session wrote them only when they are short plain words (Latin letters, digits, a little punctuation, at most 60 characters); anything else, or anything shaped like a participant code or a path, is counted as `(other)`                                                                                                                                                                                                                                                                                                                                      |
| Grip-threshold calibration | Each person's r = palm length / hand length (mean over G02, marker plane; the landmarks of `MEASUREMENT_DEFINITIONS`) against the grip they reported (palm, claw, fingertip; `unsure` and blank are skipped and counted). The confusion matrix and agreement with the product's **current** thresholds (palm at r >= 0.58, claw at r >= 0.54, read from `GRIP_PREDICTION`), and the threshold pair that agrees most on these people, with the counts and how many pairs tie. Chosen and scored on the same people, so optimistic. **It never changes `src/server/fit/**`**                                                                                                                                   |
| Accuracy                   | **Dormant: no ruler truth.** Nothing is computed, nothing errors                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

Person-level means come before any statistic across people: photos are never
treated as independent people. Everything is worded as agreement with the
marker-sheet reference and retake repeatability; the output never says
"accurate".

### What the evaluator reads from the logs, and how a label finds its photo

- **From a format-3 log** (the sorter's `RUN_LOG_FORMAT`; kit v1 runs are in
  format 3 too, with `protocol: null`, and are read as candidate-v1):
  `protocol`, `session` (the whole `session.json` record the sorter was given,
  which gives the phone and the session id; `null` in a download from the
  checker page), `sheet`, `reports[]`, and `sort.photos[]` entries matched to
  a report by `file`: `status`, `destination`, `participant`, `gesture`, `hand`,
  `shot`, `extraShot`. The pose, hand and shot always come from the sort,
  **never from the QR code** on the photo (it is the participant's card).
  `--session` is only a fallback for a log that names its session by id alone,
  which no sorter writes; with the sorter's logs it is not needed.
- A photo with no participant or pose (the sorter's `needs-review`, `no-code`) is
  listed as `NOT_ASSIGNED:<status>`. The same participant, pose and shot seen twice
  (a folder sorted twice) counts once.
- **Photos the sorter does not file** (no `destination`): `needs-review` (the
  participant's photo count is not the planned 3 + 2 and `participant.json` has no
  matching `shotCounts`; `sort.participants[].reason` is `photo-count-not-planned`,
  `shot-counts-do-not-match` or `unreadable-photo-in-run`), and the photos placed in
  the shooting order whose copy cannot be made (`not-a-jpeg`, `damaged-jpeg`,
  `copy-failed`). They cannot be labelled, so they are **left out of judgement
  correctness like an unlabelled photo** and counted: the summary and the JSON give the
  unfiled photos of the evaluated participants by status, and the participants in
  review by reason. A `needs-review` photo has no pose, so it is also listed as
  `NOT_ASSIGNED:needs-review` and measured for nothing; a photo that is placed but not
  filed is still measured for the other statistics.
- **The embedded session** is checked by the contract's own `sessionRecordSchema`:
  a session on sheet B or on Letter paper is refused, and so is a top-level `sheet`
  other than A.
- **A label names its photo by its `destination`, verbatim** (`P901/G02/1.jpg`):
  the contract pins that, and it is how the sorter writes the labels template.
  The photo's own file name and a name worked out from the participant, pose and
  shot are **not** tried, and neither are other cases or separators: a label that
  does not match is a label that names no photo. A label belongs to the photos of
  its own **session**. A photo that was not filed has no destination and cannot
  be labelled. A label that names no photo of any participant in the run logs is
  counted (a naming mismatch shows up there).
- A photo with no recorded product verdict counts as not accepted, and the count is printed.
- **The handedness gate is left out of judgement correctness** (see its row above),
  and the output says so. The kit checker's own `retake` verdict is not the product's
  either: a photo the checker says to retake still counts for the statistics and is out of
  the field tables' "accepted" group, as in candidate-v1.
- A test runs the sorter's own pure code (`runSorterWithReports`, which calls
  `sortReportsV2`, the `participant.json` and `labels.json` templates and
  `buildSorterRunLog`) on synthetic reports, including a participant held for
  review and an unfiled photo, and feeds the run log it writes to the evaluator
  (`evaluateRunJson`) and to the real script.

### The report

A JSON report (`open-mouse-m2-evaluation/2`) and a Markdown summary. They hold
totals, the anonymous participant codes (`P007`), and photo ids like
`P007/G01R/3` (participant, pose and hand as printed, shot). They hold **no file
name, folder, account name, EXIF or landmark**; a test searches both for them.
The model judged is named (`landmark-raw-v1` for the baseline); a correction
such as the frozen `calibrated-v1` plugs in as `calibration` in
`EvaluateOptions` and is applied after the recompute, so both models are judged
by the same code.

### Held-out participants are evaluated once

The plan is to tune on some participants, freeze the model as `calibrated-v1`,
and evaluate the held-out participants **once**. So:

- **Claude runs the held-out evaluation, once, on the frozen model.** It is not in a workflow, and not re-run after looking at the result (a second look would make the held-out set a tuning set).
- Cross-validation folds use `--participants`; the held-out set is the participants no fold ever contained.
- `--out` refuses to overwrite, so a report cannot be quietly replaced.

`scripts/m2-gate-replay.ts` (the old replay through `/scan`) is gone: it failed
on blank-paper photos and had no parallax correction. This tool replaces it.

## Files

| Path                                                              | What                                                                              |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `src/lib/learning/kit.ts`                                         | Poses, QR payloads, capture order, photo sorter (pure, tested)                    |
| `src/lib/learning/layout.ts`                                      | Page layouts in mm (pure, tested)                                                 |
| `src/lib/learning/layoutv2.ts`                                    | Kit v2 sheets A and B and the participant card in mm (pure, tested)               |
| `src/lib/learning/session.ts`                                     | Kit v2 contract (Claude's): session, participant, labels records                  |
| `src/lib/learning/sortv2.ts`, `posecheck.ts`                      | Kit v2 sorter by shooting order; the G02/G04 pose check (pure, tested)            |
| `src/lib/learning/exifstrip.ts`, `filing.ts`, `sessionfile.ts`    | EXIF stripping (pure); filing copies, participant and labels files; reading them  |
| `src/lib/learning/order.ts`                                       | File-name order against file-time order (pure)                                    |
| `src/lib/learning/qr.ts`                                          | QR module matrix (round-trip tested with jsQR)                                    |
| `src/lib/learning/checks.ts`                                      | Per-photo verdict (pure, tested)                                                  |
| `src/lib/learning/report.ts`, `findings.ts`, `plane.ts`           | The per-photo record, its planes, and recomputing from it (pure)                  |
| `src/lib/learning/exif.ts`                                        | The EXIF white-list reader (pure)                                                 |
| `src/lib/learning/runlog.ts`, `paths.ts`, `truth.ts`              | Run log, path rules for the sorter, `truth.json` schema                           |
| `src/lib/learning/devserver.ts`                                   | The sorter's dev server: start, stop the whole tree, port probe                   |
| `src/lib/learning/qrread.ts`, `batch.ts`                          | Kit-code-only QR reading; one bad photo does not stop a batch                     |
| `src/lib/m2/`, `scripts/m2-evaluate.ts`                           | The M2 evaluator: statistics, recompute, gates, report (pure) and its CLI         |
| `src/client/learning/analyse.ts`                                  | In-browser detection: QR, markers, paper edges, landmarks, EXIF                   |
| `src/components/learning/KitSvg.tsx`, `KitV2Svg.tsx`              | Printed pose pages and kit v1 cards; kit v2 sheets and cards                      |
| `src/app/learn/**`, `src/app/l/v1/**`                             | Kit index, print, cards, checker, QR landing pages (`noindex`; 404 in production) |
| `scripts/learn-sort.ts`                                           | Folder sorter (never in CI)                                                       |
| `tests/unit/learning-*.test.ts`, `tests/e2e/learning-kit.spec.ts` | Tests                                                                             |
