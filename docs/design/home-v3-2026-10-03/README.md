# Home v3: implementation spec (2026-10-03)

This spec is for the UI lane. The source of truth is the pen.dev canvas: the
frames named `[Home v3] …` under the header "Home v3 header". The PNGs in
`screens/` are 1× exports of those frames.

## Decisions (Kirby, 2026-10-03)

- The whole site moves to a **dark theme**: home, How it works, results and
  account, not only the home page. It is one theme, not a light/dark pair that
  follows the system setting.
- `docs/design-guidelines.md` moves from "calm confidence" to the premium,
  high-impact feel of Apple and ASUS ROG. That change ships in the same PR as
  this spec.
- The particle hand shows **no measurement numbers**, only the lines and end
  ticks. Demo values must never read as a user's result.
- The home page tells **one continuous particle story** (see
  [The particle stage](#the-particle-stage)). The order (Kirby, revised
  2026-10-03):
  1. the hero is the logo with the big headline;
  2. on scroll, the particles scatter and form a hand;
  3. on scroll again, the hand re-forms as three mice.
- The three taglines below the CTA ("One photo. No printing." and the other
  two) are removed.
- The "Measure your hand." line above the headline is removed, in every
  language.
- The zh-TW strings in [Copy](#copy) are confirmed.
- **No photo-privacy line on the home page** (Kirby, 2026-10-03, after this
  spec first merged). The third tagline, "Private by design.", carried the
  home page's only copy of `PHOTO_PRIVACY_COPY` ("Your photo never leaves your
  phone. Only measurements are sent."). It goes with the taglines and is not
  moved elsewhere on the home page. The promise stays on How it works, the
  scan screens and the camera. A separate privacy-rights statement page is
  planned for later (candidate).

Still **not decided (未拍板, candidate)**:

- The logo. The particle logo in the hero (Story 1) is a placeholder.
- Which three mice the last step shows. All three are G Pro placeholders until
  more sketches exist.
- Whether to add the copy "Find your best mouse".
- A sticky "Scan" bar on mobile once the hero scrolls away.
- The particle-count and performance numbers below. They are Claude's targets
  and must be measured on a real phone before they are treated as fixed. That
  includes the WebGL stage's budgets (6,000 on a phone and 12,000 on a desktop),
  its slow-frame guard and its pixel-ratio caps (see
  [Rendering and performance](#rendering-and-performance-targets-未拍板-until-measured)).

## Delivery: two PRs

1. **PR A: dark foundation and home layout, without particles.**
   - **Make the site dark.**
     - 9 of the 11 CSS files in `src` already have a
       `@media (prefers-color-scheme: dark)` block. Promote those blocks to the
       default and drop the light defaults.
     - `sheet.css` writes its block as
       `@media screen and (prefers-color-scheme: dark)`. Keep it scoped to
       `screen`, so print is unaffected.
     - `src/client/camera/camera.css` and `easy-scan.css` have no block of
       their own. They read `--scan-*` variables (dark values in
       `src/app/scan/scan.css`), so check their hex fallbacks.
     - The whole site then turns dark in one PR, and no page is left
       half-light.
   - **Map the old variables onto the new tokens.**
     - `--scan-bg` becomes `--bg`.
     - `--scan-accent` has two jobs today. Where it fills a button, it becomes
       `--accent`. Where it colours text, an outline, a focus ring or a
       selected chip, it becomes `--accent-text`.
       - `#1F6BF0` is only 4.24:1 on `--bg` and 2.6:1 on the selected-chip
         fill, so it must never be used for text.
       - `easy-scan-measured.spec.ts` checks that chip.
     - `--scan-on-accent` becomes `--on-accent`. Today's dark scan button is a
       light blue `#79adff` with a dark label. It becomes `#1F6BF0` with a
       white label.
     - The other `--scan-*` variables (`fg`, `muted`, `border`,
       `accent-soft`, `status-*`) keep their current dark values.
     - Hard-coded `#0a64e0` / `#79adff` accents (today in all 11 CSS files in
       `src`, including `--learn-accent`) go through the tokens too.
     - Print-only colours inside `@media print` stay as they are.
     - **Acceptance:** outside the token definitions and print rules, no
       hard-coded accent hex is left in `src/**/*.css`, so the site has one
       primary button.
   - **Print stays light.** Add an explicit
     `@media print { :root, body { background: #fff; color: #000; } }`. Today
     the white comes only from the SVG backgrounds, and the dark root would
     show at the bottom of an A4 page when background graphics are on.
   - Set `color-scheme: dark`.
   - **Lay out the home page** as in the screens, with **static** SVGs where
     the particles will go (see [Static images](#static-images-pr-a)).
   - **Write the sampling half of the target generator** (see
     [Targets](#targets-precomputed-pure-and-tested)): path sampling and
     resampling, with unit tests. The static SVGs are rendered from the same
     point lists, so the static and animated versions match. Pairing and
     interpolation come in PR B.
   - Move `g-pro-sketch.svg` to `public/images/sketches/`.
   - Update the tests listed in [Tests to update](#tests-to-update).
2. **PR B: the particle stage.** It adds the canvas on top of PR A's layout.
   PR A's static SVGs stay as the reduced-motion, no-JS and small-screen
   fallback.

## Screens

| File                                           | What it shows                                                                                            |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `screens/01-mobile-zh-tw.png`                  | Mobile 390 wide, zh-TW, end state of every animation                                                     |
| `screens/02-mobile-iphone-se-first-screen.png` | 375×667, first screen only: both buttons on one line and the Early preview note fit                      |
| `screens/03-mobile-en.png`                     | Mobile 390 wide, English (also the static PR A layout)                                                   |
| `screens/04-desktop-en.png`                    | Desktop 1440 wide, English, 1200 px content container                                                    |
| `screens/story-1 … story-6`                    | The particle story, one frame per state (mobile scale). Storyboard only: the mouse captions are left out |
| `screens/logo-placeholder-vector.png`          | The placeholder mark as plain lines, only to make the shape legible                                      |

The screens show particles at full design density. The implementation
resamples every target to the particle budget (see
[Rendering and performance](#rendering-and-performance-targets-未拍板-until-measured)),
so it will look a little sparser. The screens are 1× design exports; don't
ship them as images.

## Page structure

DOM order:

1. `nav`: the wordmark, then "Sign in" and the existing `NavMenu`. Each
   control has a hit area of at least 44 × 44 px.
2. Story section `<section class="story">`, with one panel element inside. In
   order, the panel contains:
   1. the hero: the logo (a static `<img>`, decorative, empty alt), then the
      `h1`, the subhead, the two buttons and the Early preview note;
   2. the hand (a static SVG);
   3. the three mice (static SVGs), each with its caption as real text;
   4. the two `<canvas>` elements (PR B only): the WebGL one first, then the
      2D overlay last (see Layers below).
3. Final section: both buttons again and the Early preview note again.
4. Footer disclaimer: left-aligned on mobile, centred on desktop.

**Static layout.** This is PR A. In PR B it is also used under reduced motion,
without JS, or when the hero doesn't fit (see below). The section and panel
are ordinary blocks, and their parts stack in flow, as in
`screens/03-mobile-en.png`. There is no extra height and no empty gap.

**Animated layout** (PR B):

- **When to switch.** JS adds `story--animated` only after the particle module
  has loaded and drawn its first frame, and only when all three hold:
  - motion is allowed;
  - the hero's measured height fits in `100svh` (so not at 320×568, in
    landscape on a phone, or when a large text size makes the hero taller than
    the window: a tall enough window still holds it, so the switch follows the
    window's height and the text size together);
  - the viewport is at least about 600 px tall.

  Otherwise the page stays static. If the module fails to load, nothing
  changes.

- **The section and the panel.** The hero keeps exactly the same position in
  both layouts, so switching causes no layout shift. The section grows to
  about 400 svh (to be tuned). The panel becomes
  `position: sticky; top: 0; height: 100svh`.
- **Layers.** The panel holds two canvases, one on the other: the WebGL canvas
  (`.story-canvas-gl`, the particles) under the 2D canvas (`.story-canvas`,
  the overlay, and the particles too when WebGL is not available). Both are
  `aria-hidden="true"` and positioned `absolute; inset: 0; z-index: 0`, with
  `pointer-events: none`; the 2D one is later in the markup, so it is on top.
  The hero and the captions sit above them (`position: relative; z-index: 1`),
  so every button stays clickable. One canvas can not give both a 2D and a
  WebGL context, hence two. The lower one is shown only while the section's
  `data-renderer` is `webgl`.
- **Progress.** `p` is clamped to [0, 1]. It is 0 when the panel pins (the
  nav has scrolled away by then) and 1 when the section's bottom reaches the
  panel's bottom.
- **Logo handoff.** The stage draws the logo (on the WebGL canvas, or the 2D
  one on the fallback path) at the static `<img>`'s rect
  (`getBoundingClientRect`). Once that frame is drawn, it hides the `<img>`
  with `visibility: hidden`, so there is never a double logo.
- **Hero text.** From p = 0 to 0.10 the hero text fades and moves up, using
  opacity and transform only. Below opacity 0.05 the buttons and links get
  `inert`, so hidden controls can't be tabbed to; the h1 stays in the
  accessibility tree. Scrolling back reverses this.
- **Static hand and mice.** Their SVGs are hidden; the canvas draws those
  states. The three captions are absolutely positioned in the panel at the
  mice's target rects, and fade in as the mice settle.
- **Exit.** At p = 1 the sticky panel releases. The three mice and their
  captions scroll up with the panel, and the final section follows. Nothing
  disappears abruptly. The canvas stops drawing once the panel is off screen.

Buttons:

- "Scan my hand" is the filled primary; "How it works" is the outline
  secondary.
- **Acceptance:**
  - from 360 px wide up, the two sit on one line, as in screen 02;
  - when they no longer fit (320 px, or large text zoom), they stack, each at
    full width, primary on top.

  A workable start is `flex-wrap: wrap; gap: 0.75rem`, with the primary at
  `flex: 1 1 10rem` and the secondary at `flex: 1 1 8rem`, and
  `min-height: 3.125rem`. On desktop the primary is about 14rem and the
  secondary about 10.5rem.

- Fully rounded.
- Pressed state: darken the fill to `--accent-pressed`. Never drop opacity:
  `opacity: 0.85` on the button would take the white label to 4.33:1.

Hero sizes (the logo slot includes room for the glow; the mark itself is
about 60 % of the slot's height):

| Viewport     | Slot height                  | Logo mark height |
| ------------ | ---------------------------- | ---------------- |
| 375×667      | `clamp(18rem, 40svh, 24rem)` | about 9.5rem     |
| 390 wide     | same                         | about 11rem      |
| 1440 desktop | about 29rem                  | about 19rem      |

**Short desktop windows** (Kirby, 2026-10-04: laptop windows animate too). The
desktop hero is 674 px tall at full size, and the stage switches on only when
the hero fits in `100svh`, so a 1280×640 or 1366×657 window stayed static. The
fit rule is kept; the hero shrinks instead, at 48rem and up, with the window's
height (`home.css`, `.story-hero` and `.story-logo`). **The numbers below
(740 px, 44 px, 14rem, 32rem, 0.5rem) are 未拍板 (candidate) until Kirby checks
them on a real laptop;** each is one value in `home.css`.

- everything is linear in `100svh` and clamped, so it shrinks continuously and
  there is no breakpoint to jump at;
- full size from 740 px of height; the headline goes from 60 px down to 44 px,
  and two gaps tighten, as the height falls to 600 px;
- the logo slot takes what is left: `100svh` less the nav and the rest of the
  hero, so the whole hero (buttons and note too) is above the fold at the top
  of the page, from a 14rem floor up to the full 29rem;
- below 600 px the page is static, and shows the same shrunken hero. So do
  reduced motion and no JS, at any height under 740 px: one CSS serves the
  static and the animated page, which is what keeps the switch from shifting
  anything;
- the subhead may be 32rem wide here, so it is one line in a wide font too;
- the copy, the order, the 44 px hit areas and the colours do not change.

It is a calculation, not a fit: it assumes a one-line headline and subhead. A
very large text size, or a narrow window (768 to 860 px) in a wide font that
wraps the headline, makes the hero taller than the calculation; the stage's own
check decides then.

The calculation uses the Latin line heights (1.05 for the headline, 1.4 for
the subhead, 1.5 for the note). **When the i18n PR lands the zh-TW `:lang` line
heights (about 1.2 and 1.6), recompute it in the same PR:** the 0.5rem of room
will not cover them.

### Static images (PR A)

`<img>` can't read CSS variables, so these SVGs hard-code the colours. Primary
strokes are `#CFE0FF`, detail strokes `#6E9BF5`, matching `--sketch-line`.

- **Logo:** `public/images/logo-placeholder.svg`, the same geometry as the
  canvas placeholder, in a 220 × 196 box with centre (90, 98):
  - the outline of a mouse seen from above: `x = cx + 58·(0.86 − 0.14·cos t)·sin t`,
    `y = cy − 88·cos t`;
  - a button split from `cy − 88` to `cy − 22`;
  - a wheel ellipse at `(cx, cy − 56)`, rx 4.5, ry 9;
  - a ruler at `x = cx + 84` from `cy − 88` to `cy + 88`, with end ticks
    5 px to each side.
- **Hand on A4:** an SVG rendered by the target generator from the template
  hand. It has the dots, the 21 landmarks, the skeleton lines, the two
  measurement lines with end ticks, and the A4 outline. **No numbers.**
- **Three mice:** `sketches/g-pro-sketch.svg` three times, recoloured to the
  two stroke colours above, until more sketches exist.

## Copy

English strings are the ones in production today, minus the deleted line.
There is no i18n framework in the repo yet. The zh-TW strings wait for it
(zh-TW is the default language; see the 2026-09-30 decision in
`docs/STATUS.md`). Ship them through its catalogue; don't hard-code them in
the component. The i18n PR also sets `<html lang>` to `zh-TW`; today
`src/app/layout.tsx` hard-codes `lang="en"`.

| Key (suggested)      | English                                                              | zh-TW (confirmed 2026-10-03)                       |
| -------------------- | -------------------------------------------------------------------- | -------------------------------------------------- |
| `home.title` (h1)    | Find the mouse that fits.                                            | 找到最適合你的滑鼠                                 |
| `home.subhead`       | A blank sheet of A4 and your phone are all it takes.                 | 一張白紙一張手機，完成你的掃描                     |
| `home.cta.scan`      | Scan my hand                                                         | 掃描                                               |
| `home.cta.how`       | How it works                                                         | 運作方式                                           |
| `home.preview`       | Early preview — measurements are still being validated.              | 搶先預覽版：量測結果仍在驗證中。                   |
| `home.sketchCaption` | G Pro X Superlight 2 · sketch                                        | G Pro X Superlight 2 線稿                          |
| `home.disclaimer`    | Not affiliated with Logitech. Sizes from Logitech's published specs. | 本站與 Logitech 無關。尺寸取自 Logitech 公開規格。 |
| `nav.signIn`         | Sign in                                                              | 登入                                               |

**No other new copy.** The story steps carry no text beyond this table. Any
new string, such as a cue line for the hand step, needs Kirby's confirmation
first.

The hero no longer shows the G Pro sketch or its dimension line. The caption
string sits under each of the three mice. Once real sketches exist, each mouse
gets its own model name and its dimension line from the catalogue through
`formatCatalogueSpec`.

CJK typesetting:

- Apply these with `:lang(zh-TW)` selectors, so they take effect once the i18n
  PR sets `lang`.
- zh-TW uses `system-ui` (PingFang TC on Apple, Microsoft JhengHei on
  Windows). The canvas used Noto Sans TC as a stand-in.
- `letter-spacing: 0`: the negative display tracking is for Latin only.
- Line height is 1.2 for the headline and 1.6 for body text.
- The zh-TW headline is 32 px on mobile, so it fits on one line. Keep
  `text-wrap: balance` so a single character is never left alone on a line.

## Dark theme tokens

| Token              | Value                                                   | Use                                                 | Contrast                |
| ------------------ | ------------------------------------------------------- | --------------------------------------------------- | ----------------------- |
| `--bg`             | `#060709`                                               | page background                                     | —                       |
| `--text-primary`   | `#F5F5F7`                                               | headlines, labels, outline-button label             | 18.5:1 on `--bg`        |
| `--text-secondary` | `#A1A1A6`                                               | subhead, details, "Sign in"                         | 7.8:1 on `--bg`         |
| `--text-tertiary`  | `#8A8A8F`                                               | captions, Early preview note, disclaimer            | 5.9:1 on `--bg`         |
| `--accent`         | `#1F6BF0`                                               | primary button fill                                 | —                       |
| `--on-accent`      | `#FFFFFF`                                               | primary button label (not `--text-primary`: 4.36:1) | 4.75:1 on `--accent`    |
| `--accent-pressed` | `#1A5CD0`                                               | primary button, pressed                             | 6.0:1 for `--on-accent` |
| `--accent-text`    | `#7FA8FF`                                               | links and focus ring on dark                        | 8.6:1 on `--bg`         |
| `--control-border` | `#FFFFFF59`                                             | outline button border                               | about 3.1:1 on `--bg`   |
| `--hairline`       | `#FFFFFF24`                                             | A4 outline                                          | decorative              |
| `--sketch-line`    | `#CFE0FF` (primary strokes), `#6E9BF5` (detail strokes) | particles and sketches                              | 15.1:1 on `--bg`        |
| `--glow`           | `#3B82F6` at up to 40 %                                 | key light, landmark halos, button glow              | decorative              |

- **Text never sits on `--glow` above 15 %.** At 15 % tertiary text is still
  5.1:1; at 25 % it falls to 4.4:1.
- **Retired on the home page:** text in `#6E6E73` (3.97:1) and a `#2F7BFF`
  button fill (white text 3.89:1). Both failed WCAG AA during the audit.
- **Focus ring:** 2 px `--accent-text` with a 2 px offset.
- **`prefers-contrast: more`:** `--control-border` becomes a solid
  `#8A8A8F`; no glow; hairlines become solid.
- **Forced colours:** buttons keep a visible border
  (`forced-color-adjust: auto`; don't paint borders with `transparent`).

## The particle stage

Scroll progress through the story section, `p` from 0 to 1 (see [Page structure](#page-structure)), drives the state.
Scrolling stays native:

- no scroll snapping;
- no `preventDefault` on wheel or touch;
- the user can stop or reverse at any point.

| Story                   | Progress (suggested) | What happens                                                                                                                                | Text in the DOM                   |
| ----------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| 1 Hero: logo + headline | p = 0                | The particle logo (placeholder) above the headline, subhead and buttons. On load it plays one shimmer pass of at most 3 s, then stays still | `home.title`, `home.subhead`, CTA |
| 2 Logo scatters         | 0.00–0.15            | The logo's particles break loose and drift outwards                                                                                         | —                                 |
| 3 Particles → hand      | 0.15–0.38            | The particles gather into a hand on the A4 outline                                                                                          | —                                 |
| 4 Hand measured         | 0.38–0.55            | The 21 landmark dots light up in order; the skeleton lines draw; the hand-length and palm-width lines extend with end ticks, **no numbers** | —                                 |
| 5 Hand rearranges       | 0.55–0.72            | The hand's particles loosen and flow apart into three streams                                                                               | —                                 |
| 6 Three mice            | 0.72–1.00            | The three streams settle into three mouse sketches by p = 0.90 and hold still to 1.00. Stacked on mobile, side by side on desktop           | `home.sketchCaption` × 3          |

After the story section comes the final section. Only G Pro exists today, so all
three mice are G Pro placeholders.

The only motion that starts without the user is the hero shimmer, and it ends
within 3 s, which meets WCAG 2.2.2. There is no looping idle drift.
Everything else follows scroll.

### Targets: precomputed, pure and tested

- **Build step.** `scripts/build-particle-targets.ts` samples each target
  shape into point lists and writes one JSON file. The browser never parses
  SVG.
  - The mouse sketches: every SVG in `public/images/sketches/` (move
    `g-pro-sketch.svg` there). Sample the primary strokes about every 2.6 px
    and the detail strokes about every 4.2 px at a 340 px stage width, and tag
    each point bright or dim.
  - Sketch source rule:
    - each sketch is drawn as a line drawing in pen.dev, with no Logitech
      logo, wordmark or trade dress beyond the shape (as in
      `docs/design/easy-scan-shell-2026-09-25/README.md`);
    - never traced from licensed data (AGENTS.md hard rule 1).
  - The template hand: a fixed, stylised set of the 21 MediaPipe landmark
    positions, filled as capsules along the fingers plus a palm polygon. It is
    an illustration, **not** a user's hand or measurement.
  - The logo: for now a placeholder SVG, `public/images/logo-placeholder.svg`
    (the shape in `screens/logo-placeholder-vector.png`), replaced when the
    real logo exists.
- **Resampling.** The same particles move through every state, so the
  particle count is fixed by the budget below. Each target list is resampled
  to that count. Three mice share it, about a third each. The committed file
  only holds a few hundred to a few thousand points per shape, so with the
  WebGL budgets the browser grows them (see "Source density" below); the
  Canvas 2D fallback resamples exactly as before.
- **Pairing.** Sort both point lists by x and pair by index. This gives a
  coherent sideways flow instead of random crossings.
  - Logo → hand: one list to one list.
  - Hand → three mice: split the hand's points into three groups, by y on
    mobile (stacked) or by x on desktop (side by side). Pair each group with
    one mouse.
- **Interpolation.** `pos = a + (b − a)·e(t) + swirl`, where:
  - `e` is `easeInOutQuad`;
  - `swirl = sin(π·e)·A` along a golden-angle direction per particle.
- **Unit tests.** Path sampling and resampling (PR A), and pairing and
  interpolation (PR B), are pure functions with unit tests. The same seed gives the same points, and the
  endpoints equal the targets.

### Rendering and performance (targets, 未拍板 until measured)

The WebGL stage (2026-10-05) moved the particles' drawing to the GPU. **Every
number in this section is Claude's candidate (未拍板)**: the budgets, the
pixel-ratio caps, the lit shares of the stars, the slow-frame guard and the
point-size margin wait for Kirby's pick from the screenshots in `gl/` and for a
measurement on a real phone. The measured numbers (in the PR description) are from a desktop GPU (an
RTX 5060 laptop) with the CPU throttled, so the CPU side and the shader's logic
are measured and **a phone GPU's cost of filling the soft points is not**.

- **WebGL path.** Plain WebGL 1, no library (`src/components/home/stage-gl.ts`).
  - The context is made with `antialias: false`, `depth: false`,
    `premultipliedAlpha: true`, `powerPreference: "high-performance"`.
  - Each particle's three resting positions, its two swirl vectors, its tone at
    each resting state, its shimmer x and its rank (below) are made once per
    layout into one interleaved `Float32Array` and sent with `STATIC_DRAW`
    (`src/lib/particles/gl-buffers.ts`). **Scrolling uploads nothing**: a frame
    sets a few uniforms and makes one `drawArrays(POINTS)`. A new layout (a
    resize) uploads again.
  - The vertex shader computes `pos = a + (b − a)·e + sin(π·e)·A` with the ends
    exact (`e ≤ 0` is `a`, `e ≥ 1` is `b`), the same as `interpolateAxis`. The
    leg (logo to hand, or hand to mice) and the weights `e(t)` and `sin(π·e)`
    come from the same `legOf` and `legWeights` the Canvas 2D path uses, passed
    as uniforms.
  - A point is a soft round dot: a bright core with a halo, drawn over what is
    there (premultiplied alpha). With `prefers-contrast: more` the halo is
    off and each particle is a solid disc, never fainter or smaller than the
    2D look's (a core at least 1.7 px across for a bright one, 1.4 px for a
    dim one, and no state drawn below its look): the mode is for seeing better.
    The shimmer is in the shader too: it plays once, for at most 2.6 s (the
    `shimmerAt` timing, unchanged), and after it nothing is drawn or scheduled.
  - **Stars and dust (2026-10-06, Kirby's pick).** The drawings are not dust:
    the logo and the three mice are **a few hundred glowing stars each**, as
    in the Canvas 2D version, and only **the hand keeps every particle**, as
    a fine dust. A state lights a share of the particles, its **lit share**
    (`LIT_FRACTION` in `src/lib/particles/look.ts`): the logo 0.06, the mice
    0.15, the hand 1 (candidate, 未拍板). Every particle has a stable
    **rank** (its place in the uploaded order as a share of the count, taken
    at the middle of the place); a state lights the particles whose rank is
    under its share, so a smaller share is a subset of a bigger one. On a
    desktop's 12,000 particles that is 720 stars on the logo and 1,800 on the
    mice (600 to a mouse); a phone's 6,000 has half as many. The
    2D version drew about 1,300 particles on a desktop (433 to a mouse) and
    900 on a phone, so 0.15 is about a third denser than the accepted picture
    on a desktop and the same on a phone; 0.11 would match it on a desktop.
    Kirby picks the share from the screenshots `gl/lit-options-*.png`: mice
    0.08, **0.15 (the default)** and 0.25, with the logo at 0.03, 0.06 and 0.10.
    The logo's share is lower because its stars sit on a short line (the 2D
    version drew the logo as about 260 points).
  - **Over a leg** a particle's visibility goes in a straight line, by the same
    `e(t)` that moves it, from 1 or 0 (lit or not at the start of the leg) to
    1 or 0 (at the end), with the ends exact: at `e ≤ 0` it is the start
    state's value and at `e ≥ 1` the end state's (`litness`, the same formula
    in TypeScript and in the shader). So in hand to mice about 85 % of the
    dust fades out as it flows, and the rest condenses into the stars; in logo
    to hand the dust fades in around the logo's stars as they spread. A
    particle keeps the look of the end where it is lit (a particle that fades
    out stays the dust it was; one that fades in is already the star it will
    be), and one that is lit at both ends grows from dust to star by `e`.
    A particle that is lit in neither end of a leg is not drawn at all.
  - **Order.** The uploaded order is not a shuffle: it is built by
    best-candidate sampling (`src/lib/particles/star-order.ts`; the leading
    30 % of the order, the rest is a seeded shuffle): each next particle is
    the farthest, of eight random candidates, from the particles already
    chosen, on the logo and on its mouse at once. Every prefix of the order is
    then an even scatter on the logo and on each mouse, so the stars at any
    share are evenly spaced beads and not clumps and gaps (the nearest
    neighbour's distance varies by 0.3 to 0.4 of its mean, against 0.6 to 0.9
    for a random pick). It costs about 40 ms of CPU for 12,000 particles on a
    desktop (30 ms for a phone's 6,000), in 300-pick slices of 7 ms or less,
    while the page is still static, once per layout kind and budget; with the
    CPU throttled 4× it is 0.2 to 0.3 s in slices of up to about 50 ms.
  - **Look.** A star has the 2D look: a bright one about 6 px across with the
    soft glow of the 2D sprite, a dim one a small soft dot (`glLook`, which
    gets smaller and fainter the more particles crowd the sheet, applied to
    **the number of particles the state lights**, not to the total: about
    1,800 on a desktop's mice, close to the 1,300 the 2D look was tuned for,
    so a star is not shrunk). The hand's dust is the same function with every
    particle: about 2.7 px, faint. The logo's stars are a third bigger
    (`STAR_SIZE.logo`, 1.35, candidate): the 2D version topped the logo up
    with copies nudged by a pixel, five on every point, so a logo point
    glowed as a small clump; a single star of the same size reads thinner.
  - **Guard.** The lit particles come first in the order, so when the guard
    draws only the first N, the dust thins and the stars stay (until N is
    smaller than the stars: at the floor of a quarter of the budget, 3,000 of
    12,000, the 1,800 stars of the mice are all still there).
- **Overlay.** The A4 corners, the skeleton, the measurement lines with their
  end ticks and the 21 landmarks stay on Canvas 2D, on the canvas above the
  WebGL one: there are few of them.
- **Fallback to Canvas 2D** (with the **old budget** and the old look): no
  WebGL; a shader that does not compile or link; a GPU whose largest point
  (`ALIASED_POINT_SIZE_RANGE`) is under the biggest point the stage draws (a
  logo star at the top of the shimmer's swell, times the pixel ratio) plus 24
  px of room; a `webglcontextlost` while running (the
  stage does not call `preventDefault()`, which would ask the browser to
  restore the context and leave a context nobody uses; it rebuilds for the 2D
  path at once and does not try WebGL again that visit). `data-renderer` on the section says `webgl` or
  `2d`. The static layout (reduced motion, no JS, a short window, a module that
  fails to load) is unchanged. `failIfMajorPerformanceCaveat` is **not** set
  (decided 2026-10-06): a browser with only software WebGL still takes the
  WebGL path, and the slow-frame guard below is what protects it; asking for the
  caveat would also send the headless software WebGL of the e2e runs to 2D and
  leave this path untested.
- **Particle budget, shared by all states** (candidate):

  | Path                 | Phone | Desktop | Halved when `hardwareConcurrency <= 4` |
  | -------------------- | ----: | ------: | -------------------------------------- |
  | WebGL                | 6,000 |  12,000 | yes                                    |
  | Canvas 2D (fallback) |   900 |   1,300 | yes                                    |

  Each is rounded down to a multiple of three (a third per mouse). The
  budget feeds the hand's dust (every particle) and, through the lit shares
  above, the number of stars. The earlier pick between 4,000 / 8,000,
  **6,000 / 12,000 (the default)** and 10,000 / 20,000 was made on the picture
  of continuous lines; with stars it is a pick of how fine the hand's dust is
  (the stars follow the lit share, not the budget) and is still open.

- **Device pixel ratio.** The 2D canvas is capped at 2. The WebGL canvas is
  capped at 2 on a wide screen and 1.5 under 48 rem (candidate).
- **Source density.** The committed `targets.generated.json` stays small (about
  14 KB gzip): the logo has 262 points, the hand 1,400, a mouse 1,134. The
  browser grows them from the same seed, so the result is reproducible:
  - a stroke (the logo, a mouse) is walked at an even step, and each particle is
    nudged a fraction of a pixel across it (a bell-shaped spread of 0.3 stage
    px, at most 2.5 deviations), so a line gets width and stays on the shape;
    an open stroke's first and last particle are its own end points; the file
    says which points make up each stroke (`runs`);
  - the hand is a fill: `fillTemplateHand` continues, with the generator's own
    seed, past the 1,400 committed points;
  - the pairing (sort by x, pair by index) sorts packed integer keys, not
    objects, and then puts any two points the keys could not tell apart in
    order with the exact comparison, so the order is exactly the comparator's
    (x, then y, then input order, which is what the Canvas 2D fallback has
    always had) and a 12,000-particle pairing takes about 8 ms of sorting
    instead of 14.
- **Slow-frame guard** (candidate, `src/lib/particles/degrade.ts`). The WebGL
  path times the gap between two consecutive **animation frames**, not between
  two draws: a draw only happens when the picture changes, so a mouse wheel
  clicking every 30 ms, or a reader who scrolls, stops and scrolls again, would
  look slow. To have a callback on every frame of a scroll, the stage keeps its
  `requestAnimationFrame` loop running for **200 ms after the last scroll
  event** and then stops it: this is not an idle loop (nothing is scheduled
  once the page has been still for 200 ms, and during the shimmer the loop runs
  by itself for at most 2.6 s, as before). When the loop stops the guard is
  told, and the first frame of the next run has no gap, so the time the reader
  stood still is never a slow frame; a long gap inside a running loop is a
  real hitch and counts as one slow frame (a single stall is one of the eight
  it takes). The screen's refresh interval is the median of the first 40 gaps
  (the shimmer runs every frame) **and never more than 16.7 ms**, so a device
  that is slow from its first frame does not take its own slow frames for the
  screen's pace (a screen that truly runs at 30 Hz, a phone in low-power mode,
  is stepped down, which is accepted). The window the guard judges starts empty
  once the interval is known, so the first frames after the layout switches on
  (a measure, a GPU warm-up) are not in it. When **at least 8 of the last 60
  gaps are over 1.7 times that interval** (about 13 % of the frames) the count
  drawn drops by 25 %, to at most a quarter of the budget; it does not rise
  again until the budget itself changes (the layout crosses 48 rem), which
  starts the count over. After a step the window is cleared and has to fill
  again, all 60 gaps, before the next step is allowed. Counting misses, not
  reading a percentile, is on purpose: a 165 Hz screen that is not struggling
  still misses a vsync now and then (12.2 ms, over the 1.7 line), and 3 misses
  in 45 was enough to take particles from it. **The 8-in-60 bar is a candidate,
  to be checked on a real 60 Hz phone.** The particles are uploaded in a
  star order (above), so the first N are an even scatter on the logo and on every
  mouse, and nothing is missing from the logo, the hand or a mouse when fewer
  are drawn. `data-particles` is the
  budget, `data-drawn` what is drawn now and `data-refresh-ms` the estimate.
- Stop drawing when nothing changes: no scroll and no shimmer. Pause when the
  stage is off-screen (IntersectionObserver) or the tab is hidden. There is no
  idle loop: on the WebGL path the frame loop runs for 200 ms after the last
  scroll event (so the guard can time every frame of a scroll) and then
  stops; those frames draw nothing unless the picture changed.
- First paint is the static placeholder logo SVG plus the text. The particle
  module is a dynamic import after first paint, so it doesn't delay LCP. The
  LCP element is the logo `<img>` or the h1; both are in the initial HTML, and
  the logo SVG is small and not lazy-loaded. The first frame is set up in
  slices (the drawing path, the pairing, the canvases' sizes, the first
  particles), one task each, while the page is still the static one; the task
  that switches the layout only draws the first frame and flips the class. The
  real measure of the animated layout is the first frame's job.
- Main-thread work under about 8 ms per frame on a mid-range phone. The WebGL
  path takes well under 1 ms per frame on the CPU (measured on a desktop with
  the CPU throttled 4×, see the PR description). Measure this on a real phone
  and post the number.

### Reduced motion and no JS

With `prefers-reduced-motion: reduce`, or without JS:

- no particles and no shimmer;
- each section shows its end state as a static image: the logo, the hand on
  A4 with lines, the three mice.

## Tests to update

These assertions pin today's home page or today's light/dark split, and
change in PR A. Rewrite them; don't delete them silently.

- **`tests/e2e/home.spec.ts`**
  - The h1 name, which becomes "Find the mouse that fits."
  - The sketch `img` and `.landing-dimension` / `.landing-annotation` leave
    the hero. Assert the three mouse captions instead.
  - The catalogue-count sentence is removed.
  - `.landing-points > div > span` `toHaveCount(0)` becomes meaningless once
    the block is gone. Replace it with a check that the taglines are absent.
  - The privacy sentence leaves the home page (see the decisions above).
    Replace that assertion with one that it is absent on `/`, and keep the
    How it works assertion for it.
- **Duplicates.** "Scan my hand", "How it works" and the Early preview note
  (`.landing-preview-note`) now appear twice: once in the hero, once in the
  final section. Scope each locator to its region, for example with a test
  id, so Playwright strict mode doesn't hit two elements.
- **`tests/e2e/easy-scan-screenshots.spec.ts`** (the `landing` capture): it
  waits for the old h1 text and emulates `colorScheme: "light"`. Update the h1
  name. The light emulation no longer changes anything.
- **Exact background colours and light/dark loops.**
  - `tests/e2e/no-paper-device.spec.ts` pins `--scan-bg`
    (`rgb(244, 244, 246)` light, `rgb(22, 22, 23)` dark) in the background
    assertion near line 234 and in `PAGE_BG` near line 659. It runs once per
    colour scheme in the loops near lines 452, 568, 665, 701, 888, 914 and 936;
    the one near 888 indexes `PAGE_BG[colorScheme]`.
  - `tests/e2e/easy-scan.spec.ts` near line 294 and
    `tests/e2e/easy-scan-measured.spec.ts` near line 103 loop over both
    schemes with contrast assertions.
  - `tests/e2e/results-demo.spec.ts` near lines 192–195 expects
    `.results-analysis` to have a white (`rgb(255, 255, 255)`) background.

  Then look for any remaining light/dark loop or hard-coded background with
  `grep -rn "colorScheme\|rgb(" tests/e2e`.

  After PR A there is one theme. Assert `--bg` (`rgb(6, 7, 9)`) once, and
  drop the light iteration.

- **`tests/unit/privacy-copy.test.ts`** asserts that `src/app/page.tsx` uses
  `PHOTO_PRIVACY_COPY`. With the line gone from the home page, it must instead
  pin the surfaces that keep the promise (How it works, the scan screens, the
  camera), so the promise can't silently disappear from all of them.

## Accessibility checklist for PR A and PR B

- [ ] Home-page text uses only the token colours; no `#6E6E73` text.
- [ ] Every control has a hit area of at least 44 × 44 px; the focus ring is
      visible on dark.
- [ ] The h1 comes before the stage in reading order. Both canvases and the
      hero logo are decorative (`aria-hidden`, empty alt); the wordmark in the
      nav names the site. Each mouse in the last step has its model name as text.
- [ ] Reduced motion and no-JS show the static end states.
- [ ] The only automatic motion ends within 3 s (WCAG 2.2.2).
- [ ] `prefers-contrast: more` and forced colours keep borders visible.
- [ ] No horizontal scroll: checked at 320×568, 375×667, 390×844 and 1440,
      and at 200 % text zoom.

## Out of scope for PR A and PR B

- The final logo.
- More mouse sketches, and choosing which three mice to show.
- The "Find your best mouse" copy.
- Ending the story on the user's own top match after a scan. Wait until the
  hand measurement is validated.
- The i18n framework itself (it brings the zh-TW strings and `lang`).
