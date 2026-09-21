# STATUS — live project board

**Codex: update this file in every PR.** It is the single source of truth for
where the project stands. Claude reads it before writing the next milestone spec.

_Last updated: 2026-09-21 · by: Claude (M1 gate revised; M0 + M1 specced)_

---

## Right now

**Current milestone:** M0 — Scaffold
**Next action:** Codex implements M0 from issue [#1](https://github.com/kirbyliu99M/Open_Mouse/issues/1).
**Blocked on:** nothing. M1 ([#2](https://github.com/kirbyliu99M/Open_Mouse/issues/2)) is specced and waiting on M0 merging.

---

## Milestone board

| # | Milestone | Gated | Status | PR | Notes |
|---|---|---|---|---|---|
| M0 | Scaffold | – | 🔜 ready | [#1](https://github.com/kirbyliu99M/Open_Mouse/issues/1) | repo, CI, Vercel, Neon branch-per-PR |
| M1 | Data layer + shape rubric | ✅ | ⬜ blocked by M0 | [#2](https://github.com/kirbyliu99M/Open_Mouse/issues/2) | **riskiest gate — see Risks**; rubric written |
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
| M1 flare direction | ≥ 85% (Inward/Flat/Outward) | – | – | – |
| M1 hump Center-vs-Back | ≥ 85% | – | – | – |
| M1 side curvature Inward-vs-Flat | ≥ 85% | – | – | – |
| M1 within-one-level (all three) | ≥ 90% | – | – | – |
| M1 computed Size | ≥ 85% exact | **89.5%** (Logitech, n=76) | 2026-09-21 | ✅ pass |
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
| 2026-09-21 | `Size` is computed, not classified: `L + 0.4*(W-64)` | Measured 91.5% exact / 99.8% within-one on n=1260; removes a descriptor from the vision task |
| 2026-09-21 | M1 gate rebased on direction + within-one-level | Hump and flare have no numeric proxy, and 88% of mice sit in 3 of 7 flare levels — exact 7-way agreement is a poor proxy for fitness for purpose |

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
  **Resolved 2026-09-21:** the gate now measures flare/hump *direction* plus
  within-one-level agreement — see PLAN §M1.
- `Size` was the opposite case and is now **computed, not classified**
  (89.5% exact on Logitech). One fewer descriptor for vision to get wrong.

**M2 depends on a human.** The accuracy gate cannot be attempted until Kirby
shoots the ground-truth fixture set.

**M3 coefficients are unvalidated.** They start from published sizing guidance and
stay provisional until tested against mice Kirby has actually owned and rated.

---

## Open questions

| # | Question | Owner | Status |
|---|---|---|---|
| 1 | ~~Revise the M1 gate to direction + within-one-level?~~ | Kirby | ✅ resolved 2026-09-21 — yes; gate updated in PLAN §M1 |
| 2 | Which Logitech models does Kirby own and can rate for M3 tuning? | Kirby | ⏳ open |

---

## Glossary

- **Descriptor** — one of the 8 shape fields (Shape, Hump placement, Front flare,
  Side curvature, Thumb rest, Ring finger rest, Size, Hand compatibility).
- **Gate** — a numeric threshold that must pass before the next milestone starts.
- **Fixture** — the private EloShapes CSV at `../Dataset/`, used to validate our
  rubric. Never shipped, never committed.
- **Shell** — a procedurally generated mouse body mesh.
