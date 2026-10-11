"use client";

import { useEffect, useState } from "react";
import { DEFAULT_LOCALE, type Locale } from "@/lib/contracts/locale";
import { errorsCopy } from "@/lib/copy/errors";
import { ErrorScreen } from "@/components/errors/ErrorScreen";
import { localeFromBrowser } from "@/components/errors/browser-locale";
import { reloadPage } from "@/components/errors/reload";
import { ReportError } from "@/components/errors/ReportError";

/**
 * The last resort: an error in the root layout itself. It replaces the whole
 * document, so it brings its own `<html>` and `<body>` (the root layout is
 * gone) and its own styles. Plain `<a>` links, because the app router may be
 * what failed. Shows a fixed message and, at most, the error's digest.
 *
 * "Try again" reloads the page. It does NOT call `reset()` (the prop Next
 * passes): that re-renders with the payload the boundary already holds, which
 * for a server-side failure is the failure itself. See reload.ts.
 *
 * `<ReportError>` sends the error to Sentry.
 *
 * Language: the root layout's locale is gone too, so the screen starts in the
 * site default (the server cannot read the cookie here) and, once mounted,
 * switches to the visitor's cookie or browser language, setting `<html lang>`
 * with it. `initialLocale` is only for tests; Next never passes it.
 */
export default function GlobalError({
  error,
  initialLocale = DEFAULT_LOCALE,
}: {
  error: Error & { digest?: string };
  reset?: () => void;
  initialLocale?: Locale;
}) {
  const [locale, setLocale] = useState<Locale>(initialLocale);
  useEffect(() => {
    setLocale(localeFromBrowser(document.cookie, navigator.languages));
  }, []);
  const copy = errorsCopy(locale);
  return (
    <html lang={locale}>
      <head>
        <title>{copy.globalError.documentTitle}</title>
        <meta name="robots" content="noindex, nofollow" />
      </head>
      <body className="errorBody">
        <ReportError error={error} />
        <ErrorScreen
          eyebrow={copy.globalError.eyebrow}
          title={copy.globalError.title}
          message={copy.globalError.message}
          reference={error.digest}
          referenceLabel={copy.referenceLabel}
          focusHeading
        >
          <button
            type="button"
            className="errorAction errorAction-primary"
            onClick={() => reloadPage()}
          >
            {copy.actions.retry}
          </button>
          {/* Plain anchors on purpose: a full page load is what recovers from a
              failure in the root layout, and the app router may be what broke. */}
          <a className="errorAction errorAction-secondary" href="/scan/easy">
            {copy.actions.scan}
          </a>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- see above */}
          <a className="errorAction errorAction-secondary" href="/">
            {copy.actions.home}
          </a>
        </ErrorScreen>
      </body>
    </html>
  );
}
