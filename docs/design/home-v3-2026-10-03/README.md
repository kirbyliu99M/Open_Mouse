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
- The home page tells **one continuous particle story** on a sticky stage (see
  [The particle stage](#the-particle-stage)).
- The three taglines below the CTA ("One photo. No printing." and the other
  two) are removed.
- The "Measure your hand." line above the headline is removed, in every
  language.
- The zh-TW strings in [Copy](#copy) are confirmed.

Still **not decided (未拍板, candidate)**:

- The logo. The particle logo in Story 8 is a placeholder.
- Whether to add the copy "Find your best mouse".
- A sticky "Scan" bar on mobile once the hero scrolls away.
- The particle-count and performance numbers below. They are Claude's targets
  and must be measured on a real phone before they are treated as fixed.

## Screens

| File                                           | What it shows                                                        |
| ---------------------------------------------- | -------------------------------------------------------------------- |
| `screens/01-mobile-zh-tw.png`                  | Mobile 390 wide, zh-TW, end state of every animation                 |
| `screens/02-mobile-iphone-se-first-screen.png` | 375×667, first screen only: both buttons fit (bottom edge at 652 px) |
| `screens/03-mobile-en.png`                     | Mobile 390 wide, English                                             |
| `screens/04-desktop-en.png`                    | Desktop 1440 wide, English, 1200 px content container                |
| `screens/story-1 … story-8`                    | The particle story, one frame per state (mobile scale)               |
| `screens/logo-placeholder-vector.png`          | The placeholder mark as plain lines, only to make the shape legible  |

## Page structure (DOM order)

1. `nav`: the wordmark, then "Sign in" and the existing `NavMenu`. Each
   control has a hit area of at least 44 × 44 px.
2. `h1`, then the subhead, the two buttons and the Early preview note. These
   come before the stage in the DOM even though the sketch sits above them on
   screen, so a screen reader meets the headline first. Use CSS order or grid
   for the visual placement.
3. The particle stage section. The canvas is `aria-hidden="true"`. Each story
   step that carries meaning has its line of text in the DOM (see
   [The particle stage](#the-particle-stage)).
4. The final section: the particle logo (placeholder), the "Scan my hand"
   button again, and the Early preview note again.
5. The footer disclaimer, centred.

Buttons: "Scan my hand" is the filled primary (mobile: fills the remaining
width; desktop: 224 px). "How it works" is the outline secondary (mobile:
128 px; desktop: 168 px). Height 50, fully rounded, 12–14 px gap.

Hero stage height: `clamp(18rem, 40svh, 24rem)` on mobile, so both buttons
stay on the first screen of a 375×667 phone. The canvas checked 390×844 and
375×667.

## Copy

English strings are the ones in production today, minus the deleted line.
There is no i18n framework in the repo yet, so the zh-TW strings wait for
i18n PR1/PR2 in the launch plan. Ship them through that catalogue; don't hard-code
them in the component.

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

The dimension line ("125 mm", "125 × 63.5 × 40 mm 60 g") keeps coming from
the catalogue through `formatCatalogueSpec`, as it does today.

CJK typesetting:

- zh-TW uses `system-ui` (PingFang TC on Apple, Microsoft JhengHei on
  Windows); the canvas used Noto Sans TC as a stand-in.
- `letter-spacing: 0`: the negative display tracking is for Latin only.
- Line height is 1.2 for the headline and 1.6 for body text.
- The zh-TW headline is 32 px on mobile so it fits on one line. Keep
  `text-wrap: balance` so a single character is never left alone on a line.

## Dark theme tokens

| Token              | Value                                                   | Use                                      | Contrast on `--bg` |
| ------------------ | ------------------------------------------------------- | ---------------------------------------- | ------------------ |
| `--bg`             | `#060709`                                               | page background                          | —                  |
| `--text-primary`   | `#F5F5F7`                                               | headlines, labels                        | 18.5:1             |
| `--text-secondary` | `#A1A1A6`                                               | subhead, details                         | 7.8:1              |
| `--text-tertiary`  | `#8A8A8F`                                               | captions, Early preview note, disclaimer | 5.9:1              |
| `--accent`         | `#1F6BF0`                                               | primary button fill (white label 4.75:1) | —                  |
| `--accent-text`    | `#7FA8FF`                                               | links and focus ring on dark             | 8.6:1              |
| `--control-border` | `#FFFFFF59`                                             | outline button border                    | about 3.1:1        |
| `--hairline`       | `#FFFFFF24`                                             | A4 outline, horizon, dividers            | decorative         |
| `--sketch-line`    | `#CFE0FF` (primary strokes), `#6E9BF5` (detail strokes) | sketch and particles                     | 15.1:1 (primary)   |
| `--glow`           | `#3B82F6` at 25–40 %                                    | key light, landmark halos                | decorative         |

- **Retired values:** `#6E6E73` (3.97:1) and a `#2F7BFF` button fill (white
  text 3.89:1). Both failed WCAG AA during the audit.
- **Focus ring:** 2 px `--accent-text` with a 2 px offset.
- **`color-scheme: dark`**, replacing today's `light dark`.

## The particle stage

The hero sketch section and the story section share one `position: sticky`
canvas. Scroll progress through the story section, `p` from 0 to 1, drives the
state. Scrolling stays native:

- no scroll snapping;
- no `preventDefault` on wheel or touch;
- the user can stop or reverse at any point.

| Story                | Progress (suggested)       | What happens                                                                                                                                | Text in the DOM                         |
| -------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| 1 Hero sketch        | before the section         | The existing Home v2 signature moment: the SVG sketch draws in, the sweep crosses it, "125 mm" appears                                      | the hero copy                           |
| 2 Sketch → particles | 0.00–0.12                  | The sketch strokes fade out while particles sampled from those strokes drift loose                                                          | —                                       |
| 3 Particles → hand   | 0.12–0.30                  | The particles gather into a hand on the A4 outline                                                                                          | `home.subhead`                          |
| 4 Hand measured      | 0.30–0.42                  | The 21 landmark dots light up in order; the skeleton lines draw; the hand-length and palm-width lines extend with end ticks, **no numbers** | —                                       |
| 5 Hand → mouse       | 0.42–0.58                  | The particles flow from the hand into a mouse                                                                                               | —                                       |
| 6 Mouse formed       | 0.58–0.80                  | A mouse sketch made of particles, with the dimension line from the catalogue. With more sketches, it cycles through them                    | `home.sketchCaption` and dimension line |
| 7 Dissolve           | inside 6, between sketches | The particles drift aside and re-form as the next sketch                                                                                    | —                                       |
| 8 Logo + CTA         | 0.80–1.00                  | The particles form the logo (placeholder), and the CTA and the Early preview note appear                                                    | `home.cta.*`, `home.preview`            |

Only G Pro exists today, so stories 6–7 show G Pro once, without cycling.

### Targets: precomputed, pure and tested

- **Build step.** `scripts/build-particle-targets.ts` samples each target
  shape into point lists and writes one JSON file. The browser never parses
  SVG.
  - The mouse sketches: every SVG in `public/images/sketches/` (move
    `g-pro-sketch.svg` there). Primary strokes about every 2.6 px, detail
    strokes about every 4.2 px at a 340 px stage width, each point tagged
    bright or dim.
  - The template hand: a fixed, stylised set of the 21 MediaPipe landmark
    positions, filled as capsules along the fingers plus a palm polygon. It is
    an illustration, **not** a user's hand or measurement.
  - The logo, once it exists.
- **Pairing.** Sort both point lists by x and pair by index, rescaling the
  shorter list. This gives a coherent sideways flow instead of random
  crossings.
- **Interpolation.** `pos = a + (b − a)·e(t) + swirl`, where:
  - `e` is `easeInOutQuad`;
  - `swirl = sin(π·e)·A` along a golden-angle direction per particle.
- **Unit tests.** Path sampling, pairing and interpolation are pure functions
  with unit tests: the same seed gives the same points, and the endpoints
  equal the targets.

### Rendering and performance (targets, 未拍板 until measured)

- One Canvas 2D `requestAnimationFrame` loop. Draw a pre-rendered glow sprite
  per bright point; never use CSS `filter` per particle.
- Particle counts:
  - about 900 on mobile and 1,300 on desktop;
  - halve them when `navigator.hardwareConcurrency <= 4`.
- Device pixel ratio capped at 2.
- Pause the loop when the stage is off-screen (IntersectionObserver) or the
  tab is hidden.
- First paint is the static SVG sketch plus the text. The particle module is
  a dynamic import after first paint, so it doesn't affect LCP; the h1 is the
  LCP element.
- Main-thread work under about 8 ms per frame on a mid-range phone. Measure
  this on a real phone and post the number in the PR.

### Reduced motion

With `prefers-reduced-motion: reduce`:

- no particles and no draw-in;
- each section shows its end state as a static image: the sketch, the hand on
  A4 with lines, the mouse, the logo;
- numbers don't count up.

## Accessibility checklist for the PR

- [ ] Contrast pairs as in the token table; there is no `#6E6E73` left.
- [ ] Every control has a hit area of at least 44 × 44 px; the focus ring is
      visible on dark.
- [ ] The h1 is first in reading order; the canvas is `aria-hidden`; the
      sketch `img` keeps its current alt text.
- [ ] Reduced motion shows the static end states and the page works with no
      JS.
- [ ] No horizontal scroll at 375 px; checked at 375×667, 390×844 and 1440.
- [ ] Measurements use tabular numerals.

## Out of scope for this PR

- The final logo.
- More mouse sketches.
- The "Find your best mouse" copy.
- Ending the story on the user's own top match after a scan. Wait until the
  hand measurement is validated.
- Dark versions of How it works, results and account. They follow as separate
  PRs using the same tokens.
