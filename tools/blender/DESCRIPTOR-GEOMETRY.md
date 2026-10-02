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

The validator prints metric lines, off-diagonal confusion counts and the names
of unmatched models. **Only the metric lines are recorded here.** The confusion
counts and unmatched names are not: next to the per-model prediction table below,
confusion counts can reveal individual fixture labels by arithmetic (found by the
#102 review, 2026-10-02; Kirby: remove the EloShapes labels). Do not infer
labels, probe individual models with extra runs, or read the fixture.

Full stdout/stderr from every invocation will be preserved locally under ignored
`tools/blender/out/descriptors/`. Only the printed metric lines are copied here,
with exit status and the command. No fixture rows, fixture labels or confusion
counts enter this document.

### Run 1 — 2026-10-02 (pre-registered)

- **Pre-registration commit:** `06cc13d` (2026-10-02T13:14:15+08:00), pushed to
  `origin/geo-descriptors` before this run. Claude made the commit because the
  sandbox blocked Codex's (see the next section).
- **Predictions:** `tools/blender/out/descriptors/predictions.json`, SHA-256
  `21e7ffcf3e6af66bb492f1bcdffe704a6f672f84c50f7015c54ed25badc5dc37`, unchanged
  since measurement.
- **Command** (run by Claude from the main checkout, so that `../Dataset/`
  resolves; the script is this branch's): `tsx scripts/validate-rubric.ts
--predictions tools/blender/out/descriptors/predictions.json --brand Logitech`.
  Exit status 0. Full output is kept locally in ignored
  `tools/blender/out/descriptors/validation-run1.txt`.
- **Printed metrics** (aggregate only, as the script prints them):

| Descriptor     | n   | Exact | Within-one | Coarse   | Gate (coarse ≥ 85 % and within-one ≥ 90 %) |
| -------------- | --- | ----- | ---------- | -------- | ------------------------------------------ |
| Hump           | 29  | 75.9% | 93.1% ✅   | 93.1% ✅ | **pass**                                   |
| Front flare    | 28  | 46.4% | 75.0% ❌   | 67.9% ❌ | **fail**                                   |
| Side curvature | 28  | 14.3% | 67.9% ❌   | 14.3% ❌ | **fail**                                   |

Eight seeded models have no fixture row. The computed-Size line the script also
prints is unchanged by GD-1.

**Reading.** Hump placement passes the unchanged gate on its single
pre-registered run. Front flare and side curvature fail it; per hard rule 4 the
measure or the rubric gets revised, never the gate. The curvature misses lean
mostly one way, which points at the measure itself, not only its thresholds. Any redesign is now informed by these
counts, so a further run on the same 28 rows is in-sample and must be reported
as such.

## Historical local execution record (validation was blocked)

_Historical: written before Claude committed the pre-registration as `06cc13d` and ran Run 1 above._

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

## GD-2 diagnosis

2026-10-02, after Run 1 and before any Run 2 validation. Kirby authorized one
redesign of flare and curvature. The historical Run 1 stop above is superseded
only by this authorization; **hump is done and stays untouched**. No private
fixture, model-associated fixture label, or model miss list was accessed. The
aggregate counts Run 1 printed are known, so this is not a blind study.

`diagnose_descriptors_gd2.py` decodes all 33 unique delivered meshes, without
reading the catalogue or validation output. It saves six section-plot sheets
(`out/descriptors/gd2/diagnosis-1.png` through `diagnosis-6.png`) and their numeric
samples (`diagnosis-sections.json`) in the ignored output directory. Each model
has transverse sections at t=0.4, 0.5 and 0.6, the old 20/50/80% samples and
chords, and its top-projected width profile from t=0.10 to 0.75. All six sheets
were inspected. The named examples below describe our geometry, **not which
models missed the fixture**.

**Curvature interpretation and sign.** Rubric section 6 explicitly means the
cross-section between deck and base, judged from front/rear; it is not the
longitudinal outline seen from above. The old sign is correct: left outward is
-X, right outward is +X. Reversing signs would exchange a real bulge and channel.
A straight inclined wall has zero chord bow; neither linear vertical taper nor
longitudinal taper alone explains the positive bias.

**Endpoint contamination is visible.** On the G Pro 2/Superlight sections in
sheet 1, the lower wall is close to straight, but the 80% endpoint sits on the
inward-turning deck shoulder. Its chord falls inside the wall at 50%, creating
positive bow. G203/G305 in sheet 2 also show basal taper and chamfer, so the 20%
endpoint can participate in that effect. The GD-1 claim that 20/80% excludes
rounding was too strong. These percentages describe total section height, not
the boundaries of the actual finger-contact wall. A synthetic straight wall
with a rounded deck and base chamfer reproduces a non-flat GD-1 bow; the GD-2
test verifies that the central wall itself has zero bow.

**Shelves, grip zone and averaging.** G502, M720 and MX Master sections show low
extensions, uneven shoulders and asymmetric walls. The exterior envelope does
not identify semantic components. A shelf intersecting a low endpoint can
create a spurious chord concavity; a rounded opposite shoulder can dilute or
reverse it when the two signed bows are averaged. The t=0.4–0.6 interval is a
reasonable central grip region, but its median cannot remove contamination
that persists throughout that region. Retain this longitudinal interval, move
the vertical measurement below the deck shoulder and above the low chamfer,
and retain separate wall results before combining them.

**Flare references.** Rubric section 5 combines “forward of the widest point”
with the more specific instruction to compare the front third and waist. A
single slice exactly at t=1/3 is the back boundary of the front third, not a
summary of the button region. Sheets 2, 4 and 5 show narrowing farther forward
that this slice can miss. A rounded nose tip is also not the button width.
The central waist remains a better operational reference than the maximum rear
palm width, but a raw minimum can be set by a single notch or a changing shelf.
The M550/M650/M750 profiles show a central trough; the shelf-bearing shells
show why the full projected outline may not be the main body width at all.
Use a front band, exclude low shelves from both widths, and smooth the waist
before selecting its minimum. This does not uniquely resolve the rubric's
“widest point” versus “waist” wording; the chosen waist interpretation is
explicitly a hypothesis.

## GD-2 pre-registration (Run 2)

**Run 2 reason:** test a geometry-motivated replacement for the two failed
measures after the diagnosis above. Run 1's 17 flat-to-outward curvature errors
prompted the specific investigation of shoulder/chamfer contamination; the
bidirectional flare errors prompted investigation of both reference widths.
Thus the choice to redesign, and the diagnostic priorities, were influenced by
Run 1. Sampling bands and mapping boundaries below were selected from the
rubric's views/definitions and inspection of our geometry, **not optimized
against those counts**. No model labels, error identities, threshold search,
target prediction distribution, or validation feedback were used. There is one
GD-2 candidate; its constants were fixed before generating its predictions.

**Run 2 on the same 28 rows is in-sample and exploratory. Any pass must be
recorded as “passed in-sample after redesign”, never as a clean gate pass.** The
gate remains coarse **≥85%** and within-one **≥90%**, independently for each
descriptor. No held-out or leave-one-out performance is claimed. This document
does not authorize a third run. Claude must commit this pre-registration, push
it, then run Run 2 and record its result. **Codex stops before the validator.**

### Fixed redesigned measures

Use the same delivered triangles, millimetres, frame, aliases, null products,
study-confidence flags and form-factor cautions as GD-1. All measurement maths
is pure NumPy in `descriptor_geometry_gd2.py`. No public asset or rubric changes.
Let H and z0 be each transverse section's local height and minimum Z.

**Flare:** W(t) is the exact X extent of the section segments after clipping to
z0+[0.30,0.70]H. This central body projection removes low shelves/chamfers and
the high deck/wheel, while preserving any extrema inside the band. It is an
operational approximation to a top-view main-body outline, not a semantic
button segmentation. Take the median W over 15 equally spaced stations from
t=0.20 through 1/3. This samples the front third while excluding the rounded
leading cap. For the waist, retain 21 stations from t=0.40 through 0.60; compute
five-station running medians at the 17 interior centers t=0.42 through 0.58,
then take their minimum. The smoothing spans 4% of shell length and rejects
isolated notches without replacing the waist with the widest palm section.
The signed measure is front-band median / smoothed waist - 1.

**Curvature:** at the same 21 grip stations, sample each exterior wall at 13
equally spaced heights from z0+0.25H through z0+0.55H. These bounds isolate the
lower central wall visible in the diagnostic sheets, below the usual shoulder
and above low chamfers/shelves; they are not a claim of universal anatomical
landmarks. Write its outward coordinate as -X on the left and +X on the right.
Fit x(q)=a q²+b q+c by least squares for normalized band height q in [0,1].
The fitted mid-chord bow is -a/4; divide by the measured band's height 0.30H.
This averages height samples rather than tessellation density and removes
linear inclination from the bow. A real convex profile is positive; a concave
channel is negative. Take the median over grip stations **separately per wall**.
Use the larger absolute wall median, so one gently concave side is not diluted
by a flat opposite side. If the walls have opposing signs and both exceed the
flat boundary, output flat with `opposingWallConflict=true`, preserving both
values. This is an explicit conservative ambiguity policy, not evidence of
vertical walls; it follows the rubric's anti-tail instruction. Record the
per-station slope and quadratic residual as diagnostics, with no hidden veto
or classification threshold based on them.

### Fixed mapping and reasoning

| Descriptor | Absolute measure | Level (sign supplies inward/outward) |
| ---------- | ---------------- | ------------------------------------ |
| Flare      | ≤0.025           | flat                                 |
| Flare      | (0.025,0.075]    | slight                               |
| Flare      | (0.075,0.15]     | moderate                             |
| Flare      | >0.15            | aggressive                           |
| Curvature  | ≤0.025           | flat                                 |
| Curvature  | (0.025,0.10]     | inward/outward                       |
| Curvature  | >0.10            | inward_aggressive/outward_aggressive |

Flare boundaries are deliberately unchanged from GD-1: at a 60 mm waist they
mean 1.5, 4.5 and 9 mm of full-width change. The redesign changes what is
measured, not the existing interpretation of essentially parallel, visible and
pronounced width differences. Curvature now normalizes to the actual 30%-height
wall band instead of full shell height, so its numbers are not interchangeable
with GD-1. At H=40 mm, the 12 mm band has flat tolerance 0.30 mm and aggressive
boundary 1.20 mm of bow. For a symmetric quadratic these correspond to endpoint
tangent departures from its chord of arctan(4×0.025)≈5.7° and
arctan(4×0.10)≈21.8°. Small departures count as near-straight, while a pronounced
channel/bulge requires substantially more bending. These are operational
hypotheses, not numeric boundaries supplied by the rubric. No prior percentage
from the rubric or Run 1 is imposed as a required output distribution.

**Hump preservation:** `measure_descriptors_gd2.py` requires the original
`predictions.json` SHA-256 to equal
`21e7ffcf3e6af66bb492f1bcdffe704a6f672f84c50f7015c54ed25badc5dc37`.
It copies each hump level, peak fraction, peak span and lateral peak diagnostic
verbatim, and checks equality before writing. It also verifies every source
asset hash against Run 1. It never calls the hump measure or mapping. Both
GD-1 Python files and their tests stay unchanged. Its inputs are our Run 1
predictions, manifest and delivered assets; it does not read the seed.

### Declared limitations

- Fixed height bands are not semantic segmentation. A tall shelf, low deck,
  broad rounding or raised feature inside a band can still contaminate it;
  real channels above 55% height can be missed. The retained vertical/trackball
  cautions are especially relevant. No exclusions or per-model masks are added.
- The flare body projection differs from a literal all-height top silhouette.
  A button overhang above 70% height can be lost. The front-band median can miss
  a very localized splay, and the waist filter can suppress a narrow true waist.
  A monotone central profile can still choose an interval endpoint as waist.
- A quadratic summarizes only broad bending. Multiple bends, grooves and
  reconstruction artifacts may not be captured faithfully. Sloping straight
  walls still map flat although the rubric says near-vertical; slopes are
  reported rather than being mislabeled concave/convex.
- Selecting the stronger wall can select reconstruction error. Conflicting
  non-flat walls map flat by policy, which can understate genuine asymmetric
  shaping; the conflict flag must not be interpreted as a physical flatness
  finding. There is no hand-specific side selection.
- The same 33 reconstructed geometries, three lower-confidence studies,
  one alias and four noShell records remain. No agreement with real-world
  channels, fixture labels or unchanged M1 thresholds is assumed.
- No fixture or validator has been accessed during GD-2. Only Claude's later
  run can supply agreement metrics; these predictions are not a miss list.

### Reproduction and frozen artifact

With the existing ignored Python 3.13 environment and the descriptor/reference
requirements installed:

```powershell
python tools/blender/diagnose_descriptors_gd2.py
python tools/blender/measure_descriptors_gd2.py
```

The second command writes `out/descriptors/predictions-gd2.json` and its
`.provenance.json` sidecar. Neither command invokes validation. The original
Run 1 artifacts are retained. Prediction hash, distributions and required
local checks are recorded below after generation, without changing constants.

**Frozen predictions SHA-256:**
`603a850e7801be6a0fe0fa3edf14ed9be65a1333b5be13356da1e55a5f6e0848`.
Run 1's file retains its original hash. All 38 hump labels and all 34 non-null
sets of hump measurements were copied unchanged. Counts below cover the whole
38-product catalogue, including the alias and four nulls; they are not the
28-row validation subset.

| Descriptor       | Predicted level distribution                                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Hump (unchanged) | center 14; back_minimal 12; back_moderate 6; back_aggressive 2; null 4                                                               |
| Flare            | inward_aggressive 2; inward_moderate 2; inward_slight 14; flat 5; outward_slight 7; outward_moderate 4; outward_aggressive 0; null 4 |
| Curvature        | inward_aggressive 1; inward 5; flat 17; outward 9; outward_aggressive 2; null 4                                                      |

Five of the 17 curvature-flat predictions have opposing-wall conflict flags;
they are ambiguous under the declared combination policy. Eleven outward
predictions remain. No constants were changed to reduce that count or to match
the rubric's class priors.

For concrete geometry-only checks, the G Pro 2's old bow/H is 0.069297; its new
left/right bow/band-height values are -0.011555/-0.013171, consistent with the
near-straight lower wall seen in sheet 1. G305's flare changes from 0.001101 to
-0.040943 when the front band replaces the single slice; M650's central trough
retains a similar flare (0.086014 to 0.087107). MX Master 3S's separate new wall
values are -0.098473/-0.008703, exposing the asymmetry hidden by its old averaged
0.031526 bow/H. The old and new curvature normalizations differ. None of these
observations establishes agreement with a fixture label.

### Frozen bytes and line endings (GD-3 reproducibility note)

The provenance hashes were computed on the Windows working copy. A byte check
at GD-3 distinguishes source from generated output: all seven frozen Python
files below have LF endings, both in the working copy and in the Git blobs
(`git ls-files --eol`: `i/lf w/lf`, `eol=lf`). Their LF hashes therefore equal
their working-copy hashes; the four source hashes present in the provenance
files match. The claim that the frozen **code** hashes require CRLF is incorrect.
No frozen source, existing test, provenance file or recorded number was changed.

| Frozen file                             | SHA-256 of LF bytes (also current working-copy bytes)              |
| --------------------------------------- | ------------------------------------------------------------------ |
| `descriptor_geometry.py`                | `62358175506db906b0bdb1e4f8509f5160fdcbd2fee5a043b95c827bc1a7b98c` |
| `descriptor_geometry_gd2.py`            | `06f078078f8e4bf06f301cda320445a54b6ab975bce0fbf35468953ab304ece1` |
| `measure_descriptors.py`                | `e0e0fb058ba60ac0315820f9ef43bcd17eb6261b3376ce2b59bb6c8a26ce770c` |
| `measure_descriptors_gd2.py`            | `0f0e4bee6e90b3c370262d4dba478d6ad6c2f0a27de3d364bdc22de57c321699` |
| `diagnose_descriptors_gd2.py`           | `c12439faf686c462e7413a72983344ab430e49533ee1a1e10054e4a4da52a5fa` |
| `tests/test_descriptor_geometry.py`     | `3917569a345c1fbf080e0fcce161383e034dc3a87b5687729d31efa97a4e6bb6` |
| `tests/test_descriptor_geometry_gd2.py` | `a6fa5f36812084b3bb9ac38c2f8c23a7c1a011913521acdacba7a9130ec59906` |

The generated prediction JSON files, however, have CRLF endings from Windows
text-mode output. Hashing the same bytes with only CRLF replaced by LF gives:

| Generated artifact     | Recorded Windows CRLF SHA-256                                      | LF-equivalent SHA-256                                              |
| ---------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `predictions.json`     | `21e7ffcf3e6af66bb492f1bcdffe704a6f672f84c50f7015c54ed25badc5dc37` | `eadaf03c02320737595c16c04bd3179689818abd10722035a52fea53b96b1a9a` |
| `predictions-gd2.json` | `603a850e7801be6a0fe0fa3edf14ed9be65a1333b5be13356da1e55a5f6e0848` | `b1192378767f9066f8560ec5b7a07e182c40a13fffb47274a98966c034a24415` |

`measure_descriptors_gd2.py` checks the raw Run 1 **prediction** hash and asset
hashes; it records, but does not enforce, source hashes. A fresh LF checkout
alone does not trip a source-hash check. Regenerating the prediction file on an
LF-writing platform does trip its pinned Run 1 hash check, even with identical
JSON values. Reproduction requires the original CRLF Run 1 artifact. The LF
hashes above are byte-format diagnostics, not replacement approved hashes; the
frozen script and its check remain unchanged.

### GD-2 local gates

| Check                                                               | Result                                                                           |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `python -m unittest discover -s tools/blender/tests -p "test_*.py"` | PASS: 225 tests, 213 passed, 12 existing bpy-only skips; includes 15 GD-2 tests  |
| `python tools/blender/check_catalogues.py`                          | PASS: CATALOGUES_MATCH; maximum accessor-bounds error 0.000014901161193847656 mm |
| `python tools/blender/audit_payloads.py`                            | PASS: 34 GLBs, 8,641,792 bytes                                                   |
| `python tools/blender/optimize_glbs.py --check`                     | PASS: exit 0                                                                     |
| `npx prettier --check .`                                            | PASS: all matched files use Prettier code style                                  |

Python checks used the existing worktree-local Python 3.13.13 executable at
`out/descriptors/venv/Scripts/python.exe`. Discovery and payload-audit output are
saved under `out/descriptors/gd2/`. PowerShell wraps unittest's stderr progress
as `NativeCommandError` in the redirected log; the process exit is 0 and its
summary is `OK (skipped=12)`. No tests failed or were newly skipped.

Run 2 validation invocations by Codex: **zero**. Agreement metrics and gate
outcome for GD-2 remain **not measured**. Claude's commit/push/run ordering is
still required.

## Run 2 — 2026-10-02 (in-sample, after redesign)

- **Pre-registration commit:** `0a80b42` (2026-10-02T13:39:01+08:00), pushed to
  `origin/geo-descriptors` before this run.
- **Predictions:** `tools/blender/out/descriptors/predictions-gd2.json`, SHA-256
  `603a850e7801be6a0fe0fa3edf14ed9be65a1333b5be13356da1e55a5f6e0848`, checked
  just before the run. Hump is copied unchanged from Run 1.
- **Command** (run by Claude from the main checkout, as for Run 1): `tsx
scripts/validate-rubric.ts --predictions
tools/blender/out/descriptors/predictions-gd2.json --brand Logitech`. Exit
  status 0. Full output is kept locally in ignored
  `tools/blender/out/descriptors/validation-run2.txt`.
- **This run is in-sample.** The redesign was informed by Run 1's aggregate
  counts and is scored on the same 28 rows. A pass here would read "passed
  in-sample after redesign", never a clean gate pass.

| Descriptor     | n   | Exact | Within-one | Coarse   | Gate (coarse ≥ 85 % and within-one ≥ 90 %) |
| -------------- | --- | ----- | ---------- | -------- | ------------------------------------------ |
| Hump           | 29  | 75.9% | 93.1% ✅   | 93.1% ✅ | pass (unchanged from Run 1)                |
| Front flare    | 28  | 50.0% | 92.9% ✅   | 75.0% ❌ | **fail**                                   |
| Side curvature | 28  | 53.6% | 89.3% ❌   | 60.7% ❌ | **fail**                                   |

**Reading.** Both measures improved from Run 1 (flare coarse 67.9 % → 75.0 %,
within-one 75.0 % → 92.9 %; curvature coarse 14.3 % → 60.7 %, within-one 67.9 %
→ 89.3 %), and both still fail the unchanged gate. One authorised run is left,
but a third redesign on the same 28 rows would be tuned further to them; front
flare and side curvature stay unclassified unless Kirby decides otherwise.
