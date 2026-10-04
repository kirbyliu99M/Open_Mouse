# Easy scan, real main page and login (2026-09-25)

Kirby: the camera flow felt rigid — "easy scan with blank A4, can it be
achieved too?" — and the UI needed a real main page and login. Drawn on the
pen.dev canvas (frames 11–16); exports in [`screens/`](screens/).

| Screen                                           | File                                                                     |
| ------------------------------------------------ | ------------------------------------------------------------------------ |
| Main (real landing)                              | [11-main.png](screens/11-main.png)                                       |
| Login, sign-in configured                        | [12-login-available.png](screens/12-login-available.png)                 |
| Login, sign-in not configured (production today) | [13-login-unavailable.png](screens/13-login-unavailable.png)             |
| Easy scan, live                                  | [14-easy-scan-live.png](screens/14-easy-scan-live.png)                   |
| Easy scan, first-run tip                         | [15-easy-scan-first-run-tip.png](screens/15-easy-scan-first-run-tip.png) |
| Easy scan, measured                              | [16-easy-scan-measured.png](screens/16-easy-scan-measured.png)           |

## What makes it less rigid

The old flow asked for hand, grip and paper size, showed a primer page, a
review page, then a measured page — five decisions before a result.

1. **One tap to the camera.** "Scan my hand" on the main page opens the
   camera directly. No setup page.
2. **Nothing is asked before the photo.**
   - **Hand** is inferred: MediaPipe's handedness (already computed by the
     pipeline's handedness gate) picks left/right; the chip shows
     "Right hand · auto" and a tap flips it. Default right until the first
     detection.
   - **Paper size** is a small "A4" toggle on the viewfinder (A4 ⇄ Letter),
     default A4, remembered in `localStorage`.
   - **Grip** moves to after the measurement, optional, with "Not sure"
     selected by default (= no stated grip; the engine predicts it).
3. **The first-run tip replaces the primer page.** A bottom sheet over the
   live camera, dismissed with "Got it", shown once (`localStorage` flag;
   still reachable from a small "?" if you want).
4. **No separate review page.** Auto-capture (or the shutter) runs the
   pipeline immediately; the measured sheet slides up over the frozen photo
   with the hand-length and palm-width dimension lines drawn on it. Retake is
   one button on that sheet. A pipeline gate failure shows its one fix in the
   same sheet with "Try again".
5. **Upload stays one tap away** (image icon on the viewfinder) for desktop,
   denied permission, or anyone who prefers it.

Everything else from the camera spec stands: one cue at a time, per-corner
lock-on, the 800 ms auto-capture ring, photos never leave the device.

## Main page (11)

- Nav: wordmark · "Sign in" · menu.
- Preview pill stays until the M2 ruler gate passes.
- Headline "Find the mouse that fits your hand."; subhead names blank A4 and
  the 30-mouse Logitech catalogue (numbers from the seed, not hard-coded:
  count the catalogue).
- Hero: the photo `public/images/hand-on-a4-hero.png` (AI-generated
  illustration, 2026-09-25 — label it as an illustration in its `alt`, never
  as a real scan) with the four green corner checks and "All four corners
  found".
- Primary CTA "Scan my hand" → camera. Under it: "No printing, no sign-up.
  About a minute."
- How it works: three rows (blank sheet · hand flat, phone above · your best
  matches).
- Privacy card: photo never leaves the phone, only measurements are sent;
  anonymous scans deleted within 24 hours (both already true and tested).
- "Browse the mice first" row → the catalogue page when it exists; until
  then hide it (no dead links).
- Footer: sign-in link, "Not affiliated with Logitech. Sizes from Logitech's
  published specs."

## Login (12, 13)

- Top bar "‹ Home" · "Account". Heading "Keep your scans"; subtitle: signing
  in is optional, anonymous scans are deleted within 24 hours.
- Three benefits: stays until you delete it · any device · delete everything
  in one tap.
- Configured (12): "Continue with Google" (outlined, neutral — no drawn
  Google logo; if a logo is wanted later, use Google's official asset under
  their branding rules), "Scan without an account" link, fine print "We keep
  your email address and your scans — never your photo. Your current scan
  joins your account when you sign in."
- Not configured (13, today's production): an info notice "Sign-in is
  unavailable right now. You can still scan — your result is kept for 24
  hours." and the primary "Start measuring without signing in".
- Must stay consistent with #52 (sign-in stays off in production until it is
  fixed).

## Tokens

Same as `docs/design/journey-2026-09-23/README.md` (bg #F4F4F6, surface
#FFFFFF, text-primary #1C1C1E, text-secondary #55555D, accent #0A64E0,
accent-soft #E7F0FD, border #D5D5DC, ok #1E7B45); Inter. The camera screens
use white text on dark scrims or on solid pills (≥ 4.5 : 1). The PNGs are
not a colour source.

## Revision 2026-09-26: landing with a G Pro sketch; "How it works" as its own page

Kirby: the landing should carry a sketch of a G Pro as its main theme with
headlines; putting the introduction straight on it is too raw, it deserves a
separate page.

| Screen                             | File                                                               |
| ---------------------------------- | ------------------------------------------------------------------ |
| Landing (replaces 11 as `/`)       | [17-landing-g-pro-sketch.png](screens/17-landing-g-pro-sketch.png) |
| How it works (new `/how-it-works`) | [18-how-it-works.png](screens/18-how-it-works.png)                 |

**Landing (17)**

- Eyebrow "EARLY PREVIEW · HAND-FIT RANKING" (the preview label stays until
  the M2 ruler gate passes).
- Headline "Shape matters more than specs."; subhead "The right mouse starts
  with the size of your hand."
- The sketch `public/images/sketches/g-pro-sketch.svg` (moved there, and
  recoloured to the dark theme's two stroke colours, in Home v3; generated on pen.dev as a
  line drawing in the style of the G Pro X Superlight 2 — no Logitech logo,
  wordmark or trade dress beyond the shape; keep it logo-free). Caption
  "G Pro X Superlight 2 · sketch".
- Spec strip — Length 125 mm · Width 63.5 mm · Height 40 mm · Weight 60 g —
  read from the catalogue row for "G Pro X Superlight 2" (seed/DB), never
  typed into the page.
- Primary "Scan my hand" → `/scan/easy`; text link "How it works →" →
  `/how-it-works`.
- Three numbered headlines, separated by hairlines (not boxes):
  01 "One photo. No printing." / "A blank sheet of A4 is the ruler."
  02 "Ranked for your hand, not the hype." / "{count} Logitech mice scored on
  length, grip width and weight." (count from the catalogue)
  03 "Your photo never leaves your phone." / "Only the measurements are sent."
- Footer: preview line, "Not affiliated with Logitech. Sizes from Logitech's
  published specs."

**How it works (18)** — the previous main page content moves here: "‹ Home"
back link, title "How it works", the hand-on-A4 illustration with corner
checks, "Three steps", "Scan my hand", the privacy card, a privacy link.

### Sketch v2 (2026-09-26)

Kirby: the first sketch missed the side buttons and read too short. The
sketch is regenerated on pen.dev ("Asset · G Pro style sketch v2") from a
low three-quarter view on the left side, so the length (≈ 2 : 1 at
125 × 63.5 mm) reads and the two side (thumb) buttons are visible. The
landing sizes it by its own aspect ratio and lets it bleed slightly past the
text column. Screen 17 (canvas and PNG) updated to v2 and to the audited layout.
