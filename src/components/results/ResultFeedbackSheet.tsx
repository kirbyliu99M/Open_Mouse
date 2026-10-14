"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { Locale } from "@/lib/contracts/locale";
import {
  RESULT_FEEDBACK_MAX_STARS,
  RESULT_FEEDBACK_MIN_STARS,
} from "@/lib/contracts/result-feedback";
import { MAX_FEEDBACK_CHARS } from "@/lib/contracts/survey";
import { questionnaireCopy } from "@/lib/copy/questionnaire";
import { resultFeedbackCopy } from "@/lib/copy/result-feedback";
import {
  RESULT_FEEDBACK_DWELL_MS,
  buildSubmission,
  reachedEnd,
  fetchAnswered,
  markFeedbackDone,
  readFeedbackDone,
  sendFeedback,
  shouldShowSheet,
  type SendFailure,
} from "@/lib/results/resultFeedback";

const STARS = Array.from(
  { length: RESULT_FEEDBACK_MAX_STARS - RESULT_FEEDBACK_MIN_STARS + 1 },
  (_, i) => i + RESULT_FEEDBACK_MIN_STARS,
);

type Phase = "form" | "sending" | "thanks" | "already";

/**
 * The feedback sheet of the results page (Kirby, 2026-10-14): a bottom sheet
 * that does not block the page (no backdrop, no focus trap) and is announced
 * politely. It appears when the end of the list has scrolled into view or the
 * person has been on the page `RESULT_FEEDBACK_DWELL_MS`, whichever comes
 * first, and only if `GET` says the scan was not rated and this device has not
 * closed it. The rules are in `src/lib/results/resultFeedback.ts`. Renders an
 * invisible marker for the end of the list; mount it after the last block.
 */
export function ResultFeedbackSheet({
  scanId,
  language,
}: {
  scanId: string;
  language: Locale;
}) {
  const copy = resultFeedbackCopy(language);
  const qn = questionnaireCopy(language);
  const uid = useId();
  const markerRef = useRef<HTMLDivElement>(null);

  const [answered, setAnswered] = useState<boolean | null>(null);
  const [localDone, setLocalDone] = useState(false);
  const [markerInView, setMarkerInView] = useState(false);
  const [scrollMovedPx, setScrollMovedPx] = useState(0);
  const [sheetHeight, setSheetHeight] = useState(0);
  const sheetRef = useRef<HTMLElement>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [opened, setOpened] = useState(false);
  const [phase, setPhase] = useState<Phase>("form");
  const [stars, setStars] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [commentOpen, setCommentOpen] = useState(false);
  const [failure, setFailure] = useState<SendFailure | null>(null);

  // This device's memory and the server's status, asked once.
  useEffect(() => {
    if (readFeedbackDone(scanId)) {
      setLocalDone(true);
      return;
    }
    const controller = new AbortController();
    void fetchAnswered(scanId, controller.signal).then((next) => {
      if (!controller.signal.aborted) setAnswered(next);
    });
    return () => controller.abort();
  }, [scanId]);

  // The dwell time.
  useEffect(() => {
    const timer = window.setTimeout(
      () => setElapsedMs(RESULT_FEEDBACK_DWELL_MS),
      RESULT_FEEDBACK_DWELL_MS,
    );
    return () => window.clearTimeout(timer);
  }, []);

  // The end of the list in view, and whether the person really scrolled (the
  // marker already in view on load does not count).
  useEffect(() => {
    const marker = markerRef.current;
    if (!marker || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      const last = entries[entries.length - 1];
      if (last) setMarkerInView(last.isIntersecting);
    });
    observer.observe(marker);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const startY = window.scrollY;
    const onScroll = () =>
      setScrollMovedPx(Math.max(0, Math.abs(window.scrollY - startY)));
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  const scrolledToEnd = reachedEnd({ markerInView, scrollMovedPx });

  const show = shouldShowSheet({
    answered,
    dismissedLocally: localDone,
    scrolledToEnd,
    elapsedMs,
    isDemo: false,
  });
  // Once shown it stays until closed.
  useEffect(() => {
    if (show) setOpened(true);
  }, [show]);

  const visible = opened && !localDone;

  // Room under the page for the sheet, so the last block can be scrolled past it.
  useEffect(() => {
    const sheet = sheetRef.current;
    if (!visible || !sheet) {
      setSheetHeight(0);
      return;
    }
    const measure = () => setSheetHeight(sheet.offsetHeight);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(sheet);
    return () => observer.disconnect();
  }, [visible, phase, commentOpen, failure]);

  const close = () => {
    if (phase === "sending") return;
    markFeedbackDone(scanId);
    setLocalDone(true);
  };

  const submit = async () => {
    if (phase === "sending") return;
    const built = buildSubmission({ stars, comment, locale: language });
    if (!built.ok) {
      setFailure(built.reason);
      return;
    }
    setFailure(null);
    setPhase("sending");
    const result = await sendFeedback(scanId, built.body);
    if (result.ok) {
      markFeedbackDone(scanId);
      setPhase("thanks");
      return;
    }
    if (result.reason === "conflict") {
      markFeedbackDone(scanId);
      setPhase("already");
      return;
    }
    setFailure(result.reason);
    setPhase("form");
  };

  const failureText =
    failure === null
      ? null
      : failure === "rate_limited"
        ? qn.rateLimited
        : failure === "invalid_feedback"
          ? qn.sendFeedbackInvalid
          : failure === "invalid_comment"
            ? copy.commentChars
            : failure === "invalid"
              ? qn.sendInvalid
              : qn.sendNetwork;

  const announcement = !visible
    ? ""
    : phase === "thanks"
      ? copy.done
      : phase === "already"
        ? copy.already
        : copy.title;

  return (
    <>
      <div
        ref={markerRef}
        className="results-feedback-marker"
        aria-hidden="true"
      />
      {/* Always in the page, so the text added to it is announced. */}
      <p className="results-srOnly" role="status" aria-live="polite">
        {announcement}
      </p>
      {visible && <div aria-hidden="true" style={{ height: sheetHeight }} />}
      {visible && (
        <section
          ref={sheetRef}
          className="results-feedback"
          aria-label={copy.title}
          onKeyDown={(event) => {
            if (event.key === "Escape") close();
          }}
        >
          {phase === "thanks" || phase === "already" ? (
            <div className="results-feedback-body">
              <p className="results-feedback-title">
                {phase === "thanks" ? copy.done : copy.already}
              </p>
              <button
                type="button"
                className="results-feedback-primary"
                onClick={close}
              >
                {copy.close}
              </button>
            </div>
          ) : (
            <div className="results-feedback-body">
              <p className="results-feedback-title">{copy.title}</p>
              <fieldset
                className="results-feedback-stars"
                disabled={phase === "sending"}
              >
                <legend className="results-srOnly">{copy.starsGroup}</legend>
                <div className="results-feedback-starRow" role="radiogroup">
                  {STARS.map((n) => (
                    <span key={n} className="results-feedback-star">
                      <input
                        type="radio"
                        name={`${uid}-stars`}
                        id={`${uid}-star-${n}`}
                        value={n}
                        checked={stars === n}
                        aria-label={copy.starName(n)}
                        onChange={() => setStars(n)}
                      />
                      <label
                        htmlFor={`${uid}-star-${n}`}
                        data-filled={
                          stars !== null && n <= stars ? "true" : undefined
                        }
                        aria-hidden="true"
                      >
                        ★
                      </label>
                    </span>
                  ))}
                </div>
                <p className="results-feedback-ends" aria-hidden="true">
                  <span>{copy.lowLabel}</span>
                  <span>{copy.highLabel}</span>
                </p>
              </fieldset>

              {commentOpen ? (
                <div className="results-feedback-comment">
                  <textarea
                    aria-label={copy.commentLabel}
                    value={comment}
                    rows={3}
                    maxLength={MAX_FEEDBACK_CHARS}
                    placeholder={copy.placeholder}
                    aria-describedby={`${uid}-count`}
                    disabled={phase === "sending"}
                    onChange={(event) => setComment(event.target.value)}
                  />
                  <span id={`${uid}-count`} className="results-feedback-count">
                    {qn.commentCount(comment.length, MAX_FEEDBACK_CHARS)}
                  </span>
                </div>
              ) : (
                <button
                  type="button"
                  className="results-feedback-link"
                  onClick={() => setCommentOpen(true)}
                >
                  {copy.more}
                </button>
              )}

              <p className="results-feedback-notice">{copy.notice}</p>
              {failureText && (
                <p className="results-feedback-error" role="alert">
                  {failureText}
                </p>
              )}
              <div className="results-feedback-actions">
                <button
                  type="button"
                  className="results-feedback-link"
                  onClick={close}
                  disabled={phase === "sending"}
                >
                  {copy.dismiss}
                </button>
                <button
                  type="button"
                  className="results-feedback-primary"
                  disabled={stars === null || phase === "sending"}
                  onClick={() => void submit()}
                >
                  {phase === "sending" ? copy.sending : copy.send}
                </button>
              </div>
            </div>
          )}
        </section>
      )}
    </>
  );
}
