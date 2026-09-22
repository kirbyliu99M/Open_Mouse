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
2. **Photograph** — three pictures on your phone: hand flat, hand on edge, hand
   cupped, uploaded one per slot. ArUco gives a homography that fixes both scale
   _and_ perspective; MediaPipe gives 21 landmarks. **All of this runs in your
   browser — the photos never leave your device.** Only millimetres are sent.
3. **Score** — a deterministic engine rates length, grip width, height/hump,
   front flare, thumb comfort and weight, each with a reason.
4. **Simulate** — your measured hand, posed to your grip style, rendered on
   procedurally generated shells with a contact map.
5. **Explain** — Gemini writes the narrative. It never does the arithmetic.

## Status

M0 scaffold in progress. See **[`docs/STATUS.md`](docs/STATUS.md)** for the live board,
**[`docs/PLAN.md`](docs/PLAN.md)** for the full design, and
**[`AGENTS.md`](AGENTS.md)** if you are an agent working on this repo.

## Stack

Next.js 15 · TypeScript (strict) · Drizzle + Neon Postgres · three.js ·
MediaPipe Tasks Vision · js-aruco2 · Blender (`bpy`) for build-time geometry ·
Vercel · Vitest + Playwright

## Local development

Use Node.js 24 and npm. From the repository root:

```sh
npm ci
npm run dev
```

Open http://localhost:3000. The placeholder page does not require credentials.
For database work, copy `.env.example` to `.env.local` and replace the example
connection strings with the development branch values. Never use production
credentials for local development. The Gemini variable is reserved for M5.

```sh
npm run typecheck
npm run lint
npm run format:check
npm run test
npx playwright install chromium
npm run test:e2e
npm run build
```

Playwright starts its own dev server on port 3100 and checks desktop and mobile
Chromium. CI runs the same checks with a five-minute job limit. No database
credentials or Blender installation are required in GitHub Actions.

## Database migrations

Edit `src/db/schema.ts`, run `npm run db:generate`, and commit both the generated
SQL and Drizzle metadata in `drizzle/`. `npm run db:check` checks migration
history; CI regenerates migrations and fails if the schema has drifted. Do not
use schema push. M0 contains only the infrastructure table `scaffold_checks`.

`npm run db:migrate` applies the versioned migrations using Drizzle's Neon HTTP
driver and the unpooled connection from the current environment. It then queries
the scaffold table to verify the connection. It never logs connection strings.
The application uses the pooled connection through a server-only, lazy client.

## Vercel and Neon

1. Link the GitHub repository to the Vercel project. `vercel.json` declares the
   Next.js framework even if the repository was imported before the app existed.
2. Connect a Neon database through the Vercel Marketplace. Enable **Create a
   branch for each deployment** for Preview; use separate development and
   production branches. The integration supplies the two database variables.
   Set the Preview-only `DATABASE_PRODUCTION_HOST` variable to the hostname from
   the production database URL (no username, password, or path). Preview
   migrations refuse that endpoint, including its pooled hostname variant.
3. A PR preview runs `npm run vercel-build`: migrate the isolated preview branch,
   verify the table over HTTP, then build Next.js. Missing database configuration
   fails the preview build rather than silently omitting the migration check.
4. Record the deployment URL, Neon preview branch identity, and successful
   migration log in the PR. Confirm the preview endpoint differs from production.
5. Production builds do not automatically migrate. Apply reviewed migrations
   explicitly against the production environment before releasing code that
   needs them. M0's placeholder does not access the database.

The [Neon integration guide](https://neon.com/docs/guides/vercel-managed-integration)
describes preview branching. A successful static deployment alone does not prove
database isolation; M0 remains open until its preview branch has been verified.

## Data provenance

The catalogue is seeded from **manufacturers' own published dimensions**, with
shape descriptors derived independently via [`docs/shape-rubric.md`](docs/shape-rubric.md).
No third-party database is redistributed. Licensed reference data used during
development stays outside this repository and is never committed.

## Licence

None yet — private repository.
