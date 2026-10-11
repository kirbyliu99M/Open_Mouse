"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent,
  type Ref,
} from "react";
import type { Locale } from "@/lib/contracts/locale";
import { manualEntryCopy } from "@/lib/copy/manualEntry";
import {
  checkManualEntry,
  EMPTY_DRAFT,
  fieldProblemMessage,
  firstProblemTarget,
  type ManualEntryDraft,
  type ManualHand,
} from "@/lib/scan/manualEntry";

/** What the form hands over: the hand and the two numbers, whole millimetres. */
export interface ManualEntryValues {
  readonly hand: ManualHand;
  readonly handLengthMm: number;
  readonly handWidthMm: number;
}

/**
 * The typed hand length and width (candidate, 2026-10-12): which hand, a
 * length and a width in centimetres with one decimal, and the two buttons.
 * It is the content of both presentations (the phone's pull-up sheet and the
 * desktop panel); the shell around it decides where it sits.
 *
 * Errors show per field once the person has left it (or changed it again
 * after leaving), never while they are still typing the first digits. The
 * text of an error is always one sentence: what is wrong and the range or
 * the width that fits.
 *
 * 「使用這組數字」 is `aria-disabled`, not `disabled`, until the hand is chosen
 * and both numbers are valid: it stays focusable and pressable, and pressing
 * it (click, Enter in a field, Space) while it is not ready shows every
 * problem at once, the missing hand included, and moves focus to the first one
 * (hand, then length, then width). Nothing is sent. There is no default hand:
 * a default would be stored as if the person had chosen it (`initialDraft`
 * can carry a hand the person already stated).
 *
 * `initialDraft` and `onDraftChange` let the parent keep what was typed when
 * the sheet closes by accident: `onDraftChange` gets the whole draft after
 * every change, `initialDraft` starts the form from one. A started field that
 * is wrong shows its problem straight away.
 */
export function ManualEntryForm({
  locale,
  initialDraft = EMPTY_DRAFT,
  onDraftChange,
  onUse,
  onCancel,
  titleId,
  titleRef,
  introId,
  titleTag: TitleTag = "h2",
}: {
  locale: Locale;
  initialDraft?: ManualEntryDraft;
  onDraftChange?: (draft: ManualEntryDraft) => void;
  onUse: (values: ManualEntryValues) => void;
  /** Without it there is no cancel button (the desktop panel has none). */
  onCancel?: () => void;
  titleId: string;
  titleRef?: Ref<HTMLHeadingElement>;
  /** The id of the intro line, for the dialog's `aria-describedby`. */
  introId?: string;
  titleTag?: "h1" | "h2" | "h3";
}) {
  const copy = manualEntryCopy(locale);
  const ids = useId();
  const [hand, setHand] = useState<ManualHand | null>(initialDraft.hand);
  const [lengthText, setLengthText] = useState(initialDraft.lengthText);
  const [widthText, setWidthText] = useState(initialDraft.widthText);
  const [touched, setTouched] = useState({
    length: initialDraft.lengthText !== "",
    width: initialDraft.widthText !== "",
  });
  // A send was tried while the form was not ready: show everything that is wrong.
  const [attempted, setAttempted] = useState(false);

  const check = checkManualEntry(lengthText, widthText);
  const lengthProblem = touched.length ? check.length.problem : null;
  const widthProblem = touched.width ? check.width.problem : null;
  const ready = check.valid && hand !== null;
  // Next to the hand toggle, once everything else is fine or a send was tried.
  const handProblem = hand === null && (check.valid || attempted);

  // The parent keeps the draft; the form tells it after every change.
  const onDraftChangeRef = useRef(onDraftChange);
  onDraftChangeRef.current = onDraftChange;
  const firstDraft = useRef(true);
  useEffect(() => {
    if (firstDraft.current) {
      firstDraft.current = false;
      return;
    }
    onDraftChangeRef.current?.({ hand, lengthText, widthText });
  }, [hand, lengthText, widthText]);

  const firstRadio = useRef<HTMLInputElement>(null);
  const lengthInput = useRef<HTMLInputElement>(null);
  const widthInput = useRef<HTMLInputElement>(null);

  const lengthErrorId = `${ids}-length-error`;
  const widthErrorId = `${ids}-width-error`;
  const lengthHelpId = `${ids}-length-help`;
  const widthHelpId = `${ids}-width-help`;
  const handLegendId = `${ids}-hand-legend`;
  const handHelpId = `${ids}-hand-help`;
  const handErrorId = `${ids}-hand-error`;

  /** The button was pressed, or Enter sent the form, while it was not ready. */
  function attempt() {
    setTouched({ length: true, width: true });
    setAttempted(true);
    const target = firstProblemTarget({ hand, lengthText, widthText });
    if (target === "hand") firstRadio.current?.focus();
    else if (target === "length") lengthInput.current?.focus();
    else if (target === "width") widthInput.current?.focus();
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready || check.length.mm === null || check.width.mm === null) {
      attempt();
      return;
    }
    onUse({
      hand,
      handLengthMm: check.length.mm,
      handWidthMm: check.width.mm,
    });
  }

  function onUseClick(event: MouseEvent<HTMLButtonElement>) {
    // Not ready: do what `submit` would, but without relying on the browser
    // sending a form from a button that looks disabled.
    if (!ready) {
      event.preventDefault();
      attempt();
    }
  }

  return (
    <form className="manualEntry-form" noValidate onSubmit={submit}>
      <div className="manualEntry-head">
        <TitleTag
          id={titleId}
          ref={titleRef}
          tabIndex={-1}
          className="manualEntry-title"
        >
          {copy.title}
        </TitleTag>
        <p className="manualEntry-intro" id={introId}>
          {copy.intro}
        </p>
      </div>

      <fieldset
        className="manualEntry-hand"
        role="radiogroup"
        aria-required="true"
        aria-invalid={handProblem ? true : undefined}
        aria-labelledby={handLegendId}
        aria-describedby={
          handProblem ? `${handHelpId} ${handErrorId}` : handHelpId
        }
      >
        <legend className="manualEntry-label" id={handLegendId}>
          {copy.handLegend}
          <span className="manualEntry-required" aria-hidden="true">
            {copy.required}
          </span>
        </legend>
        <p className="manualEntry-help" id={handHelpId}>
          {copy.handHelp}
        </p>
        <div className="manualEntry-toggle">
          {(["left", "right"] as const).map((value) => (
            <label key={value} className="manualEntry-toggleOption">
              <input
                ref={value === "left" ? firstRadio : undefined}
                type="radio"
                name={`${ids}-hand`}
                value={value}
                checked={hand === value}
                onChange={() => setHand(value)}
              />
              <span>{value === "left" ? copy.left : copy.right}</span>
            </label>
          ))}
        </div>
        <div aria-live="polite">
          {handProblem && (
            <p className="manualEntry-warn" id={handErrorId}>
              {copy.handMissing}
            </p>
          )}
        </div>
      </fieldset>

      <div className="manualEntry-field">
        <label className="manualEntry-label" htmlFor={`${ids}-length`}>
          {copy.lengthLabel}
        </label>
        <p className="manualEntry-help" id={lengthHelpId}>
          {copy.lengthHelp}
        </p>
        <div
          className="manualEntry-input"
          data-invalid={lengthProblem ? "true" : undefined}
        >
          <input
            id={`${ids}-length`}
            ref={lengthInput}
            type="text"
            inputMode="decimal"
            enterKeyHint="next"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder={copy.lengthPlaceholder}
            value={lengthText}
            aria-invalid={lengthProblem ? true : undefined}
            aria-describedby={
              lengthProblem ? `${lengthHelpId} ${lengthErrorId}` : lengthHelpId
            }
            onChange={(e) => setLengthText(e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, length: true }))}
          />
          <span className="manualEntry-unit" aria-hidden="true">
            {copy.unit}
          </span>
        </div>
        <div aria-live="polite">
          {lengthProblem && (
            <p className="manualEntry-error" id={lengthErrorId}>
              {fieldProblemMessage(copy, "length", lengthProblem)}
            </p>
          )}
        </div>
      </div>

      <div className="manualEntry-field">
        <label className="manualEntry-label" htmlFor={`${ids}-width`}>
          {copy.widthLabel}
        </label>
        <p className="manualEntry-help" id={widthHelpId}>
          {copy.widthHelp}
        </p>
        <div
          className="manualEntry-input"
          data-invalid={widthProblem ? "true" : undefined}
        >
          <input
            id={`${ids}-width`}
            ref={widthInput}
            type="text"
            inputMode="decimal"
            enterKeyHint="done"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder={copy.widthPlaceholder}
            value={widthText}
            aria-invalid={widthProblem ? true : undefined}
            aria-describedby={
              widthProblem ? `${widthHelpId} ${widthErrorId}` : widthHelpId
            }
            onChange={(e) => setWidthText(e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, width: true }))}
          />
          <span className="manualEntry-unit" aria-hidden="true">
            {copy.unit}
          </span>
        </div>
        <div aria-live="polite">
          {widthProblem && (
            <p className="manualEntry-error" id={widthErrorId}>
              {fieldProblemMessage(copy, "width", widthProblem)}
            </p>
          )}
        </div>
      </div>

      <p className="manualEntry-note">{copy.estimateNote}</p>

      <div className="manualEntry-actions">
        {onCancel && (
          <button
            type="button"
            className="manualEntry-cancel"
            onClick={onCancel}
          >
            {copy.cancel}
          </button>
        )}
        <button
          type="submit"
          className="manualEntry-use"
          aria-disabled={ready ? undefined : true}
          onClick={onUseClick}
        >
          {copy.use}
        </button>
      </div>
    </form>
  );
}
