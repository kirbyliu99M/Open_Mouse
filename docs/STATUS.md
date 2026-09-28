# STATUS — live project board

**Every PR updates this file — Claude's and Codex's.** It is the single source of
truth for where the project stands. Read it before starting any task.

_Last updated: 2026-09-28 · by: Claude (study fidelity: Phase C built and installed)_

---

## Right now

**Goal (Kirby, 2026-09-23): carry the product through to a genuine, real-world deployment.** The release plan below defines what that means and who does what.

**Merged 2026-09-23:** #25 contracts · #31 credential redaction · #33 results page · #34 fit route · #36 scan submit · #37 analysis infra · #38 24-hour deletion bound · #40 e2e isolation · #41 analysis route · #46 rate-limit only model calls · #47 single-scan delete contract · #48 hotfix for model errors. **The whole user flow is on `main`.**

**Merged 2026-09-24:** #51 analysis quality (stated grip honoured, rounded model input, no internal identifiers) · #45 reload no longer deletes results + single-scan delete + a stale cookie can no longer read or delete a claimed session's scans · #49 journey UI on home, sheet and account + shared top bar · #53 `analysis_cache` rows bound to their scan (cascade delete) + prompt version in the cache key; cache is best-effort.

**Gemini is live in production (key added 2026-09-23).** Analysis now returns `source: model` (≈ 2–3 s), with a working DB cache on repeat requests. Adding the key first broke every analysis with a 500 — the API rejected `ThinkingLevel.MINIMAL`, and a failed call escaped `analyse()`; #48 fixed both.

**Merged 2026-09-24:** #54 contract doc · #55 `/scan` and `/results` match the journey design; audit findings closed · #56 pre-launch hardening (site-wide daily model cap 500 — candidate; per-IP limits on submit/fit; CSP and security headers; hashed rate-limit keys) · #57 contract doc for 429s.

**Merged 2026-09-25:** #58 plain-paper calibration contract (`80ce9cf`). A4/Letter paper-edge evidence is accepted alongside the existing printed-sheet payload; the full paper-edge detector and UI remain separate work. Independent code review found no blocker; CI and Vercel preview passed.

**Production verified 2026-09-25 (`7748c90`):** submit → fit (stated grip honoured) → analysis by Gemini, cached on repeat (0.7 s) → delete → 404; the unmocked live e2e (reload included) passes on Pixel 7; `/`, `/sheet`, `/scan`, `/account`, `/results/demo` load with **zero CSP violations** and no horizontal scroll; CSP, nosniff, Referrer-Policy, Permissions-Policy and HSTS present. **The anonymous flow is operational.**

**Open PRs:** #26 M4a Blender assets (Kirby: keep the textures; review pending).

**In flight — study fidelity (Kirby, 2026-09-28), branch `m4a-study-fidelity`, living doc `tools/blender/STUDY-FIDELITY.md`:** bring the limited-view studies to the 26 AR shells' finish. **Accepted by Kirby:** G903 Hero, M750, G Pro X Superlight 2 SE. **Kept as is:** M705, M325s, M850L. **Removed:** M100's 3D model (it stays in the catalogue, `noShell`). **Phase C (built by Claude while Codex was out of quota, Kirby's decision):** MX Master 4 buttons composited cover-over-body (left ΔE2000 6.02 → 0.72). The black wheels were caused by the DIFFUSE colour pass zeroing metal (wheel 38.3 → 1.48). Missed bake rays are repaired by an outward-only second pass plus a neighbour fill. Every AR shell was re-baked; **20 installed** under an install rule set before the batch, with 0 mm geometry change each; MX Vertical went 8.12 → 0.91. M550-on-M650 candidate built but not delivered (IoU ≥ 0.988 in every view vs the B3 study's 0.932 rear); Kirby chooses. Open: O5 (Superlight 2 + SE together), O6 (high ΔE vs AR on G403, G502 Hero, G203). **Independent Sonnet review in progress; Kirby's visual acceptance pending** (`Mouse Shape Project/模型驗收-2026-09-28/C階段驗收.html`).

**Production 0005 migration: applied 2026-09-24** (Kirby ran it; cache verified). The Neon `neondb_owner` password was rotated by Kirby 2026-09-24; a redeploy picked it up.

**In flight:** live camera capture with on-screen cues (Kirby, 2026-09-25; spec `docs/design/camera-capture-2026-09-25/`, branch `m7-camera-capture`, Sonnet builder).

**Design direction (Kirby, 2026-09-25):** main page with mouse-shape concepts and simple sketch motion, then functional pages, login, and a side menu. The new blank-paper flow and navigation are recorded in `docs/design/product-shell-2026-09-25/`. The older printed-sheet journey and camera spec need copy and flow updates before implementation is considered current.

**Queued:** #52 submit after sign-out joins the previous user's claimed session (blocks enabling sign-in, not the anonymous launch) · M1 rubric revision (gate failed, see Gate results) · `/security-review` · #26 review incl. the M4 bbox gate.

**Blocked — Kirby:** **M2 needs new photos for the blank-paper path.** Needed: five top-down photos on a flat blank A4 or Letter sheet with all four paper edges visible, re-placing the hand between shots; record the chosen paper size and ruler measurements of hand length (wrist crease to middle fingertip) and palm width in `../Fixtures/hands/truth.json` and `../Fixtures/hands/<session>/top-N.jpg`. The paper-edge thresholds in #58 remain candidates until this gate is measured.

---

## Release plan — "genuinely deployable"

### Definition of deployable — _candidate, pending Kirby's confirmation_

A real user, on their own phone, can print the sheet, photograph their hand and get a ranking they can trust — and nothing the product promises is false. All of:

| #   | Criterion                                                                                                       | Evidence                                                                                                       | Owner                                  |
| --- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| R1  | End to end works: sheet → photo → submit → ranking → written analysis — **on `main`; reload bug #42 open**      | Playwright E2E over the whole flow, model stubbed                                                              | Sonnet builders                        |
| R2  | Hand measurement is accurate                                                                                    | **M2 gate:** ±2 mm hand length vs ruler, ±1.5 mm over 5 captures                                               | **Kirby** (photos) → replay script     |
| R3  | Every shipped screen meets `docs/design-guidelines.md`, mobile first                                            | Codex UI audit; findings fixed                                                                                 | Codex (audit) → Sonnet (fixes)         |
| R4  | Every privacy promise is true                                                                                   | photos-never-leave E2E; 24 h expiry tested; export and delete work                                             | enforced today; re-verified at R6      |
| R5  | The analysis is honest                                                                                          | model vs. template prose labelled in the UI; no-new-numerals check                                             | #28, #30                               |
| R6  | Security review passed before public exposure (PLAN §M7) — redaction ✅ #31, rate limits ✅ #41                 | `/security-review`; credential redaction fixed; Production DB vars back to Sensitive; rate limits live         | Claude + reviewer; Kirby (Sensitive)   |
| R7  | Cost controls live (PLAN §M5) — cap, thinking, cache, per-IP limit ✅; dated reminder ✅ #44; budget alarm open | output-token cap, minimal thinking budget, cache, per-IP limit, budget alarm, reminder for the 2027-01-01 rise | #28; **Kirby** (alarm, Google console) |
| R8  | Every served asset is cleared for public serving                                                                | **Decided 2026-09-27: publish** (Logitech trademarks and source 3D models not covered by the project licence)  | **Kirby**                              |

### Not required for the first deployment — _candidate_

- **M4b 3D viewer.** Ranking and analysis stand on their own; the viewer follows once #26 is merged (textures optimised 2026-09-27: 30 mice 6.70 MiB). It needs three.js `DRACOLoader` plus decoder files — the GLBs list `KHR_draco_mesh_compression` as required.
- **M1 descriptor gate.** First live run (2026-09-23, 30 models, gemini-3.8-flash) **failed** on flare and curvature, so its output was kept out of the seed (saved outside the repo in `../Fixtures/m1-run-2026-09-23/`). Hump, flare and curvature stay unclassified and those sub-scores use a neutral prior (`UNKNOWN_PRIOR_SCORE = 75`), so rankings lean on dimensions. Deployable but weaker: either ship saying so, or wait for the key.
- **M3 coefficients** stay provisional (`fit-v0-provisional`) until tuned against mice Kirby owns. The analysis already states this.

### Phases and agent distribution

| Phase         | Work                                                                                                                                                | Agents                                               | Status       |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------ |
| 1 Integration | #27 fit route · #28 analysis infra · #29 scan submit · #30 results page                                                                             | 4 Sonnet builders, parallel                          | 🏗 in flight  |
| 1 Assets      | #26 Blender pipeline + 31 GLBs                                                                                                                      | Codex (built) · Sonnet reviewer (incl. M4 bbox gate) | 🔍 in review |
| 1 UI audit    | design-guidelines audit of every screen                                                                                                             | Codex (independent reviewer)                         | 🏗 in flight  |
| 1 Security    | credential redaction in migration errors                                                                                                            | Sonnet builder                                       | 🏗 in flight  |
| 2 Wire-up     | analysis route (needs #27 + #28) · full-flow E2E · UI-audit fixes                                                                                   | Sonnet builders                                      | ⬜           |
| 3 Hardening   | `/security-review` · Production vars Sensitive · budget alarm · mobile/a11y pass · error and empty states · launch checklist · texture optimisation | Claude + reviewers · Codex (textures) · Kirby        | ⬜           |
| 4 Acceptance  | M2 gate on ground-truth photos · real-phone run on production · final acceptance                                                                    | **Kirby**                                            | ⬜           |

### Only Kirby can supply

1. Ground-truth hand photos in `../Fixtures/hands/`, with ruler measurements → R2
2. Gemini API key → model-written analysis (R5) and the M1 gate
3. ~~A decision on the photo-derived shell textures → R8~~ — decided 2026-09-27: publish
4. Production DB variables back to Sensitive, or permission for the API call that does it → R6
5. Google OAuth credentials → sign-in. _Optional for launch: the anonymous flow works without it._
6. Final acceptance on a real phone

### Other open items

- ~~Production migrate + seed~~ and ~~Neon two-branch setup~~ — done 2026-09-23 (see Decisions log).
- **Convention question:** `@auth/drizzle-adapter: ^1.11.3` and `next-auth: ^5.0.0-beta.32` are the only caret-ranged dependencies; everything else is pinned. A caret on a beta floats across beta releases.

---

## Milestone board

| #   | Milestone                          | Gated | Status              | PR                                                     | Notes                                                                                                                   |
| --- | ---------------------------------- | ----- | ------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| M0  | Scaffold                           | –     | ✅ merged           | [#3](https://github.com/kirbyliu99M/Open_Mouse/pull/3) | merged to `main` as `f5d9814`                                                                                           |
| M1  | Data layer + shape rubric          | ✅    | 🔍 in review        | #4 #5 #8                                               | schema, 38-model seed (30 + 8 owner-approved 2026-09-27), classifier built (fake-tested); gate run needs the Gemini key |
| M2  | Calibration + measurement          | ✅    | 🔍 in review        | #9 #18 #19 #23                                         | A sheet+geometry, B API+photo pipeline, C parallax; ground-truth photos still needed for the gate                       |
| M3  | Fit engine                         | –     | 🔍 in review        | #12 #21 #22                                            | contract, engine and results UI built; coefficients still need real pairings                                            |
| M4  | 3D simulation (Blender + three.js) | ✅    | ⬜                  | –                                                      | M4a Blender → Codex, issue #7                                                                                           |
| M5  | Gemini analysis                    | –     | 🏗 changes requested | #20                                                    | re-review found two hard-rule-2 bypasses in the numeral check; fix in flight                                            |
| M6  | Sessions, auth, privacy            | –     | 🔍 in review        | #24                                                    | reviewed: approve with nits (no-store header, `isAuthConfigured`, app-wide `auth()` call)                               |
| M7  | Polish + security review           | –     | ⬜                  | –                                                      | before any public exposure                                                                                              |

Status key: 🔜 ready · 🏗 in progress · 🔍 in review · ✅ merged · ⛔ gate failed · ⬜ not started

---

## M0 verification

- Local: typecheck, ESLint, Prettier, migration history check, and production build pass.
- GitHub push CI at `4d833e3`: **87 seconds**, all checks passed ([run](https://github.com/kirbyliu99M/Open_Mouse/actions/runs/35580912792)). PR CI at `7881529`, including `vercel-build`: **81 seconds**, all checks passed ([run](https://github.com/kirbyliu99M/Open_Mouse/actions/runs/35581171147)).
- Vitest: **16/16 passed** (configuration validation, credential-safe errors, preview endpoint guard).
- Playwright: **2/2 passed** (desktop and mobile Chromium; HTTP 200, visible heading, no browser errors or horizontal overflow).
- Production dependencies: **0 npm audit findings**. Drizzle Kit's development-only legacy esbuild chain has 4 moderate findings; no forced major downgrade or migration-tool replacement was made.
- Neon: `open-mouse-db`, Free plan, `iad1`, project `rapid-salad-00847873`. Separate preview branch and applied migration still need live evidence.
- Current Preview and Production variables resolve to the **same endpoint**. A read-only production query confirmed `public.scaffold_checks` is absent. The preview build stops before SQL; enabling Marketplace preview branching is the remaining account configuration step. The extra `open-mouse-4awb` project remains linked to the repo and reports its own failed preview check without database configuration; Kirby selected `open-mouse` as the primary project.
- Vercel: the existing `main` deployment is Ready but predates the Next.js scaffold. The scaffold's production deployment requires Claude's review and merge.
- Runtime dependency override: PostCSS 8.5.28 fixes the audit findings in Next.js 15's pinned dependency without changing the requested Next.js major.
- First Vercel preview exposed a CommonJS/ESM import mismatch in the migration entry point; corrected to the package's default import. CI now runs `vercel-build` to cover that entry point too. Local `vercel-build` passes; a synthetic production-endpoint preview exits before any database request.
- Repository history plus staged diff: **0 licensed-data paths, 0 CSV row patterns, 0 known credential values** found. The dataset was not read or moved for M0.

## Gate results

Fill in with **measured numbers** as each gate is attempted. Record failures too —
a failed attempt is information, not something to overwrite.

| Gate                              | Target                              | Measured                              | Date       | Verdict |
| --------------------------------- | ----------------------------------- | ------------------------------------- | ---------- | ------- |
| M1 flare direction                | ≥ 85% (Inward/Flat/Outward)         | **72.4%** (n=29)                      | 2026-09-23 | ⛔ fail |
| M1 hump Center-vs-Back            | ≥ 85%                               | **85.2%** (n=27)                      | 2026-09-23 | ✅ pass |
| M1 side curvature Inward-vs-Flat  | ≥ 85%                               | **25.0%** (n=8)                       | 2026-09-23 | ⛔ fail |
| M1 within-one-level (all three)   | ≥ 90%                               | hump 100% · flare 86.2% · curve 62.5% | 2026-09-23 | ⛔ fail |
| M1 computed Size                  | ≥ 85% exact                         | **89.5%** (Logitech, n=76)            | 2026-09-21 | ✅ pass |
| M1 Size from **first-party** dims | ≥ 85% exact                         | **90.0%** (27/30, current lineup)     | 2026-09-21 | ✅ pass |
| M2 repeatability                  | ≤ ±1.5 mm over 5 captures           | –                                     | –          | –       |
| M2 accuracy                       | ≤ ±2 mm hand length vs ruler        | –                                     | –          | –       |
| M4 bbox fidelity                  | ≤ 0.5 mm vs spec L/W/H              | –                                     | –          | –       |
| M4 watertight                     | no holes, no self-intersection      | –                                     | –          | –       |
| M4 silhouette review              | Kirby judges 76 shells recognisable | –                                     | –          | –       |

---

## Decisions log

Append; don't rewrite. Each entry: what, why, when.

| Date       | Decision                                                                                              | Why                                                                                                                                              |
| ---------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-09-21 | EloShapes CSV is a private fixture, never shipped                                                     | Their ToS forbids redistribution; their shape judgments are the protected part                                                                   |
| 2026-09-21 | Catalogue seeded from Logitech's published specs                                                      | Raw dimensions are unprotectable facts; Logitech publishes them                                                                                  |
| 2026-09-21 | Printed L-fold sheet + ArUco for scale                                                                | Homography also removes perspective distortion, not just scale                                                                                   |
| 2026-09-21 | Markers on a 180×180 mm inner square                                                                  | Identical on A4 and Letter — paper size stops being a variable                                                                                   |
| 2026-09-21 | Bank card in frame as cross-check                                                                     | Catches printers that silently scale the page                                                                                                    |
| 2026-09-21 | Blender (bpy 5.2.2) as build-time pre-modeling                                                        | Subsurf + booleans + Draco; reviewable artifacts; keeps runtime cheap                                                                            |
| 2026-09-21 | Hand mesh generated in Blender, not MANO                                                              | MANO is research-licence only — unusable for anything public                                                                                     |
| 2026-09-21 | `gemini-3.8-flash`                                                                                    | Kirby's call; cost levers documented in PLAN M5                                                                                                  |
| 2026-09-21 | Repo is a **sibling** of `Dataset/`, not its parent                                                   | Makes committing licensed data structurally impossible, not merely forbidden                                                                     |
| 2026-09-21 | `Size` is computed, not classified: `L + 0.4*(W-64)`                                                  | Measured 91.5% exact / 99.8% within-one on n=1260; removes a descriptor from the vision task                                                     |
| 2026-09-21 | M1 gate rebased on direction + within-one-level                                                       | Hump and flare have no numeric proxy, and 88% of mice sit in 3 of 7 flare levels — exact 7-way agreement is a poor proxy for fitness for purpose |
| 2026-09-21 | **Backend moves from Codex to Claude**; Codex owns frontend + 3D                                      | Kirby's call. Split, directory ownership and cross-review rules in `AGENTS.md`                                                                   |
| 2026-09-21 | Cross-review: Claude reviews Codex, Codex reviews Claude, Kirby merges                                | With Claude now writing code, nobody may approve their own work                                                                                  |
| 2026-09-21 | `src/lib/contracts/` is the only frontend/backend seam                                                | Lets both halves build in parallel against one runtime-validated shape                                                                           |
| 2026-09-21 | Migration errors are redacted, not suppressed                                                         | M0 review: the generic message hid real SQL failures. `describeMigrationError` keeps Postgres detail, strips URLs and credentials                |
| 2026-09-21 | M0 uses Node 24, the latest Next.js 15 patch, and versioned Drizzle migrations applied over Neon HTTP | Matches the milestone and existing Vercel runtime; no persistent connection pool                                                                 |
| 2026-09-21 | Preview builds apply migrations; production migrations are explicit                                   | Preview database isolation must be configured through Marketplace before deployment can pass                                                     |
| 2026-09-21 | Issue #1's secret criterion is interpreted as no credential values in code                            | Environment variable names must be referenced to read server configuration; Gemini has no implementation in M0                                   |

| 2026-09-21 | Descriptor levels stored as slugs (`back_minimal`), labels in `src/lib/contracts/descriptors.ts` | One vocabulary drives DB enums, classifier schema, validator and UI |
| 2026-09-21 | Rubric §2 rules enforced twice: `checkConsistency()` and DB `CHECK` constraints | Code explains a violation; the DB guarantees none is stored. Null never violates |
| 2026-09-21 | Scan data cascades from `scan_sessions` | The M6 expiry sweep is a single DELETE |
| 2026-09-21 | **M1 seed scope cut from 76 to the 30-model current lineup (option C)**; issue #2 amended | Kirby's call: cheapest path, and the gate stays meaningful. Older models later. Computed Size re-measured on the 30: 90.0% |
| 2026-09-21 | Per-storefront axis conventions for Logitech specs | logitech.com labels length "Height" and height "Depth"; label mapping silently swapped them. Guarded by `dimensionWarnings` + a CI test over the seed file |
| 2026-09-21 | Preview builds migrate **and seed** their own Neon branch | Every PR preview has a real catalogue; production seeding stays explicit (`npm run db:seed`) |
| 2026-09-21 | Each agent works in its own git worktree | Two agents shared one checkout; one agent's uncommitted notes were committed by another |
| 2026-09-21 | **Codex narrowed to Blender (M4a); Sonnet subagents build backend + frontend; a separate Sonnet subagent reviews** | Kirby's call — Codex token cost. Claude orchestrates and adjudicates |
| 2026-09-21 | Contract v1: marker layout is 180 mm _outer_ extent (25 mm markers, centres on 155 mm) | Centres on 180 mm with 30 mm markers spanned 210 mm = A4 width, leaving no printer margin |
| 2026-09-21 | Browser sends raw landmark distances under a versioned measurement model | Landmarks are joint centres (palm width reads 10–20 mm low); correction is fitted to ruler ground truth in M2, not guessed client-side |
| 2026-09-21 | `weight_g` gets a positivity CHECK | Reviewer finding: dimensions were guarded but weight was not |
| 2026-09-21 | Each worktree runs its own `npm ci`; `node_modules` is never shared | npm reconciles a whole folder against its own branch's lockfile, so a shared one is silently rewritten by the last installer |
| 2026-09-21 | Classifier uses product images only, never lifestyle shots | Review finding: fewer images beat misleading ones for the visual descriptors M1 hinges on |
| 2026-09-21 | Descriptors file is authoritative for the models it contains | Review finding: COALESCE let a stale wrong value survive a later needsReview. Models absent from the file keep their stored values |
| 2026-09-21 | Partial-view classifications are allowed but annotated | Classifying from one available view beats discarding evidence; the note lets misses be audited against it |
| 2026-09-21 | Classification checkpoints after every model | The real run spends Kirby's key; a crash midway must not lose completed work |
| 2026-09-21 | Printed sheet verified by real PDF render: exactly 1 page on A4 and Letter, SVG exactly 210 mm | Review finding: a global CSS margin rendered it as 3 pages at 79% scale; geometry-only tests could not see it |
| 2026-09-22 | **Input is still photos (upload), not a live camera**; still processed in the browser | Kirby's call. Simpler flow; fixtures become replayable files. Adds EXIF orientation, HEIC and lens-distortion handling |
| 2026-09-22 | Ground-truth hand photos live outside the repo (`../Fixtures/hands/`); the gate replay script never runs in CI | Same privacy promise as the product; same pattern as the licensed dataset |
| 2026-09-22 | UI/UX standard: Apple design principles, applied per screen in `docs/design-guidelines.md` | Kirby's call. Frontend PRs are reviewed against its checklist |
| 2026-09-22 | **Parallax correction applies to the top-down photo**, via camera pose from the marker homography + EXIF focal length (homography-estimated focal as fallback) | Landmarks sit above the sheet; measured +2.6 mm on a 190 mm hand (450 mm, 20° tilt), which alone fails the ±2 mm gate. Corrected to 0.03 mm under realistic noise (#23). An earlier estimate of ~5.5 mm was too high |
| 2026-09-22 | Side and grip photos deferred | Fit engine v0 consumes only top-down measurements; revisit once M2 gate data shows whether thickness improves rankings |
| 2026-09-22 | Builders run wide in parallel (up to six), all Sonnet, each on an issue-as-spec | Kirby's call: maximise Sonnet use; Claude writes contracts/specs and adjudicates |
| 2026-09-22 | Expiry = lazy sweep on each scan write + expired-means-gone on reads + daily cron backstop | Vercel Hobby allows only daily cron; a daily-only sweep would let anonymous data live ~48 h and break the 24 h promise (#18, amended #17) |
| 2026-09-22 | Neon Free branch cap limits concurrent PR previews; reviewed PRs give up their preview branch | Preview builds for #19 #21 #22 #23 failed with "Branch limit reached" |
| 2026-09-22 | Preview deployments stay SSO-protected; builders never change project security settings | A builder correctly refused to enable Protection Bypass for Automation; that is Kirby's decision |
| 2026-09-22 | A PR's `push` CI passing does **not** mean the PR is green; the `pull_request` run builds the merge with the base | #20 was green on push and red on `pull_request` at the same SHA: `contracts-fit` had widened the `excluded[]` contract with `brand`/`model`, which only breaks once the base is merged in. Read the `pull_request` run |
| 2026-09-22 | The numeral check exempts digit runs inside tokens that appear verbatim in the input, and checks every other digit run | Re-review of #20 found `"about68mm"` produces **zero** regex matches — an invented number passing unchecked. The lookbehind that caused it exists to protect product names like `G502`, which was recorded nowhere. Both cases now have tests |
| 2026-09-22 | Nits are adjudicated, not auto-applied, once a PR has been reviewed | Code the orchestrator writes after review is unreviewed code in a PR the orchestrator then merges — the thing "nobody approves their own work" exists to prevent. Nits go back to a builder |
| 2026-09-22 | The numeral check's exemption draws from `brand`/`model` only, never slugs or IDs | `slugify` lowercases, so a slug always put the lowercase digit run in the exempt set and silently neutralised the case-sensitive match. Fix the source, not the matcher |
| 2026-09-22 | Ordinal carve-out requires a determiner before **and** a non-`of` word after | The earlier "either/or" form leaked both ways: determiner-only ignored a following `of`, and the noun rule reached across sentence boundaries |
| 2026-09-22 | On hard rules, prefer the stricter rule: false positives cost a retry, false negatives reach the user | Four rounds of clever narrow fixes each opened a new hole. A monotonically stricter change cannot introduce a false negative |
| 2026-09-22 | A branch is merged with `main` locally and fully verified before the PR is merged | #20 was green on `push` and red on `pull_request` at one SHA; two branches conflicted in `package.json` where both added a dependency |
| 2026-09-23 | Neon integration connected to Production only; Preview DB vars set by hand to one shared `Preview` branch | The Neon Free plan caps branches at 10, and per-deployment branches outlive their PRs until Vercel deletes the deployment. The deployment-action toggle has no API, but connecting without `preview` removes the action entirely |
| 2026-09-23 | **Codex may take assigned tasks beyond Blender** | Kirby's call. First two: publishing its own Blender work (#26) and an independent UI design audit — independent because Sonnet builders wrote the frontend |
| 2026-09-23 | A Codex task that needs `git push` is launched by Kirby, not by Claude | The agent permission classifier blocks Claude from starting an external agent with push access. Otherwise Codex judges and Claude runs git |
| 2026-09-23 | Analysis `source` is reported by the code path taken, never inferred from whether a key is set | A keyed call can fail and fall back; inferring from the key would label template text as model prose (#25 review) |
| 2026-09-23 | Only model-written analyses are cached | The fallback is deterministic and free to recompute; caching it would keep serving template text after a transient model failure clears |
| 2026-09-23 | Contract error bodies are tested against the shipped route | The first draft of `errorResponseSchema` rejected what `POST /api/scans` already returns; a reviewer caught it by reading both files. Now CI does |
| 2026-09-23 | **At most three agents run at once** (revised from five the same day), and the orchestrator commits and pushes any uncommitted work the moment an agent stops | Eight parallel agents exhausted the account's session limit together; so did five, a few hours later. One builder had 17 files uncommitted, another had temporarily reverted its own fix to prove a test red. Nothing was lost: each worktree was inspected, WIP-committed and pushed before resuming |
| 2026-09-23 | **Remove the automatic pagehide deletion; deleting now is an explicit user action** | `pagehide` cannot tell closing a browser from reloading a page, so the beacon deleted anonymous results on refresh. It backed no remaining promise: since #38 the copy says deletion within 24 hours of creation, enforced by TTL + sweep. Guarantees are unchanged; immediate deletion becomes the user's choice |
| 2026-09-23 | **Every critical flow needs one test with nothing mocked between the browser and the database** | The reload bug shipped past 774 green tests because each test stubbed the exact seam where it lived. Mocked seams test each side against the contract, not that the sides work together |
| 2026-09-23 | UI design decisions are drawn on the pen.dev canvas before builders implement them | Kirby's suggestion. The journey (`docs/design/journey-2026-09-23/`) settles audit findings that span screens, so separate builders do not each invent their own navigation |
| 2026-09-24 | `analysis_cache` rows are bound to their scan (`scan_id` FK, `ON DELETE CASCADE`), not given their own TTL | Every existing scan-deletion path (24 h sweep, "Delete this scan now", account deletion) then removes the prose inside the same proven bound. Cross-scan hits are given up: they needed identical 1 mm measurements and let one scan's prose reach another. |
| 2026-09-24 | The cache is best-effort: a read error is a miss, a write error is skipped; deploy code before migrating | The neon-http migrator has no transactions, and code and schema briefly disagree during every deploy. A cache must never turn that into a 500. 0005 is one atomic `DO` block so it can re-run. |
| 2026-09-24 | The scan-session cookie proves ownership of an **anonymous** session only (`user_id IS NULL`), in the shared find/delete predicate | The #45 review showed a cookie left after sign-out could delete the account's scans. The contract already said ownership follows the user once claimed. |
| 2026-09-24 | M1 descriptors from the first live run stay out of the seed | Gate failed (flare 72.4%, curvature 25.0%). Rule 4: revise the rubric, not the gate. Shape sub-scores stay "Shape not rated yet" and the UI says the total leans on size. |
| 2026-09-25 | Production DB env vars stay non-Sensitive in Vercel (known risk, accepted by Kirby) | The Neon integration offers no Sensitive toggle; Hobby project with Kirby as the only member. Password rotated 2026-09-24 after it had been pasted into a conversation. |
| 2026-09-25 | The camera flow borrows TONALITE's documented principles, not its screens | Public reviews describe its step-by-step flow and QR-sticker fiducials but not the capture UI; our ArUco markers play the stickers' role. |
| 2026-09-27 | **Catalogue grows 30 → 38**: M750, M325s, Mobi Fold, M850L, M840L, MX Ergo S, ERGO M575S, G903 Hero | Kirby's call, from a PChome Taiwan shelf check plus a first-party spec read. Descriptors pending; the dated Size-gate figure (27/30) covers only the original 30 — the 8 new rows are unmeasured |
| 2026-09-27 | **R8: Blender assets are published** (open-source project); **no medical claims** anywhere | Kirby's call. Logitech trademarks and source 3D models are not covered by the project licence — note it in the asset README |
| 2026-09-27 | **New-mouse shells**: Mobi Fold, M840L and MX Ergo S get no shell (`NO_SHELL`); ERGO M575S aliases the ERGO M575 shell; oblique-photo studies get a flat base, with the resulting boxy lower edge accepted for now | Kirby: drop Mobi Fold and M840L, fix the rest, "fine for now". Only folded, front-oblique or no top photos exist for the three. The M575S alias rests on identical published dimensions — shape not independently verified |
| 2026-09-28 | **Study fidelity:** all eight studies target the AR shells' finish. G903 Hero and M750 use the full AR pipeline, calibrated per axis despite 2.9% / 3.3% source-scale spread. SE uses the Superlight 2 shell recoloured from SE photos. M550 is the photo-bake prototype. M100 keeps the sheared trace. Codex runs on `gpt-6-astra` | Kirby's calls, recorded in `tools/blender/STUDY-FIDELITY.md` Decisions. Official AR GLBs were found for G903 and M750 only, after 181 rate-limited requests |
---

## Risks

**Cached analysis prose outlives the scan it came from — live since the key was added.** `analysis_cache` stores model-written prose keyed by a hash of rounded measurements and the top three mice. It has no scan or session id, so deleting a scan — or the 24-hour sweep — does not remove it, and the prose may quote the measurements. It cannot be traced to a person without already knowing their measurements. **It began filling on 2026-09-23** when `GEMINI_API_KEY` went live; a retention limit is queued behind #45 (raised by Codex's review of #47).

**Credential redaction: two known limitations after #31 (accepted, follow-up queued).** Both found by the fourth review pass; neither is reachable with any variable this project uses. (1) A key with an unbroken run of more than 64 characters on either side of the credential word is not matched at all — the cost of bounding the pattern to make it linear. (2) A quoted `Bearer` token containing an internal space leaks the part after the space. Every form that leaked in any review round — 11 in all — is redacted on `main`, and a 1 MB adversarial input takes under 10 ms.

**Anonymous results vanish on reload (found 2026-09-23 in production; fix in flight, #42).** `BeaconOnUnload` in the root layout sends a session-delete beacon on every `pagehide`, and `pagehide` fires on reload, back/forward and full navigation as well as on tab close. Reproduced in a real browser against production: fit 200, one reload, fit 404; production logs show `POST /api/scans/session` between every submit and fit. **No test caught it because every test mocked the seam it lives on** — the results-page e2e stubs the backend, the scan-submit e2e stubs `/api/scans`. The fix removes the beacon, adds an explicit delete action, and adds a regression test with nothing mocked between browser and database.

**Credential redaction leaks quoted secrets (P1, open since 2026-09-21).** Codex's M0 review reported that `describeMigrationError` lets quoted credentials through. It was never fixed. Re-tested 2026-09-23 against `main`: of seven forms, **five leak the full secret** — `password="…"`, `password='…'`, `{"password":"…"}`, escaped quotes, and `PGPASSWORD=…`. This code runs in every preview build, so a failing migration could write the database password into Vercel build logs. Fix in flight; blocks R6.

**Shell textures are derived from product photos.** Before 2026-09-27, 98% of the 118 MB of GLBs in #26 (115 MB) was embedded PNG textures; the optimised build is 6.86 MiB of 512 px JPEG-textured GLBs, reconstructed from product images. The 2026-09-21 decision to seed from Logitech's published specs covers _dimensions_ — facts — not images. Merging #26 serves them publicly from `/models/`. Kirby decided R8 on 2026-09-27: publish (open-source project); the rights caveat above stands. Dropping the textures would also remove ~98% of the download, which M7's phone budget needs anyway.

**M1 is the riskiest gate in the project.** Analysis of the validation fixture
shows `Hump placement` and `Front flare` have **no numeric proxy**: height/length
medians across all four hump levels sit within 0.320–0.336, and width/length
across the seven flare levels is equally flat. These are genuinely visual
editorial judgments, so if the vision rubric underperforms there is no arithmetic
fallback.

Two consequences:

- The original gate (≥80% exact on a 7-level flare scale) was too ambitious.
  **Resolved 2026-09-21:** the gate now measures flare/hump _direction_ plus
  within-one-level agreement — see PLAN §M1.
- `Size` was the opposite case and is now **computed, not classified**
  (89.5% exact on Logitech). One fewer descriptor for vision to get wrong.

**Vertical mice break length-based sizing.** Lift Vertical (108 mm long, 71 mm
tall) is the only two-level Size miss on Logitech. Treat `Height/Length > 0.55`
as its own form factor; M3 must not score it with the horizontal length model.

**M2 depends on a human.** The accuracy gate cannot be attempted until Kirby
shoots the ground-truth fixture set.

**M3 coefficients are unvalidated.** They start from published sizing guidance and
stay provisional until tested against mice Kirby has actually owned and rated.

---

## Open questions

| #   | Question                                                         | Owner | Status                                                 |
| --- | ---------------------------------------------------------------- | ----- | ------------------------------------------------------ |
| 1   | ~~Revise the M1 gate to direction + within-one-level?~~          | Kirby | ✅ resolved 2026-09-21 — yes; gate updated in PLAN §M1 |
| 2   | Which Logitech models does Kirby own and can rate for M3 tuning? | Kirby | ⏳ open                                                |

---

## Glossary

- **Descriptor** — one of the 8 shape fields (Shape, Hump placement, Front flare,
  Side curvature, Thumb rest, Ring finger rest, Size, Hand compatibility).
- **Gate** — a numeric threshold that must pass before the next milestone starts.
- **Fixture** — the private EloShapes CSV at `../Dataset/`, used to validate our
  rubric. Never shipped, never committed.
- **Shell** — a procedurally generated mouse body mesh.
