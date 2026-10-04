import type { Metadata } from "next";
import { guardDemoRouteFromProduction } from "../demo-guard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Error screen (dev only)",
  robots: { index: false, follow: false },
};

/**
 * What the thrown error says. tests/e2e/error-pages.spec.ts repeats this text
 * and checks that none of it reaches the screen: the message, the file path,
 * the stack. (Not exported: a Next page file may only export page fields.)
 */
const DEMO_ERROR_MESSAGE =
  "DEMO-ERROR-MESSAGE-MUST-NOT-BE-SHOWN /srv/app/internal/secret-path.ts";

/**
 * Dev/demo route that throws on purpose, so the error boundary
 * (`src/app/error.tsx`) can be exercised end to end: no other page fails
 * reliably. 404s in production like every other route in this folder
 * (`guardDemoRouteFromProduction`).
 */
export default function ErrorDemoPage(): never {
  guardDemoRouteFromProduction();
  throw new Error(DEMO_ERROR_MESSAGE);
}
