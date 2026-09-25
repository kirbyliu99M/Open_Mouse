# Product shell and blank-paper journey — 2026-09-25

This is the next UI direction after Kirby changed calibration to **any blank A4
or Letter sheet** and asked for a main page, functional pages, login, and a side
menu. The corresponding editable screens are in the active pen.dev canvas.
Earlier `journey-2026-09-23` screens document the printed-sheet flow and are
historical; they are not the copy source for new implementation.

Mobile screen exports: [main](screens/01-main.png) ·
[paper setup](screens/02-paper-setup.png) · [camera](screens/03-camera.png) ·
[review](screens/04-review.png) · [side menu](screens/05-menu.png) ·
[login](screens/06-login.png) · [mouse shapes](screens/07-mouse-shapes.png).
These are design states; the camera frame uses a
schematic hand and sheet in place of live video.

## Navigation

```text
Main
├─ Measure my hand → Paper setup → Camera → Photo review → Results
├─ Explore mouse shapes → Browse / compare (future functional page)
├─ Account → Sign in → Saved scans (when configured)
└─ Side menu → Main / Measure / Mouse shapes / My results / Sign in / Privacy
```

The main page offers two equally clear intents: get a personal fit ranking or
explore shapes. Its preview label remains until the M2 ruler gate passes. The
mouse-shape area introduces top view, side profile, and hand fit as concepts;
it does not imply a validated 3D simulation or a scored shape comparison yet.
EloShapes' [browse](https://www.eloshapes.com/mouse/browse) and
[compare](https://www.eloshapes.com/mouse/compare) tools are conceptual
references for shape literacy. Use our own art, interaction, wording, and data.
Do not use the private EloShapes fixture as product content.

## Screen decisions

| Screen       | Main content                                                           | Primary action                             |
| ------------ | ---------------------------------------------------------------------- | ------------------------------------------ |
| Main         | Shape sketch, concise explanation, preview status                      | Measure my hand                            |
| Paper setup  | A4/Letter choice and three placement steps                             | Open camera                                |
| Camera       | Four independent corner locks, one live cue, paper/steady/light status | Manual shutter; auto capture when valid    |
| Photo review | Captured image with the four found corners                             | Use this photo                             |
| Results      | Best match and reasons before the rest of the ranking                  | Inspect matches                            |
| Login        | Retention promise and account controls                                 | Continue with Google, only when configured |
| Side menu    | Stable routes with text labels                                         | Selected destination                       |

The setup and camera must say **paper**, not printed sheet, ArUco markers, or
bank card. The user selects A4 or Letter because one photo cannot reliably
distinguish them. Keep the current upload path for camera permission failure,
camera absence, and desktop use. The camera may auto capture, but the shutter
stays available. Review offers a retake without losing hand or grip choices.

The menu is a navigation panel with a close control and a dimmed main page
behind it. Its route names match page headings. `My results` leads to the
current result if one exists, or a clear empty state; it must not suggest a
scan was saved to an account when the user is anonymous.

Sign in is optional. Anonymous scans are deleted within 24 hours of creation;
signed-in scans are kept until the user deletes them. If Google auth is not
configured, replace the sign-in button with the existing unavailable status
and retain the anonymous measurement action.

## Motion and interaction

- The main sketch moves between **top view**, **side profile**, and **hand fit**
  with a short outline reveal and crossfade. Keep labels stable and let a tap
  switch immediately. No looping motion that competes with reading.
- The menu slides from the side that contains its trigger, follows the user's
  gesture if dragging is added, and closes by the close control, scrim, or
  Escape. Return focus to the trigger.
- Corner lock feedback responds as each paper corner is found. Cues announce
  only the next action; preserve the 1.5-second screen-reader throttle from
  the camera design. The auto-capture ring fills only while all gates pass.
- Respect reduced motion with instant sketch state changes, no camera flash,
  and no panel travel. Use solid surfaces for reduced transparency and strong
  borders for increased contrast.
- All interactive targets are at least 44 × 44 px. Press feedback is immediate;
  processing and failure states give one specific next action.

## Handoff and constraints

The current `docs/design/camera-capture-2026-09-25/README.md` on
`m7-camera-capture` still describes printed markers and a bank card; update it
before treating that branch as the implementation spec. The same applies to
the existing `/sheet` print route, home copy, and links to `/sheet`. The
paper-edge contract landed in #58; the detector and camera integration are
separate work. Do not expose a blank-paper path as ready until the full pipeline
and M2 ruler gate are verified.

Photos stay in the browser. Only derived millimetre values are sent. Numbers
shown to users come from tested TypeScript, and shape classifications remain
unrated until their gate passes.

## Open items before implementation (design review, 2026-09-25)

- **Mouse-shapes descriptors need a data source.** The three example lines on
  `07-mouse-shapes.png` ("Symmetric profile", "Right-hand profile",
  "Trackball form") are not in `src/db/seed/logitech.json`, which holds only
  dimensions, weight, warnings, connectivity and source URL. The shape and
  hand-compatibility descriptors from M1 stay out of the seed until the M1
  gate passes. Until a sourced, tested field exists (for example a
  first-party form-factor field with its Logitech `sourceUrl`), the page shows
  only what the catalogue already holds: name, length × width × height,
  weight. Never hard-code descriptor copy in a component.
- **Two states have rules but no screen**: sign-in when Google auth is not
  configured (align the copy with today's `src/app/account/page.tsx`:
  "Sign-in is unavailable right now." / "Start measuring without signing
  in"), and the empty **My results** state for an anonymous visitor.
- **Colours**: implement from the token table in
  `docs/design/journey-2026-09-23/README.md` (every text pair ≥ 4.5 : 1); the
  PNGs are not a colour source.
- **Menu accessibility** (focus trap, Escape, focus return to the trigger) is
  specified in text only; verify it in the implementation's e2e tests.
