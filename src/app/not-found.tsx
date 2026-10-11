import type { Metadata } from "next";
import Link from "next/link";
import { ErrorScreen } from "@/components/errors/ErrorScreen";
import { errorsCopy } from "@/lib/copy/errors";
import { getLocale } from "@/server/i18n/getLocale";

export async function generateMetadata(): Promise<Metadata> {
  return {
    // The page name only: the root layout's title template adds the site name.
    title: errorsCopy(await getLocale()).notFound.pageTitle,
    robots: { index: false, follow: false },
  };
}

/**
 * Every unknown URL, and every `notFound()` (a guarded demo route in
 * production, a results page that does not exist). Next sends the 404 status.
 */
export default async function NotFound() {
  const copy = errorsCopy(await getLocale());
  return (
    <ErrorScreen
      eyebrow={copy.notFound.eyebrow}
      title={copy.notFound.title}
      message={copy.notFound.message}
      referenceLabel={copy.referenceLabel}
    >
      <Link className="errorAction errorAction-primary" href="/scan/easy">
        {copy.actions.scan}
      </Link>
      <Link className="errorAction errorAction-secondary" href="/">
        {copy.actions.home}
      </Link>
    </ErrorScreen>
  );
}
