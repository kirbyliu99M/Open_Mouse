"use client";

import { useId, useState, type FormEvent, type Ref } from "react";
import type { Locale } from "@/lib/contracts/locale";
import { manualEntryCopy } from "@/lib/copy/manualEntry";
import {
  checkManualEntry,
  fieldProblemMessage,
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
 * the width that fits. 「使用這組數字」 stays disabled until the hand is chosen
 * and both numbers are valid; the line under the fields says why when only
 * the hand is missing. There is no default hand: a default would be stored as
 * if the person had chosen it (`initialHand` is for a hand the person already
 * stated on the scan screen).
 */
export function ManualEntryForm({
  locale,
  initialHand = null,
  onUse,
  onCancel,
  titleId,
  titleRef,
  titleTag: TitleTag = "h2",
}: {
  locale: Locale;
  initialHand?: ManualHand | null;
  onUse: (values: ManualEntryValues) => void;
  /** Without it there is no cancel button (the desktop panel has none). */
  onCancel?: () => void;
  titleId: string;
  titleRef?: Ref<HTMLHeadingElement>;
  titleTag?: "h1" | "h2" | "h3";
}) {
  const copy = manualEntryCopy(locale);
  const ids = useId();
  const [hand, setHand] = useState<ManualHand | null>(initialHand);
  const [lengthText, setLengthText] = useState("");
  const [widthText, setWidthText] = useState("");
  const [touched, setTouched] = useState({ length: false, width: false });

  const check = checkManualEntry(lengthText, widthText);
  const lengthProblem = touched.length ? check.length.problem : null;
  const widthProblem = touched.width ? check.width.problem : null;
  const ready = check.valid && hand !== null;
  const needsHand = check.valid && hand === null;

  const lengthErrorId = `${ids}-length-error`;
  const widthErrorId = `${ids}-width-error`;
  const lengthHelpId = `${ids}-length-help`;
  const widthHelpId = `${ids}-width-help`;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready || check.length.mm === null || check.width.mm === null) return;
    onUse({
      hand,
      handLengthMm: check.length.mm,
      handWidthMm: check.width.mm,
    });
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
        <p className="manualEntry-intro">{copy.intro}</p>
      </div>

      <fieldset className="manualEntry-hand">
        <legend className="manualEntry-label">{copy.handLegend}</legend>
        <div className="manualEntry-toggle">
          {(["left", "right"] as const).map((value) => (
            <label key={value} className="manualEntry-toggleOption">
              <input
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
      <div aria-live="polite">
        {needsHand && <p className="manualEntry-warn">{copy.handMissing}</p>}
      </div>

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
        <button type="submit" className="manualEntry-use" disabled={!ready}>
          {copy.use}
        </button>
      </div>
    </form>
  );
}
