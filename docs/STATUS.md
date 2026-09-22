# STATUS — live project board

**Every PR updates this file — Claude's and Codex's.** It is the single source of
truth for where the project stands. Read it before starting any task.

_Last updated: 2026-09-22 · by: Claude (orchestrator)_

---

## Right now

**Current milestone:** building toward full function, stopping where Blender assets are required (M4b). **#3 merged to main.** The rest of the stack is reviewed and green but **the merge cascade has not started** — see blocker 1.

**Open PRs:** #4 #5 #6 (green, ready) · #8 #9 #12 (reviewed) · #18 scan API (timing-safe cron fix `19263aa`) · #19 photo pipeline (out of draft, evidence posted) · #20 analysis (**changes requested**, fix in flight) · #21 fit engine · #22 results UI · #23 parallax · #24 M6 auth (reviewed, approve-with-nits).

**In flight (Sonnet):** builder closing two confirmed hard-rule-2 bypasses in `src/server/analysis/numerals.ts` (#20).

**Next wave, after the merges:** integration — scan → fit → results → analysis end to end, with the routes and the analysis cache table.

**Blocked — Kirby:**

1. **The merge cascade needs a permission grant.** `gh pr merge` is denied by the Claude Code permission classifier (`Merge Without Review`): the reviewer approvals recorded in the handoff live in session context, not as review objects on the PRs, so every PR reads `reviewDecision: ""` from outside. #4 is `MERGEABLE`/`CLEAN` with CI and Vercel green and is ready to go the moment a Bash rule for `gh pr merge` exists in `.claude/settings.json`.
2. **Vercel previews still fail — confirmed, and it is not a stale error.** A fresh redeploy of #19 returned **`Resource provisioning failed`**: the Neon per-deployment branch cannot be created under the Free cap. #6 and #20 deploy fine only because their Neon branches already exist. The fix is the two-branch setup in HANDOFF-NEXT: delete the old per-PR branches, create `preview` from `main`, turn off per-deployment branching in the Vercel↔Neon integration, and point Preview-scope DB env vars at `preview`.
3. **Codex's Blender tooling is uncommitted** in the main checkout (`tools/`, `public/` on `m4-asset-foundation`); ask Codex to commit and push it.
4. When convenient: Gemini key for the M1 gate; ground-truth hand photos in `../Fixtures/hands/`; which mice you own; Google OAuth credentials; preview-protection decision.

### Merge-cascade readiness (checked 2026-09-22)

Every stale branch was test-merged against its base: **#5 #8 #9 #12 #18 all merge cleanly**, and the only non-doc changes they are missing are `.gitignore` and `README.md`. No contract changes are pending for them, so the cascade should not produce another semantic break like #20's.

---

## Milestone board

| #   | Milestone                          | Gated | Status              | PR                                                     | Notes                                                                                             |
| --- | ---------------------------------- | ----- | ------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| M0  | Scaffold                           | –     | ✅ merged           | [#3](https://github.com/kirbyliu99M/Open_Mouse/pull/3) | merged to `main` as `f5d9814`                                                                     |
| M1  | Data layer + shape rubric          | ✅    | 🔍 in review        | #4 #5 #8                                               | schema, 30-model seed, classifier built (fake-tested); gate run needs the Gemini key              |
| M2  | Calibration + measurement          | ✅    | 🔍 in review        | #9 #18 #19 #23                                         | A sheet+geometry, B API+photo pipeline, C parallax; ground-truth photos still needed for the gate |
| M3  | Fit engine                         | –     | 🔍 in review        | #12 #21 #22                                            | contract, engine and results UI built; coefficients still need real pairings                      |
| M4  | 3D simulation (Blender + three.js) | ✅    | ⬜                  | –                                                      | M4a Blender → Codex, issue #7                                                                     |
| M5  | Gemini analysis                    | –     | 🏗 changes requested | #20                                                    | re-review found two hard-rule-2 bypasses in the numeral check; fix in flight                      |
| M6  | Sessions, auth, privacy            | –     | 🔍 in review        | #24                                                    | reviewed: approve with nits (no-store header, `isAuthConfigured`, app-wide `auth()` call)         |
| M7  | Polish + security review           | –     | ⬜                  | –                                                      | before any public exposure                                                                        |

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

| Gate                              | Target                              | Measured                          | Date       | Verdict |
| --------------------------------- | ----------------------------------- | --------------------------------- | ---------- | ------- |
| M1 flare direction                | ≥ 85% (Inward/Flat/Outward)         | –                                 | –          | –       |
| M1 hump Center-vs-Back            | ≥ 85%                               | –                                 | –          | –       |
| M1 side curvature Inward-vs-Flat  | ≥ 85%                               | –                                 | –          | –       |
| M1 within-one-level (all three)   | ≥ 90%                               | –                                 | –          | –       |
| M1 computed Size                  | ≥ 85% exact                         | **89.5%** (Logitech, n=76)        | 2026-09-21 | ✅ pass |
| M1 Size from **first-party** dims | ≥ 85% exact                         | **90.0%** (27/30, current lineup) | 2026-09-21 | ✅ pass |
| M2 repeatability                  | ≤ ±1.5 mm over 5 captures           | –                                 | –          | –       |
| M2 accuracy                       | ≤ ±2 mm hand length vs ruler        | –                                 | –          | –       |
| M4 bbox fidelity                  | ≤ 0.5 mm vs spec L/W/H              | –                                 | –          | –       |
| M4 watertight                     | no holes, no self-intersection      | –                                 | –          | –       |
| M4 silhouette review              | Kirby judges 76 shells recognisable | –                                 | –          | –       |

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
---

## Risks

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
