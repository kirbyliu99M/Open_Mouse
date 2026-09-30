# Design: live camera capture with on-screen cues (2026-09-25)

**Superseded for the blank-paper easy scan:** references below to a live bank-card outline, card placement, and printed ArUco markers describe the earlier printed-sheet mode. The current `/scan/easy` flow tracks the four corners of plain A4 or Letter paper and uses no bank card.

Kirby's request: the web UI must open the phone camera itself and guide the
user to the right photograph with cues on screen, in the spirit of Final's
TONALITE onboarding (headphones that personalise sound from a phone scan of
the head and ears).

## What we know about the reference — and what we don't

Public reviews describe TONALITE's flow as step by step — head scan, then ear
photos from several angles — using a phone camera that reads **QR-code
stickers on a supplied headband**, needing decent light, with "video
instructions and an interface so nice that you never feel lost"
([Headfonia](https://www.headfonia.com/final-tonalite-review/),
[Audio46](https://audio46.com/blogs/headphones/tws-sound-gets-super-personal-final-audio-tonalite-review)).
**None of the reviews describe the capture screen itself** (overlays,
countdowns, auto-capture, haptics). So this design borrows the _principles_
that are documented, not TONALITE's pixels:

1. **Printed fiducials the camera recognises live.** TONALITE's QR stickers
   are our sheet's four ArUco markers. Showing each marker "lock on" as it is
   found is the central cue.
2. **One step at a time, one instruction at a time.** Never a list of
   problems; the single most important next action.
3. **Prepare before the camera opens** (light, sheet, card, hand) — a short
   primer, like TONALITE's instruction video, so the camera screen itself
   only has to confirm.

## Flow

`/scan` keeps its hand and grip pickers. "Choose photo" becomes two actions:

- **Primary: "Open camera"** (when `navigator.mediaDevices.getUserMedia`
  exists and the page is a secure context).
- **Secondary: "Upload a photo instead"** — today's file input, unchanged
  (keep `accept="image/*"`; add `capture="environment"` only on the camera-less
  fallback path). Desktop and permission-denied users land here.

### 1 · Primer (one screen, before the permission prompt)

Three illustrated rows, 44 pt+ each, then "Turn on camera":

1. Sheet flat on a table, printed at 100 %, good even light, no glare.
2. Bank card in the card outline; hand flat, fingers together, wrist at the
   line.
3. Hold the phone flat above, about 40 cm up — the whole sheet in view.

Line under the button: "The camera view stays on this phone. Only
measurements are sent." (matches the promise on /scan today).

### 2 · Live viewfinder (full-screen, rear camera)

`facingMode: "environment"`, `playsinline`, muted, highest available
resolution (ideal 3840×2160, accept whatever the device gives).

Overlay, drawn on a canvas over the video (all in `docs/design-guidelines.md`
tokens, legible over any photo: 2 px stroke + 1 px dark halo):

- **Sheet frame**: a portrait rectangle at the sheet's aspect
  (`SHEET` layout, 210 × 265 mm), inset from the screen edges, with
  **four corner brackets at the marker positions**.
  - A bracket is outlined white while its marker is missing and **fills
    green with a small check** once that marker id is detected in the live
    frame. This is the "lock-on" cue and the main source of confidence.
  - When markers are found, the brackets **track the real detected corners**
    (animate from the ideal frame to the detected quad), so the user sees the
    sheet being recognised, not a static decal.
- **Card outline (superseded in blank-paper mode)** and a faint **hand ghost** (mirrored for the chosen hand)
  at their sheet positions, drawn relative to the tracked sheet quad. The
  ghost is a placement hint only; it never feeds measurement.
- **Top bar**: close (×, back to /scan), "Step 2 of 2 · Photo".
- **Cue line** (one sentence, large, bottom-centre above the shutter) — the
  first failing check in this priority order:
  1. "Point the camera at the sheet" (0 markers)
  2. "Move back so all four corners are in view" (1–3 markers)
  3. "Hold the phone flat above the sheet" (sheet quad too skewed: opposite
     edge-length ratio outside 0.85–1.15, or corner angles off 90° by > 12°)
  4. "Move closer" (sheet quad < 55 % of frame width) / "Move back a little"
     (> 95 %)
  5. "More light, please" (mean luma < 70/255) / "Too bright — avoid glare"
     (> 5 % pixels clipped at 250+ inside the sheet quad)
  6. "Hold still" (marker corners moved > 1.5 % of frame diagonal between
     samples, or sharpness below threshold) — _changed by scan v2, see the
     note below: "Hold still" is now shake only, and sharpness below the
     threshold reads "Waiting for a sharp picture"_
  7. All pass → "Perfect — hold still" and auto-capture starts.
- **Three status chips** above the cue: `Sheet 4/4`, `Steady`, `Light` —
  each outlined when failing, filled when passing. Redundant with the cue for
  people who scan rather than read.
- **Shutter**: 72 px circle, always tappable (manual capture is never
  blocked — the photo pipeline still gates quality afterwards).
  - **Auto-capture**: once every check passes continuously, a progress ring
    fills around the shutter over **800 ms** of passing samples; ~~any failure
    resets it~~ it empties after 3 consecutive failed samples (scan v2, see
    the note below). At full,
    capture fires, with a short `navigator.vibrate(30)` where supported and a
    brief white flash (skipped under `prefers-reduced-motion`).

Thresholds are **candidates** to tune on real phones; keep them in one
constants file with a comment saying so.

> **Scan v2 note (2026-09-30).** The easy scan
> ([`scan-v2-2026-09-30`](../scan-v2-2026-09-30/README.md)) changed two pure
> modules this screen shares, so this screen changed with them:
> `advanceAutoCapture` empties the ring only after 3 consecutive failed
> samples (one or two pause it), and `pickCue` reports blur as its own cue,
> "Waiting for a sharp picture", while "Hold still" means shake only. The
> `Steady` chip follows: it fails on shake only, not on blur. The rest of this
> screen is as written above.

### 3 · Review

The captured frame, frozen, with the detected markers and card drawn on it
(the same overlay the pipeline already produces). Actions: **"Use this
photo"** (primary) → runs today's `runPhotoPipeline` on it → the existing
measured state; **"Retake"** (secondary) → back to the live viewfinder.

### Errors

- Permission denied → a calm card: why the camera is needed, how to allow it
  in the browser settings, and "Upload a photo instead".
- No rear camera / `getUserMedia` missing / insecure context → go straight
  to the upload path, no error styling.
- Stream ends (tab hidden, phone locked) → stop the tracks; resume on return
  with a "Tap to resume camera" state. Always stop tracks on unmount.

## Accessibility

- Cue line is an `aria-live="polite"` region, **throttled to one change per
  1.5 s** so screen readers aren't flooded; chips carry text, not colour only.
- Shutter has an accessible name ("Take photo"); auto-capture announces
  "Photo taken".
- `prefers-reduced-motion`: no bracket tracking animation (jump), no flash,
  ring fills without easing.
- 44 pt minimum targets; all overlay text ≥ 4.5 : 1 on its own backing pill.

## Engineering constraints

- **Photos never leave the browser** (hard rule 5). The live stream and the
  captured frame stay in memory; no network request may fire while the
  camera is open — extend the existing zero-request e2e check to the camera
  path.
- Live analysis runs on a **downscaled** frame (long edge ≈ 640 px) at
  **≤ 8 samples/s**, reusing the pure `detectMarkers` and
  `computeLaplacianVariance`; no MediaPipe in the live loop (too heavy — the
  hand is checked once, after capture, as today). Pure functions for each
  check, unit-tested (hard rule 3).
- Capture at full resolution: `ImageCapture.takePhoto()` where available,
  else draw the current video frame to a full-size canvas → `toBlob` →
  `File`, then the existing pipeline unchanged.
- CSP already allows `camera=(self)` and `blob:`; no new origins.
- e2e: Chromium's `--use-fake-device-for-media-stream` with
  `--use-file-for-fake-video-capture` pointing at a generated `.y4m`/`.mjpeg`
  of the real sheet layout (markers + card), so the lock-on, cue order and
  auto-capture are testable without a phone.
