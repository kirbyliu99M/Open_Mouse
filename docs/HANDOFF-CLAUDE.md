# Backend handoff: Codex investigation

2026-09-21. Kirby handed backend work to Claude. Claude has already recorded the
new ownership in `AGENTS.md` and started work on `m1-data-layer`; these notes
preserve Codex's earlier read-only deployment investigation without changing
Claude's work. Codex owns frontend, browser-side hand measurement, and Blender/3D.
Classification scripts and rubric agreement statistics remain Claude's per the
updated working agreement. Cross-review applies; Kirby merges.

## Verified before the handoff

- Inspected M0 head: `f69a6b7e0b5b6039568cb950742bfc8915c67495` on `m0-scaffold`.
  Subsequent Claude changes are not covered by these results.
- [PR #3](https://github.com/kirbyliu99M/Open_Mouse/pull/3) was open and draft with
  no reviews. [Issue #1](https://github.com/kirbyliu99M/Open_Mouse/issues/1) contains
  the acceptance criteria.
- GitHub CI passed: [PR run, 85 seconds](https://github.com/kirbyliu99M/Open_Mouse/actions/runs/35581444083)
  and [push run](https://github.com/kirbyliu99M/Open_Mouse/actions/runs/35581439252).
  Local 16/16 unit and 2/2 E2E results in STATUS are from the preceding session;
  Codex did not rerun them during this investigation.
- Both Vercel checks still failed: [primary open-mouse](https://vercel.com/kirby-at-ntu/open-mouse/JDm8bRnzkC9Eum3nVwXt3V5MuFxt)
  and [duplicate open-mouse-4awb](https://vercel.com/kirby-at-ntu/open-mouse-4awb/DU79HNeMVRtstTcPG3W5yLVeQ1bm).
- The branch alias resolved to an older failed deployment. Use the exact PR
  check deployment ID when inspecting current logs.
- `vercel.cmd integration resource inspect open-mouse-db --json` confirmed
  Available status, Free plan (`free_v3`), and connection to `open-mouse` for
  Preview and Production. The environment listing showed integration-provided
  database variables for both scopes and `DATABASE_PRODUCTION_HOST` for Preview.
  Codex did not decrypt their values during this resume investigation.
- Codex made no backend, database, account-setting or deployment changes before
  the handoff. No licensed dataset was read or moved.

## Existing resource identifiers

| Resource                 | Identifier                                        |
| ------------------------ | ------------------------------------------------- |
| Vercel team              | `kirby-at-ntu` / `team_U9ESW3saIAMdHtIy7YSn2WuS`  |
| Primary Vercel project   | `open-mouse` / `prj_IQHFdn1iNSurDYTXFPIqgr66RZaO` |
| Neon resource            | `open-mouse-db` / `store_awKkwEWQtJOSOm6s`        |
| Marketplace installation | `icfg_tzFs0h5zugfw7nN6USH50KfS`                   |
| Neon project             | `rapid-salad-00847873`                            |

[Resource dashboard](https://vercel.com/kirby-at-ntu/~/stores/integration/store_awKkwEWQtJOSOm6s).
These are identifiers, not credentials.

## Remaining M0 evidence

After Preview branching and resource-ready deployment configuration are fixed,
redeploy `m0-scaffold`. Record the new Neon branch identity, an endpoint distinct
from production, successful versioned migration and `scaffold_checks` query,
and a Ready deployment URL. Preserve the production-endpoint guard and the free
plan. Confirm production remains unaffected. Update the PR and STATUS with the
measured results and obtain cross-review. Production deployment of the scaffold
follows review and merge.

Use `gh` and `vercel.cmd` on this host; `vercel.ps1` is blocked by PowerShell
execution policy. Both CLIs were authenticated. The resource connection CLI
exposes environment/prefix options but no Preview branching flag in its help.
No Neon CLI was found on PATH and Codex's browser inventory was empty.
Preserve existing ignored `.env.local` and `.vercel/`; never print credentials.

## Codex tool readiness

The Blender MCP tools are exposed, but the first status/scene requests did not
return before Codex stopped waiting. No scene was changed. Connection and
Blender-version verification remain separate from M4 implementation; existing
milestone gates still apply.
