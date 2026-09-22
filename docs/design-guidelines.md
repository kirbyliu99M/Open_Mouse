# Design Guidelines

Open_Mouse's UI/UX standard, adopted 2026-09-22. It follows Apple's interface
design principles (_Designing Fluid Interfaces_, _Principles of Great Design_)
translated to the web, and applied to **our** screens. Every frontend PR is
reviewed against this file.

The feeling to aim for: **calm confidence.** Someone is measuring their own
hand, so the product must feel precise, private and unhurried, never gimmicky.

---

## Screens and what matters on each

### Sheet (`/sheet`)

- **Simplicity:** one job — print correctly. The single most prominent line is
  _Print at 100% / Actual size_. Everything else is secondary.
- The on-screen preview is exact-size and never rescaled. (It is tested: 1 page,
  210 mm.)

### Scan (`/scan`) — three photo slots

- **Wayfinding:** always show _step n of 3_, what the step is for, and how to
  leave. Never trap the user.
- **Response:** a slot reacts on pointer-down. After a file is chosen, show a
  status state immediately ("Reading photo…") — never a frozen UI while
  detection runs. Detection runs off the main thread where possible.
- **Feedback in four kinds**, each visually distinct:
  status (processing) · completion (✓ measured) · warning (usable, but e.g. low
  sharpness) · error (retake).
- **Errors are specific and actionable**, one instruction each: _"Marker 2 is
  hidden — keep all four corner squares visible."_ Not _"Detection failed."_
- **Agency:** replace any single photo without redoing the others. Nothing is
  lost on a retake.
- **Responsibility:** state _"Processed on this device — the photo is never
  uploaded"_ at the moment of choosing a photo, where it is relevant and true.
- **Mapping:** show the detected markers, card and landmarks overlaid on the
  user's own photo, so a retake reason points at the exact spot.

### Results

- **Hierarchy:** the top recommendation and _why_ it fits come first; the other
  ranked mice and the six sub-scores sit one level deeper.
- **Direct labels:** name things by what they are ("Grip width", "Hump
  position"), not internal terms ("sideCurvature").
- Numbers shown to the user come from the fit engine, never from Gemini prose.

### 3D viewer (M4b)

Direct manipulation, per the fluid-interface rules below: orbit tracks the
pointer 1:1, a flick carries momentum, zoom rubber-bands at its limits, and any
motion can be grabbed mid-flight.

---

## Motion

- **Springs, not fixed-duration animations, for anything a user touches.**
  Default: critically damped (`bounce: 0`, ~0.3–0.4 s response). Add bounce
  (~0.2, damping ≈ 0.8) **only** after a gesture that carried momentum — e.g.
  flicking the 3D model. Never on a panel that simply appears.
- **Interruptible always.** Animate from the current on-screen value; never
  block input during a transition.
- **Velocity handoff + momentum projection** for the 3D orbit:
  `projected = current + (v/1000)·d/(1−d)`, `d ≈ 0.998`.
- **Spatial consistency:** things leave the way they came; popovers and sheets
  grow from the control that opened them (`transform-origin`).
- Animate only `transform` and `opacity`.
- Library: `motion` (motion.dev) when springs are needed. Plain CSS
  transitions are fine for non-interactive state changes (e.g. a pressed
  button). Don't add a library for a single fade.

## Materials

- Floating chrome (the 3D viewer toolbar, sticky headers) is a translucent
  layer — `backdrop-filter: blur(20px) saturate(180%)` over a semi-transparent
  fill — with content scrolling beneath. Never stack translucent on translucent.
- Modal tasks (e.g. confirming data deletion) dim the background; non-blocking
  panels don't.

## Typography

- `system-ui` first; a custom face needs a reason.
- Tracking is size-specific: display text `letter-spacing: -0.02em` with
  `line-height ~1.05`; body text near `0` with `line-height ~1.5`.
- Spacing in `rem`, so the layout scales with the user's text size.
- Measurements are shown with tabular numerals (`font-variant-numeric:
tabular-nums`) so digits don't jitter as values update.

## Accessibility — built in, not bolted on

- `prefers-reduced-motion: reduce` → cross-fades instead of springs/slides; the
  3D model does not auto-rotate.
- `prefers-reduced-transparency: reduce` → solid surfaces, no blur.
- `prefers-contrast: more` → solid backgrounds with defined borders.
- Every upload slot, retake message and result is reachable and announced by a
  screen reader (`aria-live="polite"` for detection status).
- Touch targets ≥ 44 × 44 px.

## Review checklist (frontend PRs)

- [ ] Feedback on press, and a visible status while work runs
- [ ] Every error names the problem and the one action that fixes it
- [ ] Nothing animates that can't be interrupted
- [ ] Reduced-motion / transparency / contrast variants present
- [ ] Wayfinding: the user knows where they are and how to leave
- [ ] No internal vocabulary in user-facing text
