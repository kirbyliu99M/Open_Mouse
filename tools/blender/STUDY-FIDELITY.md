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

| Study                        | Geometry kept from                    | Notes                                                   |
| ---------------------------- | ------------------------------------- | ------------------------------------------------------- |
| M100                         | `m4a-m100-level-base` (sheared trace) | Kirby's choice                                          |
| M550                         | `m4a-eight-new-shells`                | Same published L/W/H as M650 (AR shell)                 |
| M705 Marathon                | `m4a-eight-new-shells`                |                                                         |
| G Pro X Superlight 2 SE      | `m4a-eight-new-shells`                | Same published L/W/H as G Pro X Superlight 2 (AR shell) |
| G903 Hero                    | `m4a-eight-new-shells`                |                                                         |
| M325s                        | `m4a-eight-new-shells`                |                                                         |
| M750                         | `m4a-eight-new-shells`                |                                                         |
| Signature Comfort Plus M850L | `m4a-eight-new-shells`                |                                                         |

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

## Decisions

| Date       | Decision                                                                                                                                           | By     |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 2026-09-28 | Scope: all eight studies; target is the 26 AR-derived shells' finish                                                                               | Kirby  |
| 2026-09-28 | Geometry: eight-new-shells versions, except M100 from m100-level-base                                                                              | Kirby  |
| 2026-09-28 | Codex runs `gpt-6-astra` at reasoning high                                                                                                         | Kirby  |
| 2026-09-28 | **Gate A passed.** G903 Hero and M750 go through the full AR pipeline of the 26 shells; their study geometry is replaced (approved geometry route) | Kirby  |
| 2026-09-28 | SE uses the G Pro X Superlight 2 shell (geometry and detail maps) recoloured from SE photos (approved geometry route)                              | Kirby  |
| 2026-09-28 | M550 is the photo-bake prototype for M100, M550, M705, M325s and M850L                                                                             | Kirby  |
| 2026-09-28 | Phase B runs as B1 (G903, M750), then B2 (SE), then B3 (M550), one Codex run each, because all three rewrite `manifest.json` and `validation.json` | Claude |

## Progress log

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
