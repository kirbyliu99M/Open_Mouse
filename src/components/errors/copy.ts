/**
 * Every sentence on the not-found and error screens, in one place, so the
 * screens, their tests and the pull request's copy table read the same text.
 * All of it is pending Kirby's confirmation.
 *
 * None of these screens ever shows an error's message, stack or a file path:
 * in development those can hold internal detail, and in production Next
 * already replaces them with a digest. The only thing an error screen may
 * print about the failure is that digest (a hash that lets a developer find
 * the matching server log line), labelled `REFERENCE_LABEL`.
 */
export const ACTIONS = {
  home: "Back to home",
  scan: "Scan my hand",
  retry: "Try again",
} as const;

export const NOT_FOUND_COPY = {
  eyebrow: "Error 404",
  title: "We can’t find that page",
  message:
    "The link may be out of date, or the page may have moved. You can head back home or start a scan.",
  documentTitle: "Page not found — Open_Mouse",
} as const;

export const ERROR_COPY = {
  eyebrow: "Something went wrong",
  title: "That didn’t work",
  message:
    "We couldn’t show this page. Try again, or head back home and start from there.",
} as const;

export const GLOBAL_ERROR_COPY = {
  eyebrow: "Something went wrong",
  title: "Open_Mouse hit a problem",
  message:
    "The app couldn’t recover on its own. Try again, or head back home and start from there.",
  documentTitle: "Something went wrong — Open_Mouse",
} as const;

export const REFERENCE_LABEL = "Reference";

/** Announced (role=status) while the Try again request is running. */
export const RETRYING = "Trying again…";
