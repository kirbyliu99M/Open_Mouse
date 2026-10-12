import { notFound } from "next/navigation";

/**
 * Two guards, both called at the top of a route's page component.
 *
 * `guardDemoRouteFromProduction()`: closed only in a real production
 * deployment (`VERCEL_ENV === "production"`). It is for the printed-sheet
 * flow, `/sheet` (the printable ArUco calibration sheet) and `/scan` (its
 * photo step) (Kirby, 2026-10-11): the main scan flow is `/scan/easy` on any
 * blank A4 sheet, and nothing in the site links to the printed-sheet pages.
 * They stay for previews, the demos and the e2e tests, so `next dev` and
 * Vercel previews are unaffected. `/scan/easy` itself, the one public scan
 * page, must NOT call a guard.
 *
 * `guardDevOnlyRoute()`: open only on a local `next dev` (Kirby, 2026-10-11;
 * candidate). It is for the dev and demo routes and the learning kit. The demo
 * routes exist to reach states no e2e fixture can (no synthetic photo gets
 * MediaPipe to detect a hand, see tests/e2e/scan.spec.ts); `/scan/submit-demo`
 * and `/scan/measured-demo` mount real, wired-up components (`submit-demo`
 * really POSTs to `/api/scans`); `/results/demo` is fixture data with no place
 * in the product. The learning kit (`/learn/kit/**`, `/l/**`) is where Kirby
 * collects the learning data by hand, on his own machine (decision
 * 2026-09-30). (`/learn` itself is the public information page and is NOT
 * guarded.) Production, Vercel previews and a local `next start` all answer
 * 404, because a preview has no password and `NODE_ENV` is "production" in
 * every `next build` output. The e2e suite runs `next dev`
 * (playwright.config.ts), so its tests of these pages still work. Anything
 * that wants one of these pages against `next start` gets a 404 on purpose.
 */
export function guardDemoRouteFromProduction(): void {
  if (process.env.VERCEL_ENV === "production") notFound();
}

export function guardDevOnlyRoute(): void {
  // A real Vercel production deployment stays closed even if NODE_ENV were
  // ever set to "development" there by hand.
  if (
    process.env.NODE_ENV !== "development" ||
    process.env.VERCEL_ENV === "production"
  ) {
    notFound();
  }
}
