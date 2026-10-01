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

| Model                        | Route                                              | Geometry                                     | State                                                                          |
| ---------------------------- | -------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------ |
| G903 Hero                    | Full AR pipeline (B1)                              | Rebuilt from the official AR source          | Done; **accepted by Kirby 2026-09-28**                                         |
| M750                         | Full AR pipeline (B1)                              | Rebuilt from the official AR source (medium) | Done; **accepted by Kirby 2026-09-28**                                         |
| G Pro X Superlight 2 SE      | Superlight 2 shell, recoloured from SE photos (B2) | Superlight 2 AR-derived shell                | Built; **accepted by Kirby 2026-09-28**                                        |
| M550                         | M650 AR-derived sibling shell (Part 3 → D2)        | M650 AR shell, thumb buttons faired          | **Delivered as a shell (D2, Kirby-approved route)**; visual acceptance pending |
| M100                         | Removed (Kirby, 2026-09-28)                        | Study, `m4a-m100-level-base` (sheared trace) | **3D model removed**; M100 moves to `noShell`                                  |
| M705 Marathon                | No photo bake (C1 dropped)                         | Study, `m4a-eight-new-shells`                | Kept as is (Kirby, 2026-09-28)                                                 |
| M325s                        | No photo bake (C1 dropped)                         | Study, `m4a-eight-new-shells`                | Kept as is (Kirby, 2026-09-28)                                                 |
| Signature Comfort Plus M850L | No photo bake (C1 dropped)                         | Study, `m4a-eight-new-shells`                | Kept as is (Kirby, 2026-09-28)                                                 |

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

## Phase D — geometry quality (Kirby, 2026-09-28)

**Kirby: no more colouring; the focus is model quality.** Improve all of the following
together. Codex and Claude work in parallel, in separate worktrees. Colour and texture
are out of scope: keep existing materials and UVs as they are, even if a changed shape
stretches a texture, and just report it.

| Part | Work                                                                                                                                                                                                                                                                                                           | Owner                                                              | Where                                       | Changes public assets?        |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------- | ----------------------------- |
| D0   | Geometry audit of every delivered model. AR-derived shells: surface distance to their calibrated AR source (mean, p95, max mm) and silhouette IoU against the AR source in fixed orthographic views. Studies: silhouette IoU against their photos. Output `tools/blender/GEOMETRY-AUDIT.md` with a ranked list | Claude                                                             | worktree `m4a-geometry-audit` (own branch)  | No                            |
| D1   | Refine the geometry of the kept studies M705 Marathon, M325s and Signature Comfort Plus M850L from their photos, of any colourway (silhouettes only)                                                                                                                                                           | Codex                                                              | this worktree                               | Yes: those three studies only |
| D2   | Finish and deliver M550 on the M650 AR shell (Part 3 candidate): clean up the thumb-region fairing                                                                                                                                                                                                             | Claude                                                             | after D1 lands, to avoid manifest conflicts | Yes: M550 only                |
| D3   | O6: G403, G502 Hero, G203 (and G502 X side) differ strongly from their AR sources. Diagnose from D0 (shape, orientation or source mismatch), then fix                                                                                                                                                          | Claude diagnoses; the owner of the fix is decided from the finding | —                                           | Decided later                 |

**Schedule and handoffs (planned 2026-09-28 23:15, Asia/Taipei).** Codex's quota has run
out mid-phase four times, and a reset takes about 5 hours, so the plan puts Claude's work in
Codex's quota gaps and treats every Codex run as possibly cut short.

| When (planned)                                        | Codex                                                                                                             | Claude                                                                                                                                              | Handoff / checkpoint                                                      |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 09-28 23:15 – 09-29 02:30                             | Out of quota (resets 03:36)                                                                                       | **D2**: finish M550 on the M650 shell in worktree `m4a-geometry-audit`: fair the plate outline, move M550 from `studies` to `shells`, run the gates | —                                                                         |
| 02:30 – 03:15                                         | —                                                                                                                 | Independent Sonnet review of D0 + D2; fix findings                                                                                                  | —                                                                         |
| **03:15 – 03:30**                                     | —                                                                                                                 | **Handoff H1**: merge `m4a-geometry-audit` into this branch and push, then add a D1b brief note that M550 is now a shell and off-limits             | Branch holds D0 + D2                                                      |
| **03:38** (timer)                                     | **D1b** starts: M325s export and delivery, then M705 and M850L with the asymmetric basis. Commits after each step | Audits each commit as it lands (monitor) and pushes; writes the D4 brief and its before/after check (`geometry_audit.py` on changed shells)         | —                                                                         |
| ~05:00 – 07:00                                        | D1b ends (finished, or quota-stopped with work committed)                                                         | **Handoff H2**: audit D1b, push, run Sonnet review of D1b                                                                                           | —                                                                         |
| After H2 (quota permitting, else timer at next reset) | **D4**: local remeshing at wheel crowns (M190, M750, M650, G903) and G903's channel, within 15k triangles         | Audits D4 commits; reruns the D0 audit on changed shells                                                                                            | —                                                                         |
| **09-29 ~09:00**                                      | —                                                                                                                 | Updates `docs/STATUS.md` and the acceptance page in `模型驗收-2026-09-28/`                                                                          | **Kirby**: visual acceptance of D2 (M550), D1 studies and the D0 findings |
| After D4                                              | —                                                                                                                 | Audit, review, acceptance sheet                                                                                                                     | **Kirby**: D4 acceptance                                                  |

Rules for the schedule:

1. **One writer per branch at a time.** Codex writes only in this worktree; Claude writes only in
   `m4a-geometry-audit`. Claude merges into this branch only while Codex is idle (H1), and Codex
   pulls at the start of each run.
2. Codex never pushes. Claude pushes after an audit and records every handoff in the Progress log.
3. If Codex's quota stops a run, Claude commits any uncommitted work as WIP and sets a timer to resume
   just after the reset (Kirby's standing instruction). Claude takes over a Codex phase only if Kirby
   says so.
4. Times are targets, not gates. A gate failure moves the schedule; the gate never moves.

**D1 acceptance (per study).**

1. Cameras fitted to every usable photo with B3's perspective fitter (`photo_camera_math.py`,
   `fit_m550_photos.py` as the model; generalise, don't fork per study). At least one
   photo per study is **held out**, used neither for geometry nor for camera tuning beyond its own fit.
2. Deliver only if **every fitted view's IoU does not drop by more than 0.002, the mean
   fitted IoU improves, and the held-out IoU improves**. Otherwise leave that study unchanged
   and report the numbers. Never relax this.
3. Geometry gates stay green: at most 15,000 triangles, 0 non-manifold edges, 0 intersections,
   calibrated catalogue bbox (≤ 0.5 mm), flat base on the ground plane, support margin ≥ 5 mm,
   and `tests/check_assets.py`, `check_catalogues.py`, `audit_payloads.py`, `optimize_glbs.py --check`,
   unit tests and prettier.
4. Photos from iFixit or other third parties may be used as geometry and camera evidence
   only, never as texture (AGENTS rule 1 and R8).
5. Report per study: IoU per view before/after, held-out IoU before/after, largest remaining
   silhouette gap in mm, and a contact sheet (photos | before | after, top/side/front/hero).

## Phase D5 — rebuild the undone items (Kirby, 2026-09-29)

Kirby: work on the undone items first, with AGY and Sonnet subagents working together. **"Use the
dimensions as a reference, then build up the models by analysing the depth and edges."**
Codex is out until 2026-10-04.

| Part | Work                                                                                                                                                                                                                                                        | Owner            | Where                                         |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | --------------------------------------------- |
| D5-R | Web research: orthographic references (design patents or registered designs with six-view drawings, official dimension drawings, spec sheets) for M705 Marathon and Signature Comfort Plus M850L. Report only                                               | **AGY** (Gemini) | report in `Mouse Shape Project/codex-briefs/` |
| D5a  | Rebuild M705 and M850L from catalogue L/W/H as the bounding frame: visual-hull carving from the edges and silhouettes of every calibrated photo, fitting at the 1440 px evaluation resolution, then smoothing. Add orthographic drawings from D5-R if found | Sonnet builder A | worktree `m4a-d5-studies`                     |
| D5b  | Wheels as a separate feature: fit a cylinder to each AR source's wheel part (M190, M750, M650, G903) and merge it into the shell with an exact boolean union (one clean manifold mesh), instead of moving vertices. G903's channel is optional              | Sonnet builder B | worktree `m4a-d5-wheels`                      |
| —    | Orchestration, checking each commit, merges, independent Sonnet review, forwarding AGY's findings                                                                                                                                                           | Claude           | —                                             |

**Gates are unchanged.** D5a uses D1's delivery gate. Because M705's held-out photo has been
seen twice, the M705 report must state it and also show the result on the **official photos only**.
D5b uses D4's gate: the inside > 2 mm share falls by at least half; the outside share rises by at most
0.2 points; IoU against the source drops by at most 0.001 per view; clean topology; ≤ 15,000 triangles;
calibrated bbox; support margin ≥ 5 mm; and all existing gates.

## Results

### F9-1 integration (2026-10-01)

Kirby closed Phase D on 2026-09-30: wheel work is closed, M705 and M850L
remain as delivered, and all delivered 3D work is included. Integration resumed
2026-10-01 in `f9-integrate`; no geometry or texture generation is authorised.

Merged `origin/main` (`497bdc8`) as `4ecbddd`, then
`origin/m4a-study-fidelity` (`05b0ac8`) as `45eac44`. The first merge had no
textual conflicts; the second conflicted only in `docs/STATUS.md`, resolved
with main. Main-owned paths match main, except the explicitly retained split
`.github/workflows/blender-python.yml` from `cb29bea`.

Discarded fidelity changes (including changes Git resolved automatically):

- `docs/STATUS.md`: old 3D progress, asset-size, rights and phase-decision
  updates; retained main's live project board in full.
- `docs/PLAN.md`: historical 30-model payload note (6.70 MiB and 100 KiB
  estimate discussion); retained main's plan.
- `.github/workflows/ci.yml`: old embedded Blender Python job and its older
  action/dependency setup; retained main's CI and the separate Blender workflow.

Immediately after the merges, every file under `tools/blender/` and
`public/models/` matched fidelity. Its reference catalogue already has 34 rows
matching the seed's dimensions and four explicit `NO_SHELL` routes: M100,
Mobi Fold, MX Ergo S and Signature Comfort M840L. M575S aliases M575. No
catalogue or manifest data repair is needed. Added strict manifest partition,
dimension, file coverage and alias checks with nine new regression tests.
Python 3.13 discovery: 171 tests, 159 passed / 12 Blender-only skips.
Catalogue, payload, optimisation, typecheck, lint and repository-wide Prettier
passed. Parameter export passed outside the sandbox after a Windows user-info
lookup failure. Full asset checks and the unrestricted Vitest rerun are pending;
the first Vitest run hit the same user-info/process sandbox restrictions.
Blender 5.2.2 reran all 12 skipped tests successfully. The full asset gate
passed 20 fixtures and 35 reimport routes (34 mice including the alias, plus
the hand); minimum support margin is 11.361876 mm, and maximum reimport versus
manifest bbox error is 0 mm. The unrestricted application suite passed
2,651 tests with eight skips (127 files passed / one skipped); the separate
Blender TypeScript suite passed nine tests. Drizzle check and schema-drift
generation passed with no migration changes; production dependency audit found
zero vulnerabilities. All-project Playwright remains in progress.

`public/models/` contains 36 files totalling **8,894,672 bytes (8.483 MiB)**.
Its 34 GLBs total **8,641,792 bytes**, with 93 embedded JPEG maps. Five largest:

| File under `public/models/`     |  Bytes |
| ------------------------------- | -----: |
| `shells/logitech-g309.glb`      | 397556 |
| `shells/logitech-g903-hero.glb` | 393920 |
| `shells/logitech-g502-x.glb`    | 346700 |
| `shells/logitech-m650.glb`      | 331176 |
| `shells/logitech-m750.glb`      | 331092 |

No final PR addition/change exceeds 5,000,000 bytes. No output directory,
Blender scene/backup, virtual environment or cache is tracked. Licensed-data
scan: zero hits outside ignore rules in final PR-changed files and in the
PR's patch history. The whole tracked tree has 17 existing hit lines in seven
unchanged main files (policy/reference text and one incidental vendored WASM
byte match); every hit is recorded in ignored
`out/f9/licensed-scan-all-tracked.txt`. No private fixture was read or added.

Drafts for Claude and Kirby: ignored `out/f9/pr-26-description.md` and the
rights paragraph in `README.md`, explicitly marked pending Kirby approval.
Neither is approved copy. Every public file remains byte-identical to fidelity.

### D1 — study geometry refinement

**D1b resumed 2026-09-29 after H1 at `f61740c`. M325s delivered; M705 and M850L pending.**
The previous final-stop subsection is historical; the resumed results follow here.

#### D1b M325s delivery after round trip

The existing **12-field symmetric** candidate passes after position-lossless Draco
export and Blender reimport. Largest absolute coefficient **3.323631321 mm**
(shoulder-height field); maximum displacement **1.746764796 mm**. Every view is
numerically identical to the raw candidate table below: fitted mean
**0.974176579 → 0.976835651**, worst fitted delta **-0.001850948**; held-out
`right.png` **0.966532500 → 0.966563548** (gain **0.000031048351**).
Largest remaining projected silhouette gap **2.974568 mm**. **Delivered.**

Round trip: **14,000 triangles**, **0 non-manifold / degenerate / intersections**,
bbox max error **0.000001228 mm**, ground Z **0**, support **22.720196 mm**.
Per-corner UVs, triangle connectivity and material assignments survive the export;
original material JSON and embedded JPEG bytes are preserved. Shape changes mildly
stretch the existing projected top detail as described in the previous sheet.
Payload **75,284 → 181,492 bytes** because position and UV quantisation are disabled.
No M550 or AR shell changed. Only M325s manifest and validation entries changed.

Evidence: `out/study-fidelity/d1/logitech-m325s/roundtrip-geometry.json`,
`roundtrip-silhouette-evaluation.json`, `roundtrip-silhouette-comparison.png`,
and the inspected `geometry-contact-sheet.png`. The round-trip evaluator binds
its results to the candidate SHA256 before packaging. Baselines and frozen cameras
remain unchanged. No held-out result was used to select or tune a candidate.

**2026-09-28, baseline geometry checkpoint; no delivery yet.** Worktree pulled
to `4b282a2`. Only M705 Marathon, M325s and M850L are in scope. Baseline GLBs,
decoded meshes and all public-file hashes are saved in `out/study-fidelity/d1/`.
`study_geometry_preflight.py` reads the committed files using Blender 5.2.2 /
Python 3.13 and checks against the actual catalogue dimensions.

| Study         | Triangles | Non-manifold / degenerate / intersections | Support margin mm | Minimum Z mm |
| ------------- | --------: | ----------------------------------------- | ----------------: | -----------: |
| M705 Marathon |     14000 | 0 / 0 / 0                                 |         11.361876 |            0 |
| M325s         |     14000 | 0 / 0 / 0                                 |         22.972782 |            0 |
| M850L         |     14000 | 0 / 0 / 0                                 |         27.747661 |            0 |

All bbox errors are below 0.000007 mm. This checks the minimum ground height;
flat-base preservation will also be checked on any proposed deformation.
Re-inspected all 35 photographs in the three A3 contact sheets, including all
15 M705 supplemental files. Camera/mask inventory and per-view IoU are pending.
No geometry fit, new contact sheet or full delivery-gate claim at this checkpoint.
No public asset, material, UV, manifest or validation entry changed.

**Camera preflight checkpoint.** `photo_camera_fit.py` generalises B3's
seven-parameter, square-pixel perspective registration; `fit_study_photos.py`
consumes a mesh and inventory directory. Fits use 300/900/4000 mm starts,
320/720 px optimisation, 1100 iterations per start and independent 1440 px
evaluation with triangle-union masks. Existing M550 files remain untouched.
Ten camera/mask tests pass, including five new tests. Geometry fitting has not
started. The next long run fits the committed baselines, including each held-out
photo's own camera, then freezes those cameras for before/after comparison.

| Study | Fitting photos                                                                                                                                                                | Held out from geometry             | Excluded                        |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ------------------------------- |
| M705  | gallery 1 top, 3 front-left oblique, 4 left profile; supplemental techwalls 0/1/2 left oblique, 6/7/8 front-left oblique, 9/10/11 bottom oblique, 12/13/14 rear-right oblique | gallery 2 rear-left oblique        | techwalls 3/4/5: hand occlusion |
| M325s | top graphite; left red front-left; extra 1/2 pale-grey/lilac front-left; extra 3/5 blue/patterned front-right; extra 4 patterned elevated left                                | right patterned rear-left oblique  | None                            |
| M850L | top graphite; left black elevated left; extra 1 graphite rear-left elevated; extra 3 bottom; extra 6 graphite elevated left                                                   | extra 5 graphite rear-left oblique | extra 2/4: hand occlusion       |

All **35** local photos are inventoried, **30** usable (**27** fitting and
**3** held-out). Every duplicate resolution is retained and labelled; all
members of a duplicate group stay in the fitting split. These are correlated
observations, not independent additional views. PNG masks use alpha >180,
largest component and enclosed-hole filling. Supplemental M705 masks use
photo-only fixed ROIs and max RGB <160 to separate the dark shell from the
pale desk and red watermark, with the same component/hole convention.
Masks were inspected before fitting. A rejected GrabCut preparation included
desk/watermark pixels and was replaced before any camera run. No reference
was modified. Four usable thumbnail URLs are missing in the existing sidecar and are
recorded as unknown rather than invented; local SHA256 identifies each file.
Third-party images are geometry/camera evidence only.

Inventory and mask sheets (one per study):
`out/study-fidelity/d1/<slug>/photo-inventory.json` and
`out/study-fidelity/d1/<slug>/photo-mask-inventory.png`.

**Deformation implementation checkpoint, before any geometry fit.** Added
12 smooth Gaussian loft displacement fields: shoulder width, roof height,
shoulder height and upper-shell longitudinal shift at rear/middle/front.
Coefficients are bounded to ±5 mm, displacements vanish at Z=0, UV seam
duplicates move together and each candidate is recalibrated to catalogue XYZ.
The fitter reads **only fitting-role cameras** and keeps them fixed. Selection
uses mean training IoU plus a regression penalty at 320/720 px, never held-out
results. The independent 1440 px delivery check will apply all three D1 rules.
Per-stage parameters and 50-evaluation WIP checkpoints survive interrupted runs.
Five deformation/gate tests pass. Full Python suite: **83 tests, 71 passed /
12 Blender-only skips**; Blender-only suite: **12 passed**. No candidate exists
at this checkpoint and no public file has changed.

M850L `extra-1.png`'s initial view label was corrected on photo inspection:
the nose is toward the image top (rear-left elevated view). Its camera-only
retry improves baseline IoU **0.880964682 → 0.918674852**. The first camera
is retained as `initial-camera-extra-1.json`; it is not a geometry baseline.
Other baseline fits remain in progress. No held-out geometry result has been
computed or used to select a shape.

#### D1 final stop: M850L delivery gate failure

**No study delivered. All 36 public files, including 34 GLBs, manifest and validation,
are byte-identical to `4b282a2`.** Stopped on the M850L gate failure as instructed.
M705 was interrupted; M325s was not exported or installed. No held-out result
was used to retune a candidate. No threshold was relaxed.

| Study | Mean fitted before | Mean candidate | Worst fitted delta | Held-out before | Held-out candidate | Decision                                          |
| ----- | -----------------: | -------------: | -----------------: | --------------: | -----------------: | ------------------------------------------------- |
| M325s |        0.974176579 |    0.976835651 |       -0.001850948 |     0.966532500 |        0.966563548 | Raw candidate passes; delivery unfinished at stop |
| M850L |        0.964185763 |    0.964185281 |       -0.000128911 |     0.954755529 |        0.954625159 | FAIL: mean and held-out do not improve            |
| M705  |        0.953122827 |  Not evaluated |      Not evaluated |     0.955600933 |      Not evaluated | Interrupted; unchanged                            |

Failed command: `python tools/blender/evaluate_study_geometry.py --directory
tools/blender/out/study-fidelity/d1/logitech-signature-comfort-plus-m850l` returned
**exit 2**. Exact reasons: `Mean fitted IoU does not improve` and
`Held-out IoU does not improve`. Mean delta **-0.000000481162**, held-out delta
**-0.000130370173**. Passing the per-view 0.002 allowance does not override these failures.

M325s passes all three silhouette criteria before export. Its held-out gain is
only **0.000031048351**; export/reimport measurement is still required before
delivery. No candidate GLB was exported.

All usable photos below use their own perspective camera, fitted on the committed
mesh and then frozen. IoUs are evaluated at 1440 px. A dash means that M705 has
no final candidate; its unchanged delivered-after values equal its baseline.

| Study | Photo                         | Role     | Baseline IoU | Candidate IoU |        Delta |
| ----- | ----------------------------- | -------- | -----------: | ------------: | -----------: |
| M705  | m705-gallery-1.png            | fit      |  0.995853503 |             - |            - |
| M705  | m705-gallery-2.png            | held-out |  0.955600933 |             - |            - |
| M705  | m705-gallery-3.png            | fit      |  0.958693836 |             - |            - |
| M705  | m705-gallery-4.png            | fit      |  0.984413888 |             - |            - |
| M705  | supplemental/techwalls-0.jpg  | fit      |  0.946388063 |             - |            - |
| M705  | supplemental/techwalls-1.jpg  | fit      |  0.946409016 |             - |            - |
| M705  | supplemental/techwalls-2.jpg  | fit      |  0.945603090 |             - |            - |
| M705  | supplemental/techwalls-6.jpg  | fit      |  0.954700319 |             - |            - |
| M705  | supplemental/techwalls-7.jpg  | fit      |  0.955551352 |             - |            - |
| M705  | supplemental/techwalls-8.jpg  | fit      |  0.955638481 |             - |            - |
| M705  | supplemental/techwalls-9.jpg  | fit      |  0.959893311 |             - |            - |
| M705  | supplemental/techwalls-10.jpg | fit      |  0.960638534 |             - |            - |
| M705  | supplemental/techwalls-11.jpg | fit      |  0.960391800 |             - |            - |
| M705  | supplemental/techwalls-12.jpg | fit      |  0.924685179 |             - |            - |
| M705  | supplemental/techwalls-13.jpg | fit      |  0.922794809 |             - |            - |
| M705  | supplemental/techwalls-14.jpg | fit      |  0.925187224 |             - |            - |
| M325s | top.png                       | fit      |  0.989728173 |   0.989052019 | -0.000676155 |
| M325s | left.png                      | fit      |  0.969655609 |   0.974872100 | +0.005216490 |
| M325s | right.png                     | held-out |  0.966532500 |   0.966563548 | +0.000031048 |
| M325s | extra-1.png                   | fit      |  0.971800896 |   0.974706094 | +0.002905198 |
| M325s | extra-2.png                   | fit      |  0.970777752 |   0.975440127 | +0.004662375 |
| M325s | extra-3.png                   | fit      |  0.972056404 |   0.975302871 | +0.003246467 |
| M325s | extra-4.png                   | fit      |  0.975918456 |   0.974067508 | -0.001850948 |
| M325s | extra-5.png                   | fit      |  0.969298759 |   0.974408840 | +0.005110081 |
| M850L | top.png                       | fit      |  0.995860793 |   0.995781529 | -0.000079265 |
| M850L | left.png                      | fit      |  0.955185883 |   0.955269182 | +0.000083299 |
| M850L | extra-1.png                   | fit      |  0.918674852 |   0.918802922 | +0.000128070 |
| M850L | extra-3.png                   | fit      |  0.995157768 |   0.995152169 | -0.000005599 |
| M850L | extra-5.png                   | held-out |  0.954755529 |   0.954625159 | -0.000130370 |
| M850L | extra-6.png                   | fit      |  0.956049517 |   0.955920606 | -0.000128911 |

Candidate mesh checks (Blender 5.2.2 / Python 3.13, before export):

| Study | Triangles | Non-manifold / degenerate / intersections | Max bbox error mm | Ground Z mm | Support mm | Max move mm |
| ----- | --------: | ----------------------------------------- | ----------------: | ----------: | ---------: | ----------: |
| M325s |     14000 | 0 / 0 / 0                                 |       0.000001228 |           0 |  22.720196 |    1.746765 |
| M850L |     14000 | 0 / 0 / 0                                 |       0.000002015 |           0 |  27.704527 |    0.143377 |

Both candidates preserve topology, all original Z=0 vertex heights, UVs, materials
and material assignments. Largest remaining projected silhouette gap: **M325s
2.974568 mm**, **M850L 5.463152 mm**; M705 unchanged baseline **4.991808 mm**.
These are target-plane boundary Hausdorff distances, not measured 3D surface errors.

M705 completed its 320 px stage. Its 720 px stage was interrupted after the last
saved checkpoint at **100 evaluations**. `deformation-stages.json`,
`deformation-wip.json` and `deformation.log` preserve state. No final M705 mesh,
candidate IoU, held-out evaluation or before/after render exists.

Appearance was not edited. M325s mildly warps the existing projected top details:
per-triangle surface area ratios **0.927025-1.058526**, p05/p95 **0.950416 /
1.040619**. M850L changes are not visibly distinguishable in the shared-light
sheet; area ratios **0.993982-1.005099**. Existing smeared flank appearance
remains. No third-party photograph was sampled as texture.

**Gates:** Python **83 tests: 71 passed / 12 Blender-only skips**; Blender
`test_*_blender.py` **12 passed**, confirmed subprocess exit **0**;
`tests/check_assets.py` **ALL_ASSET_CHECKS_PASSED**; catalogue, payload,
`optimize_glbs.py --check`, Prettier and `git diff --check` pass. An earlier
PowerShell stderr wrapper reported exit 1 despite passing Blender tests; an
explicit subprocess run confirmed exit 0. No payload size changed, so
`PAYLOAD-AUDIT.md` was not regenerated. Silhouette delivery gate: M850L fails,
M325s passes only before export, M705 incomplete.

**Inspected contact sheets:**

- `out/study-fidelity/d1/logitech-m325s/geometry-contact-sheet.png`
- `out/study-fidelity/d1/logitech-signature-comfort-plus-m850l/geometry-contact-sheet.png`
- Both directories also contain `silhouette-comparison.png` with all used photos
  and before/candidate overlays.
- All three directories contain `photo-mask-inventory.png`; this is the only
  completed D1 contact sheet for M705.

The four-view sheets use top/side/front/hero renders. References are explicitly
identified as oblique when no matching straight view exists. M850L extra-1 is
an elevated oblique reference beside the front render, not a front-photo
registration. Silhouette sheets instead use each actual fitted camera.

**Not done:** M705 final fit/evaluation/rendering; candidate GLB exports and
round-trip verification; M325s installation and manifest/validation changes.
No M550, M100, AR shell or other worktree changes. No push. Claude must
adjudicate the failed gate before continuation.

#### D4 — local remeshing (Sonnet builder)

**Not delivered for any of the four shells; the mesh's own tolerances block the gate.**
Sonnet builder, worktree `m4a-d4-remesh` (branch `m4a-d4-remesh`, from `dbdd5fd`).

**Method.** `tools/blender/local_remesh_math.py` (pure numpy, 12 unit tests in
`tests/test_local_remesh_math.py`) provides target-vertex thresholding, BFS ring
distance for a topological blend zone, a smoothstep blend weight and a millimetre
displacement clamp. `tools/blender/d4_local_remesh.py` (Blender) loads each shell
and its calibrated AR source exactly as `geometry_audit.py` does, then: (1) marks a
vertex a target when it sits more than 1 mm inside the source **and** a straight-up
ray from it actually hits the source (confirms it, doesn't rely on source normals);
(2) locally subdivides the faces touching target vertices (`bmesh.ops.subdivide_edges`,
selectable ring and cut count, always checked against the 15,000-triangle cap before
any vertex moves); (3) projects target and near-ring vertices onto the source along a
**vertical** ray (not the vertex normal — the normal flips sharply between a slot's
near-vertical wall and its floor, which fans divergent moves into folds); (4) blends
the move to zero over `local_remesh_math.blend_weight`'s ring taper; (5) clamps the
per-vertex displacement and validates with `asset_utils.validate_mesh`.

**Baseline (this branch, matches D0):**

| Shell     | IoU top/side/front       | Distance mean/p95/max mm | inside share >2mm | outside share >2mm | Triangles |
| --------- | ------------------------ | ------------------------ | ----------------- | ------------------ | --------: |
| M190      | 0.9953 / 0.9937 / 0.9941 | 0.14 / 0.44 / 7.42       | 0.42%             | 0.24%              |     14000 |
| M750      | 0.9949 / 0.9885 / 0.9923 | 0.37 / 1.50 / 11.02      | 0.33%             | 4.06%              |     14000 |
| M650      | 0.9942 / 0.9893 / 0.9920 | 0.48 / 2.78 / 11.23      | 1.16%             | 4.54%              |     14000 |
| G903 Hero | 0.9951 / 0.9877 / 0.9908 | 0.47 / 2.22 / 8.22       | 1.60%             | 4.18%              |     14000 |

Reproduced with `blender -b --factory-startup --python-exit-code 1 --python
geometry_audit.py -- --data <worktree>/tools/blender --only logitech-m190
logitech-m750 logitech-m650 logitech-g903-hero --out out/d4/baseline`, then
`geometry_audit_report.py out/d4/baseline`.

**Why none passes.** Systematically swept threshold (1 mm per the brief),
subdivide ring (0/1), face-selection strictness (any-vertex vs. all-vertex per
face), cut count (1/2/3) and blend ring (0–4) on M190 and M750 (the smaller
target sets):

| Shell | Config (subdivide ring / strict / cuts / inner / outer) | Moved verts | Max clamp mm | Self-intersection pairs |
| ----- | ------------------------------------------------------- | ----------: | -----------: | ----------------------: |
| M190  | 0 / any / 1 / 0 / 1                                     |         154 |          6.0 |                    1081 |
| M190  | 1 / strict / 1 / 0 / 2                                  |         564 |          6.0 |                     201 |
| M190  | 1 / strict / 1 / 0 / 2                                  |         564 |          4.0 |                     112 |
| M190  | 1 / strict / 1 / 0 / 2                                  |         564 |          1.0 |                      13 |
| M190  | 1 / strict / 1 / 0 / 2                                  |         564 |      **0.3** |                   **0** |
| M750  | 1 / strict / 1 / 0 / 2                                  |         523 |          2.0 |                      60 |
| M750  | 1 / strict / 1 / 0 / 2                                  |         523 |          0.5 |                       9 |

Every configuration that keeps the mesh clean (0 self-intersections) caps the
per-vertex displacement at roughly **0.3–0.5 mm** — the mesh has other surfaces
that close to it near the wheel slot and G-shape seams, so any larger, gate-relevant
correction (the deficits run to 7–11 mm) immediately folds the local patch into a
neighbour. Adding more local resolution does not fix this: it is not an
under-sampling problem, it is that the target displacement is topologically
incompatible with the existing nearby geometry at this triangle budget. A 0.3–0.5 mm
correction cannot move the ">2 mm inside" or ">2 mm outside" shares by a measurable
amount, so it would not pass "inside share falls by at least half" either — there is
no clamp value where both the topology gate and the improvement gate hold.

M650 (348 candidate target vertices) and G903 Hero (265) are worse: subdividing
even a one-ring strict selection around their target vertices already exceeds the
15,000-triangle cap before any vertex is moved (16,798 and 16,972 respectively),
because their affected regions (the whole wheel neighbourhood for M650; the button
channel and both wing seams for G903) are far larger than M190's or M750's.

**Conclusion.** Per shell: **left alone, gate not attempted to relax.** This
confirms and extends the D0 recommendation ("the fix needs local remeshing") with a
negative result: local remeshing was tried, with ray-confirmed target selection,
budget-checked local subdivision, vertical (not normal) projection to avoid
divergent-normal folding, and smooth ring blending, and it still cannot satisfy
both the topology gate and the improvement gate on any of the four shells within
15,000 triangles. A fix would need feature-aware topology (e.g. explicitly modelling
the wheel as a separate loop with its own boundary curve fixed to the slot rim,
or constrained fairing that treats the slot walls as a hard boundary) — out of scope
for a normal-displacement remesher. No public asset changed; `out/reference-library`
and `out/reconstructed` untouched (read-only, as required).

Tooling delivered and kept (not reverted, since it is generically useful evidence
and the failure mode it exposes is itself the finding): `tools/blender/local_remesh_math.py`,
`tools/blender/tests/test_local_remesh_math.py`, `tools/blender/d4_local_remesh.py`.
Baseline audit outputs: `tools/blender/out/d4/baseline/` (gitignored, reproducible).

**Not done:** no `out/d4/reconstructed/*`, no Phase C bake, no `optimize_glbs`,
no installer, no before/after render sheets — there is no "after" state to render,
since no shell passed the gate. Existing gates re-verified green with no asset
changes: `check_catalogues.py` → `CATALOGUES_MATCH`; `tests/check_assets.py` →
`ALL_ASSET_CHECKS_PASSED`; full Python suite `python -m unittest discover -s tests`
→ 102 passed / 12 Blender-only skips (up from 90/12 with the 12 new local-remesh-math
tests).

#### D5b — wheel crowns as features (Sonnet builder B)

**Not delivered for any shell; the built wheels do not cover the deficient region. All four shells unchanged.**
Worktree `m4a-d5-wheels` (from `ee15fcb`). Tools: `cylinder_fit_math.py` (numpy: free-axis, fixed-axis and trimmed
cylinder fits, 8 unit tests), `d5_wheel_fit.py` (locate and fit), `d5_build_wheel.py` (capped 56-segment cylinder,
8% narrower than the fitted width, Blender exact boolean union, `clean_export_mesh`, `validate_mesh`), plus the
inspection scripts `d5_wheel_diagnose/objects/locate/fit_diagnose.py`.

**Wheel fits** (reconstruction frame; axis fixed to lateral X; tread points only, within 2.5 mm of a rough radius;
accepted only if width 4-12 mm, radius 6-15 mm):

| Shell | Source of the wheel                                  | Radius mm | Width mm | Residual RMS / max mm | Result                                      |
| ----- | ---------------------------------------------------- | --------: | -------: | --------------------- | ------------------------------------------- |
| M190  | own topological island in the AR mesh (363 vertices) |     12.16 |     4.01 | 0.11 / 0.17           | fit                                         |
| M750  | glTF node Node5 (7,535 vertices)                     |      8.25 |     9.43 | 0.24 / 0.49           | fit                                         |
| M650  | glTF node Node19 (7,515 vertices)                    |      8.36 |     9.31 | 0.25 / 0.49           | fit                                         |
| G903  | fused to the shell; deficiency-cluster band          |     16.23 |    11.99 | 0.18 / 0.37           | **rejected**: radius above 15 mm; not built |

A first free-axis attempt fitted hub, housing and chassis (widths 22 mm, oblique axes) and was discarded after Claude's audit.

**Build:** all three unions are one closed manifold mesh: 0 non-manifold, 0 degenerate, 0 intersections; triangles
14,284 (M190), 14,318 (M750), 14,372 (M650); calibrated bbox and ground unchanged (0.0 mm; the crown is below the
highest point).

**Audit before -> after (D4 gate):**

| Shell | Inside > 2 mm   | Outside > 2 mm  | IoU top / side / front after (before)                     | Gate                                     |
| ----- | --------------- | --------------- | --------------------------------------------------------- | ---------------------------------------- |
| M190  | 0.42% -> 0.475% | 0.24% -> 0.245% | 0.99532 / 0.99374 / 0.99414 (0.99532 / 0.99366 / 0.99414) | **fail**: inside share must fall by half |
| M750  | 0.33% -> 0.345% | 4.06% -> 3.92%  | unchanged to 5 places                                     | **fail**                                 |
| M650  | 1.16% -> 1.29%  | 4.54% -> 4.385% | unchanged to 5 places                                     | **fail**                                 |

**Why it fails.** Every "inside > 2 mm" sample lies 13-42 mm from the fitted axis (M190 13.3-26.0; M750 16.2-42.4;
M650 3.9-30.6), and 0 (M650: 1) of them fall within the fitted tread band. The wheels the shells lack are therefore not
what the deficient samples measure: they are the wheel housing, the surrounding button and trim geometry above the
slot, which a single cylinder cannot represent. The wheel itself is small and mostly already hidden by the shell.
Adding it changes the inside share by +0.015 to +0.13 points, so the gate's "fall by half" cannot be met by this method.
Nothing was re-baked, optimised or installed; no public file changed. The installer step was not written because no
shell passed (ERGO M575S alias handling is therefore untested). G903's channel (optional) was skipped.

Evidence: `out/d5/baseline`, `out/d5/after` (audit tables, deviation maps), `out/d5/wheel-fits.json`,
`out/d5/reconstructed/<slug>/d5b-build-report.json` (gitignored, reproducible). Close-up renders were not produced
because there is no delivered "after". Gates run: unit tests 110 pass / 12 Blender skips, `check_catalogues.py`
CATALOGUES_MATCH, `audit_payloads.py`, `optimize_glbs.py --check` clean, public files unchanged.
Next step, if wanted: model the wheel housing and button surround (the deficient region) as features, not the wheel.

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

#### Part 2b control correction and real colour-gate stop

2026-09-28, resumed from Claude's audited `9ade5ba`. The independent opaque
control proves that raw Base Color was the wrong oracle for the new synthetic
DIFFUSE test. The control material is created with Alpha 1, no alpha link, and
the same Base Color, roughness and default Principled settings as the forced
cover. Only the cover material is exchanged; geometry and bake settings stay
fixed. Measurements (linear RGB):

| Bake                           |         Red |       Green |        Blue |
| ------------------------------ | ----------: | ----------: | ----------: |
| Forced opaque cover            | 0.683209062 | 0.585607767 | 0.488006473 |
| Originally opaque control      | 0.683209062 | 0.585607767 | 0.488006473 |
| Original transparent composite | 0.170802265 | 0.146401942 | 0.122001618 |

Forced/control maximum difference **0**, control/control repeat spread **0**;
transparent/control maximum difference **0.512406796**. The existing
`atol=1e-5`, default `rtol=1e-7` remains unchanged. Both Blender alpha tests
pass, process exit **0**; exception restoration and the roughness negative
control still pass. No production colour compensation was added. The uniform
0.976013 ratio is shared by the independently opaque control, confirming it is
not an opacity loss. Log: `out/study-fidelity/c/alpha-control.log`.

MX Master 4 was re-baked at the production 2048 px resolution in an isolated
candidate folder, exported with the existing Draco settings, and optimised to
three 512 px JPEG maps (**289,652 bytes**, current public **287,868 bytes**).
The pre-export mesh remains **14,000 triangles**, with clean topology and
**29.237824557 mm** support margin. No candidate was installed in public.

**The existing Part 2b colour target fails.** Fixed interior rectangles selected
on the reference exclude button rims, seams and printed logos. The side patch
samples the thumb-rest flank in the top view; the wheel patch includes its
central crown. Identical cameras, source calibration, Cycles 32 samples/seed 0,
neutral world and two area lights are used for AR, committed and candidate
renders; Standard view transform, no exposure change. DeltaE2000 is measured
between the mean encoded-sRGB patch colours, converted to D65 Lab. This is a
new shared studio, not a reproduction of Claude's earlier absolute sRGB values.

| Region       | Committed vs AR DeltaE2000 | Opaque candidate vs AR DeltaE2000 | Target                       |
| ------------ | -------------------------: | --------------------------------: | ---------------------------- |
| Left button  |                   6.021381 |                      **7.306253** | <= 3, **fail**               |
| Right button |                   4.209348 |                      **7.812137** | <= 3, **fail**               |
| Palm         |                   0.113540 |                          0.116268 | <= 3, pass                   |
| Side         |                   0.610098 |                          0.612467 | Report only                  |
| Wheel        |                  38.291572 |                         38.269722 | Report only; O2 remains open |

Left-button mean sRGB255 is AR **89.653968/91.748095/95.764603**, old
**73.288095/74.403016/78.797619**, new
**109.478730/110.676190/116.391270**. The opaque candidate overshoots the
reference in this studio. The control-test correction does not resolve this
rendered appearance mismatch. No existing tolerance or material was adjusted
after the failure. Exact error, exit **1**:

```text
PART_2B_COLOUR_GATE_FAILED: buttons and palm must be <= 3
```

Evidence under `out/study-fidelity/c/colour/logitech-mx-master-4/`:
`colour-evidence.json` (full precision RGB, boxes, DeltaE), `patches.png`,
`colour-crops.png`, `comparison.png` (AR | committed | candidate; top/side/hero),
all nine original 800 px renders, lossless and optimised candidate GLBs, and
the candidate blend/report/textures. Bake/render logs are in the parent `c/`.
`phase_c_colour.py` reproduces the isolated bake and renders using only
bpy/mathutils/numpy; `measure_phase_c_colour.py` uses the already-present local
`out/python-deps` for external image analysis. No packages were installed and
Blender's environment was not changed.

Reproduction (Blender means 5.2.2 background with `--python-exit-code 1`):

1. Blender: `--python tools/blender/tests/test_bake_alpha_blender.py`.
2. Blender: `--python tools/blender/phase_c_colour.py -- --model logitech-mx-master-4`.
3. External Python: call `optimize_glbs.optimize(destination, source)` with
   `destination=c/colour/logitech-mx-master-4/logitech-mx-master-4-delivered.glb`
   and `source=c/colour/logitech-mx-master-4/logitech-mx-master-4.glb`, both paths
   relative to `out/study-fidelity/`.
4. Blender: `--python tools/blender/phase_c_colour.py -- --model logitech-mx-master-4 --render`.
5. External Python: `python tools/blender/measure_phase_c_colour.py` (records
   the evidence and exits 1 at the existing colour target).

M720, MX Vertical and Pebble 2 isolated candidate bakes had already been
started while the MX Master 4 comparison was being measured. All three finished
successfully (exit 0), but their regional opacity-impact measurements and
renders were **not performed after the stop**. Their generated candidates are
not approval to re-bake or replace their delivered assets. The Blender log also
contains a thumbnail-cache write warning for `.thumbnails`; candidate saves
and exports completed. All **35/35 public GLBs**, manifest and validation are
unchanged from `9ade5ba`. Full asset/catalogue/payload/optimisation/unit gates
were not rerun after the failed colour gate; Phase C remains incomplete.

AGY's report was read: **no Logitech-hosted AR candidate URL** for M100 or any
sibling, and none for M550/M705/M325s/M850L/SE. No requests or general web
search were made. Record only as **unverified leads**: B100/M90 identical
dimensions, M110 Silent near dimensions, M100r regional-variant claim, M105
smaller-body claim, and M325s/M325 same-shell claim. These are not verified
shell-equivalence evidence; most report citations are domain roots. Part 4's
next route is photo-based geometry refinement. It was **not started**, so there
are no new M100 IoUs, gap measurements or contact sheet. Parts 2, 1 and 3 were
also not started; the prior O1 table and O4 deferrals stand, O2 has no verified
new cause/fix, and no M550 sibling candidate exists. No push.

#### Part M ? M100 removed, 2026-09-28

Deleted `public/models/studies/logitech-m100.glb` (76,416 bytes). M100 is now
`noShell` with Kirby's exact reason, and absent from validation round trips and
the generation reference catalogue. The app catalogue and fit fixtures were
not edited. Reference inventories remain historical evidence. Removed active
gallery routing, blocked stale reconstruction folders and prototype generation,
and made catalogue/payload/optimisation/asset checks reject stale no-shell
entries or files. The geometry and orientation tests now use M325s and M550;
new regressions retain M100 in the product catalogue while rejecting its return.

SHA-256 comparison against the start of this run: **34/34 remaining GLBs are
byte-identical; M100 is the only removed file; zero other GLBs changed**.
Evidence: `out/study-fidelity/c/removal/{before-sha256,hash-evidence}.json`.
Payload audit regenerated: **34 files, 8,290,492 bytes**. Gates: Python **63
tests, 54 passed / 9 bpy skips**; TypeScript **9 passed**; Blender orientation
**4**, colour sampling **3**, alpha controls **2 passed**; full asset gate
`ALL_ASSET_CHECKS_PASSED`; catalogue, payload, optimisation and Prettier pass.
Blender tests' native exit codes are recorded separately (all zero); PowerShell
stderr wrapping is not treated as a failed test. No check outside the allowed
paths required M100's GLB. No generator was run against public assets.

Removed file: `public/models/studies/logitech-m100.glb`.
Changed files (plus this Results/Progress log):

- `public/models/manifest.json`
- `public/models/validation.json`
- `tools/blender/PAYLOAD-AUDIT.md`
- `tools/blender/README.md`
- `tools/blender/audit_payloads.py`
- `tools/blender/build_assets.py`
- `tools/blender/check_catalogues.py`
- `tools/blender/color_reconstruction.py`
- `tools/blender/compose_study_sheets.py`
- `tools/blender/finish_reconstruction.py`
- `tools/blender/optimize_glbs.py`
- `tools/blender/package_reconstruction.py`
- `tools/blender/params/reference-catalogue.json`
- `tools/blender/polish_reconstruction.py`
- `tools/blender/prepare_gallery_texture.py`
- `tools/blender/reconstruct_gallery.py`
- `tools/blender/reconstruct_views.py`
- `tools/blender/render_reference_views.py`
- `tools/blender/render_study_review.py`
- `tools/blender/tests/check_assets.py`
- `tools/blender/tests/test_catalogues.py`
- `tools/blender/tests/test_polish_orientation_blender.py`
- `tools/blender/tests/test_reference_geometry.py`

#### Part 2b ? cover/body hypothesis preflight stopped, 2026-09-28

The new hypothesis was checked **before** any per-texel bake. The exact existing
studio was extracted into `phase_c_colour.shared_studio` without changing its
settings. `inspect_button_layers.py` imports the official AR source, inspects
material alpha and casts top-camera rays on the fixed patch grids (252 rays per
button, 648 palm rays), then renders the original, opaque-cover and hidden-cover
variants. No production bake logic or public asset was changed.

**Actual layers:** `LEFT_BUTTON` / `RIGHT_BUTTON` use
`TRANSPARENT_LEFT_BUTTON` / `TRANSPARENT_RIGHT_BUTTON`. Alpha is linked to the
base-colour texture's Alpha output, not a scalar default. Whole-image ranges
are **0.349019617?1** (left) and **0.400000036?1** (right); all sampled texels in
both button patches have **0.400000036** alpha. Both covers' sampled Base Color
is linear RGB **0.116970479 / 0.124771573 / 0.141263425**. Every button ray finds
`MAIN_PLASTIC` with `MAIN_PLASTIC_SUB` beneath the cover, sampled linear RGB
**0.026241273 / 0.026241273 / 0.027320866**. Cover-to-body top-ray separations:
left **1.308143?1.471281 mm**, mean **1.373823 mm**; right
**1.405299?1.505792 mm**, mean **1.451073 mm**. Palm is the opaque
`PATTERN_PLASTIC_SHELL` (alpha 1).

The prediction decodes each render to linear light, takes each patch's mean
radiance, computes `alpha * cover + (1-alpha) * body`, and re-encodes the result
to sRGB. CIEDE2000 compares it with the AR's mean encoded patch RGB using the
same D65 convention as the existing gate. This is a region-mean preflight,
**not a rendered composite-bake candidate**. The opaque column below is the
opaque **AR source layer**, not the previously baked opaque shell.

| Region       | AR sRGB255                           | Opaque cover sRGB255                 | Hidden-cover body sRGB255            | Predicted composite sRGB255          | Prediction vs AR DeltaE2000 |
| ------------ | ------------------------------------ | ------------------------------------ | ------------------------------------ | ------------------------------------ | --------------------------: |
| Left button  | 89.654127 / 91.748095 / 95.764603    | 116.112857 / 119.575714 / 126.396984 | 83.172857 / 83.319841 / 84.294444    | 98.199171 / 99.990220 / 103.897049   |         **3.043410 ? fail** |
| Right button | 77.098730 / 79.005397 / 82.804444    | 103.649048 / 106.717143 / 112.894921 | 65.575079 / 65.613333 / 66.738889    | 83.372227 / 85.000192 / 88.783069    |                    2.112469 |
| Palm         | 130.383333 / 130.683642 / 132.523457 | 130.383210 / 130.681481 / 132.525062 | 130.381667 / 130.685309 / 132.524198 | 130.817403 / 131.122117 / 132.949909 |                    0.162278 |

**Stop:** left button exceeds the unchanged **DeltaE2000 <=3** hypothesis gate
by **0.043410**. No rounding to a pass. The body is present, but this simple
mean-radiance cover/hidden-body prediction is still too light. Hiding the cover
also changes illumination of the body; shadowing/interreflection or multiple
cover intersections are possible causes, **not verified diagnoses**. No further
shader changes or candidate bake were attempted after the failure.

For comparison, the existing delivered-blended / opaque-shell / proposed
composite-prediction DeltaE2000 values are:

| Region       | Delivered blended shell | Prior opaque shell candidate | New source-layer prediction |
| ------------ | ----------------------: | ---------------------------: | --------------------------: |
| Left button  |                6.021381 |                     7.306253 |                    3.043410 |
| Right button |                4.209348 |                     7.812137 |                    2.112469 |
| Palm         |                0.113540 |                     0.116268 |                    0.162278 |

These are explicitly different stages; **there is no composite-shell variant**.
The existing side/wheel values remain in the previous table. New per-texel
compositing code/tests, remeasurement of a composite shell and the M720 / MX
Vertical / Pebble 2 impact check were not started. Parts 2 (wheel cause/fix),
1 (G903/M750 fallback and crops) and 3 (M550 candidate/IoUs/area/displacement)
remain unattempted under the stop rule. Part 4 is cancelled; Part M is complete.
O1/O2/O4 remain unchanged; Part 0 remains accepted.

Evidence: `out/study-fidelity/c/button-layers/` contains `layers.json`,
`prediction.json`, `layer-crops.png` (AR | opaque source | hidden-cover body),
three original 800 px renders, `blender.log` and `measurement.log`.
Reproduce with Blender 5.2.2 / Python 3.13:
`--background --factory-startup --python-exit-code 1 --python tools/blender/inspect_button_layers.py`,
then external Python `tools/blender/measure_button_layers.py`.
Blender exits **0** without SciPy or environment changes; measurement exits
**1**, exact error `PART_2B_LAYER_HYPOTHESIS_FAILED: prediction must be <= 3`.
The AR left patch reproduces the previous studio to within **0.000159 sRGB255**
per channel. The small palm offset in the predicted statistic includes
averaging linear light before encoding versus averaging encoded reference RGB.

No delivered GLB changed in Part 2b. All **34 remaining GLBs are byte-identical**
to the start of this run; only Part M deleted M100. Part M's full asset gates
passed; this preflight colour gate failed, so Phase C is **not gate-complete**.
No full production gate rerun or success is claimed after the stop. Separate
local checkpoint commit with the diagnostic and evidence, **no push**.

#### Part 2b — cover-over-body composite, delivered (Claude, 2026-09-28)

Built by Claude while Codex was out of quota (Kirby's decision, see Decisions).
**Needs the independent Sonnet review before it counts as accepted.**

`bake_refinement.py` now detects source objects with a transparent layer
(`cover_objects`: scalar alpha < 1, or an alpha Value node or image below 1).
For those shells it bakes two extra passes after the opaque base colour: the
cover alpha (EMIT of each source's own alpha socket) and the body colour (DIFFUSE
with the cover objects left out of the selection). `layer_composite.composite_cover`
mixes `alpha × cover + (1 − alpha) × body` in linear light and leaves alpha-1
texels bit-identical. Roughness, normal and metallic keep the opaque rule.
Shells without a transparent layer bake exactly as before. Byte sRGB bake images
hold encoded values (checked: `pixels = 0.5` saves as PNG 128), so the composite
decodes, mixes and re-encodes.

Texture check on MX Master 4: every alpha-0 texel is unbaked atlas space;
alpha-1 texels are identical to the opaque bake (max difference 0); 356,127 of
358,525 cover texels (alpha 0.34–0.41) change, mean 23.5 levels. Anti-aliased
cover outlines (alpha < 0.34 or 0.41–1, 59,561 texels) change by 3–7 levels on average.

Identical-light studio (`phase_c_colour.shared_studio`, unchanged), ΔE2000 vs AR:

| Region       | Committed (blended) | Opaque candidate | **Composite, delivered** |
| ------------ | ------------------: | ---------------: | -----------------------: |
| Left button  |                6.02 |             7.31 |                 **2.23** |
| Right button |                4.21 |             7.81 |                 **0.79** |
| Palm         |                0.11 |             0.12 |                 **0.12** |
| Side         |                0.61 |             0.61 |                     0.61 |
| Wheel        |               38.29 |            38.27 |   38.29 (O2, still open) |

Left button mean sRGB: AR 89.7 / 91.7 / 95.8, composite 84.4 / 85.6 / 90.0.
Over all pixels the change touches, mean ΔE2000 to AR drops from 5.50 to 2.49 (top), 5.06 to 2.88 (hero)
and 4.43 to 3.24 (side). Installed with `package_colour_candidate.py`: 14,000
triangles, 0.0 mm corner displacement, 0.0 mm bbox difference, 288,308 bytes
(was 287,868). Support margin 29.24 mm.

Sibling impact (same rule, texture-space ΔE2000 from the delivered blended bake
to the composite, on texels with 0 < alpha < 1):

| Shell          | Transparent source | Mean ΔE2000 | Rendered change (top, side, hero, bottom)         | Action                 |
| -------------- | ------------------ | ----------: | ------------------------------------------------- | ---------------------- |
| M720 Triathlon | none (alpha 1)     |           — | —                                                 | unchanged              |
| MX Vertical    | `Node9`            |        1.80 | not rendered (below the 2 threshold)              | unchanged              |
| Pebble 2 M350S | `Node6`            |        6.49 | none: max 1 level (top), 19 px ≤ 1.11 ΔE (bottom) | unchanged: not visible |

Pebble 2 exceeds 2 in texture space, but its changed texels are not visible
in any of the four views, so its accepted GLB is kept. A future full rebuild
will pick up the composite automatically.

Gates: `ALL_ASSET_CHECKS_PASSED`; Blender alpha (3 tests, new
`test_cover_alpha_and_body_bakes_for_compositing`), colour sampling and polish
orientation tests pass; 69 Python tests OK (10 bpy skips), including 5 new
`test_layer_composite` tests; `check_catalogues.py`, `audit_payloads.py`,
`optimize_glbs.py --check`, prettier and 967 Vitest tests pass.
`PAYLOAD-AUDIT.md` regenerated. Only `shells/logitech-mx-master-4.glb` changed.
Evidence: `out/study-fidelity/c/colour/logitech-mx-master-4/` (composite) and
`logitech-mx-master-4-opaque/` (Codex's opaque candidate, kept).

#### Part 2 — O2 cause found: metallic parts baked black (Claude, 2026-09-28)

**Cause (verified).** Cycles' DIFFUSE colour pass scales Base Color by
(1 − metallic). Every AR shell's base colour was baked through that pass with
the source's own metallic value, so fully metallic parts (MX Master 4's wheel
and thumb wheel, `METAL_MULTIMTL`) baked to black. Paired with the metallic map
(≈1 there), they rendered as a black mirror. Partly metallic surfaces baked
proportionally too dark. A synthetic Blender test pins this down: a metallic-1 part
bakes to exactly (0, 0, 0) with the raw pass, and to the metallic-0 control's
colour with the fix. On MX Master 4, 2,140 of 14,000 shell faces take their
first hit from the metal material.

**Fix.** `source_channel` sets metallic to 0 (and restores it) for the colour
bakes (`BaseColour`, `Body`). The metallic map is still baked from the untouched
socket.

MX Master 4 re-baked with both fixes, same studio, ΔE2000 vs AR:

| Region       | 2b composite | **Composite + metallic fix, delivered** |
| ------------ | -----------: | --------------------------------------: |
| Left button  |         2.23 |                                **0.72** |
| Right button |         0.79 |                                **1.62** |
| Palm         |         0.12 |                                **0.11** |
| Side         |         0.61 |                                    0.63 |
| Wheel        |        38.29 |                                **1.48** |

Installed: 0.0 mm geometry change, 295,692 bytes. The wheel and thumb wheel
now render as brushed metal; their knurling is absent because the shell seals
over the wheel. **Second, smaller cause:** on MX Master 4, about 300 faces have
a source part more than 4 mm above the shell (outside the cage), so their rays
start underneath it. The O1 fallback pass addresses misses, not these.

**Scope.** Every AR shell with metallic source values is affected. G903, M750
and the five O4 shells are re-baked with both fixes in the O1 batch. The other
shells get an impact check.

#### Part 3 — M550 on the M650 AR shell, candidate only (Claude, 2026-09-28)

**Not delivered.** Files are under `out/study-fidelity/c/m550-sibling-candidate/`
(ignored). Nothing in `public/models/`, the manifest or validation changed.
Built by `build_m550_sibling_candidate.py` from the Phase C M650 re-bake.

**Geometry.** The thumb buttons are 17 connected pieces of the M650 AR source's
`Node10` (button skins) and `Node13` (caps), inside x 17–29, y −17–16,
z 17.5–31 mm (import frame). Shell vertices whose nearest source triangle is a
button piece form the region: 290 vertices in one patch, and a stray 84-vertex patch
near the front was dropped. The region plus 2 rings (382 vertices) was refaired
by biharmonic hole filling (bi-Laplacian least squares, full rank 382/382), with
the rest of the shell fixed and vertices moving only along the region's mean normal.
Two earlier attempts failed and were discarded: a quadratic height fit (RMS 5.3 mm)
and free 3-D biharmonic (vertices slid up to 33 mm, 255 intersections).
Removed-region area **572 mm²**; largest displacement from M650 **2.98 mm**,
mean 0.64 mm. Mesh: 14,000 triangles, 0 non-manifold edges, 0 intersections,
dimensions unchanged at 61.0 × 108.2 × 38.8 mm (M550 catalogue is the same), support margin
21.56 mm, volume 144,843 mm³ (M650 144,937).

**Colour.** M550 and M650 graphite-medium top gallery photos match on the palm,
buttons and rear shell (ΔE2000 0.00, 0.36, 0.69, 0.00; crops are 1474 × 829 and
1475 × 830 px). The one difference is M650's light grey wheel-to-LED plate, which M550 lacks.
Its neutral light texels on the plate source object (`Node1`), plus the thumb region,
each grown 8 texels over their seam rims, are filled with the median of a clean surrounding band
(feathered 4 texels), with the normal map flat there. The green LED is kept. Neighbour growth
was tried first and discarded because it carried dark seam rims inward.

Silhouette IoU against M550's photos, cameras fitted by `fit_m550_photos.py`
(unchanged) on each mesh:

| View                 | Committed B3 study |  Candidate |
| -------------------- | -----------------: | ---------: |
| Top                  |             0.9951 |     0.9923 |
| Left                 |             0.9823 | **0.9915** |
| Bottom               |             0.9929 |     0.9918 |
| Rear ¾ (B3 held out) |             0.9325 | **0.9880** |
| Front ¾ (held out)   |             0.9571 | **0.9948** |

**Limitations, for Kirby's decision.** A faint outline of the M650 plate remains
(the plate is slightly raised in the geometry). The filled thumb area is smooth,
slightly flatter plastic with some mottling at its front edge, and lacks M550's
side grip ridges. M550's thin centre seam is not drawn. The dark smudges beside
the wheel come from the M650 bake. Contact sheet: `contact-sheet.png`
(M550 photos | committed B3 M550 | candidate | M650; top, side, front, hero).

#### Parts 1 and O4 — missed rays, and the re-bake of every AR shell (Claude, 2026-09-28)

**Method.** After the production pass, `repair_missed_rays` bakes the shell's own
object-space normals (the valid-texel mask) and a hit mask at the production reach.
It repeats both only for texels that missed, with a **second pass** (cage 12 mm,
reach 16 mm) and Codex's `fallback_selection`, which rejects hits whose source normal
faces away from the shell. Rays start at the cage and travel inward, so the first pass spans
4 mm above to 8 mm below the shell and the second spans 12 mm above to 4 mm below. The
second pass's lower part repeats a stretch the first pass already found empty on the
same line, so **a new hit can only lie 4–12 mm above the shell**. `tests/test_bake_reach_blender.py`
confirms this with source planes at +14, +8, +2, −2, −6 and −10 mm: only +8 mm is gained.
(An earlier version of this section said the second pass spans "12 to 4 mm above". The
Sonnet reviewer caught that: the ray spans to 4 mm below, and the effective result is as
stated here.) A miss deeper than 8 mm is a hole in the source's outer skin. Those texels,
and any still unresolved, take the mean of their resolved neighbours within the
UV island (`fill_from_neighbours`, numpy only, unit-tested). There is no explicit island ID:
islands stay apart because of the 1.5% UV margin. Texels the first pass hit are never changed.
No scipy runs inside Blender.

A first version used a 50 mm reach. It improved five of six shells, but on M650 rays went
through the gap around the wheel and picked up dark interior plastic (hero ΔE2000 on
the changed pixels 5.53 → 8.58). All shells were re-baked with the outward-only rule;
the first run's log is kept as `out/study-fidelity/c/batch-v1-reach50.log`.

**Every AR shell was re-baked** with all Phase C fixes (cover composite, metallic 0 for
colour, missed-ray repair) and rendered in the shared studio against its AR source. The
**install rule was fixed before the batch ran**: whole-silhouette ΔE2000 vs AR must not
rise by more than 0.1 in any view, and the shell must be in O1/O2/O4 scope or its
changed pixels must get closer to AR in at least two of three views
(`out/study-fidelity/c/decide.py`).

| Shell                    | First-pass miss | Repaired | Filled | Unresolved | Whole ΔE2000 vs AR, top / side / hero | Result                             |
| ------------------------ | --------------: | -------: | -----: | ---------: | ------------------------------------- | ---------------------------------- |
| ergo-m575                |           1.02% |   10,490 | 11,124 |         19 | 1.52→1.01 / 2.13→1.35 / 2.08→1.30     | **installed**                      |
| g-pro-2-lightspeed       |           4.90% |   23,836 | 55,017 |      5,327 | 4.32→1.87 / 5.64→1.67 / 3.92→1.66     | **installed**                      |
| g-pro-x-superlight-2     |           0.24% |    2,771 |  2,359 |         89 | 1.47→1.31 / 2.27→2.26 / 1.55→1.47     | kept (SE is built from it; see O5) |
| g-pro-x-superlight-2-dex |           3.07% |   16,695 | 37,775 |      1,082 | 2.18→1.21 / 1.44→1.00 / 2.12→1.41     | **installed**                      |
| g-pro-x-superlight-2c    |           0.16% |    1,515 |  1,806 |         28 | 1.73→1.66 / 2.04→1.99 / 1.82→1.77     | **installed**                      |
| g203-lightsync           |           0.12% |      964 |  1,906 |          0 | 6.24→6.40 / 6.07→6.11 / 8.73→8.83     | kept                               |
| g305-lightspeed          |           0.00% |       12 |     10 |          0 | 1.18→0.87 / 0.68→0.67 / 1.28→1.04     | **installed**                      |
| g309                     |           3.61% |    7,857 | 27,029 |        765 | 1.90→1.85 / 2.72→2.32 / 2.37→2.17     | **installed**                      |
| g403-hero                |           1.12% |    2,993 | 17,032 |      1,622 | 9.22→9.21 / 5.40→5.40 / 8.40→8.40     | **installed**                      |
| g502-hero                |           0.27% |       29 |  5,473 |          2 | 8.38→8.89 / 8.29→8.29 / 10.26→10.72   | kept                               |
| g502-x                   |           0.55% |    4,429 |  3,981 |         10 | 3.27→3.07 / 13.18→13.18 / 5.65→5.41   | **installed**                      |
| g502-x-lightspeed        |           0.47% |    4,191 |  4,831 |          0 | 1.71→1.79 / 4.03→3.78 / 1.71→1.40     | **installed**                      |
| g502-x-plus              |           0.47% |    4,191 |  4,831 |          0 | 2.34→2.42 / 2.63→2.61 / 2.11→2.15     | kept                               |
| g703-lightspeed          |           1.07% |    3,551 | 16,574 |      1,501 | 1.29→1.28 / 1.36→1.35 / 1.94→1.93     | kept                               |
| lift-vertical            |           0.02% |       40 |    319 |          0 | 1.27→1.14 / 1.20→1.20 / 1.53→1.39     | **installed**                      |
| m190                     |           0.69% |    4,783 |  9,732 |         14 | 1.15→1.15 / 1.36→1.36 / 1.70→1.70     | kept                               |
| m196                     |           0.03% |       40 |    568 |          1 | 0.85→0.86 / 2.66→2.68 / 1.40→1.44     | kept                               |
| m240                     |           0.06% |       27 |  1,207 |          0 | 1.42→1.09 / 1.54→1.17 / 1.84→1.60     | **installed**                      |
| m650                     |           3.37% |    9,625 | 33,379 |      1,572 | 1.52→1.52 / 1.82→1.82 / 2.03→2.06     | **installed**                      |
| m720-triathlon           |           0.10% |      619 |  1,509 |          2 | 1.01→0.91 / 1.73→1.07 / 1.47→1.27     | **installed**                      |
| m750                     |           3.25% |   10,471 | 32,638 |      3,015 | 2.76→1.94 / 2.31→2.27 / 3.41→2.38     | **installed**                      |
| mx-anywhere-3s           |           0.00% |       10 |      6 |          0 | 3.69→1.76 / 2.70→2.05 / 4.28→2.22     | **installed**                      |
| mx-master-3s             |           0.01% |        1 |    157 |          0 | 2.20→1.84 / 3.68→2.37 / 3.20→2.41     | **installed**                      |
| mx-vertical              |           0.00% |        0 |     76 |          0 | 8.12→0.91 / 3.34→0.72 / 7.94→1.04     | **installed**                      |
| pebble-2-m350s           |           0.00% |        0 |      0 |          0 | 3.42→3.42 / 1.93→1.94 / 3.15→3.15     | kept                               |
| pop-mouse                |           0.28% |    2,350 |  2,371 |          1 | 5.35→2.78 / 4.19→2.89 / 5.49→3.18     | **installed**                      |
| mx-master-4              |           0.03% |      230 |    322 |          0 | 2.22→2.22 / 3.18→3.18 / 3.18→3.18     | **installed**                      |
| g903-hero                |           4.24% |   14,705 | 13,385 |        145 | 3.18→3.15 / 1.92→1.92 / 3.18→3.21     | **installed**                      |

**20 GLBs changed**, each installed by `package_colour_candidate.py` with 0.0 mm corner
displacement and 0.0 mm bbox difference; ERGO M575S follows its M575 alias. The largest gains
come from the metallic fix: MX Vertical's aluminium top panel (8.12 → 0.91 top view),
MX Anywhere 3S, Pop Mouse, G Pro 2 Lightspeed. Kept by the rule: G203, G502 Hero,
G502 X Plus, G703, M190, M196, Pebble 2. Superlight 2 passed the rule but is kept,
because SE is Superlight 2's GLB with only its base colour replaced and SE's delivery
check requires every other chunk to match (O5).

Gates after install: `ALL_ASSET_CHECKS_PASSED`; Blender alpha (4 tests), colour-sampling
and orientation tests; SE geometry and SE delivery checks; unit discovery 73 tests (61 run and pass, 12 Blender-only skips; all 4 Blender test files pass under Blender); `check_catalogues.py`,
`audit_payloads.py`, `optimize_glbs.py --check`, prettier and 967 Vitest tests pass. `PAYLOAD-AUDIT.md` regenerated.

#### D2 — M550 delivered on the M650 AR shell (Claude, 2026-09-28)

Kirby approved finishing and delivering the Part 3 candidate (2026-09-28, Phase D plan).
`package_m550_sibling.py` deleted `studies/logitech-m550.glb`, wrote `shells/logitech-m550.glb`
and moved the manifest and validation entries from `studies` to `shells`. The new entry has an
`inheritedShell` record, as SE does, with the M650 source hash, the fairing numbers, photo IoU
for the candidate and the old study, the decision, and the limitations. Mesh statistics were
measured on the re-imported delivered GLB: 14,000 triangles, 0 non-manifold, 0 degenerate,
0 intersections, 61.0 × 108.2 × 38.8 mm (bbox error 0.000007 mm), ground 0, support margin 21.56 mm,
327,296 bytes. Silhouette IoU against M550's photos (fitted cameras): top 0.9923, left 0.9915, bottom 0.9918,
rear ¾ 0.9880, front ¾ 0.9948, against the old study's 0.9951 / 0.9823 / 0.9929 / 0.9325 / 0.9571.

Not done, by decision: the plate outline's sub-millimetre relief was not refaired
(the gain is in overall shape; see Part 3). `check_m550_photo_bake.py` and
`package_m550_photo_bake.py` are marked superseded; re-running the latter would
reinstall the B3 study.

Gates: `ALL_ASSET_CHECKS_PASSED`, all 4 Blender test files, unit tests (61 run, 12 bpy skips),
`check_catalogues.py`, `audit_payloads.py`, `optimize_glbs.py --check`, prettier, 967 Vitest tests.
`PAYLOAD-AUDIT.md` regenerated. Changed: `shells/logitech-m550.glb` (new),
`studies/logitech-m550.glb` (deleted), manifest, validation.

#### D1b finish — M705 and M850L (Claude, 2026-09-29; Codex out of quota)

Run with Codex's committed tools (`refine_study_geometry.py`, `evaluate_study_geometry.py`),
frozen baseline cameras, and the unchanged delivery gate. The held-out photo was never used for
selection. Earlier attempts are kept under `out/study-fidelity/d1/<slug>/symmetric-attempt/` and
`uniform-attempt/`.

| Study | Attempt                                                                                | Mean fitted IoU     |            Worst fitted Δ | Held-out Δ | Largest coefficient | Gate                                                             |
| ----- | -------------------------------------------------------------------------------------- | ------------------- | ------------------------: | ---------: | ------------------: | ---------------------------------------------------------------- |
| M850L | asymmetric basis (24 fields)                                                           | 0.964186 → 0.964181 |            −0.00044 (top) |   −0.00047 |             0.31 mm | **fail**: mean and held-out do not improve                       |
| M705  | asymmetric, uniform view weights                                                       | 0.953123 → 0.955752 | −0.00273 (gallery 1, top) |   −0.00097 |             4.90 mm | **fail**: a fitted view drops > 0.002; held-out does not improve |
| M705  | asymmetric, **duplicate groups share one vote** + hard ≤ 0.0015 drop at fit resolution | 0.953123 → 0.954547 | −0.00648 (gallery 1, top) |   +0.00074 |             3.32 mm | **fail**: a fitted view drops > 0.002                            |

**Result: M705 and M850L stay byte-identical.** Only M325s (Codex, `50a9512`) was delivered in D1.

What the failures show:

- **M850L:** even with one-sided fields, the optimiser finds almost nothing to change. Its
  worst view (extra 1, rear-left elevated, IoU 0.919) is not a smooth whole-body error.
  It needs a local correction or a check of that photo's mask and camera.
- **M705, first attempt:** 12 of 15 fitting photos are third-party desk photos in four
  near-duplicate groups (Codex's inventory marks them correlated). They outvote the three
  official photos: the rear-right group gains about 0.01, while the official top view loses 0.0027.
- **M705, second attempt:** weighting each duplicate group once was a principled change, driven by
  the fitted top view's failure and not by the held-out result, and Claude committed to one
  retry only. It also exposed a method limit. **Corrected after the Sonnet review:** the hard ≤ 0.0015
  cap held at 320 px. But at 720 px, no candidate the optimiser tried, including the inherited
  320 px result, satisfied it (`deformation-stages.json`: 720 px loss `inf` after 617 evaluations).
  So that stage silently passed the 320 px result through, and the 1440 px evaluation then measured
  a −0.0065 drop on the top view. **The constraint is resolution-sensitive already between 320 and
  720 px**; an earlier version of this note wrongly said it held at 720 px.
  `refine_study_geometry.py` now prints `STAGE_INFEASIBLE` and records `feasible: false` when that happens.
- **Next step (open, for Codex or a Sonnet builder):** run the final fit stage, and its no-regression
  constraint, at the 1440 px evaluation resolution. Also consider masks of the official photos only.
  `refine_study_geometry.py` gained an opt-in `--weighting groups` flag (default `uniform`, so
  M325s's reproduction is unchanged).

#### D5a — study rebuild (Sonnet builder A)

**Neither study delivered; M705 and M850L stay byte-identical (no public file changed).** Both
fail the unrelaxed D1 gate.

Method (fitting views only): catalogue L/W/H box, base at Z=0; voxel carving at <= 0.5 mm
(`visual_hull_math.py`, 21 unit tests) against the frozen perspective cameras and masks at 1440 px;
each duplicate group counts as one vote, so an official photo weighs as much as a whole
third-party group. Rule and threshold chosen by leave-one-duplicate-group-out cross-validation
on fitting views, scored with the gate's own renderer (`build_visual_hull.py`). M705: 7 groups,
rule `any`, threshold 0, CV mean IoU 0.929. M850L: 5 groups, rule `majority`, threshold 0, CV mean
0.947. Then marching cubes, Taubin smoothing with the base pinned (15 iterations, max move
0.32 mm), Blender voxel Remesh to the budget (a direct decimate to 14,000 gave 9
self-intersections), catalogue bbox calibration, UV transfer from the baseline (nearest face
interpolated) with its material and texture bytes unchanged, Draco export
(`export_visual_hull.py`). Depth cues: no separate depth-edge refinement was attempted.

Mesh gates (re-imported GLB): M705 13,932 triangles, 0/0/0, bbox error 0.000003 mm, ground 0,
support 26.4 mm (baseline 11.4); M850L 13,940 triangles, 0/0/0, 0.000002 mm, 0, 31.0 mm.
UV stretch percentiles are in `out/d5/<slug>/export-geometry.json`; not fixed.

The frozen `evaluate_study_geometry.py` asserts identical faces, which a rebuild cannot meet, and
was left untouched. `evaluate_visual_hull_geometry.py` re-implements the same computation from the
same functions (`evaluation_raster`, `silhouette_iou`, `delivery_gate`), same frozen cameras, 1440 px.

M705 gate: FAIL (`A fitted view drops by more than 0.002`, `Held-out IoU does not improve`). Mean
fitted 0.9531 -> 0.9687 (improves), worst fitted delta -0.0148
(gallery-1 top), held-out -0.0106. **M705's held-out photo
(gallery 2) had already been seen after two earlier attempts**; it was not used to choose anything
here. Official gallery photos alone: gallery-1 -0.0148, gallery-3 +0.0092, gallery-4 -0.0013, held-out
-0.0106; so two of three official fitted views improve or hold, the top view does not.

M850L gate: FAIL (per-view drop, mean does not improve, held-out does not improve). Mean fitted
0.9642 -> 0.9636, worst -0.0445 (bottom, extra-3), top -0.0372,
held-out -0.0468. Side views gain (+0.023 to +0.032) while the top
and bottom views, which the baseline already fits to 0.995, lose about 0.04.

Why: the baseline loft was fitted per view to 0.995 on top/bottom; a voxel hull plus remesh
cannot match that within 0.002, the same structural limit as the earlier deformation attempts.
Not tried (out of budget): a hull constrained to keep the top and bottom outlines, or a hybrid
that keeps the baseline where it already fits. No gate was relaxed.

Patent USD1002618S1 (figs 5-10, sheets 5-9): downloaded to `out/d5/`, viewed. Not verified as
M850L and **not used**: it shows a large angled thumb flange, side buttons and a thumb-wheel
strip that the M850L photos lack, and its filing date fits the M650. No outline extraction or IoU
comparison was done.

| M705 view                     | Role     | Baseline IoU | Rebuild IoU |   Delta |
| ----------------------------- | -------- | -----------: | ----------: | ------: |
| m705-gallery-1.png            | fit      |       0.9959 |      0.9811 | -0.0148 |
| m705-gallery-2.png            | held-out |       0.9556 |      0.9450 | -0.0106 |
| m705-gallery-3.png            | fit      |       0.9587 |      0.9679 | +0.0092 |
| m705-gallery-4.png            | fit      |       0.9844 |      0.9831 | -0.0013 |
| supplemental/techwalls-0.jpg  | fit      |       0.9464 |      0.9561 | +0.0098 |
| supplemental/techwalls-1.jpg  | fit      |       0.9464 |      0.9564 | +0.0100 |
| supplemental/techwalls-2.jpg  | fit      |       0.9456 |      0.9557 | +0.0101 |
| supplemental/techwalls-6.jpg  | fit      |       0.9547 |      0.9694 | +0.0147 |
| supplemental/techwalls-7.jpg  | fit      |       0.9556 |      0.9719 | +0.0163 |
| supplemental/techwalls-8.jpg  | fit      |       0.9556 |      0.9713 | +0.0157 |
| supplemental/techwalls-9.jpg  | fit      |       0.9599 |      0.9762 | +0.0163 |
| supplemental/techwalls-10.jpg | fit      |       0.9606 |      0.9768 | +0.0162 |
| supplemental/techwalls-11.jpg | fit      |       0.9604 |      0.9765 | +0.0161 |
| supplemental/techwalls-12.jpg | fit      |       0.9247 |      0.9631 | +0.0385 |
| supplemental/techwalls-13.jpg | fit      |       0.9228 |      0.9606 | +0.0378 |
| supplemental/techwalls-14.jpg | fit      |       0.9252 |      0.9649 | +0.0397 |

| M850L view  | Role     | Baseline IoU | Rebuild IoU |   Delta |
| ----------- | -------- | -----------: | ----------: | ------: |
| top.png     | fit      |       0.9959 |      0.9586 | -0.0372 |
| left.png    | fit      |       0.9552 |      0.9797 | +0.0245 |
| extra-1.png | fit      |       0.9187 |      0.9502 | +0.0315 |
| extra-3.png | fit      |       0.9952 |      0.9507 | -0.0445 |
| extra-5.png | held-out |       0.9548 |      0.9080 | -0.0468 |
| extra-6.png | fit      |       0.9560 |      0.9791 | +0.0230 |

Evidence: `out/d5/<slug>/silhouette-evaluation.json`, `silhouette-comparison.png` (photo | baseline |
rebuild for every view), `candidate.glb`. The four-view contact sheet was not produced. No
installer was written because nothing passed.

### D6 — second attempt at the undone items (Claude, 2026-09-30)

Kirby resumed the paused work: _"finish the model building and auditing that failed before"_.
Branch `m4a-d6-geometry`, worktree `m4a-d6`. The gates are unchanged. Evidence is in
`out/d6/` (gitignored).

#### D6a — M705 and M850L: height-only hybrid

**Neither study delivered; both stay byte-identical. Both fail only on the held-out view.**

- **Method** (`height_field_math.py`, 11 unit tests; `d6_height_transfer.py`): keep every loft
  vertex's X and Y, so the top and bottom outlines the lofts already fit at 0.995 are kept.
  Scale only Z by `1 + a·(R_σ − 1) + Σ c_k·φ_k(x, y)`:
  - R_σ is the D5a visual hull's top-surface height over the loft's, Gaussian-smoothed.
  - φ_k are 24 bilinear hat fields over the footprint.
  - Ground vertices never move, and the result is recalibrated to the catalogue box.
- Topology and UVs are unchanged, so the **frozen `evaluate_study_geometry.py` judged it
  unmodified**.
- **Fitted at 1440 px**, the evaluation's own resolution (the D1 lesson). A hard per-view
  no-regression constraint of 0.0015 applied, each duplicate group had one vote, and only
  fitting photos were opened.
- Each candidate was frozen (SHA-256 recorded) before its single evaluation.

| Study | Fitted mean before → after | Worst fitted Δ | Held-out Δ          | Max Z move | X/Y move | Gate                                |
| ----- | -------------------------- | -------------: | ------------------- | ---------: | -------: | ----------------------------------- |
| M850L | 0.9642 → 0.9674            |  −0.0006 (top) | −0.0032 (extra-5)   |    8.24 mm |     0 mm | **fail**: held-out does not improve |
| M705  | 0.9531 → 0.9617            |  −0.0005 (top) | −0.0118 (gallery-2) |    6.63 mm |     0 mm | **fail**: held-out does not improve |

- **M705:**
  - Every fitted view improves or holds: the left profile is +0.0063 (its projected gap falls
    from 2.76 to 0.97 mm), and rear-right (techwalls-12–14) is +0.026 to +0.029.
  - The held-out view is the rear-left oblique.
- **M850L:**
  - left +0.0088, extra-6 +0.0080, top −0.0006, extra-3 −0.0003.
  - The held-out extra-5 (rear-left, elevated) falls 0.0032, although its projected gap improves
    from 4.69 to 4.42 mm.
- **Reading (a hypothesis, not tested):** both held-out views are rear-left. M705's fitting set
  has rear-right photos but no rear-left ones. The hull, a conservative upper bound, may be least
  constrained there, so copying its heights could over-raise the rear-left. M850L does have a
  rear-left fitting view (extra-1, +0.0001), so the explanation is weaker for M850L.
- Two of M705's 24 hat coefficients sit near the 0.08 bound (maximum 0.0768). M850L's reach at
  most 0.0205.
- **Held-out use is now exhausted.** M705's gallery-2 has been evaluated four times (D1 ×2,
  D5a, D6) and M850L's extra-5 three times (D1, D5a, D6). No further attempt may be selected
  against them. A third attempt needs **new held-out photos**, such as Kirby's own photos of
  the physical mice, or Kirby's explicit decision on the fitting-view evidence.

#### D6b — the wheel-area "shape loss" is mostly a measurement artefact

**Nothing to build; the D0 "inside > 2 mm" figures that D4 and D5b targeted are 83–100% gap
bridging.**

- **What D0 got wrong:** D0 signs each shell sample by the normal of the nearest AR-source
  point. Where the shell bridges a slot, a button seam or the wheel well, that nearest point is a
  gap wall or the housing's low-poly inner wall, whose normals face into the product. D0 therefore
  labelled bridging samples "inside" (missing material).
  - Evidence (ad-hoc check, not in the committed tooling): on M650 and M750 the nearest source
    faces of the flagged samples have a median longest edge of 19.4 and 22.7 mm, against about 1 mm
    across the source. Their median nearest-surface distance is 4.6 and 3.8 mm.
- **Test** (`gap_bridge_math.py`, 8 unit tests; `d6_audit_recheck.py`): a flagged sample is real
  missing material only if a ray along the shell's outward normal meets a source face that also
  faces outward, within 1.5 mm of the sample's measured depth.
  - Without the depth condition, rays pass through the slot to outer skin 7–13 mm away (median
    12.8 mm on G903). That is how the artefact passed D4's earlier ray check.
  - **Known limit (Sonnet review):** near a steep wall, the nearest source point is lateral while
    the outward ray meets the top skin at the bump's full height. So the tight test under-counts
    tall features. On a synthetic flat shell under a box bump, the share of truly missing samples
    labelled bridging was 0% at 3 mm height, 12% at 4 mm, 53% at 6 mm and 81% at 8 mm. The
    1.5 / 3 / 5 mm / no-depth columns below bound this.
- The D0 audit was re-run for all 28 shells (`out/d6/audit-d0`) and reproduces D0 exactly.

| Shell     | D0 inside > 2 mm | Bridges a gap | Real missing material, depth tolerance 1.5 / 3 / 5 mm / none |
| --------- | ---------------: | ------------: | ------------------------------------------------------------ |
| G903 Hero |            1.59% |           98% | 0.030 / 0.125 / 0.26 / 0.65%                                 |
| M650      |            1.16% |           94% | 0.075 / 0.20 / 0.25 / 0.29%                                  |
| G502 X    |            0.62% |           99% | 0.005 / 0.005 / 0.005 / 0.005%                               |
| M190      |            0.42% |           93% | 0.030 / 0.04 / 0.065 / 0.08%                                 |
| M750      |            0.33% |           83% | 0.055 / 0.07 / 0.105 / 0.12%                                 |
| 6 others  |          ≤ 0.10% |       95–100% | ≤ 0.005% at 1.5 mm                                           |
| 17 others |               0% |             — | 0%                                                           |

- **Consequence:** D4's and D5b's gate asked the inside share to halve. That share was mostly
  bridging, which no correct closed shell should remove, so both failures are largely explained by
  the measurement, not by missing geometry.
- **Real missing material over 2 mm is 0.005–0.075% under the tight 1.5 mm depth test, and at most 0.65% (G903; ≤ 0.29% elsewhere) with no depth test. The tight test under-counts features taller than about 3.5 mm.** The gate is not changed. The measurement is
  corrected, and the correction is recorded here for Kirby's decision.
- **Proposal:** close the wheel-area item, and report the corrected share next to D0's in
  future audits.

## Open issues (candidates for Phase C)

| #   | Issue                                                                                                          | Status (2026-09-28)                                                                                                                   |
| --- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| O1  | Bake rays miss the AR source on part of G903 and M750; missed texels baked black                               | **Fixed** by the outward-only second pass plus neighbour fill; applied to every re-baked shell (Parts 1 and O4)                       |
| O2  | Wheel recesses read black on MX Master 4, M750, G903                                                           | **Fixed**: the cause was the DIFFUSE colour pass zeroing metallic base colour (Part 2). MX Master 4 wheel ΔE2000 38.29 → 1.48         |
| O3  | M705 has the lowest support margin (11.4 mm)                                                                   | No action required                                                                                                                    |
| O4  | Accepted AR shells above 1% missed area (G Pro 2, Superlight 2 DEX, G309, G403, M650)                          | **Fixed and installed** (Kirby: in scope)                                                                                             |
| O5  | Superlight 2 re-bake passes the rule (1.47 → 1.31 top) but SE is built from its GLB                            | **Dropped** (Kirby, 2026-09-28: no more colouring)                                                                                    |
| O6  | High whole-silhouette ΔE2000 vs AR on G403 (9.2 top), G502 Hero (8.4–10.3), G203 (6.1–8.7), G502 X side (13.2) | Open: not caused by Phase C (unchanged by the re-bake); likely a geometry or orientation mismatch against the AR render. Needs a look |

## Decisions

| Date       | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | By             |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| 2026-09-28 | Scope: all eight studies; target is the 26 AR-derived shells' finish                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Kirby          |
| 2026-09-28 | Geometry: eight-new-shells versions, except M100 from m100-level-base                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Kirby          |
| 2026-09-28 | Codex runs `gpt-6-astra` at reasoning high                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Kirby          |
| 2026-09-28 | **Gate A passed.** G903 Hero and M750 go through the full AR pipeline of the 26 shells; their study geometry is replaced (approved geometry route)                                                                                                                                                                                                                                                                                                                                                                                                  | Kirby          |
| 2026-09-28 | SE uses the G Pro X Superlight 2 shell (geometry and detail maps) recoloured from SE photos (approved geometry route)                                                                                                                                                                                                                                                                                                                                                                                                                               | Kirby          |
| 2026-09-28 | M550 is the photo-bake prototype for M100, M550, M705, M325s and M850L                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Kirby          |
| 2026-09-28 | Phase B runs as B1 (G903, M750), then B2 (SE), then B3 (M550), one Codex run each, because all three rewrite `manifest.json` and `validation.json`                                                                                                                                                                                                                                                                                                                                                                                                  | Claude         |
| 2026-09-28 | B1 scale gate: G903 Hero and M750 are calibrated per axis to catalogue L/W/H like the 26 shells, despite 2.9% / 3.3% scale spread. The Step 1 stop limits (0.97–1.03, 2% spread) are waived for these two only, and their calibration scales are recorded                                                                                                                                                                                                                                                                                           | Kirby          |
| 2026-09-28 | B3 camera gate: the rear three-quarter photo (IoU 0.932) is held out rather than projected. Texture comes from top, left, bottom and front ¾ (all ≥ 0.95), plus mirrored left after a mirror-IoU check (0.9991). This interprets criterion 3; it does not relax it                                                                                                                                                                                                                                                                                  | Claude         |
| 2026-09-28 | B3 assessment: the photo bake is a real but modest improvement. The remaining gap to the AR shells is mostly geometry: an interpolated loft, a 3.9 mm cross-section error at the rear ¾, and wheel and gaps present only in the texture. Phase C1 (photo bake of M100, M705, M325s and M850L, which have fewer photos) is **on hold for Kirby**. Meanwhile C runs O1/O2 on the AR shells, plus a non-delivered candidate: M550 on the M650 AR shell with the thumb buttons removed                                                                  | Claude         |
| 2026-09-28 | M550 waits for the Phase C candidate on the M650 AR shell before a final choice. **M100, M705, M325s and M850L stay as they are**: no photo bake (C1 dropped)                                                                                                                                                                                                                                                                                                                                                                                       | Kirby          |
| 2026-09-28 | **Visual acceptance:** G903 Hero, M750 and G Pro X Superlight 2 SE **accepted**. MX Master 4 and M100 **not accepted**; changes requested (details below)                                                                                                                                                                                                                                                                                                                                                                                           | Kirby          |
| 2026-09-28 | MX Master 4 changes requested: wheel black hole (O2) and **button colour/finish wrong**. Claude measured it under identical lighting (top view, mean sRGB). Left button: AR reference 177, current 146, the first all-opaque bake 182. Palm matches at 185–186 in all three. **Claude's error:** on 2026-09-27 it replaced the all-opaque bake with the blended-colour bake after judging it "too white" by eye, without measuring. The fix is to bake base colour with the sources opaque as well                                                  | Kirby / Claude |
| 2026-09-28 | M100 changes requested: detail too low and proportions wrong. Route: (1) search for an AR source of a same-shell sibling (B100 is the business variant, commonly said to share the shell; Claude has not verified this) and verify it with A2-style silhouettes; (2) otherwise refine the geometry from the four gallery photos with B3's camera fitter. Deliver only if every view's IoU improves and the held-out view improves                                                                                                                   | Kirby / Claude |
| 2026-09-28 | **M100's 3D model is removed.** It stays in the catalogue and fit results by its dimensions, and moves from `studies` to `noShell` in the manifest. Part 4 (M100 rework) is cancelled. AGY's web search found no Logitech-hosted AR file for M100 or its siblings                                                                                                                                                                                                                                                                                   | Kirby          |
| 2026-09-28 | **Claude's MX Master 4 diagnosis corrected.** The all-opaque bake is not the fix: in Codex's identical-light studio the left button is AR 89.7, blended 73.3, opaque 109.5 (mean sRGB). The clear cover sits over the button body. The blended bake composited it over black; the opaque bake drops the body. Part 2b now composites the cover over the layer beneath it                                                                                                                                                                            | Claude         |
| 2026-09-28 | **2b preflight ruling.** The region-mean preflight confirms the layer structure: cover alpha 0.40 over `MAIN_PLASTIC`, about 1.4 mm beneath. Prediction vs AR ΔE2000 is left 3.04, right 2.11, palm 0.16, against blended 6.02 / 4.21 and opaque 7.31 / 7.81. The ≤ 3 preflight threshold was Claude's hypothesis check, not a delivery gate; Claude rules the hypothesis confirmed and 2b proceeds to the per-texel composite bake. The delivery gate is unchanged: ΔE2000 ≤ 3 on the left button, right button and palm in the rendered candidate | Claude         |
| 2026-09-28 | While Codex is out of quota, **Claude builds** the remaining Phase C work (2b, 2, 1 incl. O4, 3). Because Claude would otherwise approve its own work, every Claude-built part needs the independent Sonnet review plus Kirby's visual acceptance                                                                                                                                                                                                                                                                                                   | Kirby          |
| 2026-09-28 | **O4 in scope:** fix the missed bake rays on the five accepted shells as well (G Pro 2, Superlight 2 DEX, G309, G403, M650), not only G903 and M750                                                                                                                                                                                                                                                                                                                                                                                                 | Kirby          |
| 2026-09-28 | **Install rule for the AR re-bake**, fixed before the batch ran: no view's whole-silhouette ΔE2000 vs AR may rise by more than 0.1, and the shell must be in O1/O2/O4 scope or improve on its changed pixels in 2 of 3 views. 21 passed, 7 kept; Superlight 2 is held back for SE (O5)                                                                                                                                                                                                                                                              | Claude         |
| 2026-09-28 | **Direction: no more colouring; the focus is model (geometry) quality.** Kirby says this was noted before, but it had not reached this doc, so Phase C went into colour work. Installed colour work stays (0 mm geometry change). No new recolour or texture tasks: O5 (Superlight 2 + SE) and the M550 plate recolour are dropped. Future work is judged by geometry: silhouette IoU, surface distance to AR sources, shape detail, orientation                                                                                                    | Kirby          |
| 2026-09-29 | Codex is out until 2026-10-04 13:10 (weekly limit). **Claude builds the rest of D1b (M705, M850L) and D4 now**, in this worktree (no second writer while Codex is out), with Codex's committed tools and unchanged gates. As before, an independent Sonnet review and Kirby's visual acceptance are required. Codex takes whatever is left when it returns                                                                                                                                                                                          | Kirby          |
| 2026-09-29 | Kirby: Sonnet subagents may assist. **D4 goes to a Sonnet builder** in its own worktree `m4a-d4-remesh` (branch from `dbdd5fd`, read-only junctions to this worktree's reference data), with the same D4 gate. Claude audits and pushes                                                                                                                                                                                                                                                                                                             | Kirby / Claude |
| 2026-09-29 | **Pause after D5.** Kirby: finish the D5 work in progress (builders A and B), then pause. After Claude audits, merges and records D5, no new phases, retries or Codex timers start until Kirby resumes                                                                                                                                                                                                                                                                                                                                              | Kirby          |
| 2026-09-30 | **Resumed (Kirby):** "finish the model building and auditing that failed before". Claude runs D6 (D6a M705/M850L, D6b wheel-area audit) in worktree `m4a-d6` with unchanged gates. Claude-built work goes to the independent Sonnet review and Kirby's visual acceptance, as before                                                                                                                                                                                                                                                                 | Kirby          |
| 2026-09-30 | **D6 held-out rule (proposed; Kirby to confirm):** each D6a candidate is frozen (hash recorded) before its one evaluation. After D6, M705's and M850L's held-out photos are exhausted; any further attempt needs new held-out photos or Kirby's explicit ruling                                                                                                                                                                                                                                                                                     | Claude         |
| 2026-09-30 | **D6b measurement correction (not a gate change):** D0's inside sign counts gap bridging as missing material. The corrected test (outward ray meets outward-facing outer skin within 1.5 mm of the measured depth) puts real missing material at 0.005–0.075% per shell; with no depth test, at most 0.65% (G903). The tight test under-counts features taller than about 3.5 mm. Proposed: close the wheel-area item. **Kirby decides**                                                                                                            | Claude         |

## Progress log

### F9-1 integration (2026-10-01)

- Codex: fetched origin, committed both merges (`4ecbddd`, `45eac44`), and
  preserved main-owned files and the split workflow. Fidelity geometry and
  textures are unchanged. `npm.cmd ci` completed in this worktree. The existing
  four-product `noShell` mechanism covers the 38-entry seed; strict manifest
  checks and nine unit tests added. Python 159 passed / 12 Blender skips;
  catalogue, payload, optimisation, typecheck, lint and Prettier passed.
  Added the rights paragraph explicitly as a draft pending Kirby approval.
  Blender reimport gate and all 12 Blender-only tests passed; app Vitest
  2,651 passed / eight skipped; Blender TS nine passed. Drizzle and production
  audit passed. Size/exclusion/licensed-data scans completed and PR-description
  draft saved under ignored `out/f9/`. Playwright is in progress. No push or
  PR mutation; no published geometry or texture changed.

- 2026-09-30 Claude: **D6 done; nothing delivered, one audit finding corrected.**
  - **D6a** (height-only hybrid, fitted at 1440 px, frozen evaluator unmodified): M705 fitted mean
    0.9531 → 0.9617 and M850L 0.9642 → 0.9674, with no fitted view dropping more than 0.0006. Both
    fail on their rear-left held-out views (−0.0118, −0.0032). The held-out photos are now
    exhausted.
  - **D6b:** 83–100% of D0's "inside > 2 mm" samples are the shell bridging slots and seams. Real
    missing material is 0.005–0.075% per shell under the tight depth test, and at most 0.65% (G903)
    with none. D4 and D5b largely chased this artefact.
  - No public file changed; `out/` not committed; 20 new unit tests.
  - **Independent Sonnet review: approve with fixes, no blockers.** D6a reproduced exactly: held-out
    isolation, frozen evaluator, hashes and gate numbers. Fixed: the over-claimed "≤ 0.075%"
    headline, now a range with the classifier's steep-bump limit; a new steep-bump test; a rim
    test that could not fail; the uniform-grid check; and wording (83–100%, "largely explained",
    rear-left hypothesis marked untested, held-out rule marked proposed).

- 2026-09-29 Claude: **D5 closed; nothing delivered; project paused** (Kirby: pause after D5). Audited and merged `m4a-d5-wheels` (`f3d0fc6`) and `m4a-d5-studies` (`d3e650e`): no public file changed, nothing from `out/` committed, and the builders' unit suites passed. D5a: a voxel hull plus remesh improves side and oblique views but loses 0.015–0.045 on top and bottom views that the lofts already fit at 0.995, so both studies fail the gate. Patent USD1002618S1 was not used; it shows M650 features (thumb flange, side buttons). D5b: wheel crowns built cleanly (M190, M750, M650; G903's fit was rejected at radius 16.2 mm), but the "inside" share rose slightly. **The D0 inside samples lie 13–42 mm from the wheel axis, on the wheel housing and button trim, not the wheel**, so `GEOMETRY-AUDIT.md` is corrected. Possible next steps, if Kirby resumes: a hybrid that keeps the loft where it already fits the top and bottom views; and feature modelling of the wheel housing and trim. Neither is started.

- 2026-09-29 Sonnet builder A (D5a, `m4a-d5-studies`): **M705 and M850L visual-hull rebuilds fail the D1 gate; nothing installed.** Mesh gates pass (13.9k triangles, 0/0/0, support 26 and 31 mm). M705 mean fitted 0.9531 -> 0.9687 but official top -0.0148 and held-out -0.0106 (held-out already seen twice before); M850L mean 0.9642 -> 0.9636, top -0.037, bottom -0.044, held-out -0.047. Patent USD1002618S1 not used. See "D5a" under Results.

- 2026-09-29 Sonnet builder B (D5b, worktree `m4a-d5-wheels`): **not delivered.** Fitted wheels (M190 r12.2/w4.0, M750 r8.2/w9.4, M650 r8.4/w9.3 mm; G903 rejected, r16.2 mm) and unioned them cleanly (0 defects, <= 14,372 triangles), but the inside > 2 mm share did not fall (0.42->0.475, 0.33->0.345, 1.16->1.29%): the deficient samples sit 13-42 mm from the wheel axis, i.e. the housing and surround, not the wheel. All shells unchanged. See "D5b" under Results.

- 2026-09-29 Claude: **D5-R (AGY) done** (`Mouse Shape Project/codex-briefs/logs/agy-orthographic.md`). M705: no design patent; official 109 × 71 × 42 mm, 135 g. M850L: AGY found design patent USD1002618S1 (Logitech Europe S.A., filed 2021-09-01, granted 2023-10-24; 10 figures including six orthographic views). **The match is unverified:** the filing date fits the M650 (launched 2022) better than the M850 (about 2024), so builder A must compare its outlines against M850L photos and M650 before using it. Patent drawings are public documents, used as outline evidence only. Builders A and B were stopped by a harness safety-check outage (their partial work was kept) and resumed with corrections. Builder B's fits for M750, M650 and G903 were not wheels (oblique axes, width about 22 mm), so it now uses dimension constraints: axis within 10° of lateral, width 4–12 mm, radius 6–15 mm, outer tread only.

- 2026-09-29 Claude: **audited and merged D4 (`m4a-d4-remesh`, `5a0f44d`, `d96c511`).** No public asset changed, nothing from `out/` committed, 102 unit tests pass with 12 Blender skips, prettier clean. Accepted as a documented negative result. Wheel crowns and G903's channel need feature-aware topology: a separate wheel loop with a fixed rim curve, or fairing that treats the slot walls as a hard boundary. Moving or subdividing vertices is not enough. Silhouettes are already ≥ 0.9877 per view, so the four shells stay as they are unless Kirby asks for that follow-up.

- 2026-09-29 Sonnet builder (D4, worktree `m4a-d4-remesh`): **D4 not delivered.**
  Built and tested `local_remesh_math.py` (12 unit tests) and `d4_local_remesh.py`
  (ray-confirmed target selection, budget-checked local bmesh subdivision, vertical
  projection with ring-blended fairing, `asset_utils.validate_mesh` gate). Swept
  threshold/ring/cut/clamp parameters on M190 and M750. Every mesh-clean configuration
  caps displacement at ~0.3–0.5 mm, far below the 7–11 mm deficits, so no clamp value
  satisfies both the 0-self-intersection gate and the inside-share-halves gate. M650
  and G903 Hero exceed the 15,000-triangle cap during subdivision alone (348 and 265
  target vertices) before any vertex moves. All four shells left unchanged; no public
  asset touched. See STUDY-FIDELITY.md "D4 — local remeshing (Sonnet builder)" for the
  full sweep table and baseline numbers. Existing gates re-verified green.

- 2026-09-29 Claude: **independent Sonnet review of D1 (Codex D1 + Claude D1b): approve with fixes.** No blockers. Held-out separation confirmed in code, gate implemented as documented, M850L evaluation reproduced exactly, M325s bytes match, and 79 tests pass with 12 skipped. Fixed: the M705 second-attempt explanation (the cap was already infeasible at 720 px, not only at 1440 px), and the silent pass-through in `refine_study_geometry.py`. No asset changes.

- 2026-09-29 13:40 Claude: **D1b finished; M705 and M850L not delivered** (gate failures above). The laptop was on battery, which throttled the fits about 100×; raising process priority fixed it (a background loop does this now). D4 is running with a Sonnet builder in `m4a-d4-remesh`.

- 2026-09-29 03:55 Claude: **Codex hit its weekly usage limit (next run: 2026-10-04 13:10).** D1b delivered M325s (`50a9512`, audited and pushed) and added the tested asymmetric basis (`fd43c2e`, audited and pushed). The M705 fit never started. Codex's uncommitted README reproduction section and doc fixes are committed by Claude as WIP. Also on 09-29 at 03:38, a temp cleanup deleted the session scratchpad with the Codex briefs, so the timer dispatch failed; briefs now live in `Mouse Shape Project/codex-briefs/`. Remaining: D1b (M705, M850L) and D4. Kirby decides who builds them.

- 2026-09-29 Codex, D1b extended-basis checkpoint before long M705 fit:
  24 fields retain all original 12 and add three each of upper-shell lateral
  shift, left-only width, right-only width and roof tilt. One-sided cubic width
  fields are C2 at the centreline; all fields vanish at ground and depend only
  on position. Coefficients remain bounded to +/-5 mm; catalogue recalibration
  remains mandatory. Nine deformation tests pass, including independent-side,
  reflection, legacy-subspace, ground, seam and bbox checks. Full Python suite:
  91 tests, 79 passed / 12 Blender skips. M325s delivery `50a9512`: asset gate,
  12 Blender tests, 9 TypeScript tests, catalogue/payload/optimisation checks pass.
  Next: M705 from zero with the 24-field basis, existing frozen cameras and
  unchanged training-only objective; only then evaluate its held-out photo.
  A delivery failure will leave that study unchanged and continue to M850L.

- 2026-09-29 Codex, D1b: pulled H1 (`f61740c`). M325s existing candidate exported,
  reimported and remeasured in all eight views; all three delivery rules pass.
  Installed M325s only; original texture bytes, material JSON and UVs retained.
  Added reusable export/round-trip/package tools; payload audit regenerated.
  M705 extended-basis fit and M850L retry are next. No push.

- 2026-09-28 23:45 Claude: **Handoff H1 done** (planned 03:15; D2 finished early). Fast-forwarded this branch to `m4a-geometry-audit` (`de87d32`): D0 audit with review fixes (approve with fixes; winding and box-filter checks clean) and D2 (M550 delivered as a shell). Codex D1b resumes by timer at 03:38 from this state; the D4 brief is ready for after H2.

- 2026-09-28 Claude (D2, worktree `m4a-geometry-audit`): **M550 delivered on the M650 AR shell.** Study entry moved to shells; all gates pass. D0 audit committed on the same branch (`GEOMETRY-AUDIT.md`). Codex D1b stopped on quota after about a minute (reset 03:36); a timer resumes it at 03:38. Next: Sonnet review of D0 + D2, then handoff H1.

- 2026-09-28 Codex: **D1 STOP: M850L delivery gate failed (exit 2).** Mean
  fitted IoU 0.964185763 to 0.964185281; held-out 0.954755529 to 0.954625159.
  No retuning after holdout, no delivery. M325s raw candidate passes (mean
  0.974176579 to 0.976835651; held-out 0.966532500 to 0.966563548), but export
  and installation were not attempted after the stop. Interrupted M705 during
  its 720 px stage; WIP saved at 100 evaluations, no final candidate/holdout.
  All 36 public files / 34 GLBs byte-identical. Unit 71 pass / 12 skips, Blender
  12 pass, asset/catalogue/payload/optimizer/prettier pass. Results records all
  30 baselines, finished candidate comparisons, inspected sheets and remaining
  work. Four prior local checkpoints: 8b5d429, 15ade1c, c0e81d0, b8c019e.
  Final local failure-evidence checkpoint; no push.

- 2026-09-28 Codex: **All 30 D1 baseline camera fits complete and recorded.**
  Fitted-view IoU minima: M705 0.922794809, M325s 0.969298759, M850L
  0.918674852. Held-out baselines: 0.955600933 / 0.966532500 / 0.954755529.
  M325s and M850L geometry fits converged; M705 is fitting with checkpoints.
  M850L candidate mesh gates pass, 0.143377 mm max displacement, unchanged UVs
  and materials, 27.704527 mm support. Full asset, catalogue, payload, optimizer
  and prettier checks pass on unchanged public assets. No held-out candidate
  evaluation or publication yet. Local checkpoint; no push.

- 2026-09-28 Codex: **D1 smooth-deformation code verified before the long fit.**
  Five new deformation/gate tests pass; full Python suite 71 pass / 12 skips,
  Blender suite 12 pass. Baseline perspective fits are progressing with no
  geometry changes. Corrected the M850L extra-1 camera start after inspecting
  the photo/overlay; baseline IoU 0.918674852, initial 0.880964682 archived.
  Next: once a study's baseline cameras finish, run `refine_study_geometry.py
--directory tools/blender/out/study-fidelity/d1/<slug>`; it never opens a
  held-out camera. WIP parameters save every 50 evaluations. No push.

- 2026-09-28 Codex: **D1 camera preflight ready before the long fit.** Reusable
  B3 camera engine and study driver added; ten camera/mask tests pass. Inventoried
  35 photos, fixed 27 fitting / 3 held-out / 5 occluded roles before fitting.
  Inspected mask sheets, corrected supplemental segmentation before any camera
  solve. Next command: `python tools/blender/fit_study_photos.py --directory
tools/blender/out/study-fidelity/d1/<slug>` for each of the three studies.
  Per-photo JSON is resumable. All public files remain byte-identical. No push.

- 2026-09-28 Codex: **D1 baseline geometry verified.** Pulled `4b282a2`; clean
  starting worktree. Three committed studies each have 14,000 triangles and
  zero topology defects; support margins 11.361876 / 22.972782 / 27.747661 mm.
  Saved committed copies, decoded meshes and public hashes under ignored
  `out/study-fidelity/d1/`. Read D1, A3, B3, Decisions, AGENTS and STATUS.
  Photo mask preparation and reusable camera fitting are next; no long fit
  started and no public file changed. Local checkpoint only; no push.

- 2026-09-28 Claude: **independent Sonnet review of Claude's Phase C work (`216ff52..300daa1`): approve with fixes.** No blockers; 5 of 5 spot checks reproduced exactly (decide.py table, exactly 20 GLBs changed with Superlight 2 untouched, unit and Blender tests including the metallic negative control, MX Master 4 evidence, M575 fallback record). Fixed: (1) the reach pass overwrote `CoverAlpha.png`/`Body.png` evidence, so it now writes `*-reach.png` (GLBs unaffected); (2) the second-pass reach was described wrongly, so the section is corrected and a new Blender test pins down the bands. Nits addressed: test count, the island-margin assumption, and the geometry check being a multiset comparison. No asset changes.

- 2026-09-28 Claude (building): **O1 + O4 done; 20 AR shells re-baked and installed** under the pre-set rule, 0 mm geometry change each. The first 50 mm reach was rejected after M650 picked up interior plastic, and the second pass now looks only outward. All gates pass. New open issues O5 (Superlight 2 + SE) and O6 (high ΔE shells). Independent Sonnet review of Claude's Phase C work is next.

- 2026-09-28 Claude (building): **Part 3 candidate built, not delivered.** M650 AR shell with thumb buttons refaired (max 2.98 mm) and plate recoloured. IoU vs M550 photos is ≥ 0.988 in all five views (B3 study: rear 0.932, front 0.957). Awaits Kirby's choice between it and the B3 study.

- 2026-09-28 Claude (building): **O2 cause found and fixed**: DIFFUSE colour baked metal black. MX Master 4 re-installed with the metallic fix: wheel ΔE2000 38.29 → 1.48; buttons 0.72 / 1.62, palm 0.11. New Blender test. Sonnet review pending. Next: O1 fallback plus a re-bake of G903, M750 and the five O4 shells.

- 2026-09-28 Claude (building): **2b delivered.** MX Master 4 buttons composited cover-over-body: ΔE2000 vs AR left 2.23, right 0.79, palm 0.12 (gate ≤ 3). Only its GLB changed; 0 mm geometry change. M720, MX Vertical, Pebble 2 unchanged (reasons in Results). All gates pass. Sonnet review pending. Next: Part 2 (wheel openings).

- 2026-09-28 Claude: audited and pushed `905e473` (M100 3D model removed; M100 in `noShell`; 34 other GLBs unchanged; 63 unit tests, catalogue, optimiser and payload checks pass on rerun). Codex hit its usage limit (reset 22:19) after the 2b preflight, with its work uncommitted. Claude committed that work as WIP so it is not lost; see the 2b preflight ruling in Decisions.

- 2026-09-28 Codex: **Part 2b stopped at the cover/body hypothesis preflight.**
  Both button patches have texture alpha 0.400000036 over MAIN_PLASTIC. Shared
  studio linear-light region prediction DeltaE2000: left **3.043410** (fails
  <=3), right **2.112469**, palm **0.162278**. No composite bake or production
  replacement; Parts 2/1/3 and sibling impact measurements remain pending.
  Part M committed as `905e473`, all gates green, 34 remaining GLBs unchanged.
  Results C has actual layer details, RGB values, reproduction and crops.
  Local diagnostic checkpoint only; no push.

- 2026-09-28 Codex: **Part M complete.** M100 removed and routed to noShell;
  generation/checks agree. All 34 remaining GLBs unchanged. Python 54 pass /
  9 skips, TypeScript 9, Blender 9, full asset and catalogue/payload/optimisation/
  formatting checks pass. Separate local commit; no push. Next: Part 2b layer
  hypothesis preflight; Parts 2, 1, 3 pending; Part 4 cancelled.

- 2026-09-28 Claude: audited `5f04a91` (2b control test fixed; opaque candidate fails the colour gate, not installed) and `9ade5ba`; pushed. No public GLB changed. Kirby removed M100's 3D model (Decisions). Resume brief: M100 removal first, then 2b with cover-over-body compositing, then Parts 2, 1, 3.

- 2026-09-28 Codex: **Part 2b control fixed; stopped at the existing rendered
  colour gate.** Forced/control RGB equal exactly, repeated control spread 0;
  transparent/control differs by 0.512406796. Both Blender alpha tests pass at
  unchanged 1e-5 tolerance; no production compensation. Isolated MX Master 4
  opaque candidate fails button DeltaE2000: left **7.306253**, right
  **7.812137** versus <=3; palm **0.116268** passes. Full crops, fixed-patch
  annotations, RGB table and shared-lighting comparison are recorded in Results
  C. No public replacement; all 35 GLBs unchanged. Sibling impact bakes finished
  locally but measurements remain pending. AGY report has no AR candidates;
  sibling notes recorded as unverified. Parts 4/2/1/3 not started per stop rule.
  Local checkpoint only; no push, no full-gate-complete claim.

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
