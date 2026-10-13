"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Locale } from "@/lib/contracts/locale";
import { resultsAdditionsCopy } from "@/lib/copy/results-additions";
import {
  fetchReminderStatus,
  type ReminderStatus,
} from "@/lib/results/surveyReminder";

/**
 * The clipboard-list icon of lucide (ISC licence), drawn here because the
 * project carries no icon package. Decorative: the link has its own name.
 */
function ClipboardListIcon() {
  return (
    <svg
      className="results-topBar-reminderIcon"
      viewBox="0 0 24 24"
      width="24"
      height="24"
      aria-hidden="true"
      focusable="false"
    >
      <rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <path d="M12 11h4" />
      <path d="M12 16h4" />
      <path d="M8 11h.01" />
      <path d="M8 16h.01" />
    </svg>
  );
}

/** What the link draws for a status (no fetching, so it renders as markup). */
export function SurveyReminderView({
  status,
  language,
  onClick,
}: {
  status: ReminderStatus;
  language: Locale;
  /** Analytics only; the link behaves as before. */
  onClick?: () => void;
}) {
  const copy = resultsAdditionsCopy(language);
  const unanswered = status === "unanswered";
  return (
    <Link
      href="/account"
      className="results-topBar-reminder"
      onClick={onClick}
      aria-label={unanswered ? copy.reminderNameUnanswered : copy.reminderName}
      data-unanswered={unanswered ? "true" : undefined}
    >
      <ClipboardListIcon />
      {unanswered && (
        <span className="results-topBar-reminderDot" aria-hidden="true" />
      )}
    </Link>
  );
}

/**
 * The reminder in the top bar of the results pages: a 44 x 44 link to the
 * profile page, with a small dot while the person has not answered (the rule is
 * in `src/lib/results/surveyReminder.ts`). Until the answer is known there is
 * no dot, so nothing appears and disappears.
 */
export function SurveyReminderLink({
  language,
  onClick,
}: {
  language: Locale;
  /** Called on a click with whether the questionnaire is still unanswered (analytics only). */
  onClick?: (unanswered: boolean) => void;
}) {
  const [status, setStatus] = useState<ReminderStatus>("unknown");

  useEffect(() => {
    const controller = new AbortController();
    void fetchReminderStatus(controller.signal).then((next) => {
      if (!controller.signal.aborted) setStatus(next);
    });
    return () => controller.abort();
  }, []);

  return (
    <SurveyReminderView
      status={status}
      language={language}
      onClick={onClick ? () => onClick(status === "unanswered") : undefined}
    />
  );
}
