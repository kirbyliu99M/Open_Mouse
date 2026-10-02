# GD-1: descriptors measured from delivered geometry

Pre-registration, 2026-10-02. This protocol and its implementation are to be
committed **before any validation invocation**. No private fixture has been
opened or parsed by this work. Only the unchanged `rubric:validate` script may
access it. No seed, scorer, contract, asset or rubric is changed by GD-1.

## Frame and input

Use every shell and study in `public/models/manifest.json`, decoding the actual
delivered Draco triangles, including all material primitives. The delivered
glTF frame is X across, Y up, nose -Z, ground Y=0. Convert metres to millimetres
and coordinates to Blender `(X, -Z, Y)`: nose +Y, up +Z, base Z=0.
Manifest orientation transforms describe already-applied authoring operations;
do not apply them again. The historical generic-loft README's opposite nose
convention does not apply to these delivered assets.

M575S copies M575's measures and levels using `aliasOf`; it is not an independent
geometry observation. Each of the four `noShell` products has three null
predictions. M705 Marathon, M325s and Signature Comfort Plus M850L are explicitly
lower-confidence studies: their cross-sections and local profiles depend on
limited-view interpolation and residual photograph perspective. Other shells
are also reconstructions, not physical scans. Trackball and vertical products
remain included and marked as unusual form factors; no post-hoc exclusion.

## Measures and fixed mapping

All maths is pure NumPy over vertex/triangle arrays, with no bpy or file access.
Sections intersect the triangle surface, rather than selecting nearby vertices,
so vertex density does not weight the result. Let `t` be distance from the nose
divided by total shell length. Grip stations are 21 equally spaced `t` values
from 0.40 through 0.60, including both ends.

| Descriptor | Continuous measure                                                                                                                                                                                                                                                                                   | Fixed level mapping                                                                                                               |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Hump       | `t` of the maximum shell Z; midpoint of longitudinal span for equal-height peaks (relative height tolerance 1e-9)                                                                                                                                                                                    | Center <=0.55; back_minimal (0.55,0.62]; back_moderate (0.62,0.70]; back_aggressive >0.70                                         |
| Flare      | `W(t=1/3) / min(W(grip stations)) - 1`, with W the full top-projected cross-section width                                                                                                                                                                                                            | Absolute ratio <=0.025: flat; (0.025,0.075]: slight; (0.075,0.15]: moderate; >0.15: aggressive. Negative inward, positive outward |
| Curvature  | At each grip station, sample exterior left/right X at 20%, 50%, 80% of that section's base-to-deck height. Each wall's outward signed displacement at 50% from the straight chord joining 20% and 80% is its bow. Average the two bows, divide by section height, then take the median over stations | Absolute bow fraction <=0.01: flat; (0.01,0.08]: inward/outward by sign; >0.08: inward_aggressive/outward_aggressive              |

Hump boundaries come verbatim from rubric section 4. The other boundaries are
operational hypotheses, **not** thresholds claimed by the rubric or learned
from labels. A 2.5% full-width difference makes about 1.5 mm on a 60 mm grip
an essentially parallel flare; 7.5% and 15% distinguish visibly larger width
changes. For a 40 mm section, 1% bow is 0.4 mm (near-flat), while 8% is 3.2 mm
(a pronounced channel/bulge). Broad non-aggressive bands implement the rubric's
instruction to reserve tail labels for clear evidence. Signs follow the actual
wall displacement, even if this produces uncommon outward predictions.

The grip interval excludes nose/rear caps. Using a central waist, rather than
the narrowest section over the whole mouse, avoids treating a rounded nose as
the grip. Sampling curvature between 20% and 80% excludes base/deck rounding;
normalization makes it scale-invariant. Left/right bow and wall slopes are
retained as diagnostics so asymmetry and taper are visible.

## Known measurement limitations, declared before validation

- Delivered products are single fused meshes, not labelled shell/wheel/button
  components. The literal mesh height maximum is used; projected texture details
  do not affect it, but any fused protrusion taller than the palm shell can.
  Semantic exclusion of such a protrusion cannot be guaranteed by these inputs.
  Peak span and lateral location are emitted for review. This is a limitation
  relative to the rubric's instruction to ignore wheels/raised buttons.
- Full top-projected widths may include integrated thumb shelves. No manual
  per-model masks or exceptions are chosen. This may be especially inappropriate
  for trackballs or vertical mice.
- A straight sloping wall has zero bow and is labelled flat, though the rubric
  describes flat as near-vertical. Slopes are reported separately. Averaging
  opposing wall bows can cancel asymmetric concavity/convexity.
- These measurements test the information encoded in our delivered shells. They
  do not establish that shell geometry captures real-world sidewall channels.

## Validation plan and run ledger

**Run 1 reason (proposed pre-registration):** evaluate the fixed geometric
interpretation above once against the existing Logitech M1 gate. The unchanged
gate is coarse ≥85% **and** within-one ≥90% independently for each descriptor.
Exact agreement is reported but is not an additional gate for these three
descriptors.

Stop after this run, pass or fail. No threshold tuning is planned. Maximum
authorized runs is three; any further run would require a written committed
reason first. No leave-one-out estimate is claimed: aggregate confusion counts
do not supply per-model measures/labels for refitting thresholds out of sample.
If thresholds are ever changed, these aggregate counts alone cannot honestly
produce leave-one-out performance for the tuned procedure.

The validator prints metric lines, aggregate off-diagonal confusion counts and
unmatched names, but **does not identify which matched models missed**. A true
model miss list cannot be reconstructed from these aggregates. Do not infer it,
probe individual models with extra runs, or read the fixture. Report our complete
prediction list separately, clearly labelled as predictions, not misses.

Full stdout/stderr from every invocation will be preserved locally under ignored
`tools/blender/out/descriptors/`. Only printed metrics and aggregate confusion
lines will be copied here, with exit status and the command. No fixture rows or
model-associated fixture values will enter this document.

No validation run yet.

## Local execution record (validation blocked)

The initial `git add` and requested pre-registration `git commit` were both
blocked by the sandbox: `Open_Mouse/.git/worktrees/geo-descriptors/index.lock`
is outside the writable worktree. Following the requested fallback, no elevated
commit is attempted. **Pre-registration commit: none. Validation invocations:
0 of 3.** The fixture was not accessed. The run-1 reason above remains proposed,
not committed, so the validator must not be invoked yet.

For all three descriptors, validation n, exact, within-one, coarse and gate
pass/fail are **not measured**. There are no validation metric lines to report.
No models can honestly be identified as misses. The model table below contains
only our geometric predictions, not comparisons to fixture labels.

Local measurement did complete on 33 unique delivered mouse GLBs: 34 predictions
including M575S, four null records, and three lower-confidence studies. No
thresholds were changed after measurement, and no validation feedback was seen.
No seed, src, scripts, STATUS, workflow or public asset files were edited.

### Reproduction

Use a worktree-local ignored Python 3.13 environment and install
`requirements.descriptors.txt`; the full existing test suite additionally uses
`requirements.references.txt`. This execution used Blender's bundled Python
3.13.13 to create `out/descriptors/venv`, with DracoPy 2.1.0 and NumPy 2.4.6.
The decoder itself does not import bpy. `npm.cmd ci` ran once successfully
(`npm.ps1` was blocked by Windows execution policy before starting npm).

```powershell
# From this worktree, with its Python 3.13 venv active:
python tools/blender/measure_descriptors.py
# Only AFTER committing this pre-registration, run once:
npm.cmd run rubric:validate -- --predictions tools/blender/out/descriptors/predictions.json --brand Logitech
```

The validator resolves the fixture relative to its current working directory.
Fixture availability at that location has not been checked. Do not move or copy
fixture data into a worktree to work around it. The unchanged validator must
remain the only process that reads it.

The existing Python geometry tests require `out/parameters.json` and
`out/coverage.json`. In this Windows sandbox `tsx` failed on `os.userInfo()` and
esbuild failed while resolving a parent directory. An ignored local helper,
`out/descriptors/generate-test-parameters.cjs`, used TypeScript's
`transpileModule` to compile the unchanged `export-parameters.ts` and its four
local dependencies into `out/compiled-test-setup/`, then executed that exporter.
This generated the original authored test inputs; no tests were changed or
skipped to avoid the setup failure.

### Required local checks

| Check                                                                             | Result                                                                              |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `python -m unittest discover -s tools/blender/tests -p "test_*.py"`               | PASS: 210 tests, 198 passed, 12 existing bpy-only skips; includes 10 new GD-1 tests |
| `python tools/blender/check_catalogues.py`                                        | PASS: CATALOGUES_MATCH; max accessor-bounds error 0.000014901161193847656 mm        |
| `python tools/blender/audit_payloads.py`                                          | PASS: 34 published GLBs, 8,641,792 bytes                                            |
| `python tools/blender/optimize_glbs.py --check`                                   | PASS, exit 0                                                                        |
| `node node_modules/vitest/vitest.mjs run --config tools/blender/vitest.config.ts` | PASS: 9 tests                                                                       |
| `npx.cmd prettier --check .`                                                      | PASS                                                                                |

There were two failed Python-suite attempts before generating the missing
ignored test inputs. Both had the same `test_geometry.GeometryTests.setUpClass`
missing-file error. The completed run above resolves that failure. Twelve
Blender-only tests are the existing non-bpy skips, not new GD-1 skips.

### Our predictions (not a miss list)

Values are rounded here only; mapping uses the full-precision JSON. H = fraction
from nose to peak; F = front/grip width minus one; C = signed wall bow/height.
M575S reuses M575; `lower` marks the three limited-view studies.

| Model                        | H        | F         | C         | Hump            | Flare            | Curvature          | Confidence    |
| ---------------------------- | -------- | --------- | --------- | --------------- | ---------------- | ------------------ | ------------- |
| ERGO M575                    | 0.457662 | 0.002874  | 0.041031  | center          | flat             | outward            | reconstructed |
| ERGO M575S                   | 0.457662 | 0.002874  | 0.041031  | center          | flat             | outward            | reconstructed |
| G Pro 2 Lightspeed           | 0.512157 | 0.044152  | 0.069297  | center          | outward_slight   | outward            | reconstructed |
| G Pro X Superlight 2         | 0.510663 | 0.032910  | 0.063006  | center          | outward_slight   | outward            | reconstructed |
| G Pro X Superlight 2 DEX     | 0.505799 | 0.028292  | 0.065116  | center          | outward_slight   | outward            | reconstructed |
| G Pro X Superlight 2 SE      | 0.510663 | 0.032910  | 0.063006  | center          | outward_slight   | outward            | reconstructed |
| G Pro X Superlight 2c        | 0.513089 | 0.039938  | 0.075177  | center          | outward_slight   | outward            | reconstructed |
| G203 Lightsync               | 0.582885 | -0.009073 | 0.079917  | back_minimal    | flat             | outward            | reconstructed |
| G305 Lightspeed              | 0.647423 | 0.001101  | 0.062462  | back_moderate   | flat             | outward            | reconstructed |
| G309                         | 0.592612 | -0.021957 | 0.043406  | back_minimal    | flat             | outward            | reconstructed |
| G403 Hero                    | 0.532551 | 0.034286  | 0.044067  | center          | outward_slight   | outward            | reconstructed |
| G502 Hero                    | 0.534547 | -0.027418 | 0.082508  | center          | inward_slight    | outward_aggressive | reconstructed |
| G502 X                       | 0.469105 | -0.014018 | 0.056579  | center          | flat             | outward            | reconstructed |
| G502 X Lightspeed            | 0.481327 | 0.003439  | 0.051430  | center          | flat             | outward            | reconstructed |
| G502 X Plus                  | 0.481327 | 0.003439  | 0.051430  | center          | flat             | outward            | reconstructed |
| G703 Lightspeed              | 0.525720 | 0.036321  | 0.044394  | center          | outward_slight   | outward            | reconstructed |
| G903 Hero                    | 0.593443 | -0.006040 | 0.051065  | back_minimal    | flat             | outward            | reconstructed |
| Lift Vertical                | 0.644833 | -0.060422 | -0.011033 | back_moderate   | inward_slight    | inward             | reconstructed |
| M190                         | 0.622688 | -0.028630 | 0.078522  | back_moderate   | inward_slight    | outward            | reconstructed |
| M196                         | 0.651539 | -0.012796 | 0.026881  | back_moderate   | flat             | outward            | reconstructed |
| M240                         | 0.594530 | 0.097812  | 0.067581  | back_minimal    | outward_moderate | outward            | reconstructed |
| M550                         | 0.578830 | 0.088654  | -0.001581 | back_minimal    | outward_moderate | flat               | reconstructed |
| M650                         | 0.578830 | 0.086014  | 0.000702  | back_minimal    | outward_moderate | flat               | reconstructed |
| M720 Triathlon               | 0.613213 | -0.035296 | 0.014987  | back_minimal    | inward_slight    | outward            | reconstructed |
| M750                         | 0.583551 | 0.084547  | 0.000772  | back_minimal    | outward_moderate | flat               | reconstructed |
| MX Anywhere 3S               | 0.614214 | -0.003076 | 0.007025  | back_minimal    | flat             | flat               | reconstructed |
| MX Master 3S                 | 0.614906 | -0.141993 | 0.031526  | back_minimal    | inward_moderate  | outward            | reconstructed |
| MX Master 4                  | 0.632452 | -0.099795 | -0.005866 | back_moderate   | inward_moderate  | flat               | reconstructed |
| MX Vertical                  | 0.618184 | -0.068476 | -0.020607 | back_minimal    | inward_slight    | inward             | reconstructed |
| Pebble 2 M350s               | 0.818741 | -0.005154 | 0.166121  | back_aggressive | flat             | outward_aggressive | reconstructed |
| POP Mouse                    | 0.741536 | -0.005790 | 0.116603  | back_aggressive | flat             | outward_aggressive | reconstructed |
| M325s                        | 0.627345 | 0.078697  | 0.046215  | back_moderate   | outward_moderate | outward            | lower         |
| M705 Marathon                | 0.544512 | 0.003734  | 0.049025  | center          | flat             | outward            | lower         |
| Signature Comfort Plus M850L | 0.596806 | -0.048170 | 0.048057  | back_minimal    | inward_slight    | outward            | lower         |
| M100                         | null     | null      | null      | null            | null             | null               | none          |
| Mobi Fold                    | null     | null      | null      | null            | null             | null               | none          |
| Signature Comfort M840L      | null     | null      | null      | null            | null             | null               | none          |
| MX Ergo S                    | null     | null      | null      | null            | null             | null               | none          |

### Ignored evidence artifacts

- `out/descriptors/predictions.json`: measures, per-section diagnostics, predictions, confidence, aliases, asset hashes and frame cautions from first-party URL names.
- `out/descriptors/predictions.provenance.json`: hashes and coverage counts.
- `out/descriptors/unittest.log`: completed Python discovery output.
- `out/descriptors/payload-audit.json`: complete unchanged payload audit.

Predictions SHA-256: `21e7ffcf3e6af66bb492f1bcdffe704a6f672f84c50f7015c54ed25badc5dc37`.
Manifest SHA-256: `d9900d75821346a562f4d27c54ec7854d1cb1b6e2454f5466b5e1d4d9a05bc4d`.
