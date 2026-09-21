# STATUS — live project board

**Codex: update this file in every PR.** It is the single source of truth for
where the project stands. Claude reads it before writing the next milestone spec.

_Last updated: 2026-09-21 · by: Claude (project setup)_

---

## Right now

**Current milestone:** M0 — Scaffold
**Next action:** Codex implements M0 from its milestone issue.
**Blocked on:** nothing.

---

## Milestone board

| # | Milestone | Gated | Status | PR | Notes |
|---|---|---|---|---|---|
| M0 | Scaffold | – | 🔜 ready | – | repo, CI, Vercel, Neon branch-per-PR |
| M1 | Data layer + shape rubric | ✅ | ⬜ blocked by M0 | – | **riskiest gate — see Risks** |
| M2 | Calibration + measurement | ✅ | ⬜ | – | needs Kirby's fixture set |
| M3 | Fit engine | – | ⬜ | – | coefficients need real pairings |
| M4 | 3D simulation (Blender + three.js) | ✅ | ⬜ | – | largest build |
| M5 | Gemini analysis | – | ⬜ | – | cost levers matter, see PLAN |
| M6 | Sessions, auth, privacy | – | ⬜ | – | |
| M7 | Polish + security review | – | ⬜ | – | before any public exposure |

Status key: 🔜 ready · 🏗 in progress · 🔍 in review · ✅ merged · ⛔ gate failed · ⬜ not started

---

## Gate results

Fill in with **measured numbers** as each gate is attempted. Record failures too —
a failed attempt is information, not something to overwrite.

| Gate | Target | Measured | Date | Verdict |
|---|---|---|---|---|
| M1 rubric agreement | see Risks (revision pending) | – | – | – |
| M2 repeatability | ≤ ±1.5 mm over 5 captures | – | – | – |
| M2 accuracy | ≤ ±2 mm hand length vs ruler | – | – | – |
| M4 bbox fidelity | ≤ 0.5 mm vs spec L/W/H | – | – | – |
| M4 watertight | no holes, no self-intersection | – | – | – |
| M4 silhouette review | Kirby judges 76 shells recognisable | – | – | – |

---

## Decisions log

Append; don't rewrite. Each entry: what, why, when.

| Date | Decision | Why |
|---|---|---|
| 2026-09-21 | EloShapes CSV is a private fixture, never shipped | Their ToS forbids redistribution; their shape judgments are the protected part |
| 2026-09-21 | Catalogue seeded from Logitech's published specs | Raw dimensions are unprotectable facts; Logitech publishes them |
| 2026-09-21 | Printed L-fold sheet + ArUco for scale | Homography also removes perspective distortion, not just scale |
| 2026-09-21 | Markers on a 180×180 mm inner square | Identical on A4 and Letter — paper size stops being a variable |
| 2026-09-21 | Bank card in frame as cross-check | Catches printers that silently scale the page |
| 2026-09-21 | Blender (bpy 5.2.2) as build-time pre-modeling | Subsurf + booleans + Draco; reviewable artifacts; keeps runtime cheap |
| 2026-09-21 | Hand mesh generated in Blender, not MANO | MANO is research-licence only — unusable for anything public |
| 2026-09-21 | `gemini-3.8-flash` | Kirby's call; cost levers documented in PLAN M5 |
| 2026-09-21 | Repo is a **sibling** of `Dataset/`, not its parent | Makes committing licensed data structurally impossible, not merely forbidden |

---

## Risks

**M1 is the riskiest gate in the project.** Analysis of the validation fixture
shows `Hump placement` and `Front flare` have **no numeric proxy**: height/length
medians across all four hump levels sit within 0.320–0.336, and width/length
across the seven flare levels is equally flat. These are genuinely visual
editorial judgments, so if the vision rubric underperforms there is no arithmetic
fallback.

Two consequences:
- The original gate (≥80% exact on a 7-level flare scale) is likely too
  ambitious. **A revision is pending Kirby's decision** — see the open question
  below. Do not start M1 until it is settled.
- `Size` is the opposite case: it is almost purely a function of length and
  should be **computed, not classified**. That removes it from the vision task.

**M2 depends on a human.** The accuracy gate cannot be attempted until Kirby
shoots the ground-truth fixture set.

**M3 coefficients are unvalidated.** They start from published sizing guidance and
stay provisional until tested against mice Kirby has actually owned and rated.

---

## Open questions

| # | Question | Owner | Status |
|---|---|---|---|
| 1 | Revise the M1 gate to measure flare/hump **direction** (3-class) plus within-one-level, instead of exact agreement on 7 levels? | Kirby | ⏳ open |
| 2 | Which Logitech models does Kirby own and can rate for M3 tuning? | Kirby | ⏳ open |

---

## Glossary

- **Descriptor** — one of the 8 shape fields (Shape, Hump placement, Front flare,
  Side curvature, Thumb rest, Ring finger rest, Size, Hand compatibility).
- **Gate** — a numeric threshold that must pass before the next milestone starts.
- **Fixture** — the private EloShapes CSV at `../Dataset/`, used to validate our
  rubric. Never shipped, never committed.
- **Shell** — a procedurally generated mouse body mesh.
