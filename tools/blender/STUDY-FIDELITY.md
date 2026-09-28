# Study fidelity — living doc

**Read this, then `AGENTS.md`, before every run. Update the Results and Progress
log sections in every commit you make on this branch.**

Branch `m4a-study-fidelity`, worktree
`Open_Mouse/.claude/worktrees/m4a-study-fidelity`.

## Goal

Kirby, 2026-09-28: the eight limited-view studies must reach the finish of the
26 AR-derived shells, which Kirby is satisfied with. The untextured study
geometry is good and is kept. The gap is appearance and fine detail.

What the 26 shells have that the studies lack:

|        | 26 AR-derived shells                                                              | 8 studies today                                         |
| ------ | --------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Source | Official Logitech AR 360 GLB                                                      | 2–3 gallery photos                                      |
| Maps   | 2048 px baked colour, roughness, metallic, tangent normal (512 px JPEG delivered) | One top photo projected, flat matte sides and underside |
| Detail | Button seams, wheel, logos and grip texture in the maps                           | Photo lighting baked in; sides smeared or plain         |

## Scope

Status as of 2026-09-28. The Route column follows the Decisions table.

| Model                        | Route                                              | Geometry                                     | State                                                                           |
| ---------------------------- | -------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------- |
| G903 Hero                    | Full AR pipeline (B1)                              | Rebuilt from the official AR source          | Done; **accepted by Kirby 2026-09-28**                                          |
| M750                         | Full AR pipeline (B1)                              | Rebuilt from the official AR source (medium) | Done; **accepted by Kirby 2026-09-28**                                          |
| G Pro X Superlight 2 SE      | Superlight 2 shell, recoloured from SE photos (B2) | Superlight 2 AR-derived shell                | Built; **accepted by Kirby 2026-09-28**                                         |
| M550                         | Multi-view photo bake prototype (B3)               | Study, `m4a-eight-new-shells`                | B3 prototype built; Kirby awaits the M650-shell candidate (C)                   |
| M100                         | No photo bake (C1 dropped)                         | Study, `m4a-m100-level-base` (sheared trace) | Kept as is (Kirby, 2026-09-28) ; base levelling not accepted, changes requested |
| M705 Marathon                | No photo bake (C1 dropped)                         | Study, `m4a-eight-new-shells`                | Kept as is (Kirby, 2026-09-28)                                                  |
| M325s                        | No photo bake (C1 dropped)                         | Study, `m4a-eight-new-shells`                | Kept as is (Kirby, 2026-09-28)                                                  |
| Signature Comfort Plus M850L | No photo bake (C1 dropped)                         | Study, `m4a-eight-new-shells`                | Kept as is (Kirby, 2026-09-28)                                                  |

## Agent distribution

| Agent                                     | Owns                                                                                                                                                                   | Never does                                                                                                                                                                            |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Codex** (`gpt-6-astra`, reasoning high) | Everything under `tools/blender/` and generated `public/models/**` on this branch: discovery, texture pipeline, generation, tests, this doc's Results and Progress log | Edits `docs/STATUS.md` or anything outside `tools/blender/` and `public/models/`; changes study vertex positions without Kirby's approval; passes a gate on its own judgement; merges |
| **Claude** (orchestrator)                 | Task briefs, independent verification audit of every Codex step, `docs/STATUS.md`, reporting to Kirby, dispatching the reviewer                                        | Writes the texture pipeline itself; approves its own work                                                                                                                             |
| **Sonnet reviewer**                       | Independent review of the PR against this doc's acceptance criteria and `AGENTS.md`                                                                                    | Reviews code it wrote                                                                                                                                                                 |
| **Kirby**                                 | Decisions marked **Kirby** below; visual acceptance at gates B and C                                                                                                   | —                                                                                                                                                                                     |

**Handoff protocol.** Claude starts each Codex run with one task brief naming
its phase. Codex works only in this worktree, commits and pushes after each
meaningful step, records what it did and measured in Progress log, and stops
at the end of its phase with a final report. Claude audits the pushed result,
then reports to Kirby. The next phase starts only after its gate is recorded
below.

## Phases and gates

| Phase           | Work                                                                                                                                                          | Gate to pass before the next phase                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| **A** Discovery | A1 official AR asset search for all 8. A2 sibling-shell check (SE vs Superlight 2, M550 vs M650). A3 photo inventory per study. No pipeline or asset changes. | **Kirby** chooses the route per study from the A results   |
| **B** Prototype | Multi-view photo bake on one study, or an AR bake if A1 finds a source                                                                                        | **Kirby** visual acceptance of the prototype contact sheet |
| **C** Batch     | Apply the accepted route to the remaining studies                                                                                                             | Claude audit, Sonnet review, **Kirby** visual acceptance   |

## Acceptance criteria (phases B and C)

1. Same material contract as the 26 shells: one material, 2048 px colour,
   roughness, metallic and tangent-normal bakes, delivered by
   `optimize_glbs.py` as 512 px JPEG.
2. Study vertex positions unchanged: max vertex displacement 0 mm against the
   committed GLB, unless Kirby approved a geometry route for that study.
3. Every photo used to texture has a solved camera. Report silhouette IoU of the
   rendered mesh against each photo's mask (target ≥ 0.95), plus at least one
   held-out photo per study that was not used for texturing.
4. Photo coverage: report the share of the upper and side surface textured
   from photos; name what fills the rest (underside, occluded areas).
5. Studio lighting is removed from the colour map rather than baked in.
   Report the method, and show before/after on one flat-coloured region.
6. All existing gates stay green: `tests/check_assets.py`, support margin
   ≥ 5 mm, topology, calibrated bbox, `check_catalogues.py`,
   `audit_payloads.py`, `optimize_glbs.py --check`, unit tests, prettier.
7. Contact sheet per study: reference photos | current study | new study |
   a comparable AR-derived shell (for example M100 next to M190), at top,
   side, front and hero views.

## Constraints

- `AGENTS.md` hard rules apply, especially rule 1 (no licensed data).
- Network use is limited to `logitech.com`, `logitechg.com` and their
  `resource.*` hosts, with at most one request every 3 s. Record every URL
  attempted.
- Reference images and downloaded source GLBs stay under
  `tools/blender/out/` (ignored). Never commit them.
- The `out/reference-library/*` folders are junctions into other checkouts.
  Treat them as read-only. Put new downloads in `out/ar-candidates/<slug>/`.
- Publishing manufacturer-derived appearance is decision R8 (publish, rights
  caveat kept). No medical claims anywhere.

## Results

### A1 — official AR assets

Discovery date: 2026-09-28 (Asia/Taipei). Searches cover each study's product
route in **en-us, en-gb, en-eu and zh-tw**, including inline/embedded data, for
`ar-models`, `.glb`, `.usdz`, `model-viewer` and `3d`. The G903 and M750 product
pages expose direct GLB paths. Candidate HEAD requests additionally use the
hosts/folder patterns from the 26 committed AR references, model-token variants,
gallery colour names, and `-ar-360.glb`, `-ar.glb` and `.glb` suffixes.

| Study                        | Found                          | Source URL                                                                                                                                                                                                                                              | Page / asset HEAD / download requests | Full attempt log                                                                     |
| ---------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------ |
| M100                         | No, within searched candidates | —                                                                                                                                                                                                                                                       | 4 / 12 / 0                            | [16 requests](out/ar-candidates/logitech-m100/attempts.json)                         |
| M550                         | No, within searched candidates | —                                                                                                                                                                                                                                                       | 4 / 34 / 0                            | [38 requests](out/ar-candidates/logitech-m550/attempts.json)                         |
| M705 Marathon                | No, within searched candidates | —                                                                                                                                                                                                                                                       | 4 / 12 / 0                            | [16 requests](out/ar-candidates/logitech-m705-marathon/attempts.json)                |
| G Pro X Superlight 2 SE      | No, within searched candidates | —                                                                                                                                                                                                                                                       | 4 / 24 / 0                            | [28 requests](out/ar-candidates/logitech-g-pro-x-superlight-2-se/attempts.json)      |
| G903 Hero                    | **Yes**                        | [G903 Lightspeed black GLB](https://resource.logitechg.com/content/dam/gaming/en/ar-models/g903-lightspeed/g903-lightspeed-black-gaming-mice-ar-360.glb)                                                                                                | 4 / 7 / 1                             | [12 requests](out/ar-candidates/logitech-g903-hero/attempts.json)                    |
| M325s                        | No, within searched candidates | —                                                                                                                                                                                                                                                       | 5 / 28 / 0                            | [33 requests](out/ar-candidates/logitech-m325s/attempts.json)                        |
| M750                         | **Yes, medium and large**      | [Medium graphite GLB](https://resource.logitech.com/content/dam/logitech/en/ar-models/mice/m750/m750-m-graphite-ar-360.glb); [large graphite GLB](https://resource.logitech.com/content/dam/logitech/en/ar-models/mice/m750/m750-l-graphite-ar-360.glb) | 4 / 10 / 2                            | [16 requests](out/ar-candidates/logitech-m750/attempts.json)                         |
| Signature Comfort Plus M850L | No, within searched candidates | —                                                                                                                                                                                                                                                       | 4 / 18 / 0                            | [22 requests](out/ar-candidates/logitech-signature-comfort-plus-m850l/attempts.json) |

**Total: 181 HTTP requests** (145 HEAD, 36 GET; 178 distinct URLs).
Results: 36 responses with status 200, 144 with status 404, one with status 308.
The minimum measured interval between request starts was **3.086 seconds**;
the maximum per-study count was **38**, below the 40-request ceiling.

The zh-tw M100 and M705 routes return **404**. The zh-tw M325s route returns
**308**, then the mouse category returns **200**; unrelated category-page AR
links were excluded from study candidates. Every other locale product route
returns **200**. Failed asset candidates return **404**. "No" means this focused
search found no working URL; it is not proof that an official asset does not exist.

Each `attempts.json` records every request's URL, method, timestamp and HTTP
status, including the one redirect and three successful download GETs. Saved
`<locale>.html` and `<locale>-hits.json` preserve the page searches;
`candidate-urls.json` preserves the focused asset candidates. Requests are serial
and spaced at least 3 seconds apart. The 40-request ceiling includes pages,
redirects, HEADs and downloads, a stricter count than asset candidates alone.
Only the permitted Logitech hosts were accessed for discovery. Helpers are
`out/phase_a_fetch.py` and `out/phase_a_candidates.py`; no browser search engine
or third-party source was requested.

Downloaded assets were imported with
`C:\Program Files\Blender Foundation\Blender 5.2\blender.exe -b --factory-startup`
(Blender 5.2.2 LTS, bundled Python 3.13.13). Dimensions below are the **raw
world-space Blender X/Y/Z bounding box**, in mm, with no calibration or geometry
changes. They must not be mistaken for published catalogue dimensions. M750
medium matches the study's size variant; the large asset is separate evidence.

| Download             | Bytes     | Mesh objects / unique mesh datablocks | Raw X × Y × Z bbox (mm)   | SHA256                                                             |
| -------------------- | --------- | ------------------------------------- | ------------------------- | ------------------------------------------------------------------ |
| G903 black           | 4,691,004 | 5 / 5                                 | 72.859 × 142.635 × 44.776 | `10756b6c181b4fd3d8578a148c43f141ae47b462c46a3a593378fae48dab6baa` |
| M750 medium graphite | 6,180,480 | 8 / 8                                 | 60.590 × 107.615 × 38.281 | `259a809168b944f9f6ca65c53fa5d31205e850d2052e097afb40d9b89e3e6dea` |
| M750 large graphite  | 8,482,356 | 11 / 11                               | 65.537 × 118.148 × 41.428 | `5daa232ca3166e14c69b1f9b1872cc4d0e3fe571d0821d592ae981fb73644cec` |

The GLBs, URL/byte/hash sidecars (`*.glb.json`) and Blender measurements
(`*.glb.blender.json`) remain in their ignored `out/ar-candidates/<slug>/`
folders. No downloaded source mesh is committed or substituted into a study.

### A2 — sibling shells

Measured 2026-09-28 against the **committed reconstructed sibling shells**, not
against the manufacturer's original mesh. Both pairs pass the IoU requirements
but fail the maximum-boundary-gap requirement. Neither qualifies as "same shell".

| Study                   | Sibling              | Top IoU  | Side IoU | Top / side max boundary gap (mm) | Verdict                                                                   |
| ----------------------- | -------------------- | -------- | -------- | -------------------------------- | ------------------------------------------------------------------------- |
| M550                    | M650                 | 0.991842 | 0.987842 | 1.419 / 4.222                    | **Inconclusive**: nose/button opening differs; maximum gap exceeds 1.5 mm |
| G Pro X Superlight 2 SE | G Pro X Superlight 2 | 0.994485 | 0.989098 | 1.008 / 2.338                    | **Inconclusive**: narrow roof seam differs; maximum gap exceeds 1.5 mm    |

The mismatch is concentrated at fine openings that the reconstructed sibling
may seal or smooth. This comparison therefore does not establish that the
physical production shells differ. No seam was removed to make the gate pass.
Identical published dimensions remain insufficient evidence for substitution.

Method: import `public/models/shells/logitech-m650.glb` and
`public/models/shells/logitech-g-pro-x-superlight-2.glb` into Blender 5.2.2 LTS /
Python 3.13.13, using `-b --factory-startup`. Render transparent 1600 × 1600
orthographic silhouettes. Top camera is +Z with image up +Y; side camera is −X
with image up +Z and nose pointing left. The top camera uses explicit zero Euler
rotation to avoid the track-quaternion pole ambiguity. Visually verify the nose
orientation before measurement.

For each photo and render, take alpha > 180, keep the largest connected component,
fill enclosed holes, and crop tightly. Preserve open seams and notches; apply no
opening/closing, perspective correction or optimized alignment. Resize each pair
independently in X/Y to the same bounding box at 12 pixels/mm: M550 top
61 × 108.2 mm and side 108.2 × 38.8 mm; SE top 63.5 × 125 mm and side
125 × 40 mm. IoU is intersection/union area. Maximum gap is the symmetric
Hausdorff distance between one-pixel boundaries, with physical X/Y pixel spacing.
These are normalized silhouette distances, not independently calibrated physical
measurements. Alpha thresholds 64 and 127 leave both verdicts unchanged: M550
side maximum 4.182–4.222 mm; SE side maximum 2.338 mm.

Exact photos, relative to `out/reference-library/<study>/`:

- M550: `m550-medium-graphite-top-angle-gallery-1.png` and
  `m550-medium-graphite-profile-angle-gallery-4.png`.
- SE: `pro-x-superlight-2-se-red-top-angle-gallery-1.png` and
  `pro-x-superlight-2-se-red-profile-left-angle-gallery-4.png`.

Evidence: [M550 overlay](out/ar-candidates/logitech-m550/sibling-overlay.png),
[SE overlay](out/ar-candidates/logitech-g-pro-x-superlight-2-se/sibling-overlay.png).
Each corresponding folder also contains `sibling-top.png`, `sibling-side.png`,
`sibling-render.json` and `sibling-metrics.json` (full precision, gap locations,
threshold sensitivity). Helpers: `out/phase_a_blender.py` and
`out/phase_a_metrics.py`. All are ignored local evidence.

### A3 — photo inventory

All **137 image files** in the eight reference folders, including existing supplemental
photos, were opened as labelled contact sheets. Classification below is visual;
file names and `viewHint` values are not treated as camera evidence. "Left/right"
refers to the mouse's physical side. Oblique views are useful appearance evidence
but not true orthographic profiles. No study has a clean, straight-on front or
rear photograph in this inventory. Existing supplemental photographs were read
locally; their external hosts were not requested.

Committed colourways were checked against `manifest.json` texture provenance,
the selected top photos and the current projection palette. Maximum resolution
is the full image canvas, not the mouse crop. Large-size M550/M750 photos are
identified separately and must not silently stand in for the medium study.

| Study                        | Colourway used now | Usable views in that colourway                                                                                            | Maximum resolution                                                                       | Views only in another colourway                                                                                     |
| ---------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| M100                         | Charcoal           | Top; front/rear/side-biased three-quarter; bottom in an existing supplemental photo                                       | 1600 × 1374 gallery; 1600 × 1200 supplemental                                            | None                                                                                                                |
| M550                         | Graphite, medium   | Top, true left profile, bottom, front/rear three-quarter; supplemental opposite-side oblique with size/revision uncertain | 2500 × 2160 cutouts; 3800 × 2136 lifestyle                                               | None established for the same size; rose/off-white repeat the medium gallery views; black has top and three-quarter |
| M705 Marathon                | Charcoal/dark grey | Top, true left profile, front/rear three-quarter; oblique bottom in supplemental photos                                   | 1600 × 1374 gallery; 1000 × 708 supplemental bottom                                      | None                                                                                                                |
| G Pro X Superlight 2 SE      | Red                | Top, true left and right profiles, bottom, three-quarter; opened bottom with puck removed                                 | 2500 × 2160 red cutouts; folder maximum 3840 × 2160 is an occluded black lifestyle image | No additional view category; black/white repeat red views, pink has another three-quarter angle                     |
| G903 Hero                    | Black              | Top, bottom, left/right oblique side views, front/rear three-quarter; accessory layout includes another top               | 1600 × 1382                                                                              | None                                                                                                                |
| M325s                        | Graphite           | Top only                                                                                                                  | 1600 × 1382                                                                              | Side-biased oblique and three-quarter in celebration-black; three-quarter in red, pale-grey, lilac and blue         |
| M750                         | Graphite, medium   | Top, left side-biased oblique, front/rear three-quarter                                                                   | 1600 × 1382 cutouts; 1600 × 900 lifestyle                                                | None in this local folder; additional graphite images are large size                                                |
| Signature Comfort Plus M850L | Graphite           | Top, bottom, left side-biased oblique, front/rear three-quarter                                                           | 1600 × 1382 cutouts; 1600 × 900 lifestyle                                                | None: black `left.png` repeats graphite `extra-6.png`'s side angle                                                  |

File-level view evidence (all paths relative to `out/reference-library/<slug>/`):

- **M100:** `m100-charcoal-gallery-1.png` is top; `-2.png` and `-3.png` are
  three-quarter; `-4.png` is an elevated side/three-quarter view, not a true
  profile. `supplemental/ifixit-2.jpg` and `ifixit-3.jpg` show the same bottom
  photograph at two resolutions. `ifixit-0/1.jpg` crop the top; `ifixit-4/5.jpg`
  show a held, opened shell and are not usable intact-shell silhouettes.
- **M550:** medium graphite `...gallery-1.png` is top, `...gallery-2.png` rear
  three-quarter, `...gallery-3.png` bottom, `...gallery-4.png` true left profile,
  and `...gallery-5.png` front three-quarter. Off-white and rose medium repeat
  these five categories; black medium has top and front three-quarter. Large
  graphite and black are different size variants. `supplemental/reiwa-6/7.jpg`
  and `reiwa-8/9.jpg` show opposite side obliques, `reiwa-10/11.jpg` the bottom;
  the photographed size/revision is not established. `reiwa-16/17.jpg` explicitly
  compare rose medium with dark large, so the dark profile is not medium evidence.
  Lifestyle/recycled-plastic images add top/oblique context, not clean new axes.
- **M705:** `m705-gallery-1.png` is top; `-2.png` and `-3.png` are three-quarter;
  `-4.png` is left profile. `supplemental/techwalls-9.jpg` is the largest bottom
  photo, with duplicates `-10/11.jpg`. Other supplemental files repeat oblique
  views or have a hand occluding the shell.
- **SE:** red `...gallery-1.png` is top, `...gallery-4.png` left profile,
  `...gallery-5.png` right profile, `...gallery-6.png` bottom,
  `...gallery-3.png` three-quarter (despite its "high-back" name), and
  `...gallery-7.png` an angled opened bottom with puck removed. Black and white
  have the corresponding views. Pink `...gallery-8.png` is another oblique,
  not a new orthogonal view. The large lifestyle image is unsuitable for a full
  silhouette because the hand covers the mouse.
- **G903:** `top.png` is top and `extra-1.png` bottom. `left.png` shows an elevated
  left/front oblique; `right.png` shows a right-side oblique with cable attached.
  Neither is a clean profile. `extra-2.png` is rear three-quarter;
  `extra-3.png` is an accessory layout with a top view.
- **M325s:** graphite `top.png` is the only matching-colour view. `left.png` is
  red three-quarter, not left profile; `right.png` is celebration-black rear
  three-quarter, not right profile. `extra-1/2/3.png` are pale-grey/lilac/blue
  three-quarter. `extra-4.png` is celebration-black elevated side, with visible
  top surface; `extra-5.png` is celebration-black three-quarter. No bottom,
  straight front/rear or reliable true profile is present.
- **M750:** `top.png` is medium top. `right.png` actually exposes the **left**
  thumb-button side from above. `front.png` and `back.png` are medium front/rear
  three-quarter, not straight-on front/rear. `extra-2.png` is large-size
  three-quarter; `extra-1/3/4.png` are large-size lifestyle/recycled-plastic
  context (including a cropped top and an occluded hand view). No bottom or
  clean opposite-side view is present.
- **M850L:** graphite `top.png` is top, `extra-3.png` bottom, `extra-1.png` front
  three-quarter, `extra-5.png` rear three-quarter and `extra-6.png` elevated left
  side. Black `left.png` repeats that last angle. `extra-2.jpg` and `extra-4.jpg`
  contain occluding hands. No clean right profile or straight-on front/rear.

Reproducible local inventory: `out/phase_a_inventory.py`; per-study
`out/ar-candidates/<slug>/inventory-files.json` records every actual file and
resolution, and `inventory-*.png` contains the inspected contact sheets.

### B1 — G903 Hero and M750

**Initial Step 1 inspection, 2026-09-28 (blocker subsequently waived by Kirby).**
The findings below describe the first run. Per-axis calibration is now explicitly
approved for these two assets only; see Decisions and the continuation below.
Kirby's B1 brief requires every source-to-catalogue axis scale to be within
0.97–1.03 and the scales to differ by no more than 2%. Both assets fail.
Dimensions and scales below are in **W / L / H** order (Blender X / Y / Z).

| Asset       | Raw dimensions (mm)                | Catalogue dimensions (mm) | Required calibration scales (not applied) | Scale spread, max/min − 1 | Result                                        |
| ----------- | ---------------------------------- | ------------------------- | ----------------------------------------- | ------------------------- | --------------------------------------------- |
| G903 Hero   | 72.858803 / 142.634690 / 44.776070 | 67 / 130 / 40             | 0.919587 / 0.911419 / 0.893334            | 2.938718%                 | All axes outside 0.97–1.03; spread exceeds 2% |
| M750 medium | 60.589999 / 107.614987 / 38.281003 | 61.8 / 107.19 / 37.8      | 1.019970 / 0.996051 / 0.987435            | 3.294938%                 | Individual axes pass; spread exceeds 2%       |

The absolute max-minus-min scale differences are also above 0.02:
**0.026253** for G903 and **0.032535** for M750. Thus the result does not
depend on interpreting the 2% limit as a relative ratio or percentage-point
difference. Catalogue dimensions are targets only; no calibrated shell exists
from this run.

Inspection used Blender **5.2.2 LTS / Python 3.13.13**, importing the exact
Phase A GLBs without modifying their transforms. Bounds use every actual vertex
after its world transform, not object bounding-box corners. Isolated top and
hero renders identify the parts; the descriptions below are visual observations.

G903's five meshes:

| Object / mesh  | Source material | Individual W / L / H bbox (mm)     | Observed geometry                           |
| -------------- | --------------- | ---------------------------------- | ------------------------------------------- |
| Node1 / Mesh_2 | Material1       | 70.212148 / 96.085224 / 43.891995  | Main buttons, side buttons and wheel pieces |
| Node2 / Mesh_3 | Material2       | 72.858803 / 140.617877 / 44.776070 | Rear upper shell and chassis/base geometry  |
| Node3 / Mesh_4 | Material2       | 37.887165 / 37.887259 / 4.004106   | Circular fitted underside puck/cover        |
| Node4 / Mesh_0 | Material3       | 70.209384 / 132.616937 / 35.382203 | Inner shell/base surfaces                   |
| Node5 / Mesh_1 | Material4       | 39.174447 / 80.557773 / 29.497342  | Centre/front wheel surround and trim        |

**No non-body part explains the G903 discrepancy.** Node2 sets both width
extrema, both height extrema and the positive-Y length extremum. Node5 sets
the negative-Y length extremum. Node3 is wholly within those bounds; excluding
it leaves **72.858803 / 142.634690 / 44.776070 mm** unchanged. There is no
external cable, dongle, stand or detached weight in the inspected assembly.
All five imported objects have the same uniform 0.01 world scale. The oversize
belongs to the assembled body, rather than a removable accessory; why the
source body differs from the catalogue remains unresolved. No part was excluded,
no cable trim was added, and no uniform or per-axis correction was applied.

M750 medium's eight meshes all use source **Material1**:

| Object / source mesh | Individual W / L / H bbox (mm)     | Observed geometry                        |
| -------------------- | ---------------------------------- | ---------------------------------------- |
| Node1 / Mesh_0       | 58.674002 / 96.657995 / 32.391999  | Inner upper shell surface                |
| Node5 / Mesh_1       | 16.219000 / 24.991004 / 24.989999  | Wheel                                    |
| Node9 / Mesh_2       | 58.809998 / 73.493997 / 6.518996   | Lower/base panel                         |
| Node13 / Mesh_3      | 56.215998 / 107.614987 / 27.951003 | Outer upper shell and main buttons       |
| Node17 / Mesh_4      | 50.455997 / 80.419995 / 36.423000  | Feet, underside details and side buttons |
| Node21 / Mesh_5      | 60.356997 / 41.613999 / 13.371000  | Rear lower/base panel                    |
| Node25 / Mesh_6      | 60.589999 / 98.573998 / 28.342000  | Side shell/grips                         |
| Node29 / Mesh_7      | 15.618000 / 51.718993 / 25.541000  | Centre wheel/button surround             |

M750 has no external accessory explaining its mismatch. Node25 sets width,
Node13 sets length and upper height, and Node17's feet set lower height.
All imported object world transforms are identity. The medium asset alone was
inspected; the large asset was not used. Source names above are read from the
GLB JSON; Blender added `.001` to some imported datablock names because G903
datablocks remained loaded in the inspection process.

Local ignored evidence:

- `out/b1_inspect.py`: import-only measurements and isolated-part renders.
- `out/study-fidelity/b1/logitech-g903-hero-inspection.json` and
  `logitech-m750-inspection.json`: full-precision bounds, transforms, materials,
  triangle counts and leave-one-mesh-out bounds, plus source SHA256 hashes.
- [G903 part inspection sheet](out/study-fidelity/b1/logitech-g903-hero-parts.png)
  and [M750 part inspection sheet](out/study-fidelity/b1/logitech-m750-parts.png):
  complete source followed by isolated meshes, at top and hero views. These are
  diagnostic sheets, not the requested old-study/new-shell comparison sheets.
- `out/study-fidelity/b1/byte-identical.json`: **35/35** tracked GLBs under
  `public/models/` compared byte-for-byte with HEAD; **0 changed**, **0 extra**.

**Historical first-run stop (before Kirby's waiver):** source registration, limited-view
list edits, capture/reconstruction/finish/compare/polish, packaging, optimisation,
and the Step 4 Python, Blender, catalogue, payload and optimisation gates.
No new-shell triangles, topology, support margin, silhouettes, baked maps,
512 px JPEG sizes or delivered GLB sizes are claimed. The requested four-view
comparison sheets (`b1/<slug>.png`, including G703/M650) were not generated
because there are no new shells. Both committed studies, all other packaged
assets, manifest and validation remain unchanged. Only this report is committed;
all inspection helpers and images remain under ignored `out/`. Prettier is
checked for this report using `npx.cmd`. B2 and B3 were not started. The scale
mismatch needs adjudication before B1 can resume; neither threshold was relaxed.

#### B1 continuation after the scale waiver

Resumed from `3a7c0f4` after `git pull --ff-only`. Registered the exact G903
and **medium** M750 GLBs in their local `sources.json`, retaining all photos and
other metadata. Removed both models from gallery-study lists and projections.
The AR top views plus their camera matrices establish both noses at source ?Y;
`REVERSE` now rotates each 180 degrees about Z into catalogue +Y without a
reflection. A Blender regression test checks nose direction and handedness.

Both 26-view captures, 0.45 mm depth/silhouette reconstructions, finishing and
same-camera comparisons completed. Each finished mesh has **14,000 triangles**,
**0 non-manifold edges, 0 degenerate faces, 0 non-adjacent intersection pairs**.
Mean / worst silhouette IoU: **0.9893 / 0.9869** for G903, **0.9930 / 0.9885**
for M750. Bbox-normalized independent gallery top IoU: **0.983662 / 0.992292**.
Full-precision evidence is in each ignored `out/reconstructed/<slug>/` report.
The source-to-catalogue scales are retained separately under `sourceCalibration`;
the existing `dimensionCalibrationScale` still records the subsequent
post-smoothing reconstruction correction. This avoids conflating the two stages.

The first reconstruction command found `skimage` missing in this worktree.
Copied the existing pinned offline dependency directory into local ignored
`out/python-deps/`, then reran successfully; no network package download or
shared writable dependency folder. Blender runs use 5.2.2 / Python 3.13.13;
standalone image-analysis commands use the installed `python` (3.12.10).
Bakes, packaging, delivered-asset checks and final contact sheets remain pending
at this checkpoint. No public asset has changed yet. No push attempted;
Claude will audit and push the local commits.

**B1 continuation, 2026-09-28: built after Kirby's waiver.** Codex ran Steps
2–4 and committed the code (`36f87a5`). Its Codex usage limit ended the run
before it committed the assets or wrote this evidence. Claude audited the
outputs, recorded the evidence below and committed the assets.

| Shell     | Status           | Delivered W × L × H (mm) | Source calibration (pre-carving, W/L/H) | Post-smoothing calibration | Silhouette IoU mean / worst | Support margin | Triangles | Delivered bytes |
| --------- | ---------------- | ------------------------ | --------------------------------------- | -------------------------- | --------------------------- | -------------- | --------- | --------------- |
| G903 Hero | AR-derived shell | 67.0 × 130.0 × 40.0      | 0.9196 / 0.9114 / 0.8933                | 1.0132 / 1.0115 / 1.0037   | 0.9893 / 0.9869             | 26.6 mm        | 14,000    | 385,136         |
| M750      | AR-derived shell | 61.8 × 107.19 × 37.8     | 1.0200 / 0.9961 / 0.9874                | 1.0149 / 1.0091 / 1.0048   | 0.9930 / 0.9885             | 21.7 mm        | 14,000    | 323,264         |

- Material contract matches the 26 shells: colour (sRGB), metallic/roughness
  and tangent normal (Non-Color), baked at 2048 px, delivered as 512 px JPEG,
  normal strength 0.65.
- Topology on reimport: 0 non-manifold edges, 0 self-intersections, one
  component, outward normals, 0 degenerate faces, bbox error 0.000 mm.
- Only these two mice changed. The other 33 GLBs are byte-identical to
  `3a7c0f4`. The old study GLBs were removed from `public/models/studies/`.
- Gates (Codex run and Claude re-run): unit tests OK (7 bpy tests skipped
  outside Blender), orientation and colour Blender tests OK, `check_assets.py`
  `ALL_ASSET_CHECKS_PASSED`, `check_catalogues.py`, `audit_payloads.py`,
  `optimize_glbs.py --check` and prettier all pass.
- Visual check (Claude, AR source | old study | new shell at top, side, front
  and hero): the new shells carry the AR source's panel seams, side wings,
  buttons, wheel surround and logos. The old studies were photo projections on
  smooth lofts. Both wheel recesses bake dark, the same limitation as MX Master
  4 and the other AR shells. **Kirby's visual acceptance is pending.**

### Step 0 ? reviewer fixes before B2

Source alpha and metallic emission overrides now live in a restoring per-channel
context: BaseColour retains blended source alpha; Roughness, Normal and Metallic
use opaque sources regardless of channel order. A tiny synthetic cover-over-part
Blender regression measures **0.000000** roughness through transparency versus
**0.800000** with the opaque cover, and checks restoration after Normal, Metallic
and BaseColour. Source-calibration arithmetic is pure and tested with identity
and non-self-inverse `[1, 2, 0]` axis permutations. Removed the dead side-projection
loop without changing its effective fallback behaviour. The payload generator
now derives classifications/counts from the manifest and sizes from actual GLBs;
it no longer requires stale local study snapshots.

### B2 ? SE

**Built 2026-09-28 after separate Step 0 commit `70f7765`; Kirby's visual
acceptance remains pending.** SE is now an AR-derived sibling shell, with red
SE photo colour, and the old study GLB is removed. This follows Kirby's decision,
not a changed A2 gate: A2 top/side IoU was 0.994485/0.989098, maximum seam gaps
1.008/2.338 mm, and the original shell-identity verdict was inconclusive.

**Method.** The official off-white Superlight 2 AR file is SHA256-pinned to
`ce7f19702694eaf41f2b4c5e9793eb9cd13c17e6b451d6d508a4038a94bc5888`.
It has only two materials, so material IDs alone cannot identify every part.
`bake_se_regions.py` labels disconnected source components by inspected geometry
and uses explicit source-UV boxes for the top G logo and side SUPERLIGHT mark.
The 2048 px emission ID bake uses the existing 4 mm cage, 12 mm ray distance and
12 px margin on the imported sibling UV atlas. No RGB classifier determines the
physical regions. Source geometry and UVs are not rebuilt.

`recolour_se.py` records interior photo patches in normalized alpha-bbox
coordinates, erodes patch boundaries by two pixels, rejects luminance tails and
robust-fit outliers, and subtracts a neutral specular term only on saturated red
plastic. It removes a quadratic log-luminance field before taking linear-RGB
medians. Shell and main buttons share one illumination field; its median fixes
the otherwise unknown exposure gauge. This is repeatable relative studio
de-shading, **not absolute reflectance calibration**: no colour chart or known
exposure exists. Shell-sample luminance coefficient of variation falls from
**0.320358 to 0.030843**. The [flat-patch before/after](out/study-fidelity/b2/deshading-shell-before-after.png)
is arranged left/right. The script and `colour-evidence.json` preserve the
patches, fit coefficients, counts and raw/corrected medians.

Physical-region recolour is `SE median ? (sibling texel / sibling region median)`.
Within the spatial print boxes, continuous ink/substrate compositing preserves
printed edges while changing ink to the SE photo colour; it does not classify
physical parts by RGB. The underside G uses separate source mesh components and
the SE bottom-photo median. Underside regulatory glyphs retain sibling artwork
and relative contrast: they are not SE serial/model-label evidence. Nearest
spatial labels extend into bake padding; inherited dark recess detail remains.

Photo-backed region transfer covers **99.9700% upper / 99.9966% side / 99.9987%
underside area**, using triangle-area-weighted UV-centroid ray-hit labels. This
is region-colour coverage, not full photo projection. Grain, seams, geometry and
PBR detail are inherited. The tiny remainder uses nearest-region extension and
source appearance. Hidden surfaces share their visible region's measured colour.

**Photos.** All four named red SE photos are in the read-only
`out/reference-library/logitech-g-pro-x-superlight-2-se/`:

- `pro-x-superlight-2-se-red-top-angle-gallery-1.png`
- `pro-x-superlight-2-se-red-profile-left-angle-gallery-4.png`
- `pro-x-superlight-2-se-red-profile-right-angle-gallery-5.png`
- `pro-x-superlight-2-se-red-bottom-angle-gallery-6.png`

The red `3qtr-high-back-angle-gallery-3.png` is held out from colour sampling.
Exact first-party URLs and SHA256 values are in manifest/validation. No reference
junction was written and no network download was needed.

**Registration.** Top/left/right/bottom use A2's repeatable affine framing:
alpha >180, largest component, enclosed holes filled, independent X/Y bbox
normalisation. This solves framing, not a physical lens. The held-out oblique
also fits camera angles by silhouette IoU: azimuth -49.5254?, elevation 36.2130?,
roll 0.0002?. Its appearance is not used to derive the palette.

| View   | Silhouette IoU | Used for colour |
| ------ | -------------: | --------------- |
| Top    |       0.994138 | Yes             |
| Left   |       0.986633 | Yes             |
| Right  |       0.985874 | Yes             |
| Bottom |       0.992936 | Yes             |
| Hero   |       0.978914 | No; held out    |

**Colour evidence.** Values are linear RGB; photo medians are after de-shading.
Delivered medians come from the actual 512 px JPEG, excluding region and printed
boundaries. These are consistency measurements against the photo palette, not
independent physical colour verification. The 2048 px medians/errors are also
recorded in manifest/validation and ignored evidence.

| Region             | SE photo median RGB    | Delivered median RGB   | ?E2000 |
| ------------------ | ---------------------- | ---------------------- | -----: |
| shell              | 0.6796, 0.0000, 0.0103 | 0.6724, 0.0000, 0.0103 |  0.220 |
| main buttons       | 0.6719, 0.0000, 0.0251 | 0.6654, 0.0000, 0.0252 |  0.212 |
| side buttons       | 0.9216, 0.0000, 0.0368 | 0.9216, 0.0003, 0.0356 |  0.245 |
| wheel rubber       | 0.0316, 0.0296, 0.0299 | 0.0319, 0.0296, 0.0307 |  0.582 |
| wheel rim          | 0.6358, 0.6122, 0.6174 | 0.6445, 0.6038, 0.5972 |  1.360 |
| underside          | 0.0222, 0.0224, 0.0225 | 0.0232, 0.0232, 0.0232 |  0.277 |
| feet               | 0.0945, 0.1165, 0.1484 | 0.0976, 0.1170, 0.1470 |  0.536 |
| logo               | 0.3662, 0.3611, 0.3707 | 0.3916, 0.3515, 0.3515 |  3.402 |
| side wordmark      | 0.6724, 0.6723, 0.6654 | 1.0000, 0.5552, 0.5215 | 18.759 |
| indicator          | 0.0837, 0.4634, 0.0238 | 0.4564, 0.2831, 0.1356 | 31.936 |
| ports and recesses | 0.0068, 0.0068, 0.0068 | 0.0070, 0.0070, 0.0070 |  0.115 |
| underside logo     | 0.2152, 0.2161, 0.2160 | 0.4649, 0.4649, 0.4707 | 16.987 |

Shell, main buttons and side buttons meet **?E2000 ?5**. Three other regions
exceed 5 after delivery: the thin side wordmark has only four fully covered
pixels and red JPEG chroma bleed (18.759); the indicator has one footprint pixel
and mixes with red (31.936); the high-contrast inherited underside-logo texture
averages differently after filtering (16.987, 148 evaluation pixels). Their
2048 px errors are 0.019 / 0.078 / 0.132 respectively. These are reported
limitations, not a claim of passing an all-region threshold. No gate changed.

**Geometry and delivery.** Decoded positions match the delivered sibling
**exactly: maximum displacement 0 mm**; UVs are exactly equal. Delivered W/L/H
is **63.500009 / 125.000015 / 40.000003 mm**, max catalogue error
**0.000014901 mm**. Geometry has **14,000 triangles**, **0 non-manifold edges**,
**0 degenerate faces**, **0 non-adjacent intersection pairs**, outward volume
**184,729.863 mm?**, and support margin **25.490273 mm**. One material retains
normal strength 0.65 and three 512 px JPEG maps (colour, packed metallic/roughness,
tangent normal). Geometry/UV bytes and both non-colour image payloads match the
sibling byte-for-byte; only the base image is rewritten. The lossless 2048 px
source stays under ignored `out/polished/<SE>/`. Delivered SE is **305,720 bytes**.
The **other 34/34 GLBs are byte-identical to `70f7765`**, with no unexpected
additions or missing files. There are still 35 delivered GLBs.

[Four-view contact sheet](out/study-fidelity/b2/logitech-g-pro-x-superlight-2-se.png):
SE photos | old SE study | new SE | Superlight 2, at top, side, front and hero.
All model renders share lighting/cameras. Photos retain their studio lighting.
A3 has no straight-on front photo, so that reference cell says so explicitly.
The new shell inherits the sibling's wheel/recess rendering limitations and
adds no wheel geometry. Kirby's visual acceptance remains pending.

**Gates:** Python discovery 42 tests (34 passed, 8 Blender-only skips); TypeScript
9 passed; Blender orientation 4 passed, colour sampling 3 passed, alpha regression
1 passed; `check_assets.py` reported `ALL_ASSET_CHECKS_PASSED`. Catalogue, payload,
optimisation and prettier checks all passed. The nine new SE tests also pass
with OpenCV/scikit-image imports disabled, matching CI's existing dependencies.
B3 is not started.

### B3 — M550 photo bake prototype

**2026-09-28, geometry and camera preflight checkpoint.** Pulled successfully
from `origin/m4a-study-fidelity`; no asset edits. Blender 5.2.2 imports of the
committed and lossless M550 have exactly equal decoded position sets:
**max displacement 0 mm**. The committed mesh has **14,000 triangles**, **0
non-manifold edges**, **0 degenerate faces**, **0 non-adjacent intersection
pairs**, dimensions **61.000001 / 108.200006 / 38.800009 mm**, and support margin
**24.514769 mm**. Source seam duplicates are retained; topology validation welds
only its diagnostic copy. Evidence: `out/study-fidelity/b3/geometry-preflight.json`.

Camera fitting is implemented before atlas generation to test whether the fixed
study geometry supports the photo gate. It fits perspective rotation, distance,
focal length and camera-plane translation with square pixels; it does not
independently rescale image axes. Only the five graphite-medium cutouts are
selected. The front three-quarter view is held out from appearance sampling.
Other sizes, colours and uncertain supplemental revisions are excluded; no
photo is mirrored. The alpha convention is >180, largest component, enclosed
holes filled. Four unit tests cover camera rotations, projection, rejection of
points behind the camera and IoU. Camera measurements and subsequent bake work
are pending at this checkpoint; no improved appearance is claimed.

**Historical B3 stop, 2026-09-28, before Claude's interpretation below.** The rear
three-quarter photograph reaches **0.932473336**, below **0.95** by
**0.017526664**. No gate was relaxed and no appearance bake was started.
This is a failed registration attempt, not proof that every possible camera
fit must fail. The unchanged loft matches top and profile much better than
the rear oblique; the overlay shows broad roof/rear-flank contour differences.

| Graphite-medium photo          | Silhouette IoU | Appearance role             | Camera target |
| ------------------------------ | -------------: | --------------------------- | ------------- |
| Top, gallery 1                 |    0.995091812 | Candidate; not textured     | Pass          |
| Left profile, gallery 4        |    0.982278863 | Candidate; not textured     | Pass          |
| Bottom, gallery 3              |    0.992875185 | Candidate; not textured     | Pass          |
| Rear three-quarter, gallery 2  |    0.932473336 | Candidate; not textured     | **Fail**      |
| Front three-quarter, gallery 5 |    0.957076478 | **Held out from texturing** | Pass          |

Each fit uses seven parameters: azimuth, elevation, roll, log camera distance,
log focal/distance ratio, and two camera-plane translations. Fixed view-class
initial angles use three distance starts (**300 / 900 / 4000 mm**); Nelder-Mead
fits at **320 px**, refines at **720 px**, and reports IoU independently at
**1440 px** maximum image dimension. Each optimisation permits 1100 iterations.
Camera distance is constrained to 120–10000 mm. These are silhouette-driven
perspective registrations, not uniquely recovered physical lenses. Masks retain
open notches; no contour dilation, independent X/Y rescaling or mirroring is
used. Fitted matrices, focal pixels, translation, exact photo URLs and SHA256
hashes are in `out/study-fidelity/b3/camera-*.json`.

During implementation, an OpenCV all-triangles `fillPoly` call incorrectly
cancelled overlapping front/back coverage. It was replaced by triangle unions;
the erroneous preliminary scores are discarded. A regression test requires a
fully filled square with duplicated opposing faces. **Only corrected union
raster scores appear above.** The raster is the actual unchanged mesh's
triangle projection; no surrogate ellipsoid or adjusted mesh is fitted.

**Stop status against criteria 1–7:**

- **1:** not implemented: no smart atlas, 2048 px maps or new single material.
- **2:** passes for the unchanged assets: exact decoded-position equality,
  **0 mm** displacement; no replacement GLB was written.
- **3:** **fails**, rear IoU **0.932473336 < 0.95**. Front is held out from
  all appearance work; all five photos were used only to evaluate silhouettes.
- **4:** photo coverage not measured; no new projection/blending or fill exists.
- **5:** delighting not attempted; no before/after evidence or claim exists.
- **6:** geometry preflight passes: support **24.514769 mm**, clean topology,
  bbox max error **0.000008595 mm**. Python **47 tests: 39 passed, 8 bpy-only
  skips** (including **5 new camera tests**); TypeScript **9 passed**;
  catalogue, payload, optimisation and prettier checks pass. Full
  `tests/check_assets.py` was not rerun after the camera stop; these are baseline
  checks of unchanged assets, not verification of a completed prototype.
- **7:** the requested `out/study-fidelity/b3/logitech-m550.png` four-view
  old/new/M650 sheet is **not generated**, because no new M550 exists. Instead,
  [camera diagnostics](out/study-fidelity/b3/camera-fit-diagnostics.png) shows
  all five references and silhouette overlays (red photo-only, blue mesh-only).

**Preservation:** all **35/35** public GLBs, including M550 and the other
**34/34**, are byte-identical to starting commit `881f1f7`; **0 extras, 0 missing**.
`byte-identical.json` stores SHA256 values and comparisons. Manifest, validation,
lossless polished source, reconstruction metadata and reference junctions are
unchanged. No network photo requests were needed. No `out/` file is committed.

**Appearance assessment:** M550 remains the old top-photo projection with matte
sides/underside and studio lighting baked in. It has made **no appearance
progress toward the AR shells** in this stopped run. UV atlas, visible-photo
blending, coverage/fill, delighting, M650-region PBR transfer, tangent normals,
packaging/provenance update and the final comparison sheet remain undone.
B3 needs camera-fit adjudication/refinement before resuming; geometry is still
protected and Phase C has not started. Commits remain local for Claude to push.

#### B3 continuation under Claude's criterion 3 interpretation

2026-09-28: Claude clarified that the 0.95 threshold applies to photographs
**used for texturing**. Top, left, bottom and front pass and will be used; rear
is held out and is never sampled for appearance. This supersedes the historical
stop above without changing the acceptance criterion or any threshold.

Top alpha silhouette versus its tight-bbox horizontal reflection has IoU
**0.999123599**, above the required **0.98**. Mirrored left-profile appearance
is therefore allowed for the right flank and will be labelled separately in
provenance and coverage. Other colours, sizes and supplemental revisions remain
excluded. The rear mismatch is an interpolated-cross-section accuracy finding
for Kirby: red at the rear hump and blue at the right flank/front lower edge.
Its symmetric boundary Hausdorff gap is **3.882600 mm**, using **0.070592729
mm/pixel** at the fitted target plane. This is a projected silhouette gap, not
an independently measured 3D surface error.

Checkpoint: smart-project atlas uses the AR pipeline's **66 degrees / 0.015
island margin**. Vertex coordinates remain identical. Draco position
quantisation **0 (disabled)** also roundtrips the exact decoded position set,
avoiding a second quantisation error when UV seams change. Seven new pure-math
tests pass (boundary gap, barycentrics, perspective depth, blend visibility,
robust SH fit, tangent normals, region assignment). M650's lossless 2048 px
baked material samples are extracted for region statistics. No public asset has
changed at this checkpoint; projection, delighting and delivery follow.

**B3 bake checkpoint:** all 14,000 atlas triangles contain sampled texels.
Area-weighted photo coverage is **100% upper / 99.266668% side / 100%
underside**. Side coverage separates **72.738618% direct**, **26.527334%
mirrored-only**, **0.733332% region-colour fill**. Coverage bits and per-texel
weights preserve every contributor; rear is absent. Hidden texels use observed
region medians; nearest-colour extension is only the 12 px outside-island margin.

The relative delighting pass fits second-order log-SH over uniform plastic,
rubber and underside samples, then a quadratic residual image field because
the unchanged loft normals differ from the photographed cross-section. Strong
detail and luminance outliers are excluded. The fixed top-shell patch's linear
luminance CV falls **0.286330 to 0.167610**. This is partial lighting removal,
not absolute reflectance recovery; residual gradients remain. Exposure anchors
are top plastic, left rubber and bottom underside. Top dominates roof artwork;
the front oblique contributes chiefly to the steep nose to avoid duplicate
wheel/logo projections.

M650 lossless bake medians, mapped by shared-family spatial footprints plus
bright-ink colour in the logo footprint:

| Region    | Samples | Roughness | Metallic |
| --------- | ------: | --------: | -------: |
| Shell     |    3431 |  0.490196 |        0 |
| Buttons   |    2805 |  0.501961 |        0 |
| Wheel     |     271 |  0.552941 |        0 |
| Logo      |      74 |  0.486275 |        0 |
| Rubber    |    2665 |  0.498039 |        0 |
| Underside |    4754 |  0.498039 |        0 |

The bounded log-colour high pass becomes shallow height and tangent normals;
normal shader strength remains **0.65**, with the same float32 encoding as M650
(`0.6499999761581421`). The delivered candidate has **one material**, **three
512 px JPEG maps**, from four **2048 px** lossless PNG bakes, **164,764 bytes**.
Reimport confirms **0 mm** displacement and identical triangle position
connectivity, support **24.514769 mm**, clean topology and bbox error
**0.000008595 mm**. Fourteen new photo-math/raster tests pass. Public installation,
full gates and visual contact-sheet review are still pending at this checkpoint.

#### B3 final delivered prototype, 2026-09-28

**Built, numeric checks pass; Kirby's visual acceptance pending.** Claude's
interpretation is applied: only the four passing photographs texture M550.
The rear remains a geometry evaluation photograph, not an appearance source.

| Photograph                                     | Final role                       | Silhouette IoU |
| ---------------------------------------------- | -------------------------------- | -------------: |
| Graphite medium top, gallery 1                 | Texture                          |    0.995091812 |
| Graphite medium left profile, gallery 4        | Texture; also mirrored for right |    0.982278863 |
| Graphite medium bottom, gallery 3              | Texture                          |    0.992875185 |
| Graphite medium front three-quarter, gallery 5 | Texture                          |    0.957076478 |
| Graphite medium rear three-quarter, gallery 2  | **Held out; never projected**    |    0.932473336 |

The final blend narrows profile contributions to side-facing surfaces and
front-photo contributions to the steep nose. This reduces roof-edge double
registration while retaining the angle/depth/edge weighting. Each uniform-region
fit selects SH or SH-plus-residual only if it reduces sample luminance CV;
otherwise it retains the uncorrected region. All eight sufficiently sampled
photo/region fits improved here. The final top plastic uses SH alone, so the
same fixed patch now measures **0.286330314 before / 0.199628180 after** (rather
than the intermediate 0.167610 result above). Across the top plastic fitting
samples, CV is **0.2165 before / 0.1490 after**. Relative shading and exposure
are estimated from uncalibrated product photos; some studio gradients remain.
No claim of complete or physical reflectance recovery is made.

Final area-weighted coverage is unchanged:

| Surface   | Direct photo | Mirrored-only | Region fill | Total photo |
| --------- | -----------: | ------------: | ----------: | ----------: |
| Upper     |  100.000000% |            0% |          0% | 100.000000% |
| Side      |   72.738618% |    26.527334% |   0.733332% |  99.266668% |
| Underside |  100.000000% |            0% |          0% | 100.000000% |

`coverage-bits.png` uses bits **1 top / 2 left / 4 bottom / 8 front / 16
mirrored-left**. Zero on a valid atlas texel means region-colour fill; the
atlas mask distinguishes this from outside-island padding.
`contribution-weights.npz` stores every contributor weight with its texel index.
`coverage.png` shows direct blue, mirrored-only purple, fill amber. All
14,000 triangles have texel samples; areas are triangle-area weighted, not
plain atlas pixel counts. Left reflection is supported by the measured top
symmetry **0.999123599**, but opposite-side appearance is still inferred.

The six PBR rows above remain the final mapping. Labels use inspected photo
features and shared-family millimetre footprints: front main buttons, the
centre wheel footprint, bright ink within the rear top-logo footprint, lateral
rubber, underside, and remaining shell. The source is the M650 lossless bake;
no M650 geometry or artwork is transferred. The small normal map adds restrained
seam/groove relief, not reconstructed physical wheel or button geometry.

**Final delivery and gates:**

- Four 2048 px PNG maps become one material with colour, packed MR and tangent
  normal **512 px JPEG** maps through `optimize_glbs.optimize`; normal strength
  **0.65**. Delivered size **164,568 bytes**.
- **Max displacement 0 mm**, exact triangle position connectivity; **14,000
  triangles**, **0 non-manifold edges**, **0 degenerate faces**, **0 non-adjacent
  intersection pairs**. Support **24.514769 mm**; bbox **61.000001 / 108.200006 /
  38.800009 mm**, max error **0.000008595 mm**. Draco position quantisation is
  disabled to preserve the original coordinates.
- `tests/check_assets.py`: **ALL_ASSET_CHECKS_PASSED**. Python discovery:
  **56 tests, 48 passed / 8 Blender-only skips**, including **14 photo-math and
  raster tests**. Blender orientation **4**, colour **3**, alpha regression
  **1** pass. TypeScript **9** pass. Catalogue, payload, optimisation and
  prettier checks pass.
- Only M550's GLB changes: other **34/34 byte-identical to `d448cc6`**, no
  extra or missing GLBs (35 total). All other manifest and validation entries
  are unchanged. Manifest's aggregate note now identifies M550's multi-view
  method. `limited-view-study` status remains. Reconstruction/manifest record
  photo URLs, hashes, camera roles, mirror provenance, coverage, lighting fits,
  PBR statistics and geometry limitations.

**Review artifacts (ignored, local):**

- [Required four-view comparison](out/study-fidelity/b3/logitech-m550.png):
  reference photos | old M550 | new M550 | M650, top/side/front/hero. All model
  cameras, physical framing and lighting match. No straight-on front reference
  exists; its cell says so. Hero reference is the held-out rear photograph.
- [Same flat patch before/after](out/study-fidelity/b3/delighting-before-after.png),
  [coverage map](out/study-fidelity/b3/coverage.png),
  [camera diagnostics](out/study-fidelity/b3/camera-fit-diagnostics.png).
- `geometry-evidence.json`, `bake-evidence.json`, `camera-evidence.json`,
  `delighting-patch.json`, `final-byte-identical.json`, `asset-gate.log`.

**How close:** the new M550 gains photographed grip grooves, panel seams,
underside markings and a complete PBR atlas, substantially improving the old
matte sides. It is still less physically defined than the AR shells. Its smooth
loft has no raised wheel, real button gap or accurately reconstructed transverse
section; some projection blending and illumination gradients remain. The rear
cross-section discrepancy (red hump, blue right flank/front lower edge) remains
**55 px / 3.882600 projected mm** and needs Kirby's geometry judgement. No
geometry was changed to hide it. Right-flank appearance is mirrored inference.
This prototype does not establish AR-equivalent geometric fidelity or visual
acceptance. Phase C is untouched.

Reproduction order: `m550_photo_evidence.py`, Blender `m550_atlas.py`,
`bake_m550_photos.py`, Blender `export_m550_photo_bake.py`,
`optimize_glbs.optimize(candidate, lossless)`, Blender `check_m550_photo_bake.py`,
`package_m550_photo_bake.py`, Blender `render_m550_comparison.py`,
`assemble_m550_sheet.py`, then the listed gates. Camera fits are produced by
`fit_m550_photos.py`; its historical `front-held-out` filename is retained,
while `camera-evidence.json` and manifest correctly label front as texture and
rear as held out. The atlas reads versioned baseline geometry from `d448cc6`
on a fresh run. No photo/reference junction was written; no network download,
push or `out/` commit occurred.

### C — AR shell fixes and M550 candidate

**Part 0, 2026-09-28:** SE packaging now applies IoU >= 0.95 only to
colour-source views and separately requires a held-out view. A regression accepts
a held-out IoU of 0.90, rejects colour IoU of 0.949 and rejects missing holdouts.
SE reuses `photo_camera_math.camera_axes`; the old and shared formulas return
exactly equal arrays at the tested angles. No fit or asset was regenerated.
`PAYLOAD-AUDIT.md` is regenerated after B3: 35 GLBs, 8,366,908 bytes,
4,679,005 image bytes, 94 JPEG maps. README now documents B3 reproduction and
payload-report regeneration after Phase C delivery changes.

Part 0 gates: Python 58 tests (50 pass, 8 bpy skips); Blender orientation 4,
colour 3 and alpha 1 pass; TypeScript 9 pass; full asset, catalogue, payload,
optimisation and formatting checks pass. All 35 public GLBs remain byte-identical
to `48a2af7`. Parts 1–4 are pending; O1/O2 remain open.

#### Part 1 measurement checkpoint and Blender regression stop

All 28 direct AR shells were measured in production pre-orientation coordinates,
using area-weighted polygon-centroid rays, a 4 mm cage, and total ray lengths of
16 mm / 54 mm. SE inherits the exact Superlight 2 geometry; ERGO M575S aliases
ERGO M575. These are shell-area estimates, not actual atlas texel counts. The
50 mm guarded column adds rejected opposing geometric-normal hits to remaining
misses; it is a diagnostic prediction, **not a delivered after-bake measurement**.
The first hit is always retained by the proposed selection rule.

| AR shell                 | Production 12 mm miss % | 50 mm miss % | 50 mm with backface guard, unresolved % | Delivered after % |
| ------------------------ | ----------------------: | -----------: | --------------------------------------: | ----------------- |
| ergo-m575                |                0.802443 |     0.132892 |                                0.132892 | Unchanged         |
| g-pro-2-lightspeed       |                3.748429 |     0.263402 |                                0.263402 | Unchanged         |
| g-pro-x-superlight-2     |                0.092346 |     0.004386 |                                0.004386 | Unchanged         |
| g-pro-x-superlight-2-dex |                2.182867 |     0.099209 |                                0.099209 | Unchanged         |
| g-pro-x-superlight-2c    |                0.078062 |     0.000449 |                                0.000449 | Unchanged         |
| g203-lightsync           |                0.041749 |     0.000000 |                                0.021924 | Unchanged         |
| g305-lightspeed          |                0.000000 |     0.000000 |                                0.000000 | Unchanged         |
| g309                     |                2.713391 |     0.088516 |                                0.088516 | Unchanged         |
| g403-hero                |                1.034175 |     0.026585 |                                0.540783 | Unchanged         |
| g502-hero                |                0.119983 |     0.089541 |                                0.089541 | Unchanged         |
| g502-x                   |                0.312965 |     0.027572 |                                0.057214 | Unchanged         |
| g502-x-lightspeed        |                0.298338 |     0.015668 |                                0.015668 | Unchanged         |
| g502-x-plus              |                0.298338 |     0.015668 |                                0.015668 | Unchanged         |
| g703-lightspeed          |                0.929059 |     0.033356 |                                0.540090 | Unchanged         |
| g903-hero                |                2.969815 |     0.106334 |                                2.029328 | Unchanged         |
| lift-vertical            |                0.002502 |     0.000000 |                                0.002502 | Unchanged         |
| m190                     |                0.585296 |     0.006818 |                                0.232671 | Unchanged         |
| m196                     |                0.022393 |     0.000446 |                                0.000446 | Unchanged         |
| m240                     |                0.040650 |     0.000000 |                                0.000914 | Unchanged         |
| m650                     |                2.635738 |     0.067734 |                                0.726643 | Unchanged         |
| m720-triathlon           |                0.050662 |     0.034911 |                                0.039441 | Unchanged         |
| m750                     |                2.997578 |     0.047355 |                                0.771922 | Unchanged         |
| mx-anywhere-3s           |                0.000439 |     0.000000 |                                0.000439 | Unchanged         |
| mx-master-3s             |                0.005702 |     0.000000 |                                0.000000 | Unchanged         |
| mx-master-4              |                0.016669 |     0.008653 |                                0.010896 | Unchanged         |
| mx-vertical              |                0.000860 |     0.000000 |                                0.000000 | Unchanged         |
| pebble-2-m350s           |                0.000000 |     0.000000 |                                0.000000 | Unchanged         |
| pop-mouse                |                0.162357 |     0.000455 |                                0.001502 | Unchanged         |
| g-pro-x-superlight-2-se  |                0.092346 |     0.004386 |                                0.004386 | Unchanged         |

Seven shells exceed 1%: G Pro 2 Lightspeed, Superlight 2 DEX, G309, G403 Hero,
G903 Hero, M650 and M750. Thus the requested threshold would select five more
than the expected G903/M750 pair. G903's normal guard rejects 1.922994% of total
shell area; its guarded unresolved estimate is 2.029328%, not the unguarded
0.106334%. M750's guarded estimate is 0.771922%. No normal guard was relaxed.
The diagnostic stops at the first long-ray hit; it does not seek a later face
past a rejected opposing normal.

The pure selection and exact-preservation merge have two passing unit tests.
A production second-pass prototype was attempted, but the new Blender regression
**failed before baking** on this import chain:

```text
bake_refinement.py -> photo_raster.py -> photo_bake_math.py
from scipy import ndimage
ModuleNotFoundError: No module named 'scipy'
Error: script failed, file: 'tools/blender/tests/test_bake_rays_blender.py', exiting.
```

Blender command exit code **1**. Bundled Blender is 5.2.2 / Python 3.13.13;
standalone Python has SciPy, bundled Blender does not. This is a prototype
integration failure, not a numerical rejection of the proposed ray policy.
Per the task's stop-on-gate-failure instruction, no re-bake, packaging, wheel
work, colour work or geometry work followed. The failed production prototype
and its Blender regression are preserved under ignored
`out/study-fidelity/c/blocked-ray-prototype/`, including `regression.log`.
`bake_refinement.py` was restored byte-for-byte to the Part 0 commit; no failed
prototype is active in the production pipeline. A continuation should remove
the unintended SciPy dependency from this UV-only path (or supply the pinned
Blender-compatible dependency), then rerun the preserved regression before use.
The regression must demonstrate near-hit preservation, long-hit recovery and
backface rejection; it has **not** yet done so.

Committed checkpoint: `measure_bake_rays.py`, `bake_ray_math.py` and two pure
unit tests. Measurements are saved in `out/study-fidelity/c/ray-area.json`;
import/measurement log: `out/part1-ray-area.log`. Missing reconstructed inputs
were copied from main into this worktree only; main and reference junctions were
not written. All 35 public GLBs remain byte-identical to `48a2af7`; no manifest
or validation changes. After removing the inactive failed prototype from the
production path, Python discovery passes **60 tests (52 passed, 8 bpy skips)**.
The production alpha regression and formatting were rechecked. Part 0's complete
gate results remain valid for the unchanged assets. The new fallback's Blender
regression remains **failed/unresolved**, so Phase C is not gate-complete.

**Not done:** production fallback and re-bakes; formerly black-region crops;
O2 cause verification/fix and wheel crops; Part 2b opacity change, regional
DeltaE2000 measurements and crops; Part 3 sibling candidate, geometry/IoU evidence
and contact sheet; Part 4 AGY-lead verification, geometry route, before/after IoU,
maximum gap and contact sheet. No general web search or candidate download was
performed. No new contact sheet exists. M705, M325s and M850L remain untouched.

#### Part 2b resumed checkpoint — stopped on synthetic colour regression

2026-09-28: `git pull --ff-only` reports already up to date. Part 0 remains
accepted. The resumed order is **2b, 4, 2, 1, 3**. Blender-side work must use
bpy/mathutils/numpy only; no SciPy dependency or environment changes are allowed.
O1 delivery scope is now only G903 Hero and M750. The other five above-threshold
accepted shells are deferred as O4 below. G903's 2.029328% guarded unresolved
area still needs a location crop and an explicit account of its eventual fill.

**Part 2b is WIP, not validated or delivered.** `source_channel` now makes
sources opaque for BaseColour as well as Roughness, Normal and Metallic, while
retaining the graph restoration logic. The alpha regression was updated to
check that rule and a new synthetic colour-bake assertion was added. Blender
5.2.2 / bundled Python 3.13.13 imported the production bake module successfully
without installing anything. This checks that import chain only, not every
Blender-run module; the separate O1 prototype remains inactive and unresolved.

The Blender test run had **2 tests: 1 passed, 1 failed**. Roughness measured
0.800000 opaque versus 0.000000 transparent. The new DIFFUSE colour assertion
failed at `atol=0.00001`, `rtol=0.0000001`:

| Measurement                 |      Red |    Green |     Blue |
| --------------------------- | -------: | -------: | -------: |
| Expected shader Base Color  | 0.700000 | 0.600000 | 0.500000 |
| Actual median baked DIFFUSE | 0.683209 | 0.585608 | 0.488006 |

Maximum absolute difference: **0.01679094**; maximum relative difference:
**0.02398705**. Exact terminal error: `RuntimeError: Bake alpha tests failed`.
The log is `out/study-fidelity/c/alpha.log`. The shell command subsequently
printed the log tail, so its reported exit code 0 is **not** a successful Blender
test result. No tolerance was changed. A next run should investigate whether
Principled DIFFUSE energy weighting invalidates the test's raw Base Color oracle;
an independently baked, originally opaque cover is a possible control. This is
a hypothesis, not a verified cause or permission to weaken the test.

Per the brief's stop rule, work stopped here. No MX Master 4 production re-bake,
regional DeltaE2000 table, crops, or sibling alpha-impact measurements exist yet.
Parts 4, 2, 1 and 3 were not started in this resumed run. The AGY report was not
read and no download or web search was performed. Every public GLB remains
byte-identical to `fb15dd1`; manifest, validation and payload sizes are unchanged.
The full gates were not rerun after this failed regression. The code and test
changes are committed only as an explicit failing WIP checkpoint, not as a
gate-complete Part 2b implementation.

## Open issues (candidates for Phase C)

| #   | Issue                                                                                                      | Evidence (Claude, 2026-09-28)                                                                                                                                                                                                            | Suggested direction                                                                                                                                                                                                           |
| --- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| O1  | Bake rays miss the AR source on part of G903 and M750; missed texels bake black                            | Cage 4 mm, max distance 12 mm: 2.97% (G903) and 3.00% (M750) of shell area miss, mostly mid and rear. At 50 mm only 0.11% / 0.05% still miss                                                                                             | Second bake pass for missed texels only, with a longer ray and a guard against hitting the far side; **Open: C stopped before production changes (see Results C)**                                                            |
| O2  | Wheel recesses read black on MX Master 4, M750 and G903, where the reference shows a metal or rubber wheel | MX Master 4 ray misses are only 0.02% of area, so the cause is geometry, not misses: the rebuilt wheel opening sits below the wheel crown, and rays hit the dark slot interior                                                           | Sample the wheel material for texels inside wheel openings, or raise the sealed surface to the wheel crown; must not change bbox, topology or the support gate; **Open: C stopped before production changes (see Results C)** |
| O3  | M705 has the lowest support margin                                                                         | 11.4 mm, passes the 5 mm gate. It is the eight-new-shells geometry Kirby kept                                                                                                                                                            | None required; recorded for review                                                                                                                                                                                            |
| O4  | Accepted AR shells above 1% missed area, outside the narrowed O1 scope                                     | Production 12 mm / unguarded 50 mm miss percentages: G Pro 2 Lightspeed **3.748429 / 0.263402**; Superlight 2 DEX **2.182867 / 0.099209**; G309 **2.713391 / 0.088516**; G403 Hero **1.034175 / 0.026585**; M650 **2.635738 / 0.067734** | **Kirby's decision pending.** Keep all five delivered GLBs byte-identical. Guarded figures remain in Results C's full O1 table.                                                                                               |

## Decisions

| Date       | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | By             |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| 2026-09-28 | Scope: all eight studies; target is the 26 AR-derived shells' finish                                                                                                                                                                                                                                                                                                                                                                                                                               | Kirby          |
| 2026-09-28 | Geometry: eight-new-shells versions, except M100 from m100-level-base                                                                                                                                                                                                                                                                                                                                                                                                                              | Kirby          |
| 2026-09-28 | Codex runs `gpt-6-astra` at reasoning high                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Kirby          |
| 2026-09-28 | **Gate A passed.** G903 Hero and M750 go through the full AR pipeline of the 26 shells; their study geometry is replaced (approved geometry route)                                                                                                                                                                                                                                                                                                                                                 | Kirby          |
| 2026-09-28 | SE uses the G Pro X Superlight 2 shell (geometry and detail maps) recoloured from SE photos (approved geometry route)                                                                                                                                                                                                                                                                                                                                                                              | Kirby          |
| 2026-09-28 | M550 is the photo-bake prototype for M100, M550, M705, M325s and M850L                                                                                                                                                                                                                                                                                                                                                                                                                             | Kirby          |
| 2026-09-28 | Phase B runs as B1 (G903, M750), then B2 (SE), then B3 (M550), one Codex run each, because all three rewrite `manifest.json` and `validation.json`                                                                                                                                                                                                                                                                                                                                                 | Claude         |
| 2026-09-28 | B1 scale gate: G903 Hero and M750 are calibrated per axis to catalogue L/W/H like the 26 shells, despite 2.9% / 3.3% scale spread. The Step 1 stop limits (0.97–1.03, 2% spread) are waived for these two only, and their calibration scales are recorded                                                                                                                                                                                                                                          | Kirby          |
| 2026-09-28 | B3 camera gate: the rear three-quarter photo (IoU 0.932) is held out rather than projected. Texture comes from top, left, bottom and front ¾ (all ≥ 0.95), plus mirrored left after a mirror-IoU check (0.9991). This interprets criterion 3; it does not relax it                                                                                                                                                                                                                                 | Claude         |
| 2026-09-28 | B3 assessment: the photo bake is a real but modest improvement. The remaining gap to the AR shells is mostly geometry: an interpolated loft, a 3.9 mm cross-section error at the rear ¾, and wheel and gaps present only in the texture. Phase C1 (photo bake of M100, M705, M325s and M850L, which have fewer photos) is **on hold for Kirby**. Meanwhile C runs O1/O2 on the AR shells, plus a non-delivered candidate: M550 on the M650 AR shell with the thumb buttons removed                 | Claude         |
| 2026-09-28 | M550 waits for the Phase C candidate on the M650 AR shell before a final choice. **M100, M705, M325s and M850L stay as they are**: no photo bake (C1 dropped)                                                                                                                                                                                                                                                                                                                                      | Kirby          |
| 2026-09-28 | **Visual acceptance:** G903 Hero, M750 and G Pro X Superlight 2 SE **accepted**. MX Master 4 and M100 **not accepted**; changes requested (details below)                                                                                                                                                                                                                                                                                                                                          | Kirby          |
| 2026-09-28 | MX Master 4 changes requested: wheel black hole (O2) and **button colour/finish wrong**. Claude measured it under identical lighting (top view, mean sRGB). Left button: AR reference 177, current 146, the first all-opaque bake 182. Palm matches at 185–186 in all three. **Claude's error:** on 2026-09-27 it replaced the all-opaque bake with the blended-colour bake after judging it "too white" by eye, without measuring. The fix is to bake base colour with the sources opaque as well | Kirby / Claude |
| 2026-09-28 | M100 changes requested: detail too low and proportions wrong. Route: (1) search for an AR source of a same-shell sibling (B100 is the business variant, commonly said to share the shell; Claude has not verified this) and verify it with A2-style silhouettes; (2) otherwise refine the geometry from the four gallery photos with B3's camera fitter. Deliver only if every view's IoU improves and the held-out view improves                                                                  | Kirby / Claude |

## Progress log

- 2026-09-28 Codex: **Resumed C, stopped during Part 2b on a new synthetic
  Blender colour regression.** Pull already up to date. All-channel opaque
  sources and the alpha test update are WIP. Two Blender tests: one pass, one
  fail; actual DIFFUSE RGB 0.683209/0.585608/0.488006 versus expected
  0.7/0.6/0.5, maximum error 0.01679094, tolerance 0.00001. No tolerance relaxed,
  package installed, environment changed, or GLB delivered. Results C records
  the exact failure and the possible test-oracle issue for investigation.
  Recorded narrowed O1 scope and deferred the five accepted shells as O4.
  Parts 4/2/1/3 remain pending; no new contact sheet or colour evidence exists.
  Commit is an explicit failing WIP checkpoint; no push.

- 2026-09-28 Codex: **C Part 1 stopped on Blender regression import failure.**
  Part 0 committed separately as `eafbf39`, all gates green and all 35 GLBs
  unchanged. Measured all 28 direct AR sources plus inherited SE: seven exceed
  1%, full table in Results C. G903 2.969815% misses at 12 mm, 0.106334% at
  50 mm, but 2.029328% unresolved with the required backface guard; M750
  2.997578% / 0.047355% / 0.771922%. Two pure fallback-selection tests pass.
  New Blender regression exited 1: `ModuleNotFoundError: No module named 'scipy'`
  through `photo_raster -> photo_bake_math`. Failed prototype/test/log archived
  under `out/study-fidelity/c/blocked-ray-prototype/`; production bake restored.
  No GLB, manifest or validation changes; no re-bakes. O1/O2 remain open;
  Parts 2, 2b, 3 and 4 not started per stop instruction. Local checkpoint only,
  no push. Resume with the dependency fix and preserved Blender regression.

- 2026-09-28 Codex: **Part 0 second-review fixes verified.** Pulled `48a2af7`.
  Corrected the SE camera gate and tested held-out/colour roles; reused the
  byte-identical camera-axis formula. Regenerated the payload audit and added
  B3 reproduction steps. Python 50 pass / 8 skips, Blender 8 pass, TypeScript
  9 pass; asset, catalogue, payload, optimisation and prettier gates pass.
  All 35 GLBs unchanged. Separate local commit; no push. Parts 1–4 pending.

- 2026-09-28 Claude: Kirby decided the M550 / C1 route (Decisions). Acceptance sheets were copied to a visible folder outside the repo (`Mouse Shape Project/模型驗收-2026-09-28/`); Kirby could not see the files under `.claude/`. Visual acceptance of G903, M750, SE, MX Master 4 and M100 is still pending.

- 2026-09-28 Claude: second Sonnet review, of `b5c7456..587e906` (Step 0, B2, B3): **approve with fixes**. No blockers or hard-rule violations. No iFixit or other third-party texture sources. 7 of 7 numeric spot checks matched. 56 unit tests OK (8 bpy skipped). Step 0 fixes confirmed, including a real alpha regression test. Should-fix, queued for Codex before Phase C: (1) `package_se.py:20` applies the 0.95 IoU assert to the held-out photo too; filter on use as `package_m550_photo_bake.py` does. (2) `PAYLOAD-AUDIT.md` was not regenerated after B3; add a B3/Phase C step to the README. Nits: B3 driver scripts are M550-specific one-offs, so Phase C1 needs near-full per-study rewrites, not parameter changes. Only the pure maths modules (`photo_camera_math.py`, `photo_bake_math.py`, `photo_raster.py`, `se_colour_math.py`) carry over. Camera-axis maths is duplicated between `fit_se_photos.py` and `photo_camera_math.py`.

- 2026-09-28 Claude: audited B3 (`e01836d`), pushed. Independent reimport: max vertex displacement 0.0 mm against the pre-B3 GLB (vertex count 7,565 → 8,161 from UV-seam splits only), bbox 0.000 mm, clean topology, support margin 24.51 mm, one material with three 512 px maps. Only M550 changed. Unit tests, catalogue and optimiser checks pass. Contact sheet: side grooves are now visible and the underside is complete, but streaks remain, and the shape and wheel stay far below the M650 AR shell. See the Decisions entry for routing.

- 2026-09-28 Codex: **B3 M550 delivered and verified**, after checkpoints
  `a7e3f0e` (symmetry/atlas) and `574fa9e` (first bake). Final side coverage
  **99.266668%**, with **26.527334% mirrored-only / 0.733332% fill**; upper/base
  **100%**. Four passing camera views texture; rear **0.932473336** is held out.
  Final flat-patch CV **0.286330314 to 0.199628180**; residual lighting remains.
  Tightened roof/nose blend and selected only beneficial region shading fits.
  One-material/three-map JPEG candidate **164,568 bytes**, **0 mm** position
  displacement and identical triangle connectivity. All listed gates green:
  full assets, 56 Python tests (8 bpy skips), 8 Blender-specific tests, 9 TS,
  catalogue/payload/optimisation/prettier. Only M550 changed; other **34/34** GLBs
  and all other model entries unchanged. Four-view sheet reviewed; limitations
  and **3.882600 mm** projected rear gap recorded for Kirby. Visual acceptance
  pending. No push and no Phase C work.

- 2026-09-28 Codex: **B3 bake/candidate verified.** Depth-tested, feathered
  linear blending includes four direct photos and separately labelled mirrored
  left; no rear appearance. Coverage **100 / 99.266668 / 100%** upper/side/base;
  side fill **0.733332%**. SH plus residual quadratic delighting changes the
  fixed-patch CV **0.286330 to 0.167610**. M650 region PBR medians and restrained
  tangent normals exported. Candidate reimport: exact positions and triangle
  connectivity, one material/three 512 px JPEG maps, **164,764 bytes**, geometry
  gates pass. Fourteen photo tests pass. Rendering in progress; no public asset
  changes yet. Local checkpoint only; no push.

- 2026-09-28 Codex: **B3 resumed under Claude's photo-role interpretation.**
  Pulled `d448cc6`; rear is held out, the four passing views texture. Top mirror
  IoU **0.999123599** permits mirrored-left right-flank coverage. Rear largest
  projected gap **3.882600 mm**. Smart atlas and unquantised Draco preserve
  positions exactly; seven new math tests pass. M650 PBR samples extracted.
  No public changes yet, no push, no Phase C work.

- 2026-09-28 Codex: **B3 stopped at the camera gate**, after preflight commit
  `6772f0f`. Corrected triangle-union rasterisation and added its regression test.
  Top/left/bottom/rear/held-out-front IoU: **0.995092 / 0.982279 / 0.992875 /
  0.932473 / 0.957076**; rear fails **0.95**. No atlas, bake or public asset
  changes. All **35/35** GLBs are byte-identical to `881f1f7`; decoded M550
  geometry displacement is **0 mm**. Python 47 tests (8 bpy skips), TypeScript 9,
  catalogue, payload, optimisation and prettier pass. Full asset integration
  gate not rerun; no finished-prototype claim. Results B3 records the stop,
  camera diagnostic sheet and every unattempted step. No push; Phase C untouched.

- 2026-09-28 Codex: **B3 preflight checkpoint.** Read-only geometry inspection
  confirms lossless/committed position equality (0 mm), clean 14k topology and
  24.514769 mm support. Added the focused perspective camera fitter and four
  passing camera-math tests. Five graphite-medium views selected; front
  three-quarter held out from texturing. Fits are running before UV/bake work.
  No public asset or reference-library changes. No push; Claude will push.

- 2026-09-28 Claude: audited Step 0 (`70f7765`) and B2 (`9546d3f`); both pushed. Independent reimport: SE vertex positions equal Superlight 2's delivered shell (max difference 0.0), bbox error 0.000 mm, clean topology, support margin 25.49 mm, same three-map material contract. Only the SE GLB changed since `5bf18ad`. Unit tests, `check_catalogues.py` and `optimize_glbs.py --check` pass. Contact sheet reviewed: seams, side buttons, wheel and front port match the reference photos. Accepted exceptions, as reported: side wordmark, indicator and underside logo ΔE2000 17–32, small printed marks. **Kirby's visual acceptance is pending.** B3 did not start: Codex hit its usage limit again (reset shown as 10:17 Asia/Taipei).

- 2026-09-28 Codex: **B2 SE built** after separate reviewer-fix commit `70f7765`.
  Only SE moved from study to shell; other 34 GLBs are byte-identical. Source
  component/UV region bake, photo de-shading, base-only GLB rewrite, camera fits
  and four-view sheet are complete. Vertex displacement is exactly 0 mm. Colour
  results and small-feature exceptions are in Results B2. Final gates: Python
  42 tests (8 bpy skips), TypeScript 9 passed; Blender orientation 4, colour 3,
  alpha 1 passed; full asset gate `ALL_ASSET_CHECKS_PASSED`; catalogue, payload,
  optimisation and prettier passed. New SE tests also pass without optional
  OpenCV/scikit-image imports. Only SE entries changed in manifest/validation.
  No push; Claude audits/pushes. B3 not started.

- 2026-09-28 Codex: Step 0 reviewer fixes implemented before B2. Python unit
  discovery: 33 tests, 8 Blender-only skips; TypeScript: 9 passed; Blender alpha:
  1 passed, orientation: 4 passed, colour sampling: 3 passed. Catalogue, payload
  and optimisation checks passed. Full asset gate: `ALL_ASSET_CHECKS_PASSED`; prettier passed for
  `tools/blender` and `public/models`. **35/35 GLBs byte-identical** to starting
  commit `5bf18ad`; zero changed. No published asset generation was invoked.

- 2026-09-28 Claude: Sonnet reviewer verdict on `origin/m4a-eight-new-shells..b5c7456`: **approve with fixes**. No blockers or hard-rule violations; 5 of 5 numeric spot checks matched. Should-fix items: (1) the opaque-source mutation in `bake_refinement.py` depends on channel order and is untested; (2) this Scope table was stale (fixed here); (3) `PAYLOAD-AUDIT.md` still counts 8 studies; (5) `reconstruct_views.py` `sourceCalibration` has no unit test; nit: dead `side_sources` loop in `polish_reconstruction.py`. Items 1, 3 and 5 and the nit go to Codex before B2. (4) Governance: Claude committed Codex's B1 assets after Codex hit its usage limit. This is flagged to Kirby.

- 2026-09-28 Claude: B1 audited and assets committed (see B1 continuation). Codex hit its usage limit at the end of the run; the reset is shown as 05:16 Asia/Taipei. B2 and B3 wait for Codex.

- 2026-09-28 Codex: **B1 resumed under Kirby's scale waiver (`3a7c0f4`).**
  Registered both AR sources, removed gallery routing, reconstructed and finished
  both 14k meshes with clean topology, and measured 26-view silhouette agreement.
  Confirmed both source noses need a Z half-turn, preserving handedness.
  Captures and reconstruction evidence stay local; bakes and final packaging
  are in progress. This checkpoint contains pipeline routing and evidence
  changes only. Commits remain local for Claude's audit/push.

- 2026-09-28 Claude: pushed Codex's `3f2a292` (sandbox push has no GitHub credentials). Kirby waived the B1 scale stop for G903 and M750 (Decisions). B1 resumes from Step 2.

- 2026-09-28 Codex: **B1 stopped at the Step 1 scale gate.** Imported and
  inspected G903's five meshes and M750 medium's eight meshes, including
  materials, world-space bounds and isolated-part renders. G903's fitted puck
  does not affect its bbox; the assembled body requires scales
  **0.919587 / 0.911419 / 0.893334** (relative spread **2.938718%**).
  M750 medium requires **1.019970 / 0.996051 / 0.987435** (spread **3.294938%**).
  No justified non-body exclusion fixes either mismatch. No pipeline or asset
  edits; **35/35 GLBs byte-identical to HEAD**. Results above record the blocker
  and local inspection evidence. Downstream generation, comparison sheets and
  gates were not run; B2/B3 not started. This commit records the blocker only.

- 2026-09-28 Claude: audited Phase A. Downloads, sizes and hashes match the
  sidecars. M750 medium matches the catalogue (107.6 × 60.6 × 38.3 mm raw vs
  107.19 × 61.8 × 37.8 mm). The G903 AR bbox is 9–12% larger than the catalogue
  on every axis. The 26 shells' calibration scales are all within 1.1%, so B1
  must explain this first. Overlays show M550 is the M650 body without M650's
  thumb buttons; SE differs from Superlight 2 only at seams. Committed Phase A
  (`d044780`) after Codex's `npx` was blocked. **Tooling:** call `npx.cmd`
  (or `node node_modules/prettier/bin/prettier.cjs`), not `npx`, from
  PowerShell.

- 2026-09-28 Codex: **Phase A discovery completed.** A1 made 181 serial official-host
  requests (145 HEAD / 36 GET, minimum interval 3.086 s, maximum 38 per study),
  covering all four requested locales for all eight studies. Found and downloaded
  G903 black plus M750 medium/large graphite; hashes, sizes and Blender 5.2.2 /
  Python 3.13.13 mesh/bbox inspections are recorded above and in ignored evidence.
  Other six studies had no working candidate. A2: M550 top/side IoU
  0.991842/0.987842, maximum gap 4.222 mm; SE 0.994485/0.989098, maximum gap
  2.338 mm. Both **inconclusive**, with no same-shell claim and no gate relaxation.
  A3 visually inventoried all 137 local files; view/colour/size limitations and
  overlays are recorded above. Only this living doc has tracked changes; reference
  junctions, pipeline code, packaged assets, manifest and validation are unchanged.
  Existing local `node_modules` is present, but the exact requested formatting
  command `npx prettier --write tools/blender/STUDY-FIDELITY.md` failed:
  PowerShell could not load `C:\Program Files\nodejs\npx.ps1` because script
  execution is disabled (`PSSecurityException`, `FullyQualifiedErrorId:
UnauthorizedAccess`). Stopped per Kirby's explicit stop-on-blocker instruction;
  no alternate launcher or execution-policy change attempted. **Formatting,
  commit and push are not completed; this doc remains uncommitted.**
  No discovery blocker; zh-tw M100/M705 product routes returned 404 and M325s
  redirected to a category, as logged. **Phase B not started; Kirby's route
  decisions remain pending.**
- 2026-09-28 Claude: branch created from `m4a-eight-new-shells` and merged with
  `m4a-m100-level-base` (`1ac8a8a`). All 35 packaged GLBs regenerate
  byte-identically. This doc was added.
