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
 * Only a real production deployment (`VERCEL_ENV === "production"`) answers
 * 404. `next dev`, which the e2e suite runs, and Vercel previews are
 * unaffected.
 */
export function guardDemoRouteFromProduction(): void {
  if (process.env.VERCEL_ENV === "production") notFound();
}
