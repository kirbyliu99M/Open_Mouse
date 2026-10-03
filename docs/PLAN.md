# Open_Mouse — Hand Scan → Mouse Fit Web App

**Repo:** `github.com/kirbyliu99M/Open_Mouse` (private, empty, created 2026-09-21)
*"A project that tests whether a 3D modeling mouse project can be used to help buyer decision."*

## Context

A web app that measures a user's hand from guided photos, scores every mouse in a catalogue against those measurements, renders a 3D simulation of that hand on the recommended shells, and has Gemini write the narrative analysis. Frontend on Vercel, Postgres on Neon, repo on GitHub. Claude plans and supervises; Codex implements and tests.

We have `Dataset/eloshapes_mouse_data.csv` — 1,260 mice, 160 brands, **76 Logitech**. The shape columns are essentially 100% complete (2–3 nulls each):

`Length/Width/Height (mm)`, `Weight (g)`, `Shape` (Symmetrical/Ergonomic/Hybrid), `Hand compatibility`, `Hump placement` (Center → Back-aggressive), `Front flare` (Inward-aggressive → Outward-aggressive, 7 levels), `Side curvature`, `Thumb rest`, `Ring finger rest`.

Three facts shape the design:

1. **EloShapes' [ToS](https://www.eloshapes.com/terms) prohibits copying, scraping, or redistributing their content.** Their editorial shape judgments are both the most valuable and the most protected part. Per your decision: the CSV **never ships and never enters git** — it stays a local, gitignored **validation fixture**. The shippable catalogue is seeded from Logitech's published dimensions (unprotectable facts) with shape descriptors we derive ourselves via a documented rubric. The 76 Logitech rows become the labelled test set that proves the rubric works.

2. **Those 8 descriptors are enough to generate a mouse shell procedurally.** No product photos, no image licensing, no 1,260-asset pipeline.

3. **MANO — the standard parametric hand model — is research-licence only**, so it's off the table for anything public. Generating our hand mesh in Blender from the MediaPipe skeleton sidesteps this entirely: no third-party asset, no licence question.

Decisions locked: printed calibration sheet · 3D parametric mesh · session-scoped storage persisting only on login · **Blender as build-time pre-modeling**.

---

## Agent Distribution

### Claude Code — Architect & Supervisor
Owns the plan, per-milestone specs with acceptance criteria, the shape rubric, fit-engine scoring design, Gemini prompt design, PR review, and gate adjudication. Runs `/code-review` on each PR and `/security-review` before any public launch. **Writes no feature code** — that boundary is the point of the split.

### Codex — Implementation & Test
Owns all feature code, tests, Blender generation scripts, and docs, working **one milestone spec at a time**. Branches `m<N>-<slug>`, opens a PR referencing the milestone issue, drives CI green *before* requesting review (Vercel previews are built only for ready PRs since 2026-09-30; see AGENTS.md). Does not merge its own PRs.

**Two standing constraints for Codex:** never commit or move `Dataset/` (it is gitignored from the first commit), and never let the LLM do arithmetic — all numbers originate in tested TypeScript.

### Kirby — Ground Truth & Judgment
The things neither agent can do:
- **Hand photos with blind good/bad labels** (M2) — _Revised 2026-10-02 (Kirby), prereg v2, see docs/STATUS.md R2._ You photograph each participant's mouse hand (participants are coded P###) and label every photo good or bad, blind. There are no ruler-measured true values. **Blocks M2's report** (judgement correctness, target ≥ 95 %).
- Shape-rubric spot-checks (M1) and the silhouette contact-sheet review (M4).
- Mouse-fit preference ratings from mice you've owned — these tune M3's coefficients.
- Account/secret provisioning: Neon, Vercel, Gemini API key, Google OAuth.
- Final real-world acceptance test.

### Gemini 3.8 Flash — two jobs, both narrow
Build-time: classify Logitech's official renders against our rubric (M1). Runtime: write the analysis narrative (M5). Never computes, never ranks.

### Handoff Protocol
One GitHub issue per milestone, written by Claude: scope · acceptance criteria · gate numbers · files to touch · **explicit non-goals**. Codex implements and opens a PR. **Gated milestones must post gate evidence in the PR as numbers, not claims.** Claude reviews against the criteria; merge to `main` auto-deploys.

---

## Architecture

```
BUILD TIME (Blender, bpy 5.2.2 headless)
  8 shape descriptors → procedural shell → subsurf/boolean → GLB (Draco)
  MediaPipe skeleton → skin modifier + subsurf → ONE rigged hand GLB

RUNTIME — Browser (photos never leave the device)
  printed sheet + ArUco → homography → mm/px in the hand's plane
  MediaPipe Hand Landmarker (WASM) → 21 landmarks → real-mm measurements
  three.js: load shell GLB + hand GLB, scale bones to measured lengths, pose, collide
        │ POST derived numbers only — never images
        ▼
  Next.js 15 route handlers on Vercel
    deterministic fit engine (pure TS) → ranked mice + sub-scores
    Gemini 3.8 Flash → narrative only
        ▼
  Neon Postgres (Drizzle) — catalogue + session-scoped scans
```

**Stack:** Next.js 15 (App Router, TS strict) · Drizzle ORM + `@neondatabase/serverless` (HTTP driver — never `pg.Pool` in serverless) · three.js · `@mediapipe/tasks-vision` · `js-aruco2` · Auth.js v5 (Google) · Vitest + Playwright · `bpy` 5.2.2 (Python 3.13).

**Privacy invariant, enforced by architecture:** MediaPipe and ArUco both run in-browser via WASM. Only derived millimetre values are POSTed. The claim is true, so we can state it in the UI.

---

## Blender: verdict and shape of the pipeline

**Viable — use it.** `pip install bpy` ships headless Blender as a Python module (5.2.2, **Python 3.13 only**, ~340 MB wheel, wheels for Windows/Linux/macOS-ARM), with glTF export built in. It buys us four things hand-rolled three.js lofting can't match:

- **Subdivision surfaces** — a genuinely mouse-like shell instead of a faceted loft.
- **Boolean ops** — thumb scoops, button splits, scroll cutouts as real geometry.
- **Decimate + Draco** — clean, web-sized meshes (~100 KB each; 76 models ≈ 8 MB total, small enough to commit and review).
- **Reviewable artifacts** — I can look at a rendered contact sheet and judge whether a G Pro X Superlight actually looks like one. That's the M4 gate.

**The cost is a build step**, and the honest risk is a slow iteration loop. Mitigation: the Blender script is the **single source of truth** — no second runtime implementation to drift — plus a fast preview CLI (`npm run shell:preview -- --model "G Pro X Superlight 2"` renders a PNG in seconds) so rubric tuning stays tight.

**Keep bpy out of the main CI job.** A 340 MB wheel on every push is waste. Generation runs as a separate `workflow_dispatch` job (or locally), and the GLBs are committed. App CI stays fast.

**Known limitation to accept for v1:** pre-baked shells mean no live "what if this mouse were 3 mm shorter" slider. Out of scope; revisit only if the fit engine proves people want it.

---

## Milestones

Gated milestones (**M1, M4**) are hard stops — the next milestone does not start until the gate passes with posted numbers. M2 is not one of them any more: _Revised 2026-10-02 (Kirby), prereg v2, see docs/STATUS.md R2._ It has no pass/fail threshold; it reports judgement correctness (target ≥ 95 %) and retake repeatability.

### M0 — Scaffold
Next.js 15 + TS strict, Drizzle, Vitest, Playwright, ESLint/Prettier. Push to the existing empty `Open_Mouse` repo — **`.gitignore` must contain `Dataset/` in the very first commit; verify before the first push.** Vercel project linked. Neon via the [Vercel Marketplace integration](https://vercel.com/marketplace/neon) → sets `DATABASE_URL` (pooled) + `DATABASE_URL_UNPOOLED` and creates a **DB branch per preview deployment**, so PR migrations never touch production. GitHub Actions: typecheck · lint · unit · migration check · E2E.

**Done when:** empty app deploys green, CI passes, a preview PR provisions its own Neon branch, and `git log -p` contains no dataset bytes.

### M1 — Data layer *(gated)*
- Drizzle schema: `mice` (brand, model, dims, weight, 8 descriptors, connectivity, `source`, `source_url`), `scan_sessions`, `scans`, `scan_measurements`, `fit_results`, `users`.
- Seed the **76 Logitech models** from Logitech's published spec pages, `source_url` per row.
- `docs/shape-rubric.md` — reproducible definition of every descriptor level, e.g. *Hump placement = position of peak shell height as a fraction of length; Center ≤0.55, Back-minimal 0.55–0.62, Back-moderate 0.62–0.70, Back-aggressive >0.70.*
- Apply the rubric to Logitech's official renders via Gemini vision; Kirby spot-checks.
- `scripts/validate-rubric.ts` reads the gitignored CSV from a local path (**never runs in CI**) and reports per-descriptor agreement.

**Gate (revised 2026-09-21 on measured evidence):** gate on the distinctions that
actually drive fit, not on 7-way label precision.

| Metric | Threshold |
|---|---|
| Front flare **direction** (Inward / Flat / Outward) | ≥ 85% |
| Hump **Center vs Back** | ≥ 85% |
| Side curvature **Inward vs Flat** | ≥ 85% |
| Within-one-level on the full scales (all three) | ≥ 90% |
| `Size` (computed, not classified) | ≥ 85% exact — currently 89.5% on Logitech |

*Why revised:* hump placement and front flare have **no numeric proxy** —
height/length medians span only 0.320–0.336 across all four hump levels, and
width/length is equally flat across the seven flare levels. They are purely
visual, so there is no arithmetic fallback. Compounding this, 88% of mice fall
into just three of the seven flare levels, which makes exact 7-way agreement a
poor proxy for whether the rubric is fit for purpose. Miss the gate and the
*rubric* gets revised, never the gate.

### M2 — Calibration + measurement *(no pass/fail gate — Revised 2026-10-02 (Kirby), prereg v2, see docs/STATUS.md R2)*
**The printed sheet** — one design for A4 *and* Letter: put the 4 ArUco markers on a **180 × 180 mm inner square**, which fits both identically. Paper size stops being a variable.

**L-fold design:** lower flap lies flat (top-down plane); upper flap folds up against a book or wall carrying a marker strip in the hand's **midline plane** for the side shot. One print, two calibrated planes.

**Printer scaling is the main accuracy risk** — browsers love "fit to page." Two defences: instructions demand 100%/actual size, and the user also drops **any bank card** in frame (ISO ID-1, exactly 85.60 × 53.98 mm). We detect both; disagreement >1% blocks the scan with *"your printer scaled the page."*

| Shot | Pose | Yields |
|---|---|---|
| Top-down | Hand flat on sheet, fingers together | hand length, palm length, palm width, per-finger lengths |
| Side | Pinky edge on sheet, shot square-on | palm thickness, knuckle height, arch profile |
| Grip | Hand cupped as if on a mouse | natural grip aperture, thumb angle |

**Pipeline:** `js-aruco2` finds markers → homography rectifies the image to the sheet plane in mm (**this also removes perspective distortion** — the real advantage over a bare reference object) → MediaPipe gives 21 landmarks → projected through the homography → millimetres. Manual 4-corner drag fallback when detection fails.

**Parallax correction on the top-down photo** (issue #16): landmarks sit 6–20 mm above the sheet, so mapping them through the sheet homography inflates distances (measured +2.6 mm on a 190 mm hand at 450 mm / 20° tilt, above the ±2 mm accuracy limit this section used to set). The camera pose is recovered from the homography plus the focal length (EXIF `FocalLengthIn35mmFilm`, falling back to a single-view estimate from the homography when tilt ≥ 15°), then each landmark ray is intersected with its own height plane. The per-landmark heights are provisional. They were to be fitted against ruler-measured hands in M2; _Revised 2026-10-02 (Kirby), prereg v2, see docs/STATUS.md R2:_ there is no ruler truth and no ±2 mm limit any more, and this document does not say what replaces that fitting.

**Input is still photos, not a live camera** _(design change, 2026-09-22)_. Three photo slots, one per shot. Each accepts a file from the camera app or the gallery (`<input type="file" accept="image/*">`). **Processing stays in the browser**: the file is decoded locally and never uploaded, so "photos never leave your device" still holds.

Photo-specific handling (a live camera never faced these):
- **EXIF orientation.** Phone photos are often stored sideways, so decode with `createImageBitmap(file, { imageOrientation: "from-image" })` so markers and landmarks share one upright frame.
- **Format.** iOS Safari hands the page a JPEG, but desktop browsers can't decode HEIC. A decode failure must say "export as JPEG", not fail generically.
- **Resolution.** 12–48 MP originals are downscaled to about 3000 px on the long edge before detection. ArUco and MediaPipe must run on the **same** bitmap so their coordinates share a frame.
- **Lens.** Ask for the main 1× camera from about 40–50 cm, sheet filling the frame. Ultra-wide distortion breaks the planar homography; the 16-corner reprojection error is the gate that catches it.
- **Per-photo validation after the fact.** No live guidance, so each photo is checked on upload and rejected with a specific retake reason, and the user replaces just that photo.

**Quality gates per photo:** all 4 markers found · reprojection error under threshold (also the lens-distortion check) · MediaPipe confidence above threshold · hand fully in frame · card/sheet scale agreement · sharpness (Laplacian variance). All local. Gemini vision is only a *fallback* to explain **why** a local gate failed.

**Gate:** _Revised 2026-10-02 (Kirby), prereg v2, see docs/STATUS.md R2._ M2 has no pass/fail threshold. The target is **judgement correctness ≥ 95 %**: the product's accept/retake verdict on a photo agrees with Kirby's blind good/bad label for that photo (photo-quality gates only). Retake repeatability is reported, not a threshold. There is no ruler truth, so no accuracy is claimed. **Depends on Kirby's photos and blind labels.**

Still photos make the M2 report reproducible: Kirby's blind-labelled photo set **is** the input, so a local script replays the full pipeline over those files and prints the judgement-correctness and repeatability numbers directly _(revised 2026-10-02 (Kirby), prereg v2, see docs/STATUS.md R2: no accuracy figure, since there is no ruler truth)_. Like the licensed dataset, the photos live **outside the repo** (where: docs/learning/README.md) and the script never runs in CI, which keeps the privacy promise even for our own test data.

### M3 — Fit engine
Pure TypeScript, zero LLM. Six explainable sub-scores (0–100), each emitting a machine-readable reason:

1. **Length** — `target ≈ hand_length × k(grip)`, k ≈ 0.66 palm / 0.62 claw / 0.58 fingertip.
2. **Grip width** — palm width, adjusted by `Side curvature` (inward curvature effectively narrows the grip).
3. **Height + hump** — target height from palm length and grip; `Hump placement` should land where peak palm contact falls along the shell.
4. **Front flare** — against finger length and splay.
5. **Thumb comfort** — thumb length × `Thumb rest` × side curvature.
6. **Weight** — user-stated preference, informational.

Grip style is both **asked** (users know theirs) and **predicted** from `palm_length / hand_length`; show both, let the user override. Golden-fixture tests lock hand-profile → expected-top-5 so scoring changes show up in diffs.

### M4 — 3D simulation *(gated — the hard one)*

**M4a — Blender generation (Python, build time)**
`tools/blender/gen_shell.py` — `generate_shell(params) → GLB`. Loft cross-sections along the front-to-back axis `u ∈ [0,1]`:
- `topProfile(u)` — peak position from `Hump placement`, sharpness from its modifier.
- `widthProfile(u)` — max width around u ≈ 0.55–0.65; front width modulated by `Front flare` (outward → flared lips, inward → pinched nose).
- `crossSection(u,v)` — superellipse whose lateral bulge follows `Side curvature` (concave / straight / convex sidewalls).
- `Shape: Ergonomic` skews cross-sections and booleans a thumb scoop; `Symmetrical` mirrors. `Thumb rest` / `Ring finger rest` carve scoop and ledge.
- Subsurf → decimate to a web budget → glTF export with Draco.

`tools/blender/gen_hand.py` — build the canonical MediaPipe 21-joint skeleton, apply **Skin modifier + subsurf** to get an organic hand mesh, bind it to an armature, export **one rigged GLB**. Procedural, asset-free, licence-clean.

**M4b — Runtime (three.js)**
Load the shell GLB and the rigged hand GLB. **Scale each bone to the user's measured lengths**, pose by grip style, run capsule-proxy collision against the shell. Contact analysis yields a contact heat map, thumb reach, finger overhang past the front edge, palm contact area, and a wrist-on-pad flag — these feed back into M3's explanations as **observed** rather than inferred fit.

**Gate:** generated bounding box matches spec L/W/H within 0.5 mm · meshes watertight, no self-intersection · contact sheet of all 76 Logitech shells reviewed by Kirby and judged recognisable. Deterministic-camera visual regression tests.

### M5 — Gemini analysis
**`gemini-3.8-flash`** — vision and structured output both supported. Server-side route handlers only; `GEMINI_API_KEY` never reaches the client.

**Hard rule: the LLM never computes.** It receives finished sub-scores, measurements, contact metrics and top-N shells, and returns structured output (fit narrative, why-this-shell, trade-offs, what to avoid). **Add a test asserting no numeral appears in the output that wasn't in the input.**

**Cost — read this before setting budgets.** 3.8 Flash is **$0.75 / $3.75** per 1M in/out on introductory pricing, and **both rates double to $1.50 / $7.50 on 1 January 2027**. That is roughly 15× the input cost of the Flash-Lite tier, so the "cheap" assumption behind picking Gemini needs re-checking at volume:

| | per analysis | 10k analyses/mo |
|---|---|---|
| Intro (through 2026-12-31) | ~$0.011 | ~$110 |
| From 2027-01-01 | ~$0.022 | ~$220 |

Three levers, all of which Codex should build in from the start:
- **Minimise the thinking budget.** Output billing *includes thinking tokens*, and our reasoning is already done deterministically in M3 — the model is writing prose, not solving anything. This is the single largest cost lever.
- **Cache hard** on `hash(rounded measurements + grip style + top-N ids)`. At these rates the cache is a cost control, not just a latency win.
- **Keep the model swappable behind one interface.** If volume grows, `gemini-3.5-flash-lite` ($0.30 / $2.50) is the drop-down tier for the same task. Batch API halves the rate for anything non-interactive.

Per-IP rate limit, capped output tokens, budget alarm, and a **dated reminder for the 2027-01-01 price change**.

M1's one-time rubric classification (76 renders) costs pennies at any of these tiers — pick for accuracy there, not price.

### M6 — Sessions, auth, privacy
- **Anonymous:** `scan_sessions` keyed by an httpOnly **session cookie with no Max-Age** (dies on browser close). Row carries `expires_at = now + 24h`; the hourly GitHub Actions sweep plus the daily Vercel Cron backstop enforce physical deletion independently of the browser (`src/server/scans/retention.ts`). `/results/[scanId]` also offers an explicit, anonymous-only "Delete this scan now" action that calls the same session-delete route on request.
  *UI copy must be honest:* the server cannot observe a browser closing. Since 2026-09-30 (Kirby) the copy is to state no deletion time until the privacy policy (U1) sets one (implemented in #92, not yet merged; its wording awaits Kirby): scans without an account expire automatically, and the user can delete a scan at any time. Never claim deletion is triggered by closing the browser or the tab.
  *(Removed 2026-09-23, issue #42): an automatic `navigator.sendBeacon` call to the session-delete route on `pagehide`. `pagehide` fires on reload and back/forward navigation as well as tab close, so it silently deleted a still-in-use anonymous session the first time the results page was reloaded. It backed no promise this section didn't already keep another way, so removing it changes no guarantee.*
- **Logged in:** Auth.js v5 + Google. Rows gain `user_id`, lose `expires_at`. `/account` offers export and delete-everything.
- Consent copy at upload time; state the "photos never leave your device" claim where it's true.

### M7 — Polish
Mobile-first (users photograph on their phone and upload from it), a11y pass, 3D perf budget on mid-range phones, empty/error states, launch checklist, `/security-review` before any public exposure.

---

## Extending past Logitech

Logitech's 76 is the pilot precisely because they publish full dimensions. Once the rubric clears M1, the same pipeline scales brand by brand from first-party spec pages, each row carrying its `source_url`. The EloShapes CSV stays what it is: a private accuracy check we can run against any new brand, never a source we ship.

---

## Verification

**Gates** (M1 ≥80%/95% agreement · M4 0.5 mm bbox, watertight, silhouette review) are hard stops with evidence posted in the PR. M2 is not one of them any more: _Revised 2026-10-02 (Kirby), prereg v2, see docs/STATUS.md R2._ It has no pass/fail threshold; it reports judgement correctness (target ≥ 95 %) and retake repeatability.

**Test layers Codex owns:**
- **Vitest** — homography math, landmark→mm extraction, all six scorers, shell parameter generation. Everything on the critical path is a pure function; there's no excuse for an untested one.
- **Golden fixtures** — hand-profile→ranking pairs (M3), committed and diffed. Kirby's blind-labelled photo set (M2) is the input of the M2 report, not a fixture in the repo: the photos stay outside it. _(Revised 2026-10-02 (Kirby), prereg v2, see docs/STATUS.md R2.)_
- **Playwright E2E** — full upload → score → render → analysis, uploading fixture photos with `setInputFiles` (no camera stubbing needed) and Gemini stubbed.
- **Visual regression** — fixed camera and seed, pixel-diff the 3D renders.
- **Blender** — `gen_shell` output asserted against spec dims; runs on `workflow_dispatch`, not every push.
- **DB** — migrations verified on the per-PR Neon branch.

**End-to-end acceptance:** on a preview deployment, print the sheet, scan your own hand, and confirm the top-5 contains mice you already know fit you, and the 3D contact map matches where your hand actually touches a mouse you own. That last check is the one that tells us the whole thing works. _(Revised 2026-10-02 (Kirby), prereg v2, see docs/STATUS.md R2: the earlier check that the reported hand length is within 2 mm of a ruler is dropped; there is no ruler truth, so no accuracy is claimed.)_

## Open items
- M3 coefficients start from published sizing guidance and need tuning against real pairings — the more mice you've owned and can rate, the better this gets.
- Side-shot parallax correction is unproven. M2 under prereg v2 has no ruler truth and claims no accuracy, so its photo set cannot prove it; how it would be proven is not decided in this document. _(Revised 2026-10-02 (Kirby), prereg v2, see docs/STATUS.md R2.)_
- The Gemini vision rubric (M1) may need sharpening after the first agreement report.
