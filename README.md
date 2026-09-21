# Open_Mouse

Scan your hand with your phone. Get mice that actually fit it.

Open_Mouse measures a hand from three guided photos against a printed
calibration sheet, scores every mouse in its catalogue on six dimensions of fit,
renders your measured hand on the recommended shells in 3D, and explains the
result in plain language.

> Testing whether 3D shape modelling can genuinely help a buying decision —
> rather than the usual "large hands: buy a large mouse."

## How it works

1. **Calibrate** — print one L-fold sheet carrying four ArUco markers on a
   180 × 180 mm square (identical on A4 and Letter). A bank card in frame
   cross-checks that your printer didn't silently scale the page.
2. **Capture** — three shots: hand flat, hand on edge, hand cupped. ArUco gives a
   homography that fixes both scale *and* perspective; MediaPipe gives 21
   landmarks. **All of this runs in your browser — the photos never leave your
   device.** Only millimetres are sent.
3. **Score** — a deterministic engine rates length, grip width, height/hump,
   front flare, thumb comfort and weight, each with a reason.
4. **Simulate** — your measured hand, posed to your grip style, rendered on
   procedurally generated shells with a contact map.
5. **Explain** — Gemini writes the narrative. It never does the arithmetic.

## Status

Pre-M0. See **[`docs/STATUS.md`](docs/STATUS.md)** for the live board,
**[`docs/PLAN.md`](docs/PLAN.md)** for the full design, and
**[`AGENTS.md`](AGENTS.md)** if you are an agent working on this repo.

## Stack

Next.js 15 · TypeScript (strict) · Drizzle + Neon Postgres · three.js ·
MediaPipe Tasks Vision · js-aruco2 · Blender (`bpy`) for build-time geometry ·
Vercel · Vitest + Playwright

## Data provenance

The catalogue is seeded from **manufacturers' own published dimensions**, with
shape descriptors derived independently via [`docs/shape-rubric.md`](docs/shape-rubric.md).
No third-party database is redistributed. Licensed reference data used during
development stays outside this repository and is never committed.

## Licence

None yet — private repository.
