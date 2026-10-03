import type { Metadata } from "next";
import Link from "next/link";
import { ErrorScreen } from "@/components/errors/ErrorScreen";
import { ACTIONS, NOT_FOUND_COPY } from "@/components/errors/copy";

export const metadata: Metadata = {
  title: NOT_FOUND_COPY.pageTitle,
  robots: { index: false, follow: false },
};

/**
 * Every unknown URL, and every `notFound()` (a guarded demo route in
 * production, a results page that does not exist). Next sends the 404 status.
 */
export default function NotFound() {
  return (
    <ErrorScreen
      eyebrow={NOT_FOUND_COPY.eyebrow}
      title={NOT_FOUND_COPY.title}
      message={NOT_FOUND_COPY.message}
    >
      <Link className="errorAction errorAction-primary" href="/scan/easy">
        {ACTIONS.scan}
      </Link>
      <Link className="errorAction errorAction-secondary" href="/">
        {ACTIONS.home}
      </Link>
    </ErrorScreen>
  );
}
