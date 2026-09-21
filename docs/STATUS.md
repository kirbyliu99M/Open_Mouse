# STATUS — live project board

**Every PR updates this file — Claude's and Codex's.** It is the single source of
truth for where the project stands. Read it before starting any task.

_Last updated: 2026-09-21 · by: Claude (took over backend; M0 finishing)_

---

## Right now

**Current milestone:** M0 — Scaffold: **all acceptance criteria met, in review** ([PR #3](https://github.com/kirbyliu99M/Open_Mouse/pull/3), reviewer: Codex).
**In parallel:** M1 part 1 in draft [PR #4](https://github.com/kirbyliu99M/Open_Mouse/pull/4) (stacked on #3). Part 2 = seed of the current Logitech lineup, then classification.
**Blocked on:** nothing for M0. The M1 gate run waits on `GEMINI_API_KEY`, which Kirby is holding back for the real test.

---

## Milestone board

| #   | Milestone                          | Gated | Status           | PR                                                       | Notes                                         |
| --- | ---------------------------------- | ----- | ---------------- | -------------------------------------------------------- | --------------------------------------------- |
| M0  | Scaffold                           | –     | 🔍 in review     | [#3](https://github.com/kirbyliu99M/Open_Mouse/pull/3)   | all 8 criteria met; preview branches verified |
| M1  | Data layer + shape rubric          | ✅    | ⬜ blocked by M0 | [#2](https://github.com/kirbyliu99M/Open_Mouse/issues/2) | **riskiest gate — see Risks**; rubric written |
| M2  | Calibration + measurement          | ✅    | ⬜               | –                                                        | needs Kirby's fixture set                     |
| M3  | Fit engine                         | –     | ⬜               | –                                                        | coefficients need real pairings               |
| M4  | 3D simulation (Blender + three.js) | ✅    | ⬜               | –                                                        | largest build                                 |
| M5  | Gemini analysis                    | –     | ⬜               | –                                                        | cost levers matter, see PLAN                  |
| M6  | Sessions, auth, privacy            | –     | ⬜               | –                                                        |                                               |
| M7  | Polish + security review           | –     | ⬜               | –                                                        | before any public exposure                    |

Status key: 🔜 ready · 🏗 in progress · 🔍 in review · ✅ merged · ⛔ gate failed · ⬜ not started

---

## M0 verification

- Local: typecheck, ESLint, Prettier, migration history check, and production build pass.
- GitHub push CI at `4d833e3`: **87 seconds**, all checks passed ([run](https://github.com/kirbyliu99M/Open_Mouse/actions/runs/35580912792)). PR CI at `7881529`, including `vercel-build`: **81 seconds**, all checks passed ([run](https://github.com/kirbyliu99M/Open_Mouse/actions/runs/35581171147)).
- Vitest: **16/16 passed** (configuration validation, credential-safe errors, preview endpoint guard).
- Playwright: **2/2 passed** (desktop and mobile Chromium; HTTP 200, visible heading, no browser errors or horizontal overflow).
- Production dependencies: **0 npm audit findings**. Drizzle Kit's development-only legacy esbuild chain has 4 moderate findings; no forced major downgrade or migration-tool replacement was made.
- **Preview isolation verified 2026-09-21:** preview builds for PR #3 and PR #4 both logged `Migrations applied`. The preview guard throws when the endpoint equals production, so that line is only reachable on a separate branch. PR #4's build also applied M1's migration `0001` cleanly. Duplicate project `open-mouse-4awb` removed.
- Neon: `open-mouse-db`, Free plan, `iad1`, project `rapid-salad-00847873`. Separate preview branch and applied migration still need live evidence.
- Current Preview and Production variables resolve to the **same endpoint**. A read-only production query confirmed `public.scaffold_checks` is absent. The preview build stops before SQL; enabling Marketplace preview branching is the remaining account configuration step. The extra `open-mouse-4awb` project remains linked to the repo and reports its own failed preview check without database configuration; Kirby selected `open-mouse` as the primary project.
- Vercel: the existing `main` deployment is Ready but predates the Next.js scaffold. The scaffold's production deployment requires Claude's review and merge.
- Runtime dependency override: PostCSS 8.5.28 fixes the audit findings in Next.js 15's pinned dependency without changing the requested Next.js major.
- First Vercel preview exposed a CommonJS/ESM import mismatch in the migration entry point; corrected to the package's default import. CI now runs `vercel-build` to cover that entry point too. Local `vercel-build` passes; a synthetic production-endpoint preview exits before any database request.
- Repository history plus staged diff: **0 licensed-data paths, 0 CSV row patterns, 0 known credential values** found. The dataset was not read or moved for M0.

## Gate results

Fill in with **measured numbers** as each gate is attempted. Record failures too —
a failed attempt is information, not something to overwrite.

| Gate                             | Target                              | Measured                   | Date       | Verdict |
| -------------------------------- | ----------------------------------- | -------------------------- | ---------- | ------- |
| M1 flare direction               | ≥ 85% (Inward/Flat/Outward)         | –                          | –          | –       |
| M1 hump Center-vs-Back           | ≥ 85%                               | –                          | –          | –       |
| M1 side curvature Inward-vs-Flat | ≥ 85%                               | –                          | –          | –       |
| M1 within-one-level (all three)  | ≥ 90%                               | –                          | –          | –       |
| M1 computed Size                 | ≥ 85% exact                         | **89.5%** (Logitech, n=76) | 2026-09-21 | ✅ pass |
| M2 repeatability                 | ≤ ±1.5 mm over 5 captures           | –                          | –          | –       |
| M2 accuracy                      | ≤ ±2 mm hand length vs ruler        | –                          | –          | –       |
| M4 bbox fidelity                 | ≤ 0.5 mm vs spec L/W/H              | –                          | –          | –       |
| M4 watertight                    | no holes, no self-intersection      | –                          | –          | –       |
| M4 silhouette review             | Kirby judges 76 shells recognisable | –                          | –          | –       |

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
