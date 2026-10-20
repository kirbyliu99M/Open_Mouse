import { useId, type HTMLAttributes, type Ref } from "react";
import type { Locale } from "@/lib/contracts/locale";
import {
  RESULT_FEEDBACK_MAX_STARS,
  RESULT_FEEDBACK_MIN_STARS,
} from "@/lib/contracts/result-feedback";
import { MAX_FEEDBACK_CHARS } from "@/lib/contracts/survey";
import {
  questionnaireCopy,
  type QuestionnaireCopy,
} from "@/lib/copy/questionnaire";
import {
  resultFeedbackCopy,
  type ResultFeedbackCopy,
} from "@/lib/copy/result-feedback";
import {
  commentVisible,
  primaryLabel,
  showSubmit,
  type SendFailure,
  type SheetPhase,
} from "@/lib/results/resultFeedback";

const STARS = Array.from(
  { length: RESULT_FEEDBACK_MAX_STARS - RESULT_FEEDBACK_MIN_STARS + 1 },
  (_, i) => i + RESULT_FEEDBACK_MIN_STARS,
);

/** The words for a refused or failed send (rate limit, contact details and invalid are the questionnaire's own). */
export function failureText(
  failure: SendFailure | null,
  copy: ResultFeedbackCopy,
  qn: QuestionnaireCopy,
): string | null {
  switch (failure) {
    case null:
      return null;
    case "rate_limited":
      return qn.rateLimited;
    case "invalid_feedback":
      return qn.sendFeedbackInvalid;
    case "invalid_comment":
      return copy.commentChars;
    case "invalid":
      return qn.sendInvalid;
    case "stale":
      return copy.resultChanged;
    default:
      // "network", and "conflict" (which the sheet handles as "already").
      return copy.sendFailed;
  }
}

const iconProps = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
  focusable: false,
} as const;

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" {...iconProps}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}
function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" {...iconProps}>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 018 0v3" />
    </svg>
  );
}
function ChevronIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" {...iconProps}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}
function CheckIcon({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} {...iconProps}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}
function CrossIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" {...iconProps}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}
function UndoIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" {...iconProps}>
      <path d="M9 14L4 9l5-5" />
      <path d="M4 9h10a6 6 0 010 12h-3" />
    </svg>
  );
}
function AlertIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" {...iconProps}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5M12 16.5v.01" />
    </svg>
  );
}

const STAR_PATH =
  "M12 3l2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 16.8 6.6 19.8l1.1-6.1L3.2 9.4l6.1-.8L12 3z";

/** One star: a hollow outline when not chosen, a solid shape when chosen. */
function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="40" height="40" aria-hidden="true">
      {filled ? (
        <path
          d={STAR_PATH}
          fill="currentColor"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      ) : (
        <path
          d={STAR_PATH}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

export interface ResultFeedbackPanelProps {
  language: Locale;
  phase: SheetPhase;
  stars: number | null;
  comment: string;
  notesOpen: boolean;
  failure: SendFailure | null;
  sectionRef?: Ref<HTMLElement>;
  sheetRef?: Ref<HTMLDivElement>;
  /** Pointer handlers of the drag handle (phones only; the handle is hidden on a desktop). */
  handleHandlers?: HTMLAttributes<HTMLDivElement>;
  onStars: (n: number) => void;
  onComment: (value: string) => void;
  onToggleNotes: () => void;
  onSubmit: () => void;
  onClose: () => void;
  /** Escape was pressed; `composing` is true while an input method is composing. */
  onEscape: (composing: boolean) => void;
}

/**
 * What the feedback sheet draws (v2, Pencil frames A to E), as a controlled
 * component: the container (`ResultFeedbackSheet`) owns the timing, the
 * memory, the network and the focus. A and B are one layout; the comment box
 * and the submit button appear once a star is chosen, and the data note is a
 * disclosure under the link.
 */
export function ResultFeedbackPanel({
  language,
  phase,
  stars,
  comment,
  notesOpen,
  failure,
  sectionRef,
  sheetRef,
  handleHandlers,
  onStars,
  onComment,
  onToggleNotes,
  onSubmit,
  onClose,
  onEscape,
}: ResultFeedbackPanelProps) {
  const copy = resultFeedbackCopy(language);
  const qn = questionnaireCopy(language);
  const uid = useId();
  const sending = phase === "sending";
  const finished = phase === "thanks" || phase === "already";
  const error = failureText(failure, copy, qn);
  const label = primaryLabel(phase, failure);
  const labels: Record<typeof label, string> = {
    send: copy.send,
    sending: copy.sending,
    retry: copy.retry,
  };
  const notesId = `${uid}-notes`;
  const helperId = `${uid}-helper`;
  const countId = `${uid}-count`;
  const commentId = `${uid}-comment`;
  const titleId = `${uid}-title`;
  const lowHintId = `${uid}-low`;
  const highHintId = `${uid}-high`;
  const open = commentVisible(stars);

  return (
    <section
      ref={sectionRef}
      className="results-feedback"
      data-phase={phase}
      role="dialog"
      aria-labelledby={titleId}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        onEscape(event.nativeEvent.isComposing || event.keyCode === 229);
      }}
    >
      <div ref={sheetRef} className="results-feedback-sheet">
        <div
          className="results-feedback-handle"
          aria-hidden="true"
          {...handleHandlers}
        >
          <span />
        </div>
        <button
          type="button"
          className="results-feedback-close"
          aria-label={copy.closeLabel}
          aria-disabled={sending || undefined}
          onClick={onClose}
        >
          <CloseIcon />
        </button>

        {finished ? (
          <div className="results-feedback-scroll" data-finished="true">
            <div className="results-feedback-thanks">
              {phase === "thanks" && (
                <span className="results-feedback-bigCheck">
                  <CheckIcon size={28} />
                </span>
              )}
              <p id={titleId} className="results-feedback-title">
                {phase === "thanks" ? copy.done : copy.already}
              </p>
              {phase === "already" && (
                <button
                  type="button"
                  className="results-feedback-primary"
                  onClick={onClose}
                >
                  {copy.ok}
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="results-feedback-scroll">
              <p id={titleId} className="results-feedback-title">
                {copy.title}
              </p>
              <fieldset className="results-feedback-stars" disabled={sending}>
                <legend className="results-srOnly">{copy.starsGroup}</legend>
                <div className="results-feedback-starRow" role="radiogroup">
                  {STARS.map((n) => {
                    const filled = stars !== null && n <= stars;
                    return (
                      <span key={n} className="results-feedback-star">
                        <input
                          type="radio"
                          name={`${uid}-stars`}
                          id={`${uid}-star-${n}`}
                          value={n}
                          checked={stars === n}
                          aria-label={copy.starName(
                            n,
                            RESULT_FEEDBACK_MAX_STARS,
                          )}
                          aria-describedby={
                            n === RESULT_FEEDBACK_MIN_STARS
                              ? lowHintId
                              : n === RESULT_FEEDBACK_MAX_STARS
                                ? highHintId
                                : undefined
                          }
                          onChange={() => onStars(n)}
                        />
                        <label
                          htmlFor={`${uid}-star-${n}`}
                          data-filled={filled ? "true" : undefined}
                          aria-hidden="true"
                        >
                          <StarIcon filled={filled} />
                        </label>
                      </span>
                    );
                  })}
                </div>
                <p className="results-feedback-ends" aria-hidden="true">
                  <span>{copy.lowLabel}</span>
                  <span>{copy.highLabel}</span>
                </p>
                {/* The end labels are for the eye; these say what 1 and 5 mean. */}
                <span id={lowHintId} className="results-srOnly">
                  {copy.lowHint(RESULT_FEEDBACK_MIN_STARS)}
                </span>
                <span id={highHintId} className="results-srOnly">
                  {copy.highHint(RESULT_FEEDBACK_MAX_STARS)}
                </span>
              </fieldset>

              <div
                className="results-feedback-collapse"
                data-open={open ? "true" : "false"}
              >
                <div className="results-feedback-collapseInner" inert={!open}>
                  <div className="results-feedback-field">
                    <textarea
                      id={commentId}
                      value={comment}
                      rows={3}
                      maxLength={MAX_FEEDBACK_CHARS}
                      aria-invalid={error !== null || undefined}
                      aria-describedby={`${error ? `${uid}-error` : helperId} ${countId}`}
                      disabled={sending}
                      onChange={(event) => onComment(event.target.value)}
                    />
                    <label htmlFor={commentId}>{copy.commentLabel}</label>
                    <span id={countId} className="results-feedback-count">
                      {copy.count(comment.length, MAX_FEEDBACK_CHARS)}
                    </span>
                  </div>
                  {error ? (
                    <p
                      id={`${uid}-error`}
                      className="results-feedback-error"
                      role="alert"
                    >
                      <AlertIcon />
                      <span>{error}</span>
                    </p>
                  ) : (
                    <p id={helperId} className="results-feedback-helper">
                      {copy.helper}
                    </p>
                  )}
                </div>
              </div>

              <div
                id={notesId}
                className="results-feedback-collapse"
                data-open={notesOpen ? "true" : "false"}
              >
                <div
                  className="results-feedback-collapseInner"
                  inert={!notesOpen}
                >
                  <ul className="results-feedback-notes">
                    <li>
                      <p className="results-feedback-noteTitle">
                        <CheckIcon />
                        <span>{copy.keptTitle}</span>
                      </p>
                      <p className="results-feedback-noteBody">
                        {copy.keptBody}
                      </p>
                    </li>
                    <li>
                      <p className="results-feedback-noteTitle">
                        <CrossIcon />
                        <span>{copy.notKeptTitle}</span>
                      </p>
                      <p className="results-feedback-noteBody">
                        {copy.notKeptBody}
                      </p>
                    </li>
                    <li>
                      <p className="results-feedback-noteTitle">
                        <UndoIcon />
                        <span>{copy.withdrawTitle}</span>
                      </p>
                      <p className="results-feedback-noteBody">
                        {copy.withdrawBody}
                      </p>
                    </li>
                  </ul>
                </div>
              </div>
            </div>
            {/* The bottom row stays at the bottom of the sheet; what is above it scrolls. */}
            <div
              className="results-feedback-actions"
              data-has-primary={showSubmit(stars) ? "true" : "false"}
            >
              <button
                type="button"
                className="results-feedback-link"
                aria-expanded={notesOpen}
                aria-controls={notesId}
                onClick={onToggleNotes}
              >
                <LockIcon />
                <span>{copy.dataLink}</span>
                <span className="results-feedback-chevron">
                  <ChevronIcon />
                </span>
              </button>
              {showSubmit(stars) && (
                <button
                  type="button"
                  className="results-feedback-primary"
                  aria-disabled={sending || undefined}
                  onClick={onSubmit}
                >
                  {(["send", "sending", "retry"] as const).map((key) => (
                    <span
                      key={key}
                      className="results-feedback-primaryLabel"
                      data-active={key === label ? "true" : "false"}
                    >
                      {labels[key]}
                    </span>
                  ))}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
