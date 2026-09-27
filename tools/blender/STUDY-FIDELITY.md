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

| Study     | Found | Source URL | URLs attempted |
| --------- | ----- | ---------- | -------------- |
| _pending_ |       |            |                |

### A2 — sibling shells

| Study     | Sibling | Top-silhouette IoU | Side-silhouette IoU | Verdict |
| --------- | ------- | ------------------ | ------------------- | ------- |
| _pending_ |         |                    |                     |         |

### A3 — photo inventory

| Study     | Colourway used now | Usable views (top/left/right/front/rear/bottom/¾) | Max resolution |
| --------- | ------------------ | ------------------------------------------------- | -------------- |
| _pending_ |                    |                                                   |                |

## Decisions

| Date       | Decision                                                              | By    |
| ---------- | --------------------------------------------------------------------- | ----- |
| 2026-09-28 | Scope: all eight studies; target is the 26 AR-derived shells' finish  | Kirby |
| 2026-09-28 | Geometry: eight-new-shells versions, except M100 from m100-level-base | Kirby |
| 2026-09-28 | Codex runs `gpt-6-astra` at reasoning high                            | Kirby |

## Progress log

- 2026-09-28 Claude: branch created from `m4a-eight-new-shells` and merged with
  `m4a-m100-level-base` (`1ac8a8a`). All 35 packaged GLBs regenerate
  byte-identically. This doc was added.
