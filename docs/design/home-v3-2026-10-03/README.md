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

Still **not decided (未拍板, candidate)**:

- **Where the photo-privacy line goes on the home page.** The third tagline,
  "Private by design.", carried the home page's only privacy promise
  (`PHOTO_PRIVACY_COPY`: "Your photo never leaves your phone. Only
  measurements are sent."). Removing the taglines removes it from the home
  page; it stays on How it works, the scan screens and the camera.
  - Claude suggests keeping the existing English string as one line under the
    final CTA. Its zh-TW wording also needs Kirby's confirmation.
  - Until Kirby decides, builders keep the string on the home page (under the
    final CTA) and keep the e2e assertion for it. The screens don't show it
    yet.
- The logo. The particle logo in the hero (Story 1) is a placeholder.
- Which three mice the last step shows. All three are G Pro placeholders until
  more sketches exist.
- Whether to add the copy "Find your best mouse".
- A sticky "Scan" bar on mobile once the hero scrolls away.
- The particle-count and performance numbers below. They are Claude's targets
  and must be measured on a real phone before they are treated as fixed.

## Delivery: two PRs

1. **PR A: dark foundation and home layout, without particles.**
   - **Make the site dark.**
     - 9 of the 11 CSS files in `src` already have a
       `@media (prefers-color-scheme: dark)` block. Promote those blocks to the
       default and drop the light defaults.
     - `src/client/camera/camera.css` and `easy-scan.css` have no block of
       their own. They read `--scan-*` variables (dark values in
       `src/app/scan/scan.css`), so check their hex fallbacks.
     - The whole site then turns dark in one PR, and no page is left
       half-light.
   - **Map the old variables onto the new tokens**, so the site has one primary
     button:
     - `--scan-bg` becomes `--bg`;
     - `--scan-accent` becomes `--accent`;
     - `--scan-on-accent` becomes `--on-accent`. Today's dark scan button is a
       light blue `#79adff` with a dark label. It becomes `#1F6BF0` with a
       white label.
   - **Print stays light.** Keep the `@media print` rules in `sheet.css` and
     `learn.css` on a white page with dark ink.
   - Set `color-scheme: dark`.
   - **Lay out the home page** as in the screens, with **static** SVGs where
     the particles will go (see [Static images](#static-images-pr-a)).
   - **Write the target generator** (see
     [Targets](#targets-precomputed-pure-and-tested)) with its unit tests. The
     static SVGs are rendered from the same point lists, so the static and
     animated versions match.
   - Update the tests listed in [Tests to update](#tests-to-update).
2. **PR B: the particle stage.** It adds the canvas on top of PR A's layout.
   PR A's static SVGs stay as the reduced-motion and no-JS fallback.

## Screens

| File                                           | What it shows                                                                                            |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `screens/01-mobile-zh-tw.png`                  | Mobile 390 wide, zh-TW, end state of every animation                                                     |
| `screens/02-mobile-iphone-se-first-screen.png` | 375×667, first screen only: both buttons and the Early preview note fit                                  |
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
2. Story section `<section class="story">`. It contains, in order:
   1. the hero: the logo (a static `<img>`, decorative, empty alt), then the
      `h1`, the subhead, the two buttons and the Early preview note;
   2. the hand (a static SVG);
   3. the three mice (static SVGs), each with its caption as real text;
   4. the `<canvas>` (PR B only, `aria-hidden="true"`).
3. Final section: both buttons again, the Early preview note again, and the
   privacy line (see the undecided item above).
4. Footer disclaimer: left-aligned on mobile, centred on desktop.

**Static layout** (PR A, and in PR B under reduced motion or without JS): the
story section is an ordinary block, and its parts stack in flow, as in
`screens/03-mobile-en.png`. It has no extra height and no empty gaps.

**Animated layout** (PR B, only when JS runs and motion is allowed). JS adds
`story--animated` to the section. Then:

- The section gets a tall height (about 400 svh, to be tuned). Inside it, one
  panel is `position: sticky; top: 0; height: 100svh`. The hero, the captions
  and the canvas all live in that panel, so the canvas, the logo and the mouse
  captions stay aligned with each other.
- **Progress:** `p` is 0 when the panel first pins and 1 when the section's
  bottom reaches the panel's bottom. p = 0 is the hero exactly as on first
  load, so Story 2 starts from a visible logo.
- **Logo handoff:** the canvas draws the logo at the static `<img>`'s rect
  (`getBoundingClientRect`). Once the first frame is drawn it hides the `<img>`
  (`visibility: hidden`), so there is never a double logo.
- **Hero text:** from p = 0 to 0.10 the hero text fades and moves up
  (opacity and transform only). Below opacity 0.05 it gets
  `pointer-events: none` and `inert`, so hidden buttons can't be tabbed to.
  Scrolling back reverses this.
- **Static hand and mice:** their static SVGs are hidden; the canvas draws
  those states. The three captions are absolutely positioned in the panel at
  the mice's target rects, and fade in during Story 6.
- **Exit:** at p = 1 the sticky panel releases. The three mice and their
  captions scroll up together with the panel, and the final section follows.
  Nothing disappears abruptly. The canvas stops drawing once the panel is off
  screen.

Buttons:

- "Scan my hand" is the filled primary; "How it works" is the outline
  secondary.
- Lay them out with `display: flex; flex-wrap: wrap; gap: 0.75rem`. Use
  `min-height: 3.125rem`, with `flex: 1 1 12rem` for the primary and
  `flex: 0 1 8rem` for the secondary (wider on desktop: about 14rem and
  10.5rem).
- When the row is too narrow (320 px, or large text zoom) they wrap: each
  button takes the full width, primary on top.
- Fully rounded.
- Pressed state: darken the fill to `--accent-pressed`. Never drop opacity:
  `opacity: 0.85` on the button would take the white label to 4.33:1.

Hero logo height:

- mobile: `clamp(18rem, 40svh, 24rem)`, so both buttons stay on the first
  screen of a 375×667 phone;
- desktop: about 29rem (the 1440 frame uses 470 px).

### Static images (PR A)

- **Logo:** `public/images/logo-placeholder.svg`, the same geometry as the
  canvas placeholder, in a 220 × 196 box with centre (90, 98):
  - the outline of a mouse seen from above: `x = cx + 58·(0.86 − 0.14·cos t)·sin t`,
    `y = cy − 88·cos t`;
  - a button split from `cy − 88` to `cy − 22`;
  - a wheel ellipse at `(cx, cy − 56)`, rx 4.5, ry 9;
  - a ruler at `x = cx + 84` from `cy − 88` to `cy + 88`, with 5 px end ticks.

  Stroke colour `--sketch-line`.

- **Hand on A4:** an SVG rendered by the target generator from the template
  hand. It has the dots, the 21 landmarks, the skeleton lines, the two
  measurement lines with end ticks, and the A4 outline. **No numbers.**
- **Three mice:** `g-pro-sketch.svg` three times, recoloured with
  `--sketch-line`, until more sketches exist.

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

Scroll progress through the story wrapper, `p` from 0 to 1, drives the state.
Scrolling stays native:

- no scroll snapping;
- no `preventDefault` on wheel or touch;
- the user can stop or reverse at any point.

| Story                   | Progress (suggested) | What happens                                                                                                                                | Text in the DOM                   |
| ----------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| 1 Hero: logo + headline | before the wrapper   | The particle logo (placeholder) above the headline, subhead and buttons. On load it plays one shimmer pass of at most 3 s, then stays still | `home.title`, `home.subhead`, CTA |
| 2 Logo scatters         | 0.00–0.15            | The logo's particles break loose and drift outwards                                                                                         | —                                 |
| 3 Particles → hand      | 0.15–0.38            | The particles gather into a hand on the A4 outline                                                                                          | —                                 |
| 4 Hand measured         | 0.38–0.55            | The 21 landmark dots light up in order; the skeleton lines draw; the hand-length and palm-width lines extend with end ticks, **no numbers** | —                                 |
| 5 Hand rearranges       | 0.55–0.72            | The hand's particles loosen and flow apart into three streams                                                                               | —                                 |
| 6 Three mice            | 0.72–1.00            | The three streams settle into three mouse sketches. Stacked on mobile, side by side on desktop                                              | `home.sketchCaption` × 3          |

After the wrapper comes the final section. Only G Pro exists today, so all
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
  to that count. Three mice share it, about a third each.
- **Pairing.** Sort both point lists by x and pair by index. This gives a
  coherent sideways flow instead of random crossings.
  - Logo → hand: one list to one list.
  - Hand → three mice: split the hand's points into three groups, by y on
    mobile (stacked) or by x on desktop (side by side). Pair each group with
    one mouse.
- **Interpolation.** `pos = a + (b − a)·e(t) + swirl`, where:
  - `e` is `easeInOutQuad`;
  - `swirl = sin(π·e)·A` along a golden-angle direction per particle.
- **Unit tests.** Path sampling, resampling, pairing and interpolation are
  pure functions with unit tests. The same seed gives the same points, and the
  endpoints equal the targets.

### Rendering and performance (targets, 未拍板 until measured)

- One Canvas 2D `requestAnimationFrame` loop. Draw a pre-rendered glow sprite
  per bright point; never use CSS `filter` per particle.
- Particle budget, shared by all states:
  - about 900 on mobile and 1,300 on desktop;
  - halve it when `navigator.hardwareConcurrency <= 4`.
- Device pixel ratio capped at 2.
- Stop drawing when nothing changes: no scroll and no shimmer. Pause when the
  stage is off-screen (IntersectionObserver) or the tab is hidden.
- First paint is the static placeholder logo SVG plus the text. The particle
  module is a dynamic import after first paint, so it doesn't affect LCP. The
  h1 is the LCP element.
- Main-thread work under about 8 ms per frame on a mid-range phone. Measure
  this on a real phone and post the number in the PR.

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
  - The privacy sentence stays until Kirby decides (see above).
- **Duplicates.** "Scan my hand", "How it works" and the Early preview note
  (`.landing-preview-note`) now appear twice: once in the hero, once in the
  final section. Scope each locator to its region, for example with a test
  id, so Playwright strict mode doesn't hit two elements.
- **`tests/e2e/easy-scan-screenshots.spec.ts`** (the `landing` capture): it
  waits for the old h1 text and emulates `colorScheme: "light"`. Update the h1
  name. The light emulation no longer changes anything.
- **Exact background colours and light/dark loops.** These pin `--scan-bg`
  values (`rgb(244, 244, 246)` light, `rgb(22, 22, 23)` dark) and run every
  check once per colour scheme:
  - `tests/e2e/no-paper-device.spec.ts`: the background assertion near line
    234, `PAGE_BG` near line 659 and the loops near lines 452, 568, 665 and
    701;
  - `tests/e2e/easy-scan.spec.ts` near line 294;
  - `tests/e2e/easy-scan-measured.spec.ts` near line 103.

  After PR A there is one theme. Assert `--bg` (`rgb(6, 7, 9)`) once, and
  drop the light iteration.

- **`tests/unit/privacy-copy.test.ts`** asserts that `src/app/page.tsx` uses
  `PHOTO_PRIVACY_COPY`. It stays true under the interim rule. If Kirby later
  removes the line from the home page, this test changes with it.

## Accessibility checklist for PR A and PR B

- [ ] Home-page text uses only the token colours; no `#6E6E73` text.
- [ ] Every control has a hit area of at least 44 × 44 px; the focus ring is
      visible on dark.
- [ ] The h1 comes before the stage in reading order. The canvas and the hero
      logo are decorative (`aria-hidden`, empty alt); the wordmark in the nav
      names the site. Each mouse in the last step has its model name as text.
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
