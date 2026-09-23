# Design: the measurement journey (2026-09-23)

Four phone-width screens (390 px) drawn on the pen.dev canvas. They answer the
independent UI audit's findings that are **design decisions** rather than code
fixes — above all F01, the one High finding that spans every screen and so is
the most likely to be built inconsistently if each screen is fixed separately.

Audit: [`docs/reviews/ui-audit-2026-09-23.md`](../../reviews/ui-audit-2026-09-23.md).
Standard: [`docs/design-guidelines.md`](../../design-guidelines.md).

| Screen                                          | Findings addressed      |
| ----------------------------------------------- | ----------------------- |
| [01 Home](01-home.png)                          | F01                     |
| [02 Sheet](02-sheet.png)                        | F01, F05, F13           |
| [03 Scan, measured state](03-scan-measured.png) | F01, and the step label |
| [04 Results](04-results.png)                    | F01, F10, provenance    |

## Decisions

**One journey, one wayfinding pattern.** Every screen after Home carries the same
top bar: a back link naming the screen it returns to, and a step label. The
flow is two steps — _Step 1 of 2 · Print_, _Step 2 of 2 · Photo_ — and Results
is the destination, not a third step. Today's "Step 1 of 3" on `/scan` is wrong:
side and grip photos were deferred on 2026-09-22.

**Home leads into the product.** Its only exit today is "Sign in", which is
unavailable. The primary action is _Get started_ → `/sheet`; the secondary is
_I already have the sheet_ → `/scan`; sign-in drops to a quiet link.

**Say what is true about accuracy.** Home is labelled _Early preview ·
measurements still being validated_. That stays until the M2 accuracy gate
(±2 mm against a ruler) has measured numbers behind it. Remove it only then.

**The print-scale warning is the sheet's primary message (F13).** A scaled
print silently produces wrong measurements, so _Print at actual size — 100%_
is the first thing on the page, above the preview.

**The whole sheet is visible on a phone (F05).** The preview is scaled to fit,
so no marker is cut off and nothing needs horizontal scrolling.

**Scan links back to the sheet.** _Don't have the sheet? Print it_ — the scan
screen requires a sheet and currently offers no way to get one.

**The best match shows all six scores (F10).** Each has a bar and the engine's
reason in plain words.

**An unrated score is shown as unrated — never as a bar.** Without the Gemini
key, the shape descriptors are unclassified, so _height & hump_, _front flare_
and _thumb support_ have no score. The engine uses a neutral prior (75) for
them inside the total, but drawing that as a 75-point bar would show the user
a number nobody measured. They appear as "—" with an empty outlined track and
_Shape not rated yet_; _weight_ reads _No weight preference given_. A line
under the scores says the total currently leans on size. This mirrors the
`fit_results` discussion on #34: the prior is a ranking convention, not a
measurement.

**Provenance is stated, quietly.** A deterministic summary carries _Generated
automatically from your scores above._ — the copy #33 shipped — without the
words "fallback", "model", "Gemini" or "LLM".

## Tokens

Matched to the shipped UI, so the design reads as the same product.

| Token            | Value     | Use                               |
| ---------------- | --------- | --------------------------------- |
| `bg`             | `#F4F4F6` | page                              |
| `surface`        | `#FFFFFF` | cards                             |
| `text-primary`   | `#1C1C1E` |                                   |
| `text-secondary` | `#55555D` | secondary text                    |
| `accent`         | `#0A64E0` | primary actions; white text on it |
| `accent-soft`    | `#E7F0FD` | callouts, step badges, chips      |
| `border`         | `#D5D5DC` | outlines, unrated tracks          |
| `ok`             | `#1E7B45` | the measured check                |

Contrast, computed with the WCAG 2 relative-luminance formula — every text pair
passes AA (4.5:1):

| Pair                                | Ratio   |
| ----------------------------------- | ------- |
| `text-primary` on `bg`              | 15.49:1 |
| `text-secondary` on `surface`       | 7.38:1  |
| `text-secondary` on `bg`            | 6.72:1  |
| white on `accent` (primary button)  | 5.37:1  |
| `accent` on `bg` (links)            | 4.89:1  |
| `accent` on `accent-soft` (callout) | 4.67:1  |

Touch targets are 52 px tall, above the 44 pt minimum. The design is
light-mode only; dark, reduced-motion and increased-contrast variants follow
the rules already in `docs/design-guidelines.md`.

## Not designed here

The 3D viewer (M4b, blocked on #26); F02 and F08 (error recovery and main-thread
work on `/scan` — behaviour, not layout); F04, F06, F07, F11, F12, F14 and F15,
which are code-level fixes the audit already specifies precisely.

Numbers in the mock-ups are illustrative. The Results screen uses the real top
pick from a production smoke test run on 2026-09-23 (G Pro X Superlight 2c,
fit score 79) — not a real person's hand.
