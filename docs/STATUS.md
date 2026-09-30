# STATUS — live project board

**Claude updates this file after merges, through small docs-only PRs; builders and
Codex never edit it** (2026-09-30 — parallel branches kept colliding here). It is the single
source of truth for where the project stands. Read it before starting any task.

_Last updated: 2026-09-30 · by: Claude (#82 and #89 merged; Kirby's copy, deletion and G9 decisions)_

---

## Right now

**Launch plan (Kirby, 2026-09-30):** the work sequence is approved, as set out in the PRD doc "Open_Mouse PRD 與上市缺口評估" (claude.ai) and the plan written from it.

- Two builder lanes roll by file owner: UI (Builder 1) and system (Builder 2).
- The **real-hand-photo ML (M2 calibration) is the last job**. Until M2 passes the site is not promoted and not indexed (`noindex`, Early preview); the URL itself is reachable.
- Taiwan launches first, with zh-TW as the default language.

The reasons for each call are in the 2026-09-30 decisions below.

**Work codes** used below come from the 2026-09-30 plan (kept in Kirby's and Claude's workspace, not in this repo):

- **S** and **U**: UI-lane items (Builder 1).
- **G**: system-lane items (Builder 2).
- **C**: Claude's contract PRs.
- **F**: PRD fix items.
- **W7**: the real-hand-photo ML phase, which is the last engineering job.
- **W8**: launch (public Beta, then general availability).

**Production:** behaves as of `3a585a3` (#82). The latest deploy is `9cf0612` (#89), which adds data that nothing reads yet.

- **Anonymous flow:** operational. Claude ran the unmocked live e2e (reload included) locally after each 2026-09-30 merge. The latest run passed against `9cf0612`. Command: `BASE_URL=https://open-mouse.vercel.app npx playwright test -c playwright.live.config.ts`. Result: `[mobile] reload-keeps-results.spec.ts`, 1 passed in 13.3 s. In production `/results/demo` and every dev-only demo route return 404.
- **Every merge:** followed by a local `npm run test:e2e:live` against production. We run it locally rather than through `live-e2e.yml`.
- **Kirby's phone test** of #77 (right and left hand) is still pending.

**Merged 2026-09-28:**

- #59 paper-edge detection
- #65 cache-key hotfix
- #66 live camera capture
- #67 easy scan and new landing
- #68 typed-length contract
- #70 no medical claims
- #71 catalogue 30 → 38
- #72 honest fallback

**Merged 2026-09-30:**

- **#77:** palm-down photos no longer read as the other hand, and an "auto" hand chip no longer fails the scan.
- **#78:** CI now runs only on pushes to `main` and on non-draft PRs. A docs-only PR skips the heavy steps. A push to `main` always runs the lightweight gate (≈ 90 s), and a ready PR runs the full gate with e2e. `SECURITY.md` and Dependabot security-only config are added.
- **#80 (C1):** contracts for the `trackball_form_factor` exclusion reason, per-descriptor label maps, the `thumb_rest_missing` reason, and `hand` in the fit response (#62).
- **#69:** no-paper scan and device routing (desktop QR hand-off, in-app browser notice).
  - The typed-length entry sits behind `NEXT_PUBLIC_TYPED_HAND_LENGTH_ENTRY` (off) until W7 measures its thresholds.
  - Its input range, 135–265 mm, is derived from schema limits and is a candidate.
  - Merged before Kirby confirmed its new wording, which is marked candidate in the PR: the desktop privacy line "Your photo never leaves this device. Only measurements are sent." and the device-routing strings listed there. They are on Kirby's copy list below.
- **#90 (G1b):** tests only. They pin #78's CI rules. The PR reports 28 mutants, all killed by the new tests. An independent verifier ran 26 mutants against the PR head `17c45a5` and all were killed (reported to Claude on 2026-09-30, not on GitHub). It left two low-severity follow-ups. Extra keys on the migration step (`shell:`, `working-directory:`) still pass the tests, so the step's keys should be pinned. The link-cleanup helper should also confirm a link is gone before the recursive delete.
- **#74 (S2):** one hand decision for all three pipelines (`handExplicit`; only a hand the user chose can trigger a mismatch).
  - The results page's left-hand note reads the fit response's `hand`. Old browser-storage hand keys are swept.
  - Every re-scan link goes to `/scan/easy`, and raw server errors reach the console only.
  - Dark-mode contrast is fixed on the retake sheet's hand chip and on the selected grip chip. The hand chip has an accessible name instead of `aria-pressed`.
  - The `/scan/easy` placeholder now takes its colour from a server-side user-agent hint, so it no longer flashes. As a result `/scan/easy` is rendered per request and no longer cached by the CDN.
  - Merged before Kirby approved two strings it adds: the "…or tap the hand button below." hint and the hand-chip accessible names. Both are on Kirby's copy list below.

- **#82 (G2):** the home page now says mice are scored on "length, grip width and height" (weight was never scored), and `/results/demo` returns 404 in production. A demo-route test is now opt-out: every `page.tsx` outside a pinned product list must call the production guard first. The AI-source disclosure was dropped for now (Kirby: add it later).
- **#89 (G9a):** first-party facts (hand compatibility, shape, form factor) for the 38 Logitech mice, as data only; nothing reads it until G9b. M750's shape is `symmetrical`, following M550 (Kirby). Kirby spot-checks the ⚠ models before G9b.

#77 was reviewed by the `pr-review` workflow; its test-coverage follow-ups moved to S2 (#74).

**Open work:**

- **#85 (C2)** — contracts for accepted measurement-model versions, plus calibration evidence stored with each scan (#63). Migration 0006 must run in production before the code deploys.
- A branch created before #78 still carries the old `ci.yml`, and a `push` event uses the pushed commit's file. **Merge `main` into such a branch before pushing to it.**
- **#86 (G4)** — scoring and copy logic: Chinese numerals in the no-new-numerals check, a Chinese provisional check, Chinese medical terms, the `weight_in_range` parameters and `thumb_rest_missing`. Draft, through four review rounds with adversarial probing. It waits for Kirby's review of three results-page strings. Remaining Chinese false positives and negatives become G4b, measured on a labelled corpus before i18n PR3.
- **#84 (G6)** — NOTICE, README, CONTRIBUTING, issue and PR templates, MediaPipe caching headers, non-SIMD fallback (+≈ 10.7 MB per deployment). Verified; it waits for Kirby's copy approval and for private vulnerability reporting to be switched on.
- **#76** — learning kit with data format v2 (G3). Draft, in final verification. Kirby collects the learning photos in person, so every kit page returns 404 in production and runs only on the local dev server that `npm run learn:sort` starts.
- **#93 (G8)** — M2 evaluator (`npm run m2:evaluate`), stacked on #76. Review fixes in progress.
- **#92 (S3)** — audit P1 fixes: detector download progress and a visible load-failure notice, landmarks and titles, dark-mode analysis card, axe on the main pages and phone states. It also carries the no-time deletion wording. Draft in verification; new copy awaits Kirby.
- **#94 (G5a)** — error and 404 pages, `GET /api/health`, structured server logs with redaction. Draft in review; error-page copy awaits Kirby.
- **#95** — Vercel builds previews only for ready PRs (`ignoreCommand`), after 406 deployments in 9 days nearly filled the account's deployment storage. The same day, 327 old preview, failed and cancelled deployments were deleted. The current production deployment, earlier production deployments and each open PR's latest preview were kept.
- **#75** — UI/UX audit (draft). The corrections to findings 3 and 5 are pushed (`cda0957`).
- **3D assets** — #26 → #73 → `m4a-study-fidelity` (no PR yet), merged in that order after #26 is re-reviewed. Codex is back 2026-10-04 13:10.
  - Those branches, and #76, carry STATUS edits; Claude keeps `main`'s STATUS when merging them.
  - #26 also edits `ci.yml`: its `blender-python` job moves into its own workflow first.

**3D study fidelity — closed (Kirby, in the 2026-09-30 session; `tools/blender/STUDY-FIDELITY.md` still words both items as proposals).**

- **Delivered on `m4a-study-fidelity`** (not yet on `main`): M550 on the M650 AR shell, a refined M325s, G903 and M750 on AR shells, and SE on the Superlight 2 shell. M100 moved to `noShell` on 2026-09-28.
- **Not delivered (gates held):** M705 and M850L. D6 failed only on the held-out views. D1 and D5a also lost ground on fitted views: top and bottom for D5a, the top view for D1's second M705 attempt. The held-out photos are now exhausted, so they cannot be used to choose a further candidate. (D1–D6 are stage names in `tools/blender/STUDY-FIDELITY.md`.)
- **Wheel area:** D6 found the "missing shape" was mostly gap bridging. The item is closed.

**GitHub Actions budget is limited (Kirby, 2026-09-30).** 7-day baseline, from `gh run list --limit 1000`, UTC 2026-09-23 → 2026-09-29T22:00Z:

- **CI/push:** 207 runs, ≈ 927 min wall time.
  - 129 succeeded, 34 failed, 43 were cancelled, and 1 was still running.
  - 173 of the 207 came from branches other than `main`.
- **CI/pull_request:** 102 runs, ≈ 462 min.
- **Expire schedule:** 33 runs.

#78 limits push CI to `main` and skips draft PRs.

On 2026-09-29, jobs were refused from 11:49Z with "recent account payments have failed". Jobs were running again by 15:56Z (scheduled sweep) and 18:34Z (CI).

**Deletion promise (Kirby, 2026-09-30): no stated deletion time for now.** The hourly GitHub schedule actually ran about 5 times a day (longest gap 8.56 h), so physical deletion can land later than the "24 hours" the product still says.

- Expired data is unreadable, because reads treat expired rows as gone.
- Kirby's decision: product copy and README state no deletion time. The timing and the backup scheduler (decision 9) wait for the privacy policy (U1). #92 (UI) and #84 (README) carry the no-time drafts.
- `expire-sessions.yml` stays until a backup scheduler exists.

**Blocked on Kirby (decision packet, 2026-09-30):**

- Check Actions billing and set a budget alert
- LICENSE
- Gemini tier, and the 2027-01-01 price rise (#44)
- Business model and Vercel plan
- Camera primer
- Catalogue brands
- Analytics tool
- Backup scheduler (deferred with the privacy policy)
- Neon PITR retention
- Keep or remove the legacy `/scan` flow
- GitHub settings now that #78 is in: branch protection on `main` with required check `checks`; Dependabot security updates; secret scanning; push protection; private vulnerability reporting (all off as of 2026-09-30; the last one is required before #84 merges)
- Phone test of #77 (right and left hand)
- Run migration 0006 on production before #85 merges (`DATABASE_URL_UNPOOLED` pointing at the Neon production branch, then `npm run db:migrate`)
- Copy approval for #84 (README, NOTICE, CONTRIBUTING), #92 (no-time deletion lines, detector notice, sheet numbers, "Not yet verified against a ruler.") and #94 (error pages)
- Copy approval, after the fact, for strings merged unapproved:
  - #69: the desktop privacy line "Your photo never leaves this device. Only measurements are sent." and the device-routing strings its PR lists as candidate
  - #74: the "…or tap the hand button below." hint and the hand-chip accessible names (for example "Right hand · auto, set automatically. Change hand")
- Copy approval for #86 (G4): the `weight_in_range` sentence with the user's range and the two `thumb_rest_missing` sentences
- #89: spot-check the ⚠ models before G9b
- The typed-length input range, 135–265 mm (candidate)
- M325s / M550 acceptance

**Still candidates:** the daily model cap of 500 (#56), the paper-edge thresholds (#58), and the typed-length thresholds and range (#69).

**M2 ground truth** moved to the last phase (W7) and will be collected with the learning kit. This supersedes the earlier request to put five blank-A4 photos in `../Fixtures/hands/`.

**Queued:**

- #52: a submit after sign-out joins the previous user's claimed session. It blocks enabling sign-in, not the anonymous launch.
- Dark mode: the results page's "Why this one" card keeps a white background (`.results-analysis` in `results.css`) while its text turns light, so the analysis is unreadable. Recorded by #69's audit and again by G2 (#82); already on `main`. Fixed in #92 (S3).
- M1 rubric revision (the gate failed; see Gate results).
- `security-review` workflow, after U1 and G6.
- Re-review of #26.

---

## Release plan — "genuinely deployable"

### Definition of deployable — _candidate, pending Kirby's confirmation_

A real user, on their own phone, can print the sheet, photograph their hand and get a ranking they can trust — and nothing the product promises is false. All of:

| #   | Criterion                                                                                                       | Evidence                                                                                                           | Owner                                  |
| --- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------- |
| R1  | End to end works: sheet → photo → submit → ranking → written analysis — **on `main`; reload bug fixed (#45)**   | Playwright E2E over the whole flow, model stubbed                                                                  | Sonnet builders                        |
| R2  | Hand measurement is accurate                                                                                    | **M2 gate:** ±2 mm hand length vs ruler, ±1.5 mm over 5 captures                                                   | **Kirby** (photos, W7) → evaluator     |
| R3  | Every shipped screen meets `docs/design-guidelines.md`, mobile first                                            | Codex UI audit; findings fixed                                                                                     | Codex (audit) → Sonnet (fixes)         |
| R4  | Every privacy promise is true                                                                                   | photos-never-leave E2E; 24 h expiry tested; export and delete work                                                 | enforced today; re-verified at R6      |
| R5  | The analysis is honest                                                                                          | model vs. template prose labelled in the UI; no-new-numerals check                                                 | #28, #30                               |
| R6  | Security review passed before public exposure (PLAN §M7) — redaction ✅ #31, rate limits ✅ #41                 | `/security-review`; credential redaction fixed; rate limits live; DB vars stay non-Sensitive (accepted 2026-09-25) | Claude + reviewer                      |
| R7  | Cost controls live (PLAN §M5) — cap, thinking, cache, per-IP limit ✅; dated reminder ✅ #44; budget alarm open | output-token cap, minimal thinking budget, cache, per-IP limit, budget alarm, reminder for the 2027-01-01 rise     | #28; **Kirby** (alarm, Google console) |
| R8  | Every served asset is cleared for public serving                                                                | **Decided 2026-09-27: publish** (Logitech trademarks and source 3D models not covered by the project licence)      | **Kirby**                              |

### Not required for the first deployment — _candidate_

- **M4b 3D viewer.** Ranking and analysis stand on their own; the viewer follows once #26 is merged and its textures are optimised.
- **M1 descriptor gate.** First live run (2026-09-23, 30 models, gemini-3.8-flash) **failed** on flare and curvature, so its output was kept out of the seed (saved outside the repo in `../Fixtures/m1-run-2026-09-23/`). Hump, flare and curvature stay unclassified and those sub-scores use a neutral prior (`UNKNOWN_PRIOR_SCORE = 75`), so rankings lean on dimensions. Deployable but weaker: either ship saying so, or wait for the key.
- **M3 coefficients** stay provisional (`fit-v0-provisional`) until tuned against mice Kirby owns. The analysis already states this.

### Phases and agent distribution

| Phase         | Work                                                                                                                    | Agents                                               | Status       |
| ------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------ |
| 1 Integration | #27 fit route · #28 analysis infra · #29 scan submit · #30 results page                                                 | 4 Sonnet builders, parallel                          | ✅ merged    |
| 1 Assets      | #26 Blender pipeline + 31 GLBs                                                                                          | Codex (built) · Sonnet reviewer (incl. M4 bbox gate) | 🔍 re-review |
| 1 UI audit    | design-guidelines audit of every screen                                                                                 | Codex (independent reviewer)                         | ✅ done      |
| 1 Security    | credential redaction in migration errors                                                                                | Sonnet builder                                       | ✅ merged    |
| 2 Wire-up     | analysis route (needs #27 + #28) · full-flow E2E · UI-audit fixes                                                       | Sonnet builders                                      | ✅ merged    |
| 3 Hardening   | `/security-review` · budget alarm · mobile/a11y pass · error and empty states · launch checklist · texture optimisation | Claude + reviewers · Codex (textures) · Kirby        | 🏗 lanes      |
| 4 Acceptance  | M2 gate on ground-truth photos · real-phone run on production · final acceptance                                        | **Kirby**                                            | ⬜ last (W7) |

### Only Kirby can supply

1. Ground-truth hand photos with ruler measurements, collected with the learning kit in W7 (last) → R2
2. ~~Gemini API key~~ — added 2026-09-23
3. ~~A decision on the photo-derived shell textures~~ — decided 2026-09-27: publish
4. ~~Production DB variables back to Sensitive~~. Decided 2026-09-25: they stay non-Sensitive (accepted risk; see Decisions log).
5. Google OAuth credentials → sign-in. _Optional for launch: the anonymous flow works without it._
6. Final acceptance on a real phone

### Other open items

- ~~Production migrate + seed~~ and ~~Neon two-branch setup~~ — done 2026-09-23 (see Decisions log).
- **Convention question:** `@auth/drizzle-adapter: ^1.11.3` and `next-auth: ^5.0.0-beta.32` are the only caret-ranged dependencies; everything else is pinned. A caret on a beta floats across beta releases.

---

## Milestone board

| #   | Milestone                          | Gated | Status         | PR                                                     | Notes                                                                                                 |
| --- | ---------------------------------- | ----- | -------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| M0  | Scaffold                           | –     | ✅ merged      | [#3](https://github.com/kirbyliu99M/Open_Mouse/pull/3) | merged to `main` as `f5d9814`                                                                         |
| M1  | Data layer + shape rubric          | ✅    | ⛔ gate failed | #4 #5 #8                                               | merged; 38-model seed; descriptors kept out after the 2026-09-23 gate failure; rubric revision queued |
| M2  | Calibration + measurement          | ✅    | 🏗 gate in W7   | #9 #18 #19 #23 #58 #59                                 | merged incl. paper-edge; gate measured last (W7) with learning-kit photos                             |
| M3  | Fit engine                         | –     | ✅ merged      | #12 #21 #22                                            | coefficients provisional (`fit-v0-provisional`) until owner ratings in W8                             |
| M4  | 3D simulation (Blender + three.js) | ✅    | 🔍 in review   | #26 #73                                                | study fidelity closed 2026-09-30; M4b viewer optional                                                 |
| M5  | Gemini analysis                    | –     | ✅ merged      | #20                                                    | live since 2026-09-23; zh-TW numerals and provisional check queued (G4)                               |
| M6  | Sessions, auth, privacy            | –     | ✅ merged      | #24                                                    | sign-in not enabled in production; fix #52 before enabling                                            |
| M7  | Polish + security review           | –     | 🏗 in progress  | –                                                      | UI lane and system lane; `security-review` after U1 + G6                                              |

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

| Date       | Decision                                                                                                                                                                                                                                       | Why                                                                                                                                                                                                                                                                                                               |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-21 | EloShapes CSV is a private fixture, never shipped                                                                                                                                                                                              | Their ToS forbids redistribution; their shape judgments are the protected part                                                                                                                                                                                                                                    |
| 2026-09-21 | Catalogue seeded from Logitech's published specs                                                                                                                                                                                               | Raw dimensions are unprotectable facts; Logitech publishes them                                                                                                                                                                                                                                                   |
| 2026-09-21 | Printed L-fold sheet + ArUco for scale                                                                                                                                                                                                         | Homography also removes perspective distortion, not just scale                                                                                                                                                                                                                                                    |
| 2026-09-21 | Markers on a 180×180 mm inner square                                                                                                                                                                                                           | Identical on A4 and Letter — paper size stops being a variable                                                                                                                                                                                                                                                    |
| 2026-09-21 | Bank card in frame as cross-check                                                                                                                                                                                                              | Catches printers that silently scale the page                                                                                                                                                                                                                                                                     |
| 2026-09-21 | Blender (bpy 5.2.2) as build-time pre-modeling                                                                                                                                                                                                 | Subsurf + booleans + Draco; reviewable artifacts; keeps runtime cheap                                                                                                                                                                                                                                             |
| 2026-09-21 | Hand mesh generated in Blender, not MANO                                                                                                                                                                                                       | MANO is research-licence only — unusable for anything public                                                                                                                                                                                                                                                      |
| 2026-09-21 | `gemini-3.8-flash`                                                                                                                                                                                                                             | Kirby's call; cost levers documented in PLAN M5                                                                                                                                                                                                                                                                   |
| 2026-09-21 | Repo is a **sibling** of `Dataset/`, not its parent                                                                                                                                                                                            | Makes committing licensed data structurally impossible, not merely forbidden                                                                                                                                                                                                                                      |
| 2026-09-21 | `Size` is computed, not classified: `L + 0.4*(W-64)`                                                                                                                                                                                           | Measured 91.5% exact / 99.8% within-one on n=1260; removes a descriptor from the vision task                                                                                                                                                                                                                      |
| 2026-09-21 | M1 gate rebased on direction + within-one-level                                                                                                                                                                                                | Hump and flare have no numeric proxy, and 88% of mice sit in 3 of 7 flare levels — exact 7-way agreement is a poor proxy for fitness for purpose                                                                                                                                                                  |
| 2026-09-21 | **Backend moves from Codex to Claude**; Codex owns frontend + 3D                                                                                                                                                                               | Kirby's call. Split, directory ownership and cross-review rules in `AGENTS.md`                                                                                                                                                                                                                                    |
| 2026-09-21 | Cross-review: Claude reviews Codex, Codex reviews Claude, Kirby merges                                                                                                                                                                         | With Claude now writing code, nobody may approve their own work                                                                                                                                                                                                                                                   |
| 2026-09-21 | `src/lib/contracts/` is the only frontend/backend seam                                                                                                                                                                                         | Lets both halves build in parallel against one runtime-validated shape                                                                                                                                                                                                                                            |
| 2026-09-21 | Migration errors are redacted, not suppressed                                                                                                                                                                                                  | M0 review: the generic message hid real SQL failures. `describeMigrationError` keeps Postgres detail, strips URLs and credentials                                                                                                                                                                                 |
| 2026-09-21 | M0 uses Node 24, the latest Next.js 15 patch, and versioned Drizzle migrations applied over Neon HTTP                                                                                                                                          | Matches the milestone and existing Vercel runtime; no persistent connection pool                                                                                                                                                                                                                                  |
| 2026-09-21 | Preview builds apply migrations; production migrations are explicit                                                                                                                                                                            | Preview database isolation must be configured through Marketplace before deployment can pass                                                                                                                                                                                                                      |
| 2026-09-21 | Issue #1's secret criterion is interpreted as no credential values in code                                                                                                                                                                     | Environment variable names must be referenced to read server configuration; Gemini has no implementation in M0                                                                                                                                                                                                    |
| 2026-09-21 | Descriptor levels stored as slugs (`back_minimal`), labels in `src/lib/contracts/descriptors.ts`                                                                                                                                               | One vocabulary drives DB enums, classifier schema, validator and UI                                                                                                                                                                                                                                               |
| 2026-09-21 | Rubric §2 rules enforced twice: `checkConsistency()` and DB `CHECK` constraints                                                                                                                                                                | Code explains a violation; the DB guarantees none is stored. Null never violates                                                                                                                                                                                                                                  |
| 2026-09-21 | Scan data cascades from `scan_sessions`                                                                                                                                                                                                        | The M6 expiry sweep is a single DELETE                                                                                                                                                                                                                                                                            |
| 2026-09-21 | **M1 seed scope cut from 76 to the 30-model current lineup (option C)**; issue #2 amended                                                                                                                                                      | Kirby's call: cheapest path, and the gate stays meaningful. Older models later. Computed Size re-measured on the 30: 90.0%                                                                                                                                                                                        |
| 2026-09-21 | Per-storefront axis conventions for Logitech specs                                                                                                                                                                                             | logitech.com labels length "Height" and height "Depth"; label mapping silently swapped them. Guarded by `dimensionWarnings` + a CI test over the seed file                                                                                                                                                        |
| 2026-09-21 | Preview builds migrate **and seed** their own Neon branch                                                                                                                                                                                      | Every PR preview has a real catalogue; production seeding stays explicit (`npm run db:seed`)                                                                                                                                                                                                                      |
| 2026-09-21 | Each agent works in its own git worktree                                                                                                                                                                                                       | Two agents shared one checkout; one agent's uncommitted notes were committed by another                                                                                                                                                                                                                           |
| 2026-09-21 | **Codex narrowed to Blender (M4a); Sonnet subagents build backend + frontend; a separate Sonnet subagent reviews**                                                                                                                             | Kirby's call — Codex token cost. Claude orchestrates and adjudicates                                                                                                                                                                                                                                              |
| 2026-09-21 | Contract v1: marker layout is 180 mm _outer_ extent (25 mm markers, centres on 155 mm)                                                                                                                                                         | Centres on 180 mm with 30 mm markers spanned 210 mm = A4 width, leaving no printer margin                                                                                                                                                                                                                         |
| 2026-09-21 | Browser sends raw landmark distances under a versioned measurement model                                                                                                                                                                       | Landmarks are joint centres (palm width reads 10–20 mm low); correction is fitted to ruler ground truth in M2, not guessed client-side                                                                                                                                                                            |
| 2026-09-21 | `weight_g` gets a positivity CHECK                                                                                                                                                                                                             | Reviewer finding: dimensions were guarded but weight was not                                                                                                                                                                                                                                                      |
| 2026-09-21 | Each worktree runs its own `npm ci`; `node_modules` is never shared                                                                                                                                                                            | npm reconciles a whole folder against its own branch's lockfile, so a shared one is silently rewritten by the last installer                                                                                                                                                                                      |
| 2026-09-21 | Classifier uses product images only, never lifestyle shots                                                                                                                                                                                     | Review finding: fewer images beat misleading ones for the visual descriptors M1 hinges on                                                                                                                                                                                                                         |
| 2026-09-21 | Descriptors file is authoritative for the models it contains                                                                                                                                                                                   | Review finding: COALESCE let a stale wrong value survive a later needsReview. Models absent from the file keep their stored values                                                                                                                                                                                |
| 2026-09-21 | Partial-view classifications are allowed but annotated                                                                                                                                                                                         | Classifying from one available view beats discarding evidence; the note lets misses be audited against it                                                                                                                                                                                                         |
| 2026-09-21 | Classification checkpoints after every model                                                                                                                                                                                                   | The real run spends Kirby's key; a crash midway must not lose completed work                                                                                                                                                                                                                                      |
| 2026-09-21 | Printed sheet verified by real PDF render: exactly 1 page on A4 and Letter, SVG exactly 210 mm                                                                                                                                                 | Review finding: a global CSS margin rendered it as 3 pages at 79% scale; geometry-only tests could not see it                                                                                                                                                                                                     |
| 2026-09-22 | **Input is still photos (upload), not a live camera**; still processed in the browser                                                                                                                                                          | Kirby's call. Simpler flow; fixtures become replayable files. Adds EXIF orientation, HEIC and lens-distortion handling                                                                                                                                                                                            |
| 2026-09-22 | Ground-truth hand photos live outside the repo (`../Fixtures/hands/`); the gate replay script never runs in CI                                                                                                                                 | Same privacy promise as the product; same pattern as the licensed dataset                                                                                                                                                                                                                                         |
| 2026-09-22 | UI/UX standard: Apple design principles, applied per screen in `docs/design-guidelines.md`                                                                                                                                                     | Kirby's call. Frontend PRs are reviewed against its checklist                                                                                                                                                                                                                                                     |
| 2026-09-22 | **Parallax correction applies to the top-down photo**, via camera pose from the marker homography + EXIF focal length (homography-estimated focal as fallback)                                                                                 | Landmarks sit above the sheet; measured +2.6 mm on a 190 mm hand (450 mm, 20° tilt), which alone fails the ±2 mm gate. Corrected to 0.03 mm under realistic noise (#23). An earlier estimate of ~5.5 mm was too high                                                                                              |
| 2026-09-22 | Side and grip photos deferred                                                                                                                                                                                                                  | Fit engine v0 consumes only top-down measurements; revisit once M2 gate data shows whether thickness improves rankings                                                                                                                                                                                            |
| 2026-09-22 | Builders run wide in parallel (up to six), all Sonnet, each on an issue-as-spec                                                                                                                                                                | Kirby's call: maximise Sonnet use; Claude writes contracts/specs and adjudicates                                                                                                                                                                                                                                  |
| 2026-09-22 | Expiry = lazy sweep on each scan write + expired-means-gone on reads + daily cron backstop                                                                                                                                                     | Vercel Hobby allows only daily cron; a daily-only sweep would let anonymous data live ~48 h and break the 24 h promise (#18, amended #17)                                                                                                                                                                         |
| 2026-09-22 | Neon Free branch cap limits concurrent PR previews; reviewed PRs give up their preview branch                                                                                                                                                  | Preview builds for #19 #21 #22 #23 failed with "Branch limit reached"                                                                                                                                                                                                                                             |
| 2026-09-22 | Preview deployments stay SSO-protected; builders never change project security settings                                                                                                                                                        | A builder correctly refused to enable Protection Bypass for Automation; that is Kirby's decision                                                                                                                                                                                                                  |
| 2026-09-22 | A PR's `push` CI passing does **not** mean the PR is green; the `pull_request` run builds the merge with the base                                                                                                                              | #20 was green on push and red on `pull_request` at the same SHA: `contracts-fit` had widened the `excluded[]` contract with `brand`/`model`, which only breaks once the base is merged in. Read the `pull_request` run                                                                                            |
| 2026-09-22 | The numeral check exempts digit runs inside tokens that appear verbatim in the input, and checks every other digit run                                                                                                                         | Re-review of #20 found `"about68mm"` produces **zero** regex matches — an invented number passing unchecked. The lookbehind that caused it exists to protect product names like `G502`, which was recorded nowhere. Both cases now have tests                                                                     |
| 2026-09-22 | Nits are adjudicated, not auto-applied, once a PR has been reviewed                                                                                                                                                                            | Code the orchestrator writes after review is unreviewed code in a PR the orchestrator then merges — the thing "nobody approves their own work" exists to prevent. Nits go back to a builder                                                                                                                       |
| 2026-09-22 | The numeral check's exemption draws from `brand`/`model` only, never slugs or IDs                                                                                                                                                              | `slugify` lowercases, so a slug always put the lowercase digit run in the exempt set and silently neutralised the case-sensitive match. Fix the source, not the matcher                                                                                                                                           |
| 2026-09-22 | Ordinal carve-out requires a determiner before **and** a non-`of` word after                                                                                                                                                                   | The earlier "either/or" form leaked both ways: determiner-only ignored a following `of`, and the noun rule reached across sentence boundaries                                                                                                                                                                     |
| 2026-09-22 | On hard rules, prefer the stricter rule: false positives cost a retry, false negatives reach the user                                                                                                                                          | Four rounds of clever narrow fixes each opened a new hole. A monotonically stricter change cannot introduce a false negative                                                                                                                                                                                      |
| 2026-09-22 | A branch is merged with `main` locally and fully verified before the PR is merged                                                                                                                                                              | #20 was green on `push` and red on `pull_request` at one SHA; two branches conflicted in `package.json` where both added a dependency                                                                                                                                                                             |
| 2026-09-23 | Neon integration connected to Production only; Preview DB vars set by hand to one shared `Preview` branch                                                                                                                                      | The Neon Free plan caps branches at 10, and per-deployment branches outlive their PRs until Vercel deletes the deployment. The deployment-action toggle has no API, but connecting without `preview` removes the action entirely                                                                                  |
| 2026-09-23 | **Codex may take assigned tasks beyond Blender**                                                                                                                                                                                               | Kirby's call. First two: publishing its own Blender work (#26) and an independent UI design audit — independent because Sonnet builders wrote the frontend                                                                                                                                                        |
| 2026-09-23 | A Codex task that needs `git push` is launched by Kirby, not by Claude                                                                                                                                                                         | The agent permission classifier blocks Claude from starting an external agent with push access. Otherwise Codex judges and Claude runs git                                                                                                                                                                        |
| 2026-09-23 | Analysis `source` is reported by the code path taken, never inferred from whether a key is set                                                                                                                                                 | A keyed call can fail and fall back; inferring from the key would label template text as model prose (#25 review)                                                                                                                                                                                                 |
| 2026-09-23 | Only model-written analyses are cached                                                                                                                                                                                                         | The fallback is deterministic and free to recompute; caching it would keep serving template text after a transient model failure clears                                                                                                                                                                           |
| 2026-09-23 | Contract error bodies are tested against the shipped route                                                                                                                                                                                     | The first draft of `errorResponseSchema` rejected what `POST /api/scans` already returns; a reviewer caught it by reading both files. Now CI does                                                                                                                                                                 |
| 2026-09-23 | **At most three agents run at once** (revised from five the same day), and the orchestrator commits and pushes any uncommitted work the moment an agent stops                                                                                  | Eight parallel agents exhausted the account's session limit together; so did five, a few hours later. One builder had 17 files uncommitted, another had temporarily reverted its own fix to prove a test red. Nothing was lost: each worktree was inspected, WIP-committed and pushed before resuming             |
| 2026-09-23 | **Remove the automatic pagehide deletion; deleting now is an explicit user action**                                                                                                                                                            | `pagehide` cannot tell closing a browser from reloading a page, so the beacon deleted anonymous results on refresh. It backed no remaining promise: since #38 the copy says deletion within 24 hours of creation, enforced by TTL + sweep. Guarantees are unchanged; immediate deletion becomes the user's choice |
| 2026-09-23 | **Every critical flow needs one test with nothing mocked between the browser and the database**                                                                                                                                                | The reload bug shipped past 774 green tests because each test stubbed the exact seam where it lived. Mocked seams test each side against the contract, not that the sides work together                                                                                                                           |
| 2026-09-23 | UI design decisions are drawn on the pen.dev canvas before builders implement them                                                                                                                                                             | Kirby's suggestion. The journey (`docs/design/journey-2026-09-23/`) settles audit findings that span screens, so separate builders do not each invent their own navigation                                                                                                                                        |
| 2026-09-24 | `analysis_cache` rows are bound to their scan (`scan_id` FK, `ON DELETE CASCADE`), not given their own TTL                                                                                                                                     | Every existing scan-deletion path (24 h sweep, "Delete this scan now", account deletion) then removes the prose inside the same proven bound. Cross-scan hits are given up: they needed identical 1 mm measurements and let one scan's prose reach another.                                                       |
| 2026-09-24 | The cache is best-effort: a read error is a miss, a write error is skipped; deploy code before migrating                                                                                                                                       | The neon-http migrator has no transactions, and code and schema briefly disagree during every deploy. A cache must never turn that into a 500. 0005 is one atomic `DO` block so it can re-run.                                                                                                                    |
| 2026-09-24 | The scan-session cookie proves ownership of an **anonymous** session only (`user_id IS NULL`), in the shared find/delete predicate                                                                                                             | The #45 review showed a cookie left after sign-out could delete the account's scans. The contract already said ownership follows the user once claimed.                                                                                                                                                           |
| 2026-09-24 | M1 descriptors from the first live run stay out of the seed                                                                                                                                                                                    | Gate failed (flare 72.4%, curvature 25.0%). Rule 4: revise the rubric, not the gate. Shape sub-scores stay "Shape not rated yet" and the UI says the total leans on size.                                                                                                                                         |
| 2026-09-25 | Production DB env vars stay non-Sensitive in Vercel (known risk, accepted by Kirby)                                                                                                                                                            | The Neon integration offers no Sensitive toggle; Hobby project with Kirby as the only member. Password rotated 2026-09-24 after it had been pasted into a conversation.                                                                                                                                           |
| 2026-09-25 | The camera flow borrows TONALITE's documented principles, not its screens                                                                                                                                                                      | Public reviews describe its step-by-step flow and QR-sticker fiducials but not the capture UI; our ArUco markers play the stickers' role.                                                                                                                                                                         |
| 2026-09-27 | **Catalogue grows 30 → 38**: M750, M325s, Mobi Fold, M850L, M840L, MX Ergo S, ERGO M575S, G903 Hero                                                                                                                                            | Kirby's call, from a PChome Taiwan shelf check plus a first-party spec read. Descriptors pending; the dated Size-gate figure (27/30) covers only the original 30 — the 8 new rows are unmeasured                                                                                                                  |
| 2026-09-27 | **R8: Blender assets are published** (open-source project); **no medical claims** anywhere                                                                                                                                                     | Kirby's call. Logitech trademarks and source 3D models are not covered by the project licence — note it in the asset README                                                                                                                                                                                       |
| 2026-09-30 | **Launch sequence approved; real-hand-photo ML (M2 calibration) is the last job; the site is not promoted or indexed until M2 passes**                                                                                                         | Kirby's call. Everything that does not depend on measurement accuracy is built first, so the ML phase is only data → train → gate                                                                                                                                                                                 |
| 2026-09-30 | **Taiwan first: zh-TW is the default language, English stays**                                                                                                                                                                                 | Kirby's call. i18n runs after the UI lanes settle; the catalogue expands for the first market                                                                                                                                                                                                                     |
| 2026-09-30 | **Learning-kit code (#76) merges early; photo collection waits for W7**                                                                                                                                                                        | Kirby's call. Merging early avoids rebase drift and lets the printed QR codes resolve; format v2 adds the fields training needs                                                                                                                                                                                   |
| 2026-09-30 | **Study fidelity (D phase) closed**; delivered assets merge via #26 → #73 → `m4a-study-fidelity`                                                                                                                                               | Kirby's call after D6: the M705/M850L held-out photos are exhausted, and the wheel-area loss was mostly gap bridging                                                                                                                                                                                              |
| 2026-09-30 | **At most five agents at once** (two builders plus up to three workflow agents), replacing the 2026-09-23 cap of three                                                                                                                         | Kirby's call. Each workflow caps itself with an in-script pool of 3 and uses ≤ 10 agents per run                                                                                                                                                                                                                  |
| 2026-09-30 | **GitHub Actions budget is limited**: CI runs only on push to `main` and on non-draft PRs (from #78); live e2e runs locally                                                                                                                    | Kirby's call. 7-day baseline: 207 push runs (≈ 927 min, 173 from non-`main` branches) plus 102 PR runs (≈ 462 min)                                                                                                                                                                                                |
| 2026-09-30 | **Builders never edit STATUS**; Claude updates it through small docs-only PRs (≈ 10 s of PR CI, plus the ≈ 90 s lightweight gate on `main` after merge)                                                                                        | Claude, under the plan Kirby approved. Every parallel branch collided on this file (#77, #76, #73, study fidelity); PRs keep it compatible with branch protection                                                                                                                                                 |
| 2026-09-30 | **Every code PR is reviewed by the `pr-review` workflow**; a docs-only STATUS/AGENTS PR gets one independent fact-check agent instead: 3 Sonnet lenses, and a refuter for each of the 6 most severe findings; the rest go to Claude unverified | Claude, under the plan Kirby approved. Independent perspectives plus a check against plausible-but-wrong findings; Claude adjudicates. The script is Claude's local tooling, not part of this repo                                                                                                                |
| 2026-09-30 | **#69's typed-length entry ships behind a build-time flag, set to off**                                                                                                                                                                        | Claude, under the plan Kirby approved. Its thresholds and input range are candidates and must be measured on M2 photos before users see the path                                                                                                                                                                  |
| 2026-09-30 | **Codex tasks that Claude dispatches never push, and never edit STATUS or `.github/`**; Claude runs git                                                                                                                                        | Claude, under the plan Kirby approved; follows the 2026-09-23 rule that a Codex task needing push is launched by Kirby, not Claude                                                                                                                                                                                |
| 2026-09-30 | #77 merged; its wiring-test gap moved to S2 (#74)                                                                                                                                                                                              | S2 replaces `handIsAuto` with `handExplicit`, so the tests belong with the code that stays                                                                                                                                                                                                                        |
| 2026-09-30 | **No stated deletion time in product copy or README** until the privacy policy (U1) sets it; the backup scheduler waits with it                                                                                                                | The schedule ran about 5 times a day, so "24 hours" was not reliably true; Kirby chose to state no time rather than a weaker one                                                                                                                                                                                  |
| 2026-09-30 | **The AI-source disclosure is dropped for now**; the home page's "weight" claim is corrected to "height"                                                                                                                                       | Kirby: add the disclosure later; weight was never scored                                                                                                                                                                                                                                                          |
| 2026-09-30 | **G9: left-hand exclusion unchanged; ambidextrous ⇒ symmetrical not inferred (pending verification); M750 shape = symmetrical like M550**; #89 merges before Kirby's spot check                                                                | Kirby's answers on #89; the data is inert until G9b                                                                                                                                                                                                                                                               |
| 2026-09-30 | **The learning kit pages are not served in production**                                                                                                                                                                                        | Kirby collects the learning photos in person; the pages run on the local dev server only                                                                                                                                                                                                                          |
| 2026-09-30 | **Vercel builds previews only for ready PRs**; 327 old preview, failed and cancelled deployments deleted                                                                                                                                       | 406 deployments in 9 days nearly filled the account's deployment storage (Kirby)                                                                                                                                                                                                                                  |

---

## Risks

~~**Cached analysis prose outlives the scan it came from — live since the key was added.**~~ **Resolved 2026-09-24 (#53):** `analysis_cache` rows are bound to their scan and cascade-deleted (production migration 0005 applied 2026-09-24).

**Credential redaction: two known limitations after #31 (accepted, follow-up queued).** Both found by the fourth review pass; neither is reachable with any variable this project uses. (1) A key with an unbroken run of more than 64 characters on either side of the credential word is not matched at all — the cost of bounding the pattern to make it linear. (2) A quoted `Bearer` token containing an internal space leaks the part after the space. Every form that leaked in any review round — 11 in all — is redacted on `main`, and a 1 MB adversarial input takes under 10 ms.

~~**Anonymous results vanish on reload (found 2026-09-23 in production; fix in flight, #42).**~~ **Resolved 2026-09-24 (#45):** the pagehide beacon is gone; deleting is an explicit action.

~~**Credential redaction leaks quoted secrets (P1, open since 2026-09-21).**~~ **Resolved 2026-09-23 (#31):** every leaking form is redacted on `main`; two accepted limitations remain (above).

**Shell textures are derived from product photos.** _R8 decided 2026-09-27: publish; the rights caveat stands._ 98% of the 118 MB of GLBs in #26 (115 MB) is embedded PNG textures, reconstructed from product images. The 2026-09-21 decision to seed from Logitech's published specs covers _dimensions_ — facts — not images. Merging #26 serves them publicly from `/models/`, which R8 allows. Dropping the textures would also remove ~98% of the download, which M7's phone budget needs anyway.

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
