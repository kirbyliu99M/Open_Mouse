"use client";

/**
 * The two optional question pages after a measured scan (Pencil v3 grip and
 * v9 thickness frames, approved by Kirby 2026-10-12): grip 1／2 and palm
 * thickness 2／2. Each is a full page with 返回 (top left), a step counter,
 * a title, a picture, three radio rows, one primary button that stays
 * disabled until a row is chosen, and a small 跳過 under it.
 *
 * The pages hold no state of their own: the parent owns the answers
 * (`answers.ts`), so 返回 keeps them. Logic that a test can reach without a
 * browser is in `answers.ts` (`gripControls`, `thicknessControls`).
 *
 * `GripPage` takes `required` for its second use (typed hand measurements,
 * where the grip is mandatory): it hides 跳過, and 確認 stays disabled until a
 * row is chosen. The normal flow does not pass it.
 *
 * Accessibility: each list is a native radio group (arrow keys, one tab stop),
 * the pictures are decorative, focus lands on the heading when a page opens,
 * 返回 and 跳過 have a 44 px hit area, and the image swap is a fade under
 * `prefers-reduced-motion`.
 */
import { useEffect, useRef, type ReactNode, type Ref } from "react";
import type { PalmThicknessLevel } from "../../lib/contracts/measurement";
import { scanAnswersCopy, type ChoiceCopy } from "../../lib/copy/scan-answers";
import { scanCommonCopy } from "../../lib/copy/scan-common";
import { useLocale } from "../i18n/LocaleProvider";
import { gripControls, thicknessControls, type GripStyle } from "./answers";
import type { SubmitScanErrorKind } from "./submitScan";
import {
  THICKNESS_HAND_DOTS,
  THICKNESS_HAND_DOT_OPACITIES,
  THICKNESS_HAND_GLOW,
  THICKNESS_HAND_LINES,
  THICKNESS_HAND_RINGS,
  THICKNESS_HAND_SOLID,
  THICKNESS_HAND_VIEWBOX,
} from "./thicknessHandArt";
import "./answer-pages.css";

/** The grip line art (sketch-pipeline/grip-illustration/final, 358 x 300). */
export const GRIP_IMAGES: Readonly<Record<GripStyle, string>> = {
  palm: "/images/grip/grip-palm.svg",
  claw: "/images/grip/grip-claw.svg",
  fingertip: "/images/grip/grip-fingertip.svg",
};

interface Row<T extends string> {
  readonly value: T;
  readonly copy: ChoiceCopy;
}

function CheckMark() {
  return (
    <svg
      className="answerRadioCheck"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M20 6 9 17l-5-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** A native radio group drawn as three rows. */
function ChoiceRows<T extends string>({
  name,
  legend,
  rows,
  value,
  onChange,
  disabled = false,
}: {
  readonly name: string;
  readonly legend: string;
  readonly rows: readonly Row<T>[];
  readonly value: T | null;
  readonly onChange: (next: T) => void;
  readonly disabled?: boolean;
}) {
  return (
    <fieldset className="answerChoices" disabled={disabled}>
      <legend className="answerSr">{legend}</legend>
      {rows.map((row) => (
        <label key={row.value} className="answerChoice">
          <input
            type="radio"
            className="answerChoiceInput"
            name={name}
            value={row.value}
            checked={value === row.value}
            onChange={() => onChange(row.value)}
          />
          <span className="answerChoiceBody">
            <span className="answerChoiceText">
              <span className="answerChoiceName">{row.copy.name}</span>
              <span className="answerChoiceHint">{row.copy.hint}</span>
            </span>
            <span className="answerRadio" aria-hidden="true">
              <CheckMark />
            </span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/** Both pages: the top row, the title, the picture slot, the rows and the buttons. */
function PageShell({
  title,
  subtitle,
  step,
  stepLabel,
  art,
  artClassName,
  backLabel,
  onBack,
  backDisabled = false,
  children,
  footer,
}: {
  readonly title: string;
  readonly subtitle: string;
  readonly step: string;
  readonly stepLabel: string;
  readonly art: ReactNode;
  readonly artClassName: string;
  readonly backLabel: string;
  readonly onBack: () => void;
  readonly backDisabled?: boolean;
  readonly children: ReactNode;
  readonly footer: ReactNode;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  // A page opens with its heading focused, so a screen reader starts at the
  // title and a keyboard user is not left on a control that has gone.
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);
  return (
    <section className="answerPage">
      <div className="answerTop">
        <button
          type="button"
          className="answerBack"
          onClick={onBack}
          disabled={backDisabled}
        >
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            aria-hidden="true"
            focusable="false"
          >
            <path
              d="m15 18-6-6 6-6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {backLabel}
        </button>
        <p className="answerStep">
          <span aria-hidden="true">{step}</span>
          <span className="answerSr">{stepLabel}</span>
        </p>
        <span aria-hidden="true" />
      </div>
      <h2
        id="answer-title"
        className="answerTitle"
        ref={headingRef}
        tabIndex={-1}
      >
        {title}
      </h2>
      <p className="answerSubtitle">{subtitle}</p>
      <div className={`answerArt ${artClassName}`} aria-hidden="true">
        {art}
      </div>
      {children}
      {footer}
    </section>
  );
}

/** The neutral picture shown until a grip is chosen: a question mark. */
function QuestionMark() {
  return (
    <svg
      className="gripImage gripQuestion"
      viewBox="0 0 358 300"
      aria-hidden="true"
      focusable="false"
    >
      <circle
        cx="179"
        cy="150"
        r="90"
        fill="#6E9BF5"
        fillOpacity="0.12"
        stroke="var(--sketch-line-detail)"
        strokeWidth="1.2"
      />
      <path
        d="M140 120c0-26 17-42 39-42 22 0 39 15 39 35 0 20-15 28-27 38-9 7-12 13-12 26"
        fill="none"
        stroke="#9DBEFF"
        strokeWidth="17"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx="179"
        cy="205"
        r="11"
        fill="var(--sketch-line)"
        stroke="#9DBEFF"
      />
      <path
        d="M62 70v16m-8-8h16m230-26v12m-6-6h12m-10 164v14m-7-7h14m-249-15v10m-5-5h10"
        fill="none"
        stroke="var(--sketch-line-detail)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle
        cx="301"
        cy="117"
        r="5"
        fill="#CFE0FF"
        fillOpacity="0.12"
        stroke="var(--sketch-line)"
        strokeWidth="1.5"
      />
      <circle
        cx="55"
        cy="155"
        r="5"
        fill="#CFE0FF"
        fillOpacity="0.12"
        stroke="var(--sketch-line)"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function PrimaryButton({
  children,
  disabled,
  onClick,
  testId,
  buttonRef,
}: {
  readonly children: ReactNode;
  readonly disabled: boolean;
  readonly onClick: () => void;
  readonly testId: string;
  readonly buttonRef?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      type="button"
      className="answerPrimary"
      ref={buttonRef}
      disabled={disabled}
      onClick={onClick}
      data-testid={testId}
    >
      {children}
    </button>
  );
}

export interface GripPageProps {
  /** The chosen grip, or `null`: nothing chosen yet (or skipped). */
  readonly value: GripStyle | null;
  readonly onChange: (next: GripStyle) => void;
  readonly onConfirm: () => void;
  /** Not called, and 跳過 is not drawn, when `required`. */
  readonly onSkip?: () => void;
  readonly onBack: () => void;
  /** The grip is mandatory (typed measurements): no 跳過. */
  readonly required?: boolean;
}

/** Grip page, step 1／2. */
export function GripPage({
  value,
  onChange,
  onConfirm,
  onSkip,
  onBack,
  required = false,
}: GripPageProps) {
  const words = scanAnswersCopy(useLocale());
  const controls = gripControls(value, required);
  const rows: readonly Row<GripStyle>[] = [
    { value: "palm", copy: words.grip.palm },
    { value: "claw", copy: words.grip.claw },
    { value: "fingertip", copy: words.grip.fingertip },
  ];
  return (
    <PageShell
      title={words.gripTitle}
      subtitle={words.gripSubtitle}
      step={words.stepGrip}
      stepLabel={words.stepGripLabel}
      backLabel={words.back}
      onBack={onBack}
      artClassName="gripArt"
      art={
        <>
          <span
            className="gripLayer"
            data-active={value === null}
            data-testid="grip-art-neutral"
          >
            <QuestionMark />
          </span>
          {(Object.keys(GRIP_IMAGES) as GripStyle[]).map((grip) => (
            <span
              key={grip}
              className="gripLayer"
              data-active={value === grip}
              data-testid={`grip-art-${grip}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- three small fixed line drawings, all mounted so the swap never waits on a download */}
              <img
                className="gripImage"
                src={GRIP_IMAGES[grip]}
                alt=""
                width={358}
                height={300}
                decoding="async"
              />
            </span>
          ))}
        </>
      }
      footer={
        <div className="answerActions">
          <PrimaryButton
            disabled={!controls.confirmEnabled}
            onClick={onConfirm}
            testId="grip-confirm"
          >
            {words.gripConfirm}
          </PrimaryButton>
          {controls.showSkip && (
            <button
              type="button"
              className="answerSkip"
              onClick={onSkip}
              data-testid="grip-skip"
            >
              {words.skip}
            </button>
          )}
        </div>
      }
    >
      <ChoiceRows
        name="grip"
        legend={words.gripGroupLabel}
        rows={rows}
        value={value}
        onChange={onChange}
      />
    </PageShell>
  );
}

export interface ThicknessPageProps {
  readonly value: PalmThicknessLevel | null;
  readonly onChange: (next: PalmThicknessLevel) => void;
  /** 看結果: the scan is sent with whatever was answered. */
  readonly onSubmit: () => void;
  /** 跳過: the scan is sent with no thickness. */
  readonly onSkip: () => void;
  readonly onBack: () => void;
  /** The scan is being sent (or was, and the results are opening). */
  readonly busy: boolean;
  /** The scan was stored and the results page is opening. */
  readonly opening?: boolean;
  /** Why the last attempt to send it failed, if it did. */
  readonly errorKind: SubmitScanErrorKind | null;
  /** The banner's 重拍 (shown only for a failure whose fix is a new photo). */
  readonly onRetake: () => void;
}

/** Failures whose own sentence asks for a new photo (scan-common.ts submitErrors). */
export const RETAKE_ERROR_KINDS: readonly SubmitScanErrorKind[] = [
  "invalid",
  "tooLarge",
];

/** Palm-thickness page, step 2／2: where the scan is sent. */
export function ThicknessPage({
  value,
  onChange,
  onSubmit,
  onSkip,
  onBack,
  busy,
  opening = false,
  errorKind,
  onRetake,
}: ThicknessPageProps) {
  const locale = useLocale();
  const words = scanAnswersCopy(locale);
  const common = scanCommonCopy(locale);
  const controls = thicknessControls(value, busy);
  const submitRef = useRef<HTMLButtonElement>(null);
  const skipRef = useRef<HTMLButtonElement>(null);
  // A failed send leaves the controls off for a moment (they were disabled
  // while it ran, which dropped focus). The alert announces the reason; focus
  // goes back to the main button, or to 跳過 when no row is chosen (the main
  // button is then disabled and cannot take it).
  useEffect(() => {
    if (!errorKind) return;
    const target = submitRef.current?.disabled
      ? skipRef.current
      : submitRef.current;
    target?.focus();
  }, [errorKind]);
  const rows: readonly Row<PalmThicknessLevel>[] = [
    { value: "thick", copy: words.thickness.thick },
    { value: "medium", copy: words.thickness.medium },
    { value: "thin", copy: words.thickness.thin },
  ];
  return (
    <PageShell
      title={words.thicknessTitle}
      subtitle={words.thicknessSubtitle}
      step={words.stepThickness}
      stepLabel={words.stepThicknessLabel}
      backLabel={words.back}
      onBack={onBack}
      backDisabled={!controls.backEnabled}
      artClassName="thicknessArt"
      art={<ThicknessHand />}
      footer={
        <div className="answerActions">
          {errorKind && (
            <div className="answerError">
              <p role="alert">{common.submitErrors[errorKind]}</p>
              {RETAKE_ERROR_KINDS.includes(errorKind) && (
                <button
                  type="button"
                  className="answerErrorRetake"
                  onClick={onRetake}
                  data-testid="thickness-retake"
                >
                  {words.retake}
                </button>
              )}
            </div>
          )}
          <PrimaryButton
            disabled={!controls.submitEnabled}
            onClick={onSubmit}
            testId="thickness-submit"
            buttonRef={submitRef}
          >
            {opening
              ? common.submitButtonOpening
              : busy
                ? words.sending
                : words.thicknessSubmit}
          </PrimaryButton>
          {/* The visible word stays 跳過; the name says what it does here: the
              scan is sent. It contains the visible word (WCAG 2.5.3). */}
          <button
            type="button"
            className="answerSkip"
            ref={skipRef}
            onClick={onSkip}
            disabled={!controls.skipEnabled}
            aria-label={words.skipAndSee}
            data-testid="thickness-skip"
          >
            {words.skip}
          </button>
          <p className="answerSr" aria-live="polite">
            {opening ? common.submitSuccessStatus : busy ? words.sending : ""}
          </p>
        </div>
      }
    >
      <ChoiceRows
        name="thickness"
        legend={words.thicknessGroupLabel}
        rows={rows}
        value={value}
        onChange={onChange}
        disabled={busy}
      />
    </PageShell>
  );
}

/** The glowing hand inside its dotted outline (Pencil art, see thicknessHandArt.ts). */
function ThicknessHand() {
  const glow = THICKNESS_HAND_GLOW;
  return (
    <svg
      className="thicknessHand"
      viewBox={THICKNESS_HAND_VIEWBOX}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <filter
          id="thickness-hand-blur"
          x="-100%"
          y="-100%"
          width="300%"
          height="300%"
        >
          <feGaussianBlur stdDeviation="24" />
        </filter>
      </defs>
      <ellipse
        className="thicknessGlow"
        cx={glow.cx}
        cy={glow.cy}
        rx={glow.rx}
        ry={glow.ry}
        filter="url(#thickness-hand-blur)"
      />
      <path
        d={THICKNESS_HAND_SOLID}
        fill="var(--sketch-line-detail)"
        fillOpacity="0.18"
        stroke="var(--sketch-line)"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path
        d={THICKNESS_HAND_LINES}
        fill="none"
        stroke="var(--sketch-line-detail)"
        strokeWidth="1"
        strokeLinecap="round"
        opacity="0.8"
      />
      {THICKNESS_HAND_RINGS.map(([x, y]) => (
        <circle
          key={`${x}-${y}`}
          cx={x}
          cy={y}
          r="4.5"
          fill="none"
          stroke="#ffffff59"
          strokeWidth="1.5"
        />
      ))}
      {THICKNESS_HAND_DOTS.map(([x, y], i) => (
        <circle
          key={i}
          cx={x}
          cy={y}
          r="1.7"
          fill="var(--sketch-line)"
          opacity={
            THICKNESS_HAND_DOT_OPACITIES[
              i % THICKNESS_HAND_DOT_OPACITIES.length
            ]
          }
        />
      ))}
    </svg>
  );
}
