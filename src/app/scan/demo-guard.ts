import { notFound } from "next/navigation";

/**
 * Dev/demo routes exist to reach states no e2e fixture can (no synthetic
 * photo gets MediaPipe to detect a hand — see tests/e2e/scan.spec.ts).
 * `/scan/submit-demo` and `/scan/measured-demo` both mount real, wired-up
 * components: `submit-demo` really POSTs to `/api/scans`, and
 * `measured-demo` renders the real submit panel too. None of them should
 * exist once this ships to production — call this at the top of each route's
 * page component. `/results/demo` writes nothing, but it is fixture data with
 * no place in the product (and its own page title says "mock data"), so it is
 * guarded too.
 *
 * The learning kit (`/learn/**`, `/l/**`) is guarded the same way: Kirby
 * collects the learning data by hand, on his own machine (decision 2026-09-30),
 * so those pages are not served in production.
 *
 * The printed-sheet flow, `/sheet` (the printable ArUco calibration sheet) and
 * `/scan` (its photo step), is guarded too (Kirby, 2026-10-11): the
 * main scan flow is `/scan/easy` on any blank A4 sheet, and nothing in the
 * site links to the printed-sheet pages. They stay for the learning kit, the
 * demos and the e2e tests, which run under `next dev`. `/scan/easy` itself,
 * the one public scan page, must NOT call this guard.
 *
 * Only a real production deployment (`VERCEL_ENV === "production"`) answers
 * 404. `next dev`, which the e2e suite runs, and Vercel previews are
 * unaffected.
 */
export function guardDemoRouteFromProduction(): void {
  if (process.env.VERCEL_ENV === "production") notFound();
}
