"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { ErrorScreen } from "@/components/errors/ErrorScreen";
import { RetryButton } from "@/components/errors/RetryButton";
import { ACTIONS, ERROR_COPY, RETRYING } from "@/components/errors/copy";
import { retry } from "@/components/errors/retry";

/**
 * The error boundary for every page under the root layout. It shows a fixed
 * message and, at most, the error's digest. It never renders `error.message`
 * or `error.stack`: in development they can carry internal detail, and this
 * screen is what a user sees.
 *
 * "Try again" stays focusable while it works (aria-disabled, not disabled) and
 * announces "Trying again…". Because the button keeps focus, and the heading
 * takes it when the screen is first shown or is mounted again by the boundary,
 * keyboard and screen-reader users are never left on the page body.
 */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <ErrorScreen
      eyebrow={ERROR_COPY.eyebrow}
      title={ERROR_COPY.title}
      message={ERROR_COPY.message}
      reference={error.digest}
      focusHeading
      status={pending ? RETRYING : undefined}
    >
      <RetryButton
        pending={pending}
        onRetry={() =>
          retry({
            reset,
            refresh: () => router.refresh(),
            startTransition,
          })
        }
      />
      <Link className="errorAction errorAction-secondary" href="/scan/easy">
        {ACTIONS.scan}
      </Link>
      <Link className="errorAction errorAction-secondary" href="/">
        {ACTIONS.home}
      </Link>
    </ErrorScreen>
  );
}
