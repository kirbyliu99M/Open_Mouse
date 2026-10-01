# Learning kit v2: data-collection proposal (2026-10-02)

**Status: proposal, for the repo owner agent to decide.** Nothing here changes code, `docs/STATUS.md`, `docs/learning/README.md` or any contract. It is saved on its own local branch (`proposal/data-collection-2026-10-02`, from `origin/main` at `497bdc8`) and has not been pushed.

Written by Claude on 2026-10-01/02 at Kirby's request, as a design of **how hand photos are collected** for the W7 ML phase. The documents are in Traditional Chinese.

## Contents

| File                           | What                                                                                                                                                                                                                         |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `protocol-v4-draft.md`         | The collection protocol (one sheet, one photographer, 30 seconds per person), what it can and cannot support, S0 pilot, needs for the code owners (section 9)                                                                |
| `prereg-2026-10-02.frozen.txt` | Criteria and held-out rule, written before any participant. **Byte-exact; do not edit or reformat.** SHA-256 `9e512612de4c8aeb2ef6faaeabec8079e629c4f0216c66b777e64a75deb3ce75`. A change is a new dated file, never an edit |
| `sheet-designs/`               | Three reference designs for the labelled A4 sheet (A, B, C), print-ready SVG at 100% with the real `ARUCO_MIP_36h12` ids 0–5, plus `overview.html` with a comparison table                                                   |
| `s0-log-template.csv`          | Stopwatch log for the S0 pilot                                                                                                                                                                                               |

## Fixed by Kirby (not for the owner agent to reopen)

1. Kirby is the only photographer. One A4 sheet. 30 seconds per participant.
2. The mass tier takes only **G02** (flat, fingers spread) and **G04** (claw grip), both top-down. Proposed count: G02 ×3, G04 ×2, to be confirmed by the S0 stopwatch.
3. **No caliper tier.** There is no ruler truth.
4. Participant info and consent are not on the measurement sheet. Consent is signed separately.
5. Photos may be sent to cloud AI. Consent covers this. Strip EXIF before any upload.
6. Criteria in the prereg file. Held-out is one participant per block of four, chosen by SHA-256 with a fixed seed; S0 ids P901–P912 are excluded.

## What this means for claims

Without ruler truth, results can be worded only as **agreement with the marker-sheet reference** and **retake repeatability**. Do not write "accurate to x mm" or "accurate against real hands" anywhere (UI, README, PR text). The M2 gate "±2 mm against the ruler" is dormant: it can neither pass nor fail.

## For the owner agent to decide

| #   | Decision                                               | Notes                                                                                                                                                                                                                                                  |
| --- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Which sheet: A, B or C                                 | Claude's recommendation is **B** (blank centre, six markers on the outer ring), pending S0. A keeps the product's marker positions and needs almost no new geometry code. C needs a graduation detector that does not exist and is not recommended yet |
| 2   | How to implement the single sheet                      | B needs a new layout function (marker positions differ from `computeSheetLayout()`); dictionary and ids stay. Content must stay within y ≤ 282 mm (15 mm print margin)                                                                                 |
| 3   | Sorter rules for the new sheet                         | Participant from the card-slot QR (`P###`); pose from shooting order; one extra shot allowed, logged                                                                                                                                                   |
| 4   | Evaluator changes                                      | Default pose G01 → G02; person-level bias and SD; path agreement; curl ratio (claw projected length ÷ same person's G02 hand length); allow a run with no truth                                                                                        |
| 5   | `truth.json` / protocol naming                         | Allow no truth at all; new protocol name `agreed-v2` so `candidate-v1` values are never mixed                                                                                                                                                          |
| 6   | Session manifest and participant fields                | Fields are listed in the protocol, sections 4 and 9                                                                                                                                                                                                    |
| 7   | EXIF stripping before cloud upload                     | `learn:sort` copies originals with full EXIF                                                                                                                                                                                                           |
| 8   | R2 / M2 wording in `docs/STATUS.md` and `docs/PLAN.md` | They state "±2 mm against the ruler"; with no truth that gate is unmeasured                                                                                                                                                                            |
| 9   | Whether and how to update `docs/learning/README.md`    | Not touched here                                                                                                                                                                                                                                       |

## Open items Claude could not settle

- The 30-second budget and the shot counts are estimates; only the S0 stopwatch settles them.
- The "assumed hand envelope" on the overview (hand length 160–210 mm, spread width up to 200 mm) is an assumption, not data.
- Three S0 checks decide A vs B: how often a spread hand covers a marker, whether the longest hands reach the ID slot, and how repeatable eyeball alignment is.
- The reference values come from the marker plane; if that plane is biased against real hands, ML will learn the bias and nothing here can detect it. Accepted by Kirby.

## Not done

No code, no schema, no CI, no `docs/STATUS.md` change, no push, no pull request. The literature review behind the design (`lit-review-hand-flexion-mano-2026-10-01.md`) stays outside the repo.
