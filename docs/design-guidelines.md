# Design Guidelines

Open_Mouse's UI/UX standard, adopted 2026-09-22. It follows Apple's interface
design principles (_Designing Fluid Interfaces_, _Principles of Great Design_)
translated to the web, and applied to **our** screens. Every frontend PR is
reviewed against this file.

The feeling to aim for: **precise, with impact.** _Revised 2026-10-03 (Kirby):
the reference is now the premium, high-impact feel of Apple's and ASUS ROG's
product pages; it replaces "calm confidence"._ Someone is measuring their own
hand, so the product must still feel precise and private. Impact comes from
one orchestrated moment per page, never from scattered effects. The visual
motif that is ours is **the measurement**: rulers, end ticks and landmark
points. Use it before reaching for glow. _These last two rules come from
Claude's 2026-10-03 UI audit, which Kirby approved as a whole ("全修")._

## Theme

The whole site is dark (Kirby, 2026-10-03), with one theme and
`color-scheme: dark`. The tokens and their contrast values live in
`docs/design/home-v3-2026-10-03/README.md#dark-theme-tokens`. Small text never
goes below `#8A8A8F` on the page background (5.9:1), and never sits on glow
above 15 %. Pressed states darken the fill; they never lower the opacity.

**Primary button** (Kirby, 2026-10-10, BTN-1, candidate): a near-white pill
(`--button-primary-bg` `#F5F5F7`, `border-radius: 999px`) with a near-black
label (`--on-button-primary` `#060709`, 18.5:1), pressed to `#D1D1D6`, and a
2 px `--accent-text` focus ring with an offset. Blue is for text, links, focus
rings and selected states (a selected toggle keeps its `--accent` fill and
white label, 4.75:1); it no longer fills a primary button. On paper the pill
prints black with a white label.

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
- Animate only `transform` and `opacity`. The one exception is the home
  page's canvas particle stage below (WebGL, with Canvas 2D as its fallback and
  for its overlay), which redraws its own pixels.
- **Signature motion (home page):** the particle stage in
  `docs/design/home-v3-2026-10-03/README.md`. Its rules:
  - it is driven by native scroll, with no snapping or scroll hijacking, and
    is reversible at any point;
  - the canvases are `aria-hidden`, and any text a step needs is real text in
    the DOM;
  - motion that starts on its own ends within 3 s (WCAG 2.2.2);
  - it pauses off-screen;
  - reduced motion and no-JS show static end states.

  Other sections get no extra entrance animations (no per-section fade or
  slide-up).

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
- **zh-TW (the default language)**, applied with `:lang(zh-TW)` once the i18n
  PR sets `<html lang>`:
  - `system-ui` (PingFang TC, Microsoft JhengHei);
  - `letter-spacing: 0`, because negative display tracking is for Latin only;
  - headline line height about 1.2, body text about 1.6;
  - `text-wrap: balance`, so no single character is left alone on a line.
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
- [ ] Contrast checked against the dark tokens (small text ≥ 4.5:1)
- [ ] Checked at 320×568, 375×667 and 390×844, and at 200 % text zoom; once the
      i18n framework lands, in zh-TW as well as English
