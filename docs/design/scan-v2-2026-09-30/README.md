# Scan v2: no jumping, real focus, full-bleed viewfinder (2026-09-30)

Kirby approved this design on 2026-09-30 ("v2 通過") and named Android Chrome as the
test phone. Storyboard: [`screens/`](screens/); explanatory boards: [`diagrams/`](diagrams/).
Every number below is a **candidate** until it is measured on a real Android Chrome phone
(the debug panel below exists to produce those numbers).

Standard: [`docs/design-guidelines.md`](../../design-guidelines.md). Earlier design:
[`easy-scan-shell-2026-09-25`](../easy-scan-shell-2026-09-25/README.md) (screens 14-16). This
document supersedes its viewfinder and measured-sheet layout; the rest of that flow stands.

## Why (evidence, code as of `9cf0612`; line numbers may have shifted on later branches)

Kirby's report: the scan screen jumps around, and focus fails.

| Symptom                       | Cause in code                                                                                                                                                                                                    |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The frame changes shape twice | `frameAspect` starts at A4 (0.707), then takes the stream's aspect, then the processed photo's aspect (`EasyScanCamera.tsx` ~452, ~1374, ~1529).                                                                 |
| Corner dots swim and snap     | Detected corners are set every 125 ms and animated with `left/top` over 160 ms (`camera.css` ~191). A corner that is not found falls back to its `ideal` position (`mappedPartial[i] ?? ideal[i]`), so it jumps. |
| Cue text flickers             | The cue is throttled to 1.5 s, but the throttle is bypassed whenever the cue code changes (`EasyScanCamera.tsx` ~1065), so it never debounces.                                                                   |
| Ring rarely completes         | `advanceAutoCapture` resets to 0 on any single failed sample (`autoCapture.ts`). Samples run at 8 Hz, so one noisy sample restarts the 800 ms fill.                                                              |
| Focus is never controlled     | The stream asks for `width ideal 3840, height ideal 2160` and nothing else (~621). No `focusMode`, no tap to focus, no reading of `getCapabilities()`.                                                           |
| Blur is reported as shake     | `pickCue`: `!steady \|\| !sharpEnough` both return "Hold still" (`cues.ts`). Holding still cannot fix focus.                                                                                                     |
| Threshold unproven            | Live sharpness floor 15 is measured on a ~640 px downscale and was never checked on a real phone (`constants.ts` says so).                                                                                       |
| Shot swaps the picture        | The still from `ImageCapture.takePhoto()` has a different aspect than the live stream, and the frozen frame is sized from it.                                                                                    |

## Screens

| #   | State                    | File                                                           |
| --- | ------------------------ | -------------------------------------------------------------- |
| 1   | Searching for the paper  | [01-searching.png](screens/01-searching.png)                   |
| 2   | Locking corners (2 of 4) | [02-locking.png](screens/02-locking.png)                       |
| 3   | Focus needed (new)       | [03-focus-needed.png](screens/03-focus-needed.png)             |
| 4   | Ready, ring filling      | [04-ready.png](screens/04-ready.png)                           |
| 5   | Freeze and measure       | [05-freeze-and-measure.png](screens/05-freeze-and-measure.png) |
| 6   | Measured                 | [06-measured.png](screens/06-measured.png)                     |
| 7   | Retake needed            | [07-retake-needed.png](screens/07-retake-needed.png)           |

The screens show the designed states; the photo is an illustration, not a real scan.

Screens 1 and 2 in `screens/` still show the line "Takes the photo by itself — or tap". That line
is dropped (Kirby, 2026-10-01): it is not built and not wanted, and the screenshots in
[`built/`](built/) are authoritative for those two states. The two PNGs will be replaced later.

## Behaviour

**Stage.** The live video fills the viewport (`object-fit: cover`). There is no `frameAspect`
state and no aspect-driven resizing. The four paper corners are drawn against a fixed guide
rectangle (screen 1) until they are found.

**Corner dots.** Positioned with `transform`, never `left/top`. Detected positions are low-pass
filtered per corner (start with an exponential filter, alpha about 0.35 per sample). A corner that
is lost keeps its last position and turns hollow; it never jumps to the guide. After about 1 s
lost it eases back to the guide over about 300 ms. A newly found corner pops in with a short
spring and one pulse ring (scale 1 to 1.8, opacity .5 to 0, about 350 ms).

**Cue (one line, top).** A change to a non-perfect cue must persist for 2 consecutive samples
before it replaces a "perfect" cue; a change to "perfect" needs no delay. No text change more
often than every 500 ms except into "perfect". Pure function, unit tested.

**Ring.** The ring resets only after 3 consecutive failed samples. One or two failures pause it.
Fill time stays 800 ms of passing samples.

**Focus.**

- New cue code `out-of-focus`, between `steady` and `perfect` in priority: the frame is steady
  but `sharpEnough` is false. `hold-still` now means shake only.
- At stream start read `track.getCapabilities?.()`. If `focusMode` includes `"continuous"`,
  apply `{ advanced: [{ focusMode: "continuous" }] }` (catch and ignore errors).
- Tap on the stage: if `focusMode` includes `"single-shot"` and `pointsOfInterest` is supported,
  apply single-shot focus at the tapped point (normalised to the video frame, undoing the
  `cover` crop), show the focus reticle there (screen 3: 88 px square, drafting blue `#0A64E0`,
  2 px stroke, 12 px radius, centre dot), then re-apply `"continuous"` after about 1.2 s.
- Unsupported browsers: no reticle, no tap handling.
- Live stream constraints: ask for the preview in the photo's own shape, about 1080 on the short
  edge (_revised 2026-10-06, see "What you see is what is analysed, and the attempt log" below; this line first said
  1920x1080 ideal_). The high-resolution photo still comes from `takePhoto()` as today; the canvas
  fallback path keeps working.

**Capture and freeze.** The frozen picture occupies exactly the rectangle and crop the last live
frame had. Compute the crop from the stream's `getSettings()` aspect and the still's dimensions
(pure function with unit tests; if the still shows a different vertical extent than the stream,
crop it to match before display). White flash 120 ms (was 260 ms), a dim of about 25%, one scan
line top to bottom over about 600 ms (drafting blue, with a trailing glow), and the existing
"Measuring your hand…" pill.

**Measured.** The photo scales to 90% and moves up (transform only) so nothing is under the
sheet: paper corners, hand line, palm line and both labels stay visible. Lines draw in order:
hand length, then palm width, about 350 ms each. The sheet rises with a spring-like curve
(response about 0.4 s, no bounce) and can be dismissed by dragging (nice to have; skip if it
risks the slice). Rounded photo corners in the storyboard are optional if animating them costs
frames.

**Retake.** The photo stays visible above the sheet with the problem area outlined in amber
(screen 7). One reason, one action. Existing strings.

**Reduced motion.** No pulse, no flash, no scan line, no springs: 120 ms cross-fades only.
Reduced transparency and increased contrast rules from the guidelines stay.

**Budget.** Animate only `transform` and `opacity`. No `backdrop-filter` over the live video. No
new dependencies in this slice (springs are CSS `linear()` or `cubic-bezier` approximations; the
question of adding `motion` is decided later, not here).

## Approved copy (Kirby, 2026-09-30)

- `Tap the paper to focus` (cue, when tap to focus is supported)
- `Waiting for a sharp picture` (cue when tap to focus is not supported; also the hint line
  under the viewfinder while out of focus)
- `Hold still — taking the photo` (hint line while the ring fills)

Everything else is an existing string. Do not add or reword any other user-visible text.

## Debug panel (approved)

`/scan/easy?debug=1` shows a small panel over the viewfinder. Not linked from anywhere; absent
without the query. Nothing leaves the device and no image is stored. It shows:

- User agent (short), `track.getSettings()` (width, height, frameRate), the `focusMode`,
  `pointsOfInterest` and `zoom` entries of `getCapabilities()`, and whether they were applied.
- Live loop: samples per second; detection time in ms (average and 95th percentile of the last
  30 samples); Laplacian variance now and the floor; `steady` and the largest corner movement as
  a fraction of the diagonal; corners seen; cue code; ring fraction; consecutive-failure count.
- Capture: `takePhoto` used or canvas fallback; still width, height and size in KB; milliseconds
  from ring complete to the frozen frame being on screen.
- Live view (2026-10-06): the part of the stream that is on screen, which is all the detector looks at, and the
  size of the picture it is given.
- Preview against photo (2026-10-06): what the stream was asked for, the photo's shape as the camera
  reported it, the preview's shape, their difference and the `fovMismatch` flag.
- Attempts (2026-10-06): the last 20 analyses kept on this device, newest first, one line each.
- A "Copy JSON" button (clipboard call wrapped in try/catch) so Kirby can paste the numbers. The JSON
  carries the `preview` block and the `attempts` array.

## Acceptance criteria

1. Stage rectangle: in the fake-camera e2e (`chromium-camera-paper-edge`, 390x844), the
   bounding box of the stage differs by at most 1 px between live, processing, and the moment
   the measured sheet opens (before the photo moves). Test asserts it.
2. Corner logic (smoother, lost-corner behaviour), the cue debouncer, the ring reducer (3
   consecutive failures), the `out-of-focus` cue priority, and the crop-match function are pure
   and unit tested, including the boundary cases.
3. `hold-still` fires only for shake; `out-of-focus` only when steady and not sharp.
4. On Android Chrome with `focusMode` support the app applies `continuous`; unit test with a fake
   track covers supported, unsupported and throwing `applyConstraints`.
5. No `left/top` transitions remain on the dots; nothing in the slice animates a property other
   than `transform` or `opacity` (state any deliberate exception in the PR).
6. `?debug=1` shows the panel; without it the panel is absent (e2e).
7. Reduced-motion e2e: no flash element, no scan line.
8. Every existing test still passes; axe on `/scan/easy` finds nothing serious.
9. The PR description lists measured numbers: the stage delta in px, unit test counts, and one
   real-motion screenshot set (not reduced-motion) of screens 1 to 7.
10. Kirby tests on his phone and pastes the debug JSON. Thresholds (sharpness floor, alpha, the
    3-sample rule) are then adjusted from that data; until then they stay candidates.

## Non-goals

Landing, How it works, Results, Account; i18n; new dependencies; the model-download progress UI
(already in #92); moving detection to a Web Worker (decide after the debug numbers); any copy
outside the three approved strings; changes to `docs/STATUS.md`.

## Who does what

Kirby: design and copy decisions, real-phone tests, final acceptance. Claude: orchestration,
brief, review adjudication, merge, `docs/STATUS.md`. Builder 1 (Sonnet subagent): implementation
in its own worktree. `pr-review` workflow: independent review. Codex: not involved.

## Build notes (S4, PR #97)

What the built version does differently from the text above. None of it changes an acceptance
criterion; each item is a decision the build had to make or a thing it could not settle.

- **Hint lines on screens 1 and 2: dropped by Kirby's decision, 2026-10-01.** The storyboard shows
  "Takes the photo by itself — or tap" there. It is not one of the three approved strings and it is
  not wanted, so the hint line is empty in those states. Nothing is pending on it.
- **The photo scales to 90% or less, never below 0.4.** #92's sheet is taller than the storyboard's
  (numbers, the "Not yet verified" note), and at 90% the paper would sit under it, so the scale
  shrinks to fit: 0.783 with today's sheet at 100% text, 0.575 at 150%, 0.459 at 200% (all on a
  390x844 screen). The result sheet is capped at 52vh and scrolls inside above that, and the photo
  keeps clear of the top bar as well, which grows with the text. The floor of 0.4 is reached only
  on a shorter screen, where the band cannot hold the paper at a useful size; there the drawing
  can reach under the sheet.
- **`resizeMode: { ideal: "none" }`** is asked for next to the size, so the browser prefers
  the camera's own frame sizes over a software crop-and-scale that would narrow the field of view.
  Not verified on a phone. (It was first asked for next to 1920x1080 ideal; that size is replaced,
  see "What you see is what is analysed, and the attempt log".)
- **Tap-to-focus support is inferred, not observed.** `pointsOfInterest` counts if it shows in the
  track's capabilities, its settings or `getSupportedConstraints()` (Chrome documents it outside
  `getCapabilities()`), together with `single-shot` in `focusMode`. The debug JSON records each
  source; the first Android Chrome run settles it, as does whether the point is read in the rotated
  frame.
- **The frozen photo's crop uses the `<video>` element's own frame size**, falling back to
  `getSettings()`, because the video element is what `object-fit: cover` actually cropped.
- **The legacy printed-sheet camera (`/scan`) changed too.** It shares `pickCue` and
  `advanceAutoCapture`: its ring empties after 3 consecutive failed samples, blur is the
  "Waiting for a sharp picture" cue, and its "Steady" chip is shake only. See the note in
  `camera-capture-2026-09-25/README.md`.
- **Amber outline only where the pipeline located the problem.** "We couldn't find a hand" has no
  location, so nothing is drawn (screen 07b). The white measurement lines and the amber outline
  each sit on a dark halo so they read on white paper.
- **Reduced motion cross-fades**: the moved picture fades in over the unmoved one, which stays
  opaque until it is covered, so the picture is never see-through.
- **The sheet's buttons stay at its foot.** The result sheet scrolls inside above 52vh, and at
  large text the main button used to be below the fold. The row with Retake and See my matches
  (on the failure sheet: Try again, and Edit hand length when it is offered) is
  `position: sticky; bottom: 0` with the sheet's own background (light and dark) and the padding
  the sheet had below it, so content scrolls behind it and, scrolled to the end, nothing is under
  it. The row has no top padding of its own, so the sheet is no taller than before it (333 px at
  100% text on 390x844, 360x780 and 360x640, in Windows' font; the e2e adds exactly the lines the
  text wraps onto and the rows the options take in a wider font, 25.6 px for the numbers in DejaVu
  Sans, and nothing else); content that scrolls up behind it fades out over
  1rem (a `box-shadow` in the sheet's colour; a pseudo-element made axe unable to read the
  buttons' background). The DOM order is unchanged, so the focus order is the reading order.
  `scroll-padding-bottom` keeps a focused control clear of the row's measured height, the fade and
  the focus ring (1.25rem more), so Tab never leaves an option under the fade. The dialog has
  `tabindex="-1"`, so a scrolling sheet is not a stop of its own (Tab after the last button used
  to land on the dialog; the same stop appears on a sheet with the base commit's 80vh cap once it
  scrolls at large text, simulated on this branch, not run on the base). The sheet's real height is
  still what the photo layout measures.
- **At large text the text must still fit.** The main button grows with its label instead of a
  fixed 54px, the retake icon has no padding, the status line keeps one line of room in pixels, and
  the dimension labels are kept wholly inside the visible photo and never over each other
  (`dimensionLayout.ts`: each is kept inside first, then the pair is pushed apart, kept inside
  again and re-checked; what is left is spread exactly along the axis that has room), which
  matters at the 0.4 scale floor where a fixed-size label is large against a small photo.
- **The four grip options are always the same width.** A grid that follows the width of the sheet in
  `ch` (a container query, where `ch` is the width of "0" in the sheet's own font): four columns from
  32.5ch, two by two from 16ch, one under another below that; never 3 + 1, and no word cut short.
  The first version used rem (17.25rem and two columns below it), which fits Windows' font, where
  "Fingertip" is 3.6rem, and cut the word in DejaVu Sans (what Linux and CI use), where it is 4.5rem:
  in `ch` the word is about 7.1 (6.7 to 7.1 across system-ui, DejaVu Sans, Verdana and Arial), so one
  threshold fits them all, and where even two across would not fit (200% text on 390 px, DejaVu) the
  options stack. 390 px wide at normal text is four columns of 81 px in Windows' font, as it was; in
  DejaVu Sans it is also one row at 100%, and two by two from 115%. A `ch` threshold follows a font's
  digits, not its letters, so it is not exact: two across need 14.5ch in Windows' font and 15.2ch in
  DejaVu Sans against the 16ch threshold, and a sheet up to about 10% wider than that can still stack
  (Windows' font at 200% text on 360 px: stacked, with 18 px to spare). The e2e allows that 12% and no
  more.
- **Dots and the steadiness check follow corners, not labels.** `detectPaperQuad` relabels its
  corners (a cyclic shift) when the paper is held sideways, at about 134 and 314 degrees of
  rotation in the synthetic sweep. The new observation is matched to the dots by the cyclic shift
  (0 to 3) that puts it nearest (`labelShift.ts`), using the pairs where both the observation and
  the dot have a position and needing at least two, because the detector reports 0, 2 or 4 corners
  (one hidden edge hides two); the shift is applied to the whole observation. With one pair or none
  there is nothing safe to match on and the observation is left as it came. `computeMaxCornerMovement`
  matches the same way on complete quads (it only ever gets those); before, a relabel counted as a
  movement of the paper's own size and reset the steadiness ring.
- **Accepted limits (measured on the fake-camera phone sizes).**
  - 360x640 at 200% text: the top bar is 139 px tall and the band for the paper is about 6 px
    short of clearing it, so one check mark overlaps the hand chip by about 6 px (measured 6.2 px).
    Its middle is clear of the chip, so it stays visible. Everything is above the sheet there
    (lowest drawn part 297 px, sheet top 307 px).
  - On a window shorter than that with 200% text, the scale floor of 0.4 can leave part of the
    drawing under the sheet or the top bar. Measured once, outside the suite: at 360x568 a check
    mark reaches about 15 px under the top bar (highest drawn part 124 px, bar ends 139 px) and
    the sheet is still clear (272 px against 273 px); at 320x480 the drawing reaches about 11 px
    under the sheet (241 px against 230 px) and about 27 px under the top bar. The buttons were
    still fully on screen and in front on all of them.
  - Phones held in landscape (844x390, 640x360) work, but the sheet covers the lower part of the
    photo and shows little more than its title: at 844x390 the sheet is 203 px tall, its row is the
    lower 106 px, and the drawing reaches about 71 px under the sheet (49 px at 640x360); the
    photo is at the 0.4 floor. The buttons are reachable.
  - The upload path's clear of the announcement in `retake()` guards a screen that is hard to reach
    in production (a photo picked, then no way to open the camera again); it is pinned by an e2e
    that makes `getUserMedia` disappear.
  - A mutation of `bestCyclicShift` that uses x alone in one place is equivalent: no test can tell
    it from the real thing. Accepted, not fixed.
- **The axe comparison for the live camera is relaxed in one direction.** An open rule nobody has
  reviewed still fails. A review that axe no longer needs also still fails, except colour
  contrast over the live picture, which axe may decide by itself on a run where it sees no picture
  behind the controls; that counts as a pass and is attached to the report.
- **Contrast over the live picture is measured directly and fails closed**
  (`tests/e2e/fixtures/live-picture.ts`), whatever axe reports: every listed element and every
  visible descendant that carries text (a nested span, an svg icon's shapes, `::before` and
  `::after`) is measured with its text colour and alpha and the fill and opacity of it and each
  ancestor inside the screen, over white, drawn as the browser does (each element is a group faded
  by its opacity). A `filter`, `backdrop-filter`, `mix-blend-mode`, `background-image` or
  text fill that is not the colour fails with the feature named, unless it is on an explicit allow
  list with a reason (empty). A walk of everything visible in the camera screen that carries text
  or a fill fails on anything that is neither listed, inside a listed element, nor decoration with
  no text of its own. The hint line and the green cue are measured by the same path on probes.
- **Not built (nice to have):** dragging the sheet to dismiss it; rounded photo corners.
- **Motion budget.** Only `transform` and `opacity` animate, except the shutter ring's
  `stroke-dashoffset` (existing, unchanged).

## What you see is what is analysed, and the attempt log (2026-10-06)

Added after Kirby's first Android Chrome run (Samsung S25, 2026-10-06) and its review. Every number
here is a **candidate**. The fix could not be run on that phone; Kirby retests after the merge and
pastes back the debug JSON, which now carries the `attempts` array below.

**What was seen.** The live preview was perfect (four corners, `perfect`, ring full, steady) and the
analysis of the photo taken from it said Retake: no paper corners, no palm number. The debug numbers:
preview stream 1080x1920 (9:16) at 60 fps, `takePhoto` photo 3000x4000 (3:4), 4.3 MB.

**What it is thought to be (inferred from those numbers and the code, not confirmed on the phone).**
Two things made the person's view and the analysed picture differ:

1. _The photo shows more than the preview._ The preview asked for 1920x1080, which a phone answers with
   its 16:9 video mode. In portrait that mode crops the sensor's left and right, while `takePhoto()` reads
   the whole 4:3 sensor: the photo shows 4/3 as much across (2250 of 3000 px).
2. _The screen shows less than the stream._ The viewfinder is the whole screen and shows the stream with
   `object-fit: cover`, so a tall, narrow screen cuts the stream's sides off. A 390x844 screen shows 82 % of
   the width of a 9:16 stream and **62 % of a 3:4 one**. The live detector, the cue ("Move closer", "perfect")
   and the photo's analysis looked at the WHOLE stream or photo. A sheet could therefore be found, counted
   and called perfect with its corners off the screen, and the photo it came from showed a sheet far smaller
   than the one on screen. Matching the preview's shape to the photo's (item 1) is not enough on its own: it
   makes item 2 worse, because a 3:4 stream is cut harder by a tall screen than a 9:16 one.

**What the build does: everything looks at the part the person sees.**

- **The preview is asked for in the photo's shape** (`previewConstraints.ts`, pure and unit tested). The
  photo's shape is read from `new ImageCapture(track).getPhotoCapabilities()` (the largest `imageWidth` over the
  largest `imageHeight`, long over short; 4:3 where the camera will not say or says something outside 1:1 to
  3:1). The first request is 4:3 (an `ImageCapture` needs a track to ask anything), about 1080 on the short edge
  and never below 720: upright, `width 1080, height 1440, aspectRatio 0.75`; wide, `1440 x 1080, 1.333`.
  `resizeMode: { ideal: "none" }` stays. It is kept because a 3:4 stream shows more of the scene than a 16:9 one;
  what changes is what is looked at.
- **The part on screen** (`visibleView.ts`, pure and unit tested). `visibleRectInStream(stream, container)`
  is the on-screen part of the stream in the stream's pixels, from the cover rectangle (`computeCoverRect`): the
  screen's shape, centred, the whole stream on the axis that fits. For a 3:4 stream on 390x844 it is 665x1440 at
  x 207.
- **Live detection samples only that part.** The loop draws `drawImage(video, sx, sy, sw, sh, 0, 0, w, h)`,
  so the picture the detector gets has the screen's shape, its corner coordinates are the screen's (mapped back
  with the cover rectangle of the sample, which is nearly a plain scale; a unit test checks this agrees with the
  old mapping to under 2 px), and `frameWidth` for the cue is the visible width. **No number moved:** the guide's
  0.85, the cue's 0.55 and 0.95 (`CAMERA_CONSTANTS.size`) and the rest are as they were; they now apply to what
  is on screen. A sheet that fills the screen's width is at 100 %. The sample is smaller than before: 296x640
  for a 3:4 stream on 390x844, against 360x640 for the 9:16 whole-stream sample of the base commit and 480x640
  for the 3:4 whole-stream sample this branch had before this change. The debug panel shows it ("Live view").
- **The photo is cropped to the same part** before anything is detected. `visibleRectInStill(still, stream,
visibleInStream)` carries the region over to the photo through one model: the stream is the same field of view
  as the photo, or a **centred part** of it (a 16:9 video frame from a 4:3 sensor). It holds when the stream is
  the same or the narrower view; when the stream is the _wider_ view, or one is upright and the other wide, it
  cannot hold, and `modelApplies` says so (the region is then taken in proportion, or the whole photo is used).
  The crop is applied to a `takePhoto` photo and to a canvas frame (a canvas frame is the stream, so the model is
  exact), not to an upload (no viewfinder). It replaces the earlier "crop to the preview's field of view": that
  was the special case with the screen's shape equal to the stream's. For the S25's numbers (decoded 2250x3000,
  9:16 stream, 390x844 screen) the region is 1384x3000, 433 px in from each side: the same middle of the photo
  as for a 3:4 stream (1386x3000), to a couple of pixels.
- **Parallax stays right.** (1) The EXIF focal length in pixels is worked out from the whole decoded photo's
  size, as before, because cropping does not change a focal length in pixels (`analysisFrames`); the focal
  length the paper detector assumes when there is none (70 degrees over the width) is likewise the whole
  photo's, not the crop's. (2) The principal point is the analysed image's centre: the visible region is centred
  in the stream, the stream is centred in the photo, and the whole-pixel margins are equal on both sides, so it
  is the whole photo's centre (tested). (3) The overlay (paper corners, landmarks) is moved back into the whole
  photo's pixels, so the frozen photo and the sheet are unchanged. These three are tested by running the real
  `runPhotoPipeline` (browser parts faked) in `tests/unit/pipeline-view-crop.test.ts`: the same scene analysed
  whole and analysed cropped gives the same measurements and the same overlay, and each wiring has an assertion
  that fails when it is wrong. The second half of the paper pipeline is now a pure module
  (`paperEdgeFinish.ts`) so this can run in Node.
- **A mismatch is flagged, and the track is asked for a size at most twice.** After the stream starts, the
  track's own `getSettings()` shape is compared with the photo's; more than 2 % apart sets `fovMismatch`. If the
  photo is not 4:3 the running track is asked once more in its shape. If a 4:3 photo still comes back
  mismatched, the same shape is asked for with width and height swapped (a browser may read an upright request in
  the sensor's wide orientation); it is kept only if closer and the right way round, otherwise the first request
  is put back. Never more than two size requests in all. Without an `ImageCapture` (the browser takes its photo
  from the preview with a canvas) the photo is by construction the preview's own view: it is a match, nothing is
  asked and nothing is flagged.
- **The shutter waits and focus is asked for again.** Size requests can reset a camera, so the auto-shutter
  does not fire (and the ring does not fill) until the preview has settled (after the photo-size answer and the
  size requests, or after 2.5 s without an answer), and continuous focus is asked for again after a size request.
- **Gates are untouched.** `PAPER_EDGE_LIMITS`, `gates.ts` and `src/lib/contracts/` are as they were.

**Fake camera.** `paper-edge-full.y4m` is regenerated (`gen-camera-fixtures.spec.ts`): its sheet is 560 px
wide (it was 756) in the 1000x1300 frame. The sheet has to suit two detectors: the easy scan sees the middle
601 columns on the 390x844 screen, whose cue says "Move back" above 95 % (571 px), and the paper-edge preview
(`/scan/paper-edge-preview`, still the whole stream) says "Move closer" below 55 % (550 px). 560 px is 93 % of
the first and 56 % of the second.

**Attempt log** (`attemptLog.ts`, pure and unit tested; storage wrapped in try/catch).

Every analysis, from the camera and from an uploaded file (and a re-run after the hand button), leaves one
record in `localStorage` (`openMouse.easyScan.attempts.v1`), the newest 20 kept. Whether it is **always on** (as
built) or only with `?debug=1` is **candidate (未拍板), for Kirby to confirm**: always on is what leaves a
trace of a failed scan nobody expected to debug, and the person is not told about it (no user-visible text was
added; a line for the first-run tip or the privacy note is proposed in the PR, not built). It is cleared by
"Delete everything" on the account page and by "Delete this scan now" on the results page. A page without
storage works the same and remembers nothing between reloads (the panel still lists this session's attempts,
including when the store can be read but not written). While the store can be written it is the truth: a log
deleted in another tab is not brought back from this page's copy. Nothing is sent anywhere and no image is
stored: a record is rebuilt field by field from numbers, booleans and short strings (strings cut at 200
characters, data URLs taken out, lists capped), so there is no field a photo could go in; a unit test feeds it a
5 MB data URL and checks nothing of it survives.

`errors` lists every error the pipeline reported. `paper.gateFailures` lists the paper gates that failed even
where the result reported another error first (a photo with no hand reports only that). `paper.widthFraction`
and `heightFraction` are the sheet's share of the analysed picture, which is now the on-screen region.
`preview` says whether the photo and its stream showed the same field of view. `view` says what the person
saw: the stream's size, the part of it on screen (`visibleInStream`), the relation used between stream and photo
(`model`), whether it holds (`modelApplies`) and the shape difference; `analysed.crop` is the rectangle of the
photo that was analysed. The time in the panel is UTC and says so (`Z`).

**Debug panel.** `Live view` (the part of the stream on screen and the size of the picture the detector
gets), `Preview vs photo` (what was asked for, the photo's shape and where it came from, the preview's shape,
the difference, the flag, and whether a second request or the swapped retry was made) and `Attempts` (newest
first, one line each). "Copy JSON" carries `live.visibleInStream`, `live.sample`, a `preview` block and the
`attempts` array, one record to a line.

**Sheet size against the paper gates** (`tests/e2e/paper-size-sweep.spec.ts`, opt-in, run by hand). What the
pipeline analyses is the on-screen region, so the axis is the sheet's share of the screen's width. Each step
draws the region of a 3000x4000 photo for a 390x844 screen (1848x4000, which the decoder scales to the 1386x3000
the pipeline would crop to), with the sheet at that share of its width, uploads it through the real
`/scan/easy`, and reads the attempt record. The guide puts the sheet at 85 %; the cue accepts 55 % to 95 %.
A drawn "hand" is not detected, so a synthetic photo reports `HAND_NOT_DETECTED` on every row and can never reach
`ok`; what is read is the paper gates. Synthetic scene (`paper-scene.ts`): the paper gates pass from 95 % down to
50 % (residual 0.025 to 0.170 mm against a limit of 1.5; coverage 0.70 against 0.4); at 100 % the sheet touches
the frame and its corners are not found. A real hand photo of Kirby's (not committed), shrunk inside a plain
desk-coloured frame of that shape, as he did by hand:

| sheet, share of the screen's width | residual mm | min coverage | result                                              |
| ---------------------------------- | ----------- | ------------ | --------------------------------------------------- |
| 100 %                              | 1.729       | 0.13         | `PAPER_EDGE_HIDDEN`, `PAPER_CURLED`                 |
| 95 %                               | 0.878       | 0.47         | ok                                                  |
| 90 %                               | 0.583       | 0.50         | ok                                                  |
| **85 % (the guide)**               | 0.532       | 0.50         | **ok**                                              |
| 80 %                               | 0.462       | 0.50         | ok                                                  |
| 75 %                               | 0.534       | 0.35         | `PAPER_EDGE_HIDDEN`                                 |
| 70 %                               | 0.550       | 0.33         | `PAPER_EDGE_HIDDEN`                                 |
| 65 %                               | 0.643       | 0.35         | `PAPER_EDGE_HIDDEN`                                 |
| 60 %                               | 0.872       | 0.38         | `PAPER_EDGE_HIDDEN`                                 |
| 55 % (the cue's lower limit)       | 1.374       | 0.40         | ok (coverage at its limit, residual at 92 % of its) |
| 50 %                               | 1.772       | 0.40         | `PAPER_CURLED`                                      |

What this does and does not say: with that one photo, a sheet at the guide's 85 % of the screen (and from 95 %
to 80 %) passes with the hand found. Between the guide and the cue's lower limit there are sizes that fail
(60 % to 75 %, coverage 0.33 to 0.38 against 0.40, because the hand covers one edge), and towards the lower
limit the curl residual climbs (a fixed pixel noise is more millimetres on a smaller sheet): 1.37 mm at 55 %,
1.77 mm at 50 % against a limit of 1.5. So the paper gates are marginal for this photo over much of the range
the cue accepts, though not at the guide. It is one photo of a printed page, not a blank sheet. Compared with
the first version of this table (the axis was the sheet's share of the whole 3000-wide photo, with the sheet's
size set by hand), the failing band moved with the axis, as it should: what matters is the sheet's share of what
is analysed, and that is what the screen now shows. No gate and no guidance threshold was changed; whether the
cue's 55 % lower limit should be is Claude's call.
