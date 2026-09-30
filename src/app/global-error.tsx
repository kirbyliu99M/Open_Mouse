"use client";

import { ErrorScreen } from "@/components/errors/ErrorScreen";
import { ACTIONS, GLOBAL_ERROR_COPY } from "@/components/errors/copy";

/**
 * The last resort: an error in the root layout itself. It replaces the whole
 * document, so it brings its own `<html>` and `<body>` (the root layout is
 * gone) and its own styles. Plain `<a>` links, because the app router may be
 * what failed. Shows a fixed message and, at most, the error's digest.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <head>
        <title>{GLOBAL_ERROR_COPY.documentTitle}</title>
        <meta name="robots" content="noindex, nofollow" />
      </head>
      <body className="errorBody">
        <ErrorScreen
          eyebrow={GLOBAL_ERROR_COPY.eyebrow}
          title={GLOBAL_ERROR_COPY.title}
          message={GLOBAL_ERROR_COPY.message}
          reference={error.digest}
          focusHeading
        >
          <button
            type="button"
            className="errorAction errorAction-primary"
            onClick={() => reset()}
          >
            {ACTIONS.retry}
          </button>
          {/* Plain anchors on purpose: a full page load is what recovers from a
              failure in the root layout, and the app router may be what broke. */}
          <a className="errorAction errorAction-secondary" href="/scan/easy">
            {ACTIONS.scan}
          </a>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- see above */}
          <a className="errorAction errorAction-secondary" href="/">
            {ACTIONS.home}
          </a>
        </ErrorScreen>
      </body>
    </html>
  );
}
