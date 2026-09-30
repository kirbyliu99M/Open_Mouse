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
- Live stream constraints: ask for 1920x1080 ideal for the preview. The high-resolution photo
  still comes from `takePhoto()` as today; the canvas fallback path keeps working.

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
- A "Copy JSON" button (clipboard call wrapped in try/catch) so Kirby can paste the numbers.

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
  shrinks to fit: 0.760 with today's sheet at 100% text, 0.575 at 150%, 0.459 at 200% (all on a
  390x844 screen). The result sheet is capped at 52vh and scrolls inside above that, and the photo
  keeps clear of the top bar as well, which grows with the text. The floor of 0.4 is reached only
  on a shorter screen, where the band cannot hold the paper at a useful size; there the drawing
  can reach under the sheet.
- **`resizeMode: { ideal: "none" }`** is asked for next to 1920x1080 ideal, so the browser prefers
  the camera's own frame sizes over a software crop-and-scale that would narrow the field of view.
  Not verified on a phone.
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
  it. The DOM order is unchanged, so the focus order is the reading order; `scroll-padding-bottom`
  keeps a focused control clear of the row (the row's measured height). The sheet's real height is
  still what the photo layout measures. At large text the text must still fit: the main button
  grows with its label instead of a fixed 54px, the retake icon has no padding, the grip chips wrap
  instead of cutting a word, and the dimension labels are kept wholly inside the visible photo
  (`dimensionLayout.ts`), which matters at the 0.4 scale floor where a fixed-size label is large
  against a small photo.
- **Dots and the steadiness check follow corners, not labels.** `detectPaperQuad` relabels its
  corners (a cyclic shift) when the paper is held sideways, at about 134 and 314 degrees of
  rotation in the synthetic sweep. Before smoothing, the new observation is matched to the dots by
  the cyclic shift (0 to 3) that puts it nearest in total (`labelShift.ts`), only when all four
  corners are seen on both sides. `computeMaxCornerMovement` matches the same way; before, a
  relabel counted as a movement of the paper's own size and reset the steadiness ring.
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
- **The axe comparison for the live camera is relaxed in one direction.** An open rule nobody has
  reviewed still fails. A review that axe no longer needs also still fails, except colour
  contrast over the live picture, which axe may decide by itself on a run where it sees no picture
  behind the controls; that counts as a pass and is attached to the report. Every listed element
  is now also measured directly on every live-camera audit (text colour and alpha, fill alpha and
  opacity, over white), whether or not axe named it.
- **Not built (nice to have):** dragging the sheet to dismiss it; rounded photo corners.
- **Motion budget.** Only `transform` and `opacity` animate, except the shutter ring's
  `stroke-dashoffset` (existing, unchanged).
