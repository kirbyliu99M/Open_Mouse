# AGENTS.md — Working Agreement

**Read this before every task. Read `docs/STATUS.md` next — it is the live state of the project.**

Open_Mouse measures a user's hand from guided photos, scores mice against those
measurements, renders a 3D simulation, and has Gemini write the analysis.
Full design: `docs/PLAN.md`.

## Roles

_Revised 2026-09-21: backend implementation moved from Codex to Claude._

| Agent | Owns | Never does |
|---|---|---|
| **Claude** — backend + architecture | Plan, specs, gate adjudication, shape rubric. **Builds:** schema + migrations, seed and classification scripts, rubric validation, API route handlers, fit engine (M3), Gemini (M5), sessions/auth/cron (M6), CI and infra, and `src/lib/contracts/` | Merges its own PR |
| **Codex** — frontend + 3D | **Builds:** pages and UI, camera capture, in-browser ArUco/MediaPipe pipeline and landmark→mm math, the printable calibration sheet, three.js runtime (M4b), Blender asset pipeline (M4a) | Merges its own PR; writes to the DB or calls Gemini directly |
| **Kirby** | Ground-truth photos, rubric spot-checks, silhouette review, account/dashboard config, secrets, merges, final acceptance | — |

### Directory ownership

| Path | Owner |
|---|---|
| `src/db/`, `drizzle/`, `scripts/`, `src/app/api/`, `src/server/`, `.github/` | Claude |
| `src/app/**` pages and layouts, `src/components/`, `src/client/`, `tools/blender/`, `public/` | Codex |
| `src/lib/contracts/` | **Claude writes, both consume.** The only shared seam. |
| `docs/STATUS.md` | Both — every PR updates it |

Touching the other agent's paths is allowed for a one-line fix that unblocks you;
anything larger is a request to the owner, logged in `docs/STATUS.md`.

### Cross-review

Neither agent merges its own work. **Claude reviews Codex's PRs; Codex reviews
Claude's.** The reviewer checks the milestone's acceptance criteria and the five
hard rules below, then approves. Kirby merges.

### The contract seam

Frontend and backend meet only at `src/lib/contracts/` — runtime-validated schemas
for the measurement payload the browser sends and the fit result it gets back.
Change a contract only in a PR of its own, so both sides see it land at once.

## The five hard rules

1. **Never commit licensed data.** The EloShapes CSV lives *outside* this repo
   (`../Dataset/`) and is gitignored twice over. It is a private validation
   fixture only. Never copy it in, never paste rows into code, tests, or docs,
   never let its editorial values reach a seed file. If you need it, read it
   from `../Dataset/` at runtime in a script that never runs in CI.

2. **The LLM never computes.** Every number a user sees originates in tested
   TypeScript. Gemini receives finished values and writes prose about them.
   There is a test asserting no numeral appears in model output that was not in
   the input — do not weaken it.

3. **Critical-path logic is pure and tested.** Homography, landmark→mm
   extraction, the six scorers, and shell parameter generation are pure
   functions. A pure function on the critical path without a unit test is not
   done.

4. **Gates are hard stops, and evidence is numbers.** M1, M2, and M4 have
   numeric gates in `docs/PLAN.md`. Post actual measured values in the PR. "Looks
   good" is not evidence. If a gate fails, the *implementation or rubric* gets
   revised — never the gate. Raise it with Claude instead.

5. **Photos never leave the browser.** MediaPipe and ArUco run client-side via
   WASM. Only derived millimetre values are POSTed. Any change that sends an
   image to a server breaks a promise made in the UI — stop and raise it.

## Conventions

- **Branches:** `m<N>-<slug>` (e.g. `m0-scaffold`, `m2-calibration`).
- **PRs:** reference the milestone issue, state gate evidence, keep to one
  milestone *and one side of the seam*. CI green *and* Vercel preview live before
  requesting review. A milestone that spans both sides (M2, M6) is two PRs.
- **TypeScript:** strict. No `any` on the critical path.
- **DB:** Drizzle with `@neondatabase/serverless` HTTP driver.
  **Never `pg.Pool`** — connections are not reused between serverless invocations.
- **Secrets:** server-side only. `GEMINI_API_KEY` must never reach the client
  bundle. All Gemini calls go through route handlers.
- **Blender:** `bpy` 5.2.2, Python 3.13 only. Keep it out of the default CI job
  (340 MB wheel); generation runs on `workflow_dispatch`.

## Definition of done

- [ ] Acceptance criteria in the milestone issue all met
- [ ] Unit tests for every new pure function
- [ ] CI green; Vercel preview deploys
- [ ] Gate evidence posted as numbers (gated milestones)
- [ ] **`docs/STATUS.md` updated** — milestone row, decisions, blockers
- [ ] No licensed data anywhere in the diff or in `git log -p`
