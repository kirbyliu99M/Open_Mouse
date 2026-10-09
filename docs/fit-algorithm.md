# Fit algorithm — v1 candidate

Status: **candidate (未拍板)**. `fit-v0-provisional` stays the default engine until Kirby
approves the before/after of the golden test and the stability report. Every number below
lives in `src/server/fit/coefficients.ts` only.

## 1. Inputs

| Input                                         | Source                                               | Notes                                                                             |
| --------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------- |
| `handLengthMm`, `palmLengthMm`, `palmWidthMm` | scan (`HandMeasurements`)                            | wrist crease → middle fingertip; known bias 7–11 mm on a 190 mm hand (2026-10-07) |
| `hand`                                        | scan                                                 | left / right                                                                      |
| `gripStyle`                                   | stated by the user (prefs or scan `gripStyleStated`) | overrides any prediction                                                          |
| `weightG` range, `includeVertical`            | prefs                                                | optional                                                                          |
| catalogue row                                 | `mice` (once CAT-1 adds `listed`: listed rows only)  | dims, weight, shape, hand, hump, flare, curvature, thumb rest, form factor        |

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
`height_g = handLength × HEIGHT_FACTOR[g]` — factors unchanged from v0.

**Bounded targets (CALIB-1, candidate, 未拍板).** In v1 each of the three targets is then clamped
to the 5th..95th percentile (`TARGET_BOUND_PERCENTILES`) of that dimension over the standard mice
of the catalogue the engine is given (not `vertical`, not `trackball`, height/length within
`VERTICAL_FORM_FACTOR_RATIO`). Percentile method: linear interpolation between closest ranks
(rank = p/100 · (n − 1) over the sorted values; `percentile` in `priors.ts`). The bounds are
computed once in `computePriors` (`Priors.targetBounds`); with fewer than two standard mice they
are null and nothing is clamped. The clamped targets are the ones scored and the ones reported in
the response's `targets` (and used for the hand type). v0 does not clamp. Why: on the 411-row
catalogue a large palm asked for a 135.3 mm length (99th percentile) and a small fingertip hand for
a 29.7 mm height (1st percentile), sizes the catalogue barely offers.

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
  `THUMB_REST_ERGONOMIC_ADJUSTMENT_MM`.
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

## 9. Versioning

`ENGINE_VERSION_V1 = "fit-v1-candidate.2"` (CALIB-1 bumped it from `fit-v1-candidate` so stored rows of the two calibrations never mix; v0's `ENGINE_VERSION` stays `fit-v0-provisional`),
`ENGINE_IS_PROVISIONAL = true`. `DEFAULT_ENGINE` in `coefficients.ts` (`"v0"` or `"v1"`) is the
switch `scoreFitDefault` (`engine.ts`, used by the fit route) reads; it stays `"v0"`. `fit_results` is unique
on (scan, mouse, engineVersion), so no migration. Switching the default is a one-line change
in `DEFAULT_ENGINE` after Kirby's approval. That one line also switches what `fit_results` stores for a
null sub-score: `core.ts` passes `storedNullScore(DEFAULT_ENGINE, catalogue)` to `buildFitResultRows`,
so v1 rows store the catalogue-mean prior its total used (rounded, the column is a smallint) and v0
rows keep 75.

## 9a. Code map

| File                                                      | What                                                                                    |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `src/server/fit/score-v1.ts`                              | `scoreFitV1(measurements, catalogue, prefs, hand, priors, options?)`, `compareRankKeys` |
| `src/server/fit/grip-weights.ts`                          | `gripWeights(r, stated?)`, `argmaxGrip`                                                 |
| `src/server/fit/subscores-v1.ts`                          | unrounded sub-scores, `sigmaEff`                                                        |
| `src/server/fit/priors.ts`                                | `computePriors(catalogue)` (priors and `targetBounds`), `percentile`, `clampTargets`    |
| `src/server/fit/exclusions-v1.ts`                         | wrong hand, trackball, vertical                                                         |
| `src/server/fit/engine.ts`                                | `scoreFitDefault`, the `DEFAULT_ENGINE` switch                                          |
| `src/server/fit/stability.ts`, `scripts/fit-stability.ts` | §8 report: `npx tsx scripts/fit-stability.ts`                                           |
| `src/lib/fit/handType.ts`                                 | `classifyHandType(targets, grip, catalogueStats)`                                       |
| `src/server/fit/seed-catalogue.ts`                        | the 38-row seed as an engine catalogue (tests and the report)                           |

`CatalogueMouse` gained an optional `formFactor`; absent means standard. v0 ignores it.

## 10. Known limits

Coefficients are not validated against ratings; hand measurement bias is above the 3–5 mm
precision target; imported descriptors are EloShapes' editorial judgments, so they can no longer
validate our own rubric.
