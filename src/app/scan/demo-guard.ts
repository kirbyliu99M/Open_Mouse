import { notFound } from "next/navigation";

/**
 * Dev/demo routes exist to reach states no e2e fixture can (no synthetic
 * photo gets MediaPipe to detect a hand — see tests/e2e/scan.spec.ts).
 * `/scan/submit-demo` and `/scan/measured-demo` both mount real, wired-up
 * components: `submit-demo` really POSTs to `/api/scans`, and
 * `measured-demo` renders the real submit panel too. None of them should
 * exist once this ships — call this at the top of each route's page
 * component. `/results/demo` writes nothing, but it is fixture data with no
 * place in the product (and its own page title says "mock data"), so it is
 * guarded too.
 *
 * The learning kit (`/learn/kit/**`, `/l/**`) is guarded the same way: Kirby
 * collects the learning data by hand, on his own machine (decision
 * 2026-09-30), so those pages are not served anywhere else. (`/learn` itself
 * is the public information page and is NOT guarded.)
 *
 * Dev only (Kirby, 2026-10-11; candidate): these routes answer only on a local
 * `next dev` (`NODE_ENV === "development"`). Production, Vercel previews and a
 * local `next start` all answer 404, because a preview has no password and
 * `NODE_ENV` is "production" in every `next build` output. The e2e suite runs
 * `next dev` (playwright.config.ts), so its tests of these pages still work.
 * Anything that wants one of these pages against `next start` gets a 404 on
 * purpose.
 *
 * The function keeps its old name so the pages that call it (and the source
 * check in tests/unit/demo-guard.test.ts) do not change.
 */
export function guardDemoRouteFromProduction(): void {
  // A real Vercel production deployment stays closed even if NODE_ENV were
  // ever set to "development" there by hand.
  if (
    process.env.NODE_ENV !== "development" ||
    process.env.VERCEL_ENV === "production"
  ) {
    notFound();
  }
}
