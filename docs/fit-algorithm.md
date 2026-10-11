# Fit algorithm — v1 candidate

Status: **candidate (未拍板)**. v1 has been the default engine since 2026-10-10 (now `fit-v1-candidate.3`; Kirby, after the v0-vs-v1 comparison on the real catalogue); it stays a candidate. Every number below
lives in `src/server/fit/coefficients.ts` only.

## 1. Inputs

| Input                                         | Source                                                   | Notes                                                                                                                                               |
| --------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `handLengthMm`, `palmLengthMm`, `palmWidthMm` | scan (`HandMeasurements`)                                | wrist crease → middle fingertip; known bias 7–11 mm on a 190 mm hand (2026-10-07)                                                                   |
| `hand`                                        | scan                                                     | left / right                                                                                                                                        |
| `gripStyle`                                   | stated by the user (prefs or scan `gripStyleStated`)     | overrides any prediction                                                                                                                            |
| `palmThickness`                               | stated by the user (prefs or scan `palmThicknessStated`) | v1 only. thin / medium / thick shifts the height target (§3). Prefs win over the scan; a skipped answer is `undefined`, never `"medium"`. Candidate |
| `weightG` range, `includeVertical`            | prefs                                                    | optional                                                                                                                                            |
| catalogue row                                 | `mice` (once CAT-1 adds `listed`: listed rows only)      | dims, weight, shape, hand, hump, flare, curvature, thumb rest, form factor                                                                          |

Once CAT-1 adds `listed`, unlisted rows will never reach the engine; today every seeded row does.

## 2. Grip

- Stated grip → weights `w = {stated: 1}`.
- No stated grip → soft weights from `r = palmLength / handLength`:
  `w_palm = σ((r − 0.58)/s)`, `w_fingertip = σ((0.54 − r)/s)`, `w_claw = 1 − w_palm − w_fingertip`
  (clamped ≥ 0, renormalised), `σ` the logistic function, `s = GRIP_SOFTNESS` (candidate 0.016; the first guess, 0.008, moved one mouse's total by 3 to 4 points per 0.5 mm of palm length on the golden hands, so the continuity requirement in §8 failed. About 0.012 is the smallest value that passes, 0.016 leaves margin).
- `predicted` for display = arg-max of `w` (ties go to palm, then claw, then fingertip). Because the claw band is only 0.04 wide, the arg-max leaves claw for palm slightly below r = 0.58 (about 0.5775 at s = 0.016), so `predicted` can differ from v0's hard cut inside that sliver.
- `gripStyle.weights` in the response is present only when no grip was stated (the contract's wording); a stated grip is simply `used`.
- Every grip-dependent quantity (targets, sub-scores) is computed per grip and the **per-mouse
  total** is `Σ_g w_g · total_g`. No hard cut anywhere, so the total is continuous in `r`.
- The sub-scores, reason codes and `targets` shown in the response are those of the grip used
  (stated, else the arg-max); only `total` is blended. Confidence is that of the grip used.

## 3. Targets (per grip g)

`length_g = handLength × LENGTH_FACTOR[g]`, `gripWidth = palmWidth × 0.88`,
`height_g = handLength × HEIGHT_FACTOR[g] + THICKNESS_HEIGHT_SHIFT_MM[level]` — factors unchanged from v0.

**Palm-thickness shift (candidate, 未拍板; Kirby 2026-10-11, option A).** The person's own three-way answer
shifts the height target by `THICKNESS_HEIGHT_SHIFT_MM` = thin −1.5 mm, medium 0, thick +1.5 mm, for every grip
alike. With no answer nothing is added, so the result is exactly what it was before (`medium` gives the same
numbers as no answer, but a skipped answer must reach the engine as `undefined`, never as `"medium"`). Only
the height target moves: length, grip width, hump logic, weights, sigmas, `handType` and v0 are untouched.
**The 1.5 mm is a placeholder with no data behind it, and "a thicker palm prefers a taller mouse" is an
assumption, not a verified fact.** Replace both when M2 or learning-kit data exist.

The hand-type label (§7) is classified from the targets **without** the shift: it is display only and does
not move with the answer. The response's `targets` are the shifted ones.

How large the effect can be (formula-derived, not an engine run): the height Gaussian has
σ_eff ≈ 3.2 mm (σ 3 mm, widened by 0.20 × 6 mm of hand-length noise). A perfect-match mouse (Δ = 0)
loses about 10 points on the height sub-score at a 1.5 mm shift, which is about −2.0 on the total without hump data
and about −1.2 with it (height and hump share the 0.20 weight 0.6 / 0.4). The worst case is a mouse sitting
about 2.5 mm from the target, where a 1.5 mm shift moves its height sub-score by about 27.5 points. The
total moves by that times the sub-score's weight (0.20 without hump data, 0.12 with it), divided by the sum
of the applicable weights, which is not a fixed 0.95: it is 1.0 when a weight preference is given and the
grip-width weight is whole, 0.95 with no weight preference, and 0.825 with no weight preference while
`sideCurvature` is unknown (grip-width weight halved). So the worst case is about 5.5 to 6.7 points
without hump data and about 3.3 to 4.0 with it; rounding the displayed totals can add 1 more. These are
formula figures, not an engine run: run `npx tsx scripts/fit-stability.ts [--real]` for the measured ones.

_Tried and dropped (CALIB-1, 2026-10-10):_ clamping each target to the catalogue's 5th..95th percentile. It pulled very small and very large hands toward mid-size mice (a small fingertip hand lost the smallest mice), so v1 targets stay exactly the above.

## 4. Sub-scores

Gaussian `score = 100 · exp(−½ (Δ/σ_eff)²)`, **unrounded inside the engine** (round only the
final total for display).

Measurement uncertainty: `σ_eff = √(σ² + (k · σ_meas)²)` where `k` is the hand-length factor of
that target (length: `LENGTH_FACTOR[g]`; height: `HEIGHT_FACTOR[g]`; grip width: 0.88 with
`σ_meas_palmWidth`). Candidates: `σ_meas_handLength = 6 mm`, `σ_meas_palmWidth = 4 mm`, to be
replaced by M2 repeatability numbers.

Sub-scores and weights as v0 (length 0.30, grip width 0.25, height+hump 0.20, front flare 0.10,
thumb 0.10, weight 0.05), with:

- **Missing descriptor prior:** a null sub-score contributes `PRIOR[sub][g]` = the mean of that
  sub-score over the catalogue rows that reach the engine and have the descriptor, for grip g (computed once per
  catalogue load, passed in; falls back to 75 when no row has it). Confidence still counts it as
  missing.
- **Width-aware thumb-rest adjustment (CALIB-1, candidate, 未拍板).** For an ergonomic mouse with a
  thumb rest the effective grip width subtracts
  `THUMB_REST_BASE_MM + THUMB_REST_WIDE_SLOPE · max(0, widthMm − THUMB_REST_WIDE_FROM_MM)` =
  `12 + 0.5 · max(0, width − 80)` mm instead of v0's fixed 12 mm (so nothing changes up to 80 mm;
  an 89 mm mouse loses 16.5 mm, a 92 mm one 18 mm). Other mice keep 0. v0 keeps the fixed
  `THUMB_REST_ERGONOMIC_ADJUSTMENT_MM`. The slope rests on TechPowerUp measurements: the Corsair Ironclaw RGB is listed at 80 mm and gripped at about 68 mm (wing 12 mm, <https://www.techpowerup.com/review/corsair-ironclaw-rgb/2.html>), and the Redragon M913 Impact Elite, the same shell as the M908, is listed at 92 mm with a narrowest grip of 71.7 mm (wing about 20 mm, <https://www.techpowerup.com/review/redragon-m913-impact-elite/3.html>). A slope of 1.0 was also tried and dropped: it pushed mice that reviewers call large-hand mice (Nightsword, #3 to #14) out of the large-palm top 10.
- Grip-width weight is halved only while `sideCurvature` is null (v0's rule, kept). The draft
  wording was ambiguous; with the current seed every row has a null curvature, so every row is
  halved alike, and the halving stops mattering once curvature is imported.
- The prior covers `frontFlare` and `thumb` only: length, grip width and height never score null,
  and `weight` depends on the user's preference, not on the catalogue, so those keep 75.

## 5. Exclusions (before scoring)

1. wrong hand (unchanged); 2. `formFactor = trackball` unless allowed (new — the contract
   code `trackball_form_factor` already exists; the contract has no preference for it yet, so
   `scoreFitV1` takes an optional `{ allowTrackball }` argument, default false); 3. vertical: `formFactor = vertical` **or**
   height/length > 0.55, unless `includeVertical`.

## 6. Total, ties, bands

- `total = round(Σ_g w_g · Σ_sub weight·score / Σ weight)`.
- Sort: unrounded total desc → confidence desc → |length Δ| asc → model asc.
- Band from `src/lib/fit/bands.ts` (85/70/50, candidate).

## 7. Hand type (display only, does not affect the score)

`handType = { size, grip, width }`:

- `size`: which catalogue size class (`computeSize`) the target length of the used grip falls in
  → small / medium / large.
- `grip`: the used (or arg-max predicted) grip.
- `width`: `gripWidth target / length target` above or below `HAND_TYPE_WIDTH_SPLIT`
  (candidate: catalogue median of width/length) → wide / slim.
  `size` reads the fingertip class of `computeSize` (short, low target mice) as small. A 185 mm
  hand with a claw grip has a 114.7 mm target and lands in small, not medium: the label follows the
  mice's size classes, not the person's rank among hands. Label strings are copy candidates (例「中型・抓握・寬身型」). The label is anchored to mouse
  sizes, never compared with other people.

## 8. Stability report (evidence for "rigid")

`scripts/fit-stability.ts`, local, deterministic. For the four golden hands × perturbations
{hand length ±5, ±8 mm; palm length ±3 mm; palm width ±3 mm}: top-1 kept (%), top-5 Jaccard,
max total change of the base top 5. Run for v0 and v1 on the same catalogue
(`--real` runs it on the listed rows of the full seed instead of the 38-row one). Acceptance
threshold is Kirby's (candidate: top-5 Jaccard ≥ 0.6 at ±5 mm).

Also: sweep `palmLength` in 0.5 mm steps → largest jump in any mouse's total (v1 must have no
jump > 2 points between neighbours).

Palm-thickness sensitivity (v1 only, candidate): each golden hand scored with no answer, thin, medium and
thick against its own no-answer ranking: top-1 kept, top-5 Jaccard against the no-answer top 5, largest
total change in the no-answer top 5. `medium` must equal `none`. The palm-length sweep is repeated with the
answer fixed (every answer must stay at 2 points or below). `--real` includes both.

## 9. Versioning

`ENGINE_VERSION_V1 = "fit-v1-candidate.3"` (the palm-thickness shift bumped it from `fit-v1-candidate.2`, CALIB-1's value, and CALIB-1 had bumped `fit-v1-candidate`, so stored rows of different calibrations never mix; v0's `ENGINE_VERSION` stays `fit-v0-provisional`),
`ENGINE_IS_PROVISIONAL = true`. `DEFAULT_ENGINE` in `coefficients.ts` (`"v0"` or `"v1"`) is the
switch `scoreFitDefault` (`engine.ts`, used by the fit route) reads; it is `"v1"` since 2026-10-10 (see below). `fit_results` is unique
on (scan, mouse, engineVersion), so no migration. That one line also switches what `fit_results` stores for a
null sub-score: `core.ts` passes `storedNullScore(DEFAULT_ENGINE, catalogue)` to `buildFitResultRows`,
so v1 rows store the catalogue-mean prior its total used (rounded, the column is a smallint) and v0
rows keep 75.

**Default engine.** Since 2026-10-10 (Kirby, after the v0-vs-v1 comparison on the real catalogue) v1 is the default engine (now `fit-v1-candidate.3`); `scoreFit` (v0, `fit-v0-provisional`) stays in the code and is reachable through `scoreWithEngine("v0", ...)`. v1 is still a candidate: its coefficients and labels were unchanged by the switch, and `.3` adds only the palm-thickness shift (§3); all of it is 未拍板.

## 9a. Code map

| File                                                      | What                                                                                    |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `src/server/fit/score-v1.ts`                              | `scoreFitV1(measurements, catalogue, prefs, hand, priors, options?)`, `compareRankKeys` |
| `src/server/fit/grip-weights.ts`                          | `gripWeights(r, stated?)`, `argmaxGrip`                                                 |
| `src/server/fit/subscores-v1.ts`                          | unrounded sub-scores, `sigmaEff`                                                        |
| `src/server/fit/priors.ts`                                | `computePriors(catalogue)`                                                              |
| `src/server/fit/exclusions-v1.ts`                         | wrong hand, trackball, vertical                                                         |
| `src/server/fit/engine.ts`                                | `scoreFitDefault`, the `DEFAULT_ENGINE` switch                                          |
| `src/server/fit/stability.ts`, `scripts/fit-stability.ts` | §8 report: `npx tsx scripts/fit-stability.ts`                                           |
| `src/lib/fit/handType.ts`                                 | `classifyHandType(targets, grip, catalogueStats)`                                       |
| `src/server/fit/seed-catalogue.ts`                        | the 38-row seed as an engine catalogue (tests and the report)                           |

`CatalogueMouse` gained an optional `formFactor`; absent means standard. v0 ignores it.

## 10. Known limits

Coefficients are not validated against ratings; hand measurement bias is above the 3–5 mm
precision target; imported descriptors come from a third-party compilation's editorial judgments, so they can no
longer validate our own rubric.
