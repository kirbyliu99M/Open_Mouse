# Features and UI/UX audit — 2026-09-29

**Scope.** Every route on `main` at `5ffbdaa` (#71), run locally with
`next dev`. Automated pass: 11 routes × phone (375 × 812, touch) and desktop
(1280 × 800) × light and dark. That makes 44 screenshots, each checked for
touch targets, overflow, headings, labels, WCAG contrast, focus rings,
reduced-motion animations and console errors. A manual pass followed:
screenshots read by eye, the navigation menu driven by keyboard, and the source
read for anything the screenshots could not show.

**Corrections, 2026-09-30.** Two findings overstated the problem and are
corrected in place, in the blockquote under each: finding 3 (the preview
notice already exists in two places) and finding 5 (six of the seven demo
routes were already guarded at the audit's own commit, and the seventh is now).
The rest of the audit is unchanged.

**Status, 2026-10-04.** This is a snapshot of `main` at `5ffbdaa`; it is not
updated as findings are fixed. Later PRs addressed several of them, for example
#77 (finding 0, the hand detected reversed) and #74 (finding 1, re-scans now go
to `/scan/easy`), and the site has since moved to one dark theme (#109).
See `docs/STATUS.md` for the project's open items.

**Lenses.** The audit uses three lenses, and each finding is tagged with the
ones that apply:

- **[A] Apple design.** Fluid-interface and _Principles of Great Design_
  rules: response, interruptibility, spatial consistency, agency,
  responsibility, wayfinding.
- **[F] Frontend design.** A distinct identity grounded in the subject,
  copy that does one job, no templated tells.
- **[U] UI/UX Pro Max.** The priority-ordered checklist: accessibility,
  touch, performance, style, layout, typography, animation, forms,
  navigation.

`docs/design-guidelines.md` wins wherever it already speaks.

**Previous audit.** Most of the 2026-09-26 findings are fixed on `main`:

- The eyebrow, the 01/02/03 numbering, the spec cards and the arrow links are
  gone.
- The headline and the privacy copy are unified.
- Results has the `<h2>` and the poor-fit line.
- The left-hand line exists.

The findings below are new, or were left open.

---

## Verdict

The individual screens are in good shape.

- The automated pass found no horizontal overflow, no console errors and no
  sub-44 px targets apart from visually hidden file inputs.
- Every focus ring is visible.
- Light-mode contrast passes on every page.
- The visual identity matches its subject: drafting blue, a line-drawn mouse
  sketch, a dimension line and tabular figures.

**The product's problem is the journey, not the screens.** Two calibration
journeys are live at once and send users back and forth between them. The
first capture screen asks for the camera before it has explained anything.
Several promises made on a screen are not kept anywhere else.

| Severity                      | Count |
| ----------------------------- | ----- |
| P1 — breaks trust or the flow | 6     |
| P2 — a clear defect           | 9     |
| P3 — polish                   | 8     |

---

## Feature inventory (what a user can reach on `main`)

| Feature                                  | Route                                                       | State                                                                     |
| ---------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------- |
| Landing                                  | `/`                                                         | Live; static sketch                                                       |
| How it works                             | `/how-it-works`                                             | Live                                                                      |
| **Easy scan**: blank paper + live camera | `/scan/easy`                                                | **Primary entry.** Auto-capture, upload fallback, grip after measuring    |
| Classic scan: printed sheet + bank card  | `/scan`                                                     | Still live; reached from Results, Account and `/sheet`                    |
| Printable calibration sheet              | `/sheet`                                                    | Live; linked from Account's empty state                                   |
| Results + written analysis               | `/results/[scanId]`                                         | Live; Gemini prose labelled; unrated shape sub-scores disclosed           |
| Delete a scan                            | Results, Account                                            | Live                                                                      |
| Account and sign-in                      | `/account`                                                  | Sign-in unavailable (no OAuth yet); explained honestly on the page        |
| Navigation menu                          | every page                                                  | Native modal `<dialog>`: Home, Scan my hand, How it works, Account        |
| Demo and mock routes                     | `/results/demo`, `/scan/*-demo`, `/scan/paper-edge-preview` | Titled "(mock data)". Corrected 2026-09-30: 404 in production (finding 5) |
| Mouse shapes: browse and compare         | —                                                           | In the 09-25 product-shell design; not built                              |
| Privacy page                             | —                                                           | Not built. "Read Privacy & data" links to a card on the same page         |
| My results                               | —                                                           | In the product-shell menu spec; not built                                 |
| 3D viewer (M4b)                          | —                                                           | Not built (not required for launch)                                       |

---

## P1 — breaks trust or the flow

**0. Detected hand is reversed for palm-down photos. [A responsibility] [U feedback] — found while testing the learning kit, after this audit's first commit**

`normalizeHandedness` (`src/client/photo/landmarks.ts:75`) swaps
MediaPipe's label, assuming the photo is not mirrored. That reasoning
ignores that the hand is photographed palm down: a rear-camera photo of the
back of a hand is itself a mirror of MediaPipe's palm-facing convention, so
the two flips cancel. Measured through the real pipeline (MediaPipe
in-browser, `/learn/check` on the `learning-kit` branch):

| Photo                                    | Hand in photo    | Pipeline says (confidence) |
| ---------------------------------------- | ---------------- | -------------------------- |
| Kirby's 2026-09-23 photo (a local photo) | right, palm down | **left** (0.91)            |
| the same photo mirrored                  | left, palm down  | **right** (0.96)           |
| `public/images/hand-on-a4-camera.png`    | left, palm down  | **right** (0.93)           |

Consequences on `main`:

- **Easy scan** auto-labels a right-handed user's scan "Left hand · auto".
  Results then show the left-hand line.
- **The printed-sheet flow** rejects a correct right-hand photo with
  `HANDEDNESS_MISMATCH` ("This looks like your left hand…").

The function's comment says it is unit-tested, but no test calls it.

→ Return MediaPipe's category unchanged (lower-cased) for palm-down
rear-camera photos. Add a unit test naming the convention, and an e2e check
on a real right-hand photo. Verify on three or more real photos from the
learning kit before merging. This needs its own reviewed PR, because the
easy-scan e2e asserts on the "· auto" chip.

**1. Two calibration journeys, crossed. [A wayfinding, familiarity] [U navigation]**

The front door (`/`, `/how-it-works`, the menu, Account's main button) says
_"A blank sheet of A4 … No printing"_ and leads to `/scan/easy`. Every way
back into a scan, however, leads to the old printed-sheet flow:

- Results → "Scan again" → `/scan` ("Photograph your hand on the sheet next
  to a bank card", "Step 2 of 2", "‹ Sheet").
- Results' error state → "Scan again" → `/scan`.
- Account's empty state → `/sheet` ("Print the sheet").

So a second scan asks for a printer and a bank card that the landing page
said weren't needed.

→ Point every "Scan again", and every link to `/scan` or `/sheet` outside the
learning kit, at `/scan/easy`. Keep `/scan` and `/sheet` for ground truth only
(see the learning kit) and remove them from the user journey.
Files: `src/components/results/ResultsView.tsx:29`,
`src/app/results/[scanId]/ResultsPageClient.tsx:122,149,235`,
`src/app/account/AccountView.tsx:116`.

**2. The camera prompt comes before the explanation. [A responsibility: "ask at the right moment"] [U accessibility, forms]**

`EasyScanCamera` calls `startCamera()` on mount
(`src/client/camera/EasyScanCamera.tsx:583`), while the first-run tip sheet
("One blank sheet is all you need … Got it") is still open. On a first visit,
the browser's permission prompt lands on top of an explanation the user has
not read yet.

A refusal is worse. The screenshot shows _"The camera couldn't be opened …
Open your browser's site settings"_ under the tip sheet, before the user has
chosen anything. A permission a user refuses once is hard to win back.

→ On first run, request the camera only after "Got it". On later visits,
where the tip is already dismissed, open it at once as today. Say why in one
line on the tip itself: "Next, your browser asks to use the camera. The video
stays on your phone."

**3. The blank-paper path is presented as ready before its accuracy gate. [A responsibility] [F copy]**

The product-shell design (`docs/design/product-shell-2026-09-25/README.md`)
says: _"Do not expose a blank-paper path as ready until the full pipeline and
M2 ruler gate are verified."_ On `main` it is the only advertised path. The
only caveat is one small line under the button: "Early preview — measurements
are still being validated."

M2 has no measured numbers at all yet (`docs/STATUS.md`, Gate results).

→ Either keep the caveat and move it into the results. Next to the measured
hand length, add "Measured from your photo; accuracy not yet verified" until
M2 passes. Or collect the learning-kit data first (below) and let the M2
numbers decide. A caveat that appears only before the scan is forgotten by the
time the number shows up.

> **Correction, 2026-09-30.** The preview notice is not "one small line under
> the button". It already exists in two places on `main`: the landing page
> ("Early preview — measurements are still being validated.",
> `src/app/page.tsx`) and the results page ("Early preview · measurements still
> being validated.", `src/app/results/[scanId]/ResultsPageClient.tsx`). What
> was missing is the caveat next to the number itself. #92 (merged 2026-10-03)
> adds it beside every measured number on the scan screens
> (`src/client/photo/unverified-note.ts`); the shipped wording is "Measurements
> are still being validated.", not the draft that mentioned a ruler. The alternative in the arrow above, waiting for the
> M2 data from the learning kit, stays open.

**4. The dark-mode selected chip fails contrast (1.98 : 1). [U accessibility P1]**

On the easy-scan result sheet in dark mode, the selected grip chip ("Not
sure") has light-blue text on a light-blue fill. The fill is also the only
thing that shows it is selected (colour-only state).

→ Selected chip in dark mode: solid `--accent` fill with the dark ink text
that "See my matches" already uses, plus a check glyph or
`aria-pressed`-driven weight change.
File: `src/client/camera/easy-scan.css` (chip selected state under
`prefers-color-scheme: dark`).

**5. Mock and demo routes are public in production. [A purpose, responsibility] [U navigation]**

`/results/demo`, `/scan/measured-demo`, `/scan/easy/measured-demo`,
`/scan/grip-race-demo`, `/scan/submit-demo`, `/scan/paper-edge-preview` and
`/scan/paper-edge-measured-demo` all ship. They are titled "(mock data)", and
`/results/demo` opens with "Renders `ResultsView` against fixture
`FitResponse` data", which is internal vocabulary.

Someone who lands there from a shared link sees a fake ranking with a "91 fit
score".

→ Gate them behind `NODE_ENV !== "production"`, or a
`OPEN_MOUSE_DEMO_ROUTES` flag that e2e sets, and return `notFound()`
otherwise. Keep them in e2e.

> **Correction, 2026-09-30.** At the audit's own commit (`5ffbdaa`) six of the
> seven routes above already returned 404 in production:
> `guardDemoRouteFromProduction()` (`src/app/scan/demo-guard.ts`, commit
> `3aae1cc`, 2026-09-24) was on `/scan/measured-demo`,
> `/scan/easy/measured-demo`, `/scan/grip-race-demo`, `/scan/submit-demo`,
> `/scan/paper-edge-preview` and `/scan/paper-edge-measured-demo`. Only
> `/results/demo` was public. #82 (merged 2026-09-30) put the same guard on it.
> `main` at `3a585a3` has the guard on all ten demo pages, including the three
> added since (`/scan/easy/hand-mismatch-demo`, `/scan/hand-explicit-demo`,
> `/scan/easy/length-failure-demo`). **Public demo pages in production: none.**
> This comes from reading the pages on `main` and from the tests that pin it
> (`tests/unit/demo-guard.test.ts`, `tests/unit/scan-routes-guarded.test.ts`),
> not from requesting the production site.

---

## P2 — a clear defect

**6. Sign-in is offered where it cannot work. [A agency, familiarity] [U navigation: `empty-nav-state`]**

The home page header shows a blue "Sign in" link (`src/app/page.tsx:30`). It
leads to a page
whose main message is "Sign-in is unavailable right now". The product-shell
spec says: _"If Google auth is not configured, replace the sign-in button with
the existing unavailable status."_

→ While `isAuthConfigured()` is false, hide "Sign in" from the home header
and keep "Account" in the menu only.

**7. Account promises features that are off. [A responsibility] [F copy]**

The list says "Your scans stay until you delete them · Open your results on
any device · Delete everything in one tap, any time". The next card says
sign-in is unavailable.

→ While auth is off, lead with what is true today: "Without an account, a
scan and its results are deleted within 24 hours." Keep the benefits list as
"When sign-in opens: …". The card under the button already says this; move it
up.

**8. Easy scan has no `<main>` and no `<h1>`. [U accessibility: heading hierarchy, landmarks]**

`/scan/easy` has zero headings and no `main` landmark. Its dialogs use
`<p className="easySheetTitle">` as their titles. A screen-reader user
arrives on an unlabelled camera page.

→ Wrap the camera shell in `<main>` and add a visually hidden
`<h1>Scan your hand</h1>`. Make each sheet title an `<h2>` and point the
dialog's `aria-labelledby` at it.

**9. The upload input has no label on the measured state. [U forms: `input-labels`]**

`#easy-scan-upload` has no label or `aria-label` on
`/scan/easy/measured-demo` (and therefore on the real measured state).

→ `aria-label="Upload a photo of your hand on paper"`, or associate it with
the visible upload button.

**10. Page titles don't name the page. [U navigation: deep linking] [A wayfinding]**

`/`, `/how-it-works` and `/account` are all titled "Open_Mouse". So is every
tab and history entry. The underscore is also the repo name, not the product
name the pages show ("Open Mouse").

→ Use "Open Mouse", plus "How it works — Open Mouse" and "Account — Open
Mouse". Put the template in `layout.tsx` metadata
(`title: { default, template }`).

**11. Two equal primary buttons on `/scan`. [U style: `primary-action`] [A simplicity]**

"Open camera" and "Upload a photo instead" are both solid blue, full width.
The word "instead" already makes upload the secondary action.

→ Style upload as the secondary style used elsewhere (outline, or text on
surface). _(`/scan` leaves the user journey under finding 1, so this matters
only if `/scan` stays reachable.)_

**12. The menu has no current-page state and misses two routes. [U navigation: `nav-state-active`] [A wayfinding]**

- No item carries `aria-current="page"` or any visual highlight.
- The product-shell menu specifies "My results" and "Privacy". Neither exists.

→ Set `aria-current` from `usePathname()`, with a 3 px drafting-blue
leading bar plus semibold weight. Add "Privacy" once a privacy page exists
(finding 13). Add "My results" with its empty state when there is a current
result.

**13. No privacy page. [A responsibility] [U navigation]**

"Read Privacy & data." on `/how-it-works` links to `#privacy`, the card
directly above it. The product makes three privacy promises: the photo stays
on the phone, 24-hour deletion, and Gemini receives only numbers. There is
nowhere to read them in full, or to learn what is stored and how to delete
it.

→ A plain `/privacy` page listing:

- what is sent, with the exact fields;
- what is stored, and for how long;
- what Gemini receives;
- how to delete;
- who runs the site.

Link it from the menu, the footer and the camera tip. This also closes R4's
"re-verified" evidence.

**14. Menu exit is not symmetric. [A spatial consistency §7]**

The panel slides in from the right (`navMenuSlideIn`), but `dialog.close()`
removes it instantly. "If something disappears one way, we expect it to
emerge from where it came."

→ Animate the close back to the right (transform and opacity, about 200 ms,
roughly 70 % of the entry time), then call `close()`. With reduced motion, a
plain close. Also, the close glyph is a text "×"; use the shared SVG icon set
(`src/client/camera/icons.tsx`) like the rest of the app.

---

## P3 — polish

**15. Emoji as icons in the tip sheet. [U style: `no-emoji-icons`] [F]**

📄 and 📱 sit beside the SVG `HandIcon` in the same list (`EasyScanCamera.tsx:1380,1387`). They render as colour
emoji in a line-drawn system, and differently on every OS.

→ Add `PaperIcon` and `PhoneIcon` to `icons.tsx`, same 1.75 px stroke.

**16. No press feedback in the capture flow. [A response §1] [U touch: `press-feedback`]**

`:active` states exist in globals, home, scan, sheet, top-bar and results
CSS, but not in `easy-scan.css`, `camera.css` or `nav-menu.css`. The shutter,
grip chips, retake, help and menu items give no feedback on touch-down, and
this is the screen used most.

→ `transform: scale(0.97)` with a 100 ms ease-out on `:active` for these
controls, and `touch-action: manipulation` on the camera shell.

**17. The home sketch is static. [A delight] [F one orchestrated moment]**

The product-shell spec calls for the sketch to move between top view, side
profile and hand fit (tap to switch; instant under reduced motion). No
animation runs on `/`. This is the one place the page could carry motion, and
it would also teach the three concepts the ranking uses.

→ One orchestrated outline-draw on load, plus tap-to-switch between the three
views. No loop.

**18. The dimension row is ambiguous. [F]**

"G Pro X Superlight 2 · sketch" is followed by a 125 mm dimension line, then
"125 × 63.5 × 40 mm 60 g". The length appears twice.

→ Keep the dimension line (it is the memorable element). Change the row to
"63.5 mm wide · 40 mm high · 60 g", so each number appears once, next to what
it measures.

**19. Tip copy. [F copy]**

"Shown once." opens the privacy line, so the first thing the fine print says
is about the tip itself.

→ Drop "Shown once." The dialog's own behaviour makes it obvious.

**20. Right-hand default is presented as detected. [A agency]**

The chip "Right hand · auto" shows before any hand is in frame.

→ Before detection, read "Right hand" with the chip as a picker. Add
"· detected" only once MediaPipe agrees.

**21. Dark-mode scrim over the camera error. [U light/dark: scrim legibility]**

Under the tip sheet, the error card reads as a muddy brown block (translucent
amber over a dark scrim). It is behind a modal, so this is cosmetic, but it
disappears once finding 2 is fixed (no error before "Got it").

**22. `/sheet` SVG has no accessible name. [U accessibility: alt text]**

The printable sheet `<svg>` has no `role="img"` or `aria-label`.

→ `role="img" aria-label="Calibration sheet: six square markers, a 100 mm
check ruler and a card outline"`.

---

## What is already right (keep it)

- **Identity.** Drafting blue (#0A64E0) on cool paper grey, a line-drawn mouse
  with a dimension line, system-ui with −0.02 em display tracking and tabular
  figures. It reads as calipers and technical drawing, not a SaaS kit. [F]
- **Honesty in Results.** "Shape not rated yet", the poor-fit line, the
  left-hand line, and prose labelled as model-written. Every number is from
  the fit engine. [A responsibility]
- **Accessibility baseline.**
  - `prefers-reduced-motion`, `-transparency` and `-contrast` are handled in
    every stylesheet that moves or layers.
  - Focus rings are visible everywhere.
  - Inputs meet 44 px.
  - The menu is a native modal `<dialog>`: focus goes in, Escape closes, and
    focus returns to "Open menu". [U]
- **Upload fallback** on every camera failure, with numbered recovery steps.
  [A agency]

---

## Suggested order

1. Finding 0 first, on its own PR: the handedness fix, verified on real
   photos.
2. Findings 1, 2, 4, 8, 9, 10: one Sonnet builder, one PR ("journey and
   accessibility fixes"). Small, testable, no design decisions left.
3. Finding 5: gate demo routes (touches e2e config). _Done: see the
   correction under finding 5._
4. Findings 6, 7, 12, 13: needs **Kirby**: privacy page wording and the
   auth-off navigation.
5. Finding 3: decided by the M2 data, which the learning kit (branch
   `learning-kit`) is built to collect.
6. P3 items: batch with the home-sketch motion (finding 17) as one design PR.

Evidence (screenshots and `audit.json`) was generated locally and is not
committed. It can be reproduced with `node audit.mjs http://127.0.0.1:<port>`
(Playwright over every route; the script is a local one and can
be committed under `scripts/` if wanted).
