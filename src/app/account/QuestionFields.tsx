"use client";

import { useId, type ReactNode } from "react";

/**
 * The answer controls the questionnaire form and the edit sheet share
 * (candidate, 2026-10-12). Every group is a `fieldset` with a `legend`, so a
 * screen reader hears the question before the options. A chip is a button with
 * `aria-pressed`: its state is also a heavier border and bolder label, never
 * colour alone.
 */

export interface ChipOption<T extends string> {
  value: T;
  label: string;
}

/** The legend and the optional hint under it. */
function Legend({ legend, hint }: { legend: string; hint?: string }) {
  return (
    <>
      <legend className="qn-legend">{legend}</legend>
      {hint !== undefined && <p className="qn-hint">{hint}</p>}
    </>
  );
}

/**
 * One answer out of a few. A second tap on the chosen chip clears the answer
 * (`allowClear`), because every question but a required one is optional.
 */
export function ChipChoice<T extends string>({
  legend,
  hint,
  options,
  selected,
  onSelect,
  allowClear = true,
  columns,
}: {
  legend: string;
  hint?: string;
  options: readonly ChipOption<T>[];
  selected: T | null;
  onSelect: (value: T | null) => void;
  allowClear?: boolean;
  /** Three equal columns (main use, size feel) instead of chips that wrap. */
  columns?: 3;
}) {
  return (
    <fieldset className="qn-q">
      <Legend legend={legend} hint={hint} />
      <div className={columns === 3 ? "qn-chips qn-chips-3" : "qn-chips"}>
        {options.map((option) => {
          const on = option.value === selected;
          return (
            <button
              key={option.value}
              type="button"
              className="qn-chip"
              aria-pressed={on}
              onClick={() =>
                onSelect(on ? (allowClear ? null : option.value) : option.value)
              }
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Any number of answers out of a few (what does not fit). */
export function ChipMulti<T extends string>({
  legend,
  options,
  selected,
  onToggle,
}: {
  legend: string;
  options: readonly ChipOption<T>[];
  selected: readonly T[];
  onToggle: (value: T) => void;
}) {
  return (
    <fieldset className="qn-q">
      <Legend legend={legend} />
      <div className="qn-chips">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className="qn-chip"
            aria-pressed={selected.includes(option.value)}
            onClick={() => onToggle(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * The 1 to 5 control: a radio group (native radios, so arrow keys move the
 * choice), each option named 「滿意度 4 分」, and the two end captions tied to
 * the first and last option with `aria-describedby`.
 */
export function SatisfactionField({
  legend,
  value,
  onChange,
  optionLabel,
  lowCaption,
  highCaption,
  hint,
  name,
}: {
  legend: string;
  value: number | null;
  onChange: (score: number) => void;
  optionLabel: (score: number) => string;
  lowCaption: string;
  highCaption: string;
  /** A line under the captions, shown only when there is something to say. */
  hint?: ReactNode;
  name: string;
}) {
  const id = useId();
  const lowId = `${id}-low`;
  const highId = `${id}-high`;
  return (
    <fieldset className="qn-q">
      <legend className="qn-legend">{legend}</legend>
      <div className="qn-scale">
        {[1, 2, 3, 4, 5].map((score) => (
          <label key={score} className="qn-scale-option">
            <input
              type="radio"
              name={`${name}-${id}`}
              value={score}
              checked={value === score}
              aria-label={optionLabel(score)}
              aria-describedby={
                score === 1 ? lowId : score === 5 ? highId : undefined
              }
              onChange={() => onChange(score)}
            />
            <span aria-hidden="true">{score}</span>
          </label>
        ))}
      </div>
      <div className="qn-scale-captions">
        <span id={lowId}>{lowCaption}</span>
        <span id={highId}>{highCaption}</span>
      </div>
      {hint}
    </fieldset>
  );
}
