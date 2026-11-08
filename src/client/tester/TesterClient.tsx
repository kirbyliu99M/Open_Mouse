"use client";

/**
 * The hidden data-tester page (candidate 未拍板; contract
 * src/lib/contracts/tester.ts; spec
 * docs/design/touchpoint-2026-11-08/tester-page-spec.md). One page, steps:
 *
 *   code -> consent -> tape -> conditions -> scan -> result -> conditions ...
 *
 * The scan step is the real easy-scan camera in tester mode
 * (src/client/camera/testerMode.ts): it reports every analysis, hands the
 * measured result over on 繼續, and never calls `/api/scans`. The result step
 * prepares the photo on the phone exactly like an error photo (crop, card
 * blacked out, canvas re-encode, no EXIF) when the tester left the photo box
 * ticked, then sends ONE record to `/api/tester/shots`. "Next shot" keeps the
 * tape values and the phone model. The code lives in sessionStorage only.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import EasyScanCamera, {
  type EasyScanCameraProps,
} from "../camera/EasyScanCamera";
import type {
  TesterScanAttempt,
  TesterScanHooks,
  TesterScanMeasured,
} from "../camera/testerMode";
import { prepareErrorPhoto } from "../error-photo/prepare";
import { calibrationMethodOf } from "../../lib/contracts/measurement";
import {
  TESTER_CARD_TYPES,
  TESTER_LIGHTING,
  TESTER_REFERENCES,
  TESTER_SURFACES,
  participantOf,
  testerCodeSchema,
  type TesterRecord,
} from "../../lib/contracts/tester";
import { testerCopy as copy } from "../../lib/tester/copy";
import { phoneModelAllowed } from "../../lib/tester/phoneModel";
import { buildTesterRecord, type ShotConditions } from "./record";
import {
  checkTesterCode,
  codeStorage,
  sendTesterShot,
  type ShotOutcome,
} from "./send";
import {
  EMPTY_TAPE,
  buildTape,
  formatDiffMm,
  needsRecheck,
  tapeAverage,
  type MeasureDraft,
  type PairDraft,
  type TapeDraft,
  type TapeErrors,
  type TesterTape,
} from "./tape";
import "../../app/scan/scan.css";
import "./tester.css";

type Step =
  "code" | "consent" | "tape" | "conditions" | "scan" | "giveUp" | "result";

interface ConditionsDraft {
  readonly phoneModel: string;
  readonly surface: ShotConditions["surface"] | null;
  readonly lighting: ShotConditions["lighting"] | null;
  readonly reference: ShotConditions["reference"] | null;
  readonly cardType: NonNullable<ShotConditions["cardType"]> | null;
  readonly deliberatelyPoor: boolean;
}

const EMPTY_CONDITIONS: ConditionsDraft = {
  phoneModel: "",
  surface: null,
  lighting: null,
  reference: null,
  cardType: null,
  deliberatelyPoor: false,
};

type SendState =
  | { readonly kind: "idle" }
  | { readonly kind: "preparing" }
  | { readonly kind: "sending" }
  | { readonly kind: "sent" }
  | { readonly kind: "failed"; readonly outcome: Exclude<ShotOutcome, "sent"> };

type ShotResult =
  | { readonly kind: "measured"; readonly data: TesterScanMeasured }
  | { readonly kind: "gaveUp" };

function newShotId(): string {
  return crypto.randomUUID();
}

function readConditions(d: ConditionsDraft): ShotConditions | null {
  if (!phoneModelAllowed(d.phoneModel)) return null;
  if (!d.surface || !d.lighting || !d.reference) return null;
  if (d.reference === "card" && !d.cardType) return null;
  return {
    phoneModel: d.phoneModel.trim(),
    surface: d.surface,
    lighting: d.lighting,
    reference: d.reference,
    ...(d.reference === "card" && d.cardType ? { cardType: d.cardType } : {}),
    deliberatelyPoor: d.deliberatelyPoor,
  };
}

export interface TesterClientProps {
  /** Test/demo injection only (`/scan/tester/demo`, dev-only): the real page never passes it. */
  readonly runPhotoPipelineImpl?: EasyScanCameraProps["runPhotoPipelineImpl"];
}

export function TesterClient({ runPhotoPipelineImpl }: TesterClientProps) {
  const [step, setStep] = useState<Step>("code");
  const [code, setCode] = useState<string | null>(null);
  const [codeInput, setCodeInput] = useState("");
  const [codeState, setCodeState] = useState<
    "idle" | "checking" | "invalid" | "too-many" | "network"
  >("idle");
  const [agree, setAgree] = useState(false);
  const [photoOptIn, setPhotoOptIn] = useState(true);
  const [tapeDraft, setTapeDraft] = useState<TapeDraft>(EMPTY_TAPE);
  const [tapeErrors, setTapeErrors] = useState<TapeErrors>({});
  const [tape, setTape] = useState<TesterTape | null>(null);
  const [conditionsDraft, setConditionsDraft] =
    useState<ConditionsDraft>(EMPTY_CONDITIONS);
  const [conditionsTried, setConditionsTried] = useState(false);
  const [conditions, setConditions] = useState<ShotConditions | null>(null);
  const [shotId, setShotId] = useState<string>("");
  const attemptsRef = useRef<TesterScanAttempt[]>([]);
  const [shot, setShot] = useState<ShotResult | null>(null);
  const [send, setSend] = useState<SendState>({ kind: "idle" });
  // The tester wanted the photo sent but the phone could not prepare it.
  const [photoDropped, setPhotoDropped] = useState(false);
  // What was sent last, for "try again" with the same shotId.
  const lastSendRef = useRef<{ record: TesterRecord; photo?: Blob } | null>(
    null,
  );
  const headingRef = useRef<HTMLHeadingElement>(null);

  // A code kept from earlier in this tab skips the code step.
  useEffect(() => {
    const kept = testerCodeSchema.safeParse(codeStorage.read());
    if (kept.success) {
      setCode(kept.data);
      setStep("consent");
    }
  }, []);

  // Each screen starts at the top, with focus on its heading.
  useEffect(() => {
    if (step === "scan") return;
    window.scrollTo(0, 0);
    headingRef.current?.focus();
  }, [step]);

  const participant = code ? participantOf(code) : null;

  const submitCode = async () => {
    const parsed = testerCodeSchema.safeParse(codeInput);
    if (!parsed.success) {
      setCodeState("invalid");
      return;
    }
    setCodeState("checking");
    const outcome = await checkTesterCode(parsed.data);
    if (!outcome.ok) {
      setCodeState(outcome.reason);
      return;
    }
    codeStorage.write(parsed.data);
    setCode(parsed.data);
    setCodeState("idle");
    setStep("consent");
  };

  const forgetCode = () => {
    codeStorage.clear();
    setCode(null);
    setCodeInput("");
    setStep("code");
  };

  const submitTape = () => {
    const built = buildTape(tapeDraft);
    if (!built.ok) {
      setTapeErrors(built.errors);
      return;
    }
    setTapeErrors({});
    setTape(built.tape);
    setStep("conditions");
  };

  const startScan = () => {
    setConditionsTried(true);
    const ready = readConditions(conditionsDraft);
    if (!ready) return;
    setConditions(ready);
    attemptsRef.current = [];
    setShot(null);
    setSend({ kind: "idle" });
    setPhotoDropped(false);
    lastSendRef.current = null;
    setShotId(newShotId());
    setStep("scan");
  };

  const deliver = useCallback(
    async (record: TesterRecord, photo?: Blob) => {
      if (!code) return;
      lastSendRef.current = { record, ...(photo ? { photo } : {}) };
      setSend({ kind: "sending" });
      const outcome = await sendTesterShot({
        code,
        record,
        ...(photo ? { photo } : {}),
      });
      setSend(
        outcome === "sent" ? { kind: "sent" } : { kind: "failed", outcome },
      );
    },
    [code],
  );

  const sendShot = useCallback(
    async (result: ShotResult, withPhoto: boolean) => {
      if (!tape || !conditions) return;
      const attempts = attemptsRef.current;
      if (result.kind === "gaveUp") {
        await deliver(
          buildTesterRecord({
            shotId,
            tape,
            conditions,
            attempts,
            captureMode: "camera",
          }),
        );
        return;
      }
      const m = result.data;
      let prepared: Awaited<ReturnType<typeof prepareErrorPhoto>> = null;
      if (withPhoto && m.photo) {
        setSend({ kind: "preparing" });
        prepared = await prepareErrorPhoto(m.photo);
      }
      setPhotoDropped(withPhoto && !prepared);
      const record = buildTesterRecord({
        shotId,
        tape,
        conditions,
        attempts,
        captureMode: m.captureMode,
        measured: {
          handLengthMm: m.measurements.handLengthMm,
          palmWidthMm: m.measurements.palmWidthMm,
          measurementModelVersion: m.submission.measurementModelVersion,
          calibrationMethod: calibrationMethodOf(m.submission.calibration),
        },
        ...(prepared
          ? {
              photo: {
                widthPx: prepared.widthPx,
                heightPx: prepared.heightPx,
              },
            }
          : {}),
      });
      await deliver(record, prepared?.jpeg);
    },
    [tape, conditions, shotId, deliver],
  );

  const hooks = useMemo<TesterScanHooks>(
    () => ({
      onAttempt: (attempt) => {
        attemptsRef.current = [...attemptsRef.current, attempt];
      },
      onMeasured: (data) => {
        const result: ShotResult = { kind: "measured", data };
        setShot(result);
        setStep("result");
        void sendShot(result, photoOptIn);
      },
      onExit: () => setStep("giveUp"),
    }),
    [sendShot, photoOptIn],
  );

  const confirmGiveUp = () => {
    const result: ShotResult = { kind: "gaveUp" };
    setShot(result);
    setStep("result");
    void sendShot(result, false);
  };

  const retry = () => {
    const last = lastSendRef.current;
    if (last) void deliver(last.record, last.photo);
  };

  const sendWithoutPhoto = () => {
    const last = lastSendRef.current;
    if (!last) return;
    const { photo: _omit, ...record } = last.record;
    void _omit;
    void deliver(record);
  };

  const nextShot = () => {
    // Tape and phone model stay; the rest of the conditions are asked again.
    setConditionsDraft((d) => ({
      ...EMPTY_CONDITIONS,
      phoneModel: d.phoneModel,
    }));
    setConditionsTried(false);
    setShot(null);
    setSend({ kind: "idle" });
    setStep("conditions");
  };

  if (step === "scan") {
    return (
      <div className="testerScan">
        <EasyScanCamera
          key={shotId}
          tester={hooks}
          {...(runPhotoPipelineImpl ? { runPhotoPipelineImpl } : {})}
        />
        <button
          type="button"
          className="testerGiveUpButton"
          data-testid="tester-give-up"
          onClick={() => setStep("giveUp")}
        >
          {copy.scan.giveUp}
        </button>
      </div>
    );
  }

  return (
    <main className="testerMain" data-testid={`tester-step-${step}`}>
      <p className="testerEyebrow">
        {copy.heading}
        {participant ? ` · ${participant}` : ""}
      </p>
      {step === "code" && (
        <section>
          <h1 ref={headingRef} tabIndex={-1} className="testerTitle">
            {copy.heading}
          </h1>
          <p className="testerLead">{copy.code.intro}</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submitCode();
            }}
          >
            <label className="testerField">
              <span className="testerLabel">{copy.code.label}</span>
              <input
                className="testerInput"
                name="tester-code"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                placeholder={copy.code.placeholder}
                value={codeInput}
                aria-invalid={codeState === "invalid" || undefined}
                aria-describedby="tester-code-status"
                onChange={(e) => {
                  setCodeInput(e.target.value);
                  if (codeState !== "checking") setCodeState("idle");
                }}
              />
            </label>
            <p
              id="tester-code-status"
              className="testerError"
              role="status"
              aria-live="polite"
            >
              {codeState === "invalid"
                ? copy.code.invalid
                : codeState === "too-many"
                  ? copy.code.tooMany
                  : codeState === "network"
                    ? copy.code.network
                    : ""}
            </p>
            <button
              type="submit"
              className="primaryButton testerPrimary"
              disabled={codeState === "checking" || codeInput.trim() === ""}
            >
              {codeState === "checking" ? copy.code.checking : copy.code.submit}
            </button>
          </form>
        </section>
      )}

      {step === "consent" && (
        <section>
          <h1 ref={headingRef} tabIndex={-1} className="testerTitle">
            {copy.consent.title}
          </h1>
          {participant && (
            <p className="testerLead">{copy.code.participant(participant)}</p>
          )}
          <ul className="testerPoints">
            {copy.consent.points.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
          <label className="testerCheck">
            <input
              type="checkbox"
              checked={agree}
              onChange={(e) => setAgree(e.target.checked)}
            />
            <span>{copy.consent.agree}</span>
          </label>
          <label className="testerCheck">
            <input
              type="checkbox"
              checked={photoOptIn}
              onChange={(e) => setPhotoOptIn(e.target.checked)}
            />
            <span>
              {copy.consent.photo}
              <span className="testerHint">{copy.consent.photoHint}</span>
            </span>
          </label>
          <button
            type="button"
            className="primaryButton testerPrimary"
            disabled={!agree}
            onClick={() => setStep(tape ? "conditions" : "tape")}
          >
            {copy.consent.next}
          </button>
          <button type="button" className="testerLink" onClick={forgetCode}>
            {copy.result.reenterCode}
          </button>
        </section>
      )}

      {step === "tape" && (
        <TapeStep
          headingRef={headingRef}
          draft={tapeDraft}
          errors={tapeErrors}
          onChange={setTapeDraft}
          onSubmit={submitTape}
        />
      )}

      {step === "conditions" && (
        <ConditionsStep
          headingRef={headingRef}
          draft={conditionsDraft}
          tried={conditionsTried}
          onChange={setConditionsDraft}
          onStart={startScan}
          onEditTape={() => setStep("tape")}
        />
      )}

      {step === "giveUp" && (
        <section>
          <h1 ref={headingRef} tabIndex={-1} className="testerTitle">
            {copy.giveUp.title}
          </h1>
          <p className="testerLead">{copy.giveUp.body}</p>
          <button
            type="button"
            className="primaryButton testerPrimary"
            data-testid="tester-give-up-confirm"
            onClick={confirmGiveUp}
          >
            {copy.giveUp.confirm}
          </button>
          <button
            type="button"
            className="testerLink"
            onClick={() => setStep("scan")}
          >
            {copy.giveUp.back}
          </button>
        </section>
      )}

      {step === "result" && shot && tape && (
        <ResultStep
          headingRef={headingRef}
          shot={shot}
          tape={tape}
          send={send}
          photoDropped={photoDropped}
          onRetry={retry}
          onSendWithoutPhoto={sendWithoutPhoto}
          onNext={nextShot}
          onReenterCode={forgetCode}
        />
      )}
    </main>
  );
}

type HeadingRef = React.RefObject<HTMLHeadingElement | null>;

function TapeFigure() {
  return (
    <div className="testerFigure" aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element -- our own fixed SVG (the Learn page's hand on A4), no next/image config needed */}
      <img
        src="/images/hand-on-a4.svg"
        alt=""
        width={82}
        height={101}
        decoding="async"
      />
    </div>
  );
}

function errorText(error: TapeErrors[string]): string {
  switch (error) {
    case "required":
      return copy.tape.required;
    case "invalid":
      return copy.tape.invalid;
    case "pairIncomplete":
      return copy.tape.pairIncomplete;
    case "handRequired":
      return copy.tape.handRequired;
    default:
      return "";
  }
}

function MmInput(props: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly error: TapeErrors[string];
  readonly onChange: (value: string) => void;
}) {
  return (
    <label className="testerMm" htmlFor={props.id}>
      <span className="testerMmLabel">{props.label}</span>
      <span className="testerMmBox">
        <input
          id={props.id}
          className="testerInput"
          inputMode="decimal"
          autoComplete="off"
          value={props.value}
          aria-invalid={props.error ? true : undefined}
          onChange={(e) => props.onChange(e.target.value)}
        />
        <span className="testerUnit">{copy.tape.mm}</span>
      </span>
      {props.error && (
        <span className="testerError">{errorText(props.error)}</span>
      )}
    </label>
  );
}

function PairRow(props: {
  readonly name: string;
  readonly title: string;
  readonly pair: PairDraft;
  readonly errors: TapeErrors;
  readonly onChange: (pair: PairDraft) => void;
}) {
  return (
    <div className="testerPair">
      <p className="testerPairTitle">{props.title}</p>
      <div className="testerPairInputs">
        <MmInput
          id={`${props.name}.first`}
          label={copy.tape.first}
          value={props.pair.first}
          error={props.errors[`${props.name}.first`]}
          onChange={(first) => props.onChange({ ...props.pair, first })}
        />
        <MmInput
          id={`${props.name}.second`}
          label={copy.tape.second}
          value={props.pair.second}
          error={props.errors[`${props.name}.second`]}
          onChange={(second) => props.onChange({ ...props.pair, second })}
        />
      </div>
      {needsRecheck(props.pair) && (
        <p className="testerNote" role="status">
          {copy.tape.recheck}
        </p>
      )}
    </div>
  );
}

function MeasureFieldset(props: {
  readonly name: "handLength" | "palmWidth";
  readonly legend: string;
  readonly help: string;
  readonly draft: MeasureDraft;
  readonly errors: TapeErrors;
  readonly onChange: (draft: MeasureDraft) => void;
}) {
  return (
    <fieldset className="testerFieldset">
      <legend className="testerLegend">{props.legend}</legend>
      <div className="testerHelpRow">
        <TapeFigure />
        <p className="testerHint">{props.help}</p>
      </div>
      <PairRow
        name={`${props.name}.a`}
        title={copy.tape.measurerA}
        pair={props.draft.a}
        errors={props.errors}
        onChange={(a) => props.onChange({ ...props.draft, a })}
      />
      <PairRow
        name={`${props.name}.b`}
        title={copy.tape.measurerB}
        pair={props.draft.b}
        errors={props.errors}
        onChange={(b) => props.onChange({ ...props.draft, b })}
      />
    </fieldset>
  );
}

function TapeStep(props: {
  readonly headingRef: HeadingRef;
  readonly draft: TapeDraft;
  readonly errors: TapeErrors;
  readonly onChange: (draft: TapeDraft) => void;
  readonly onSubmit: () => void;
}) {
  const { draft, errors, onChange } = props;
  return (
    <section>
      <h1 ref={props.headingRef} tabIndex={-1} className="testerTitle">
        {copy.tape.title}
      </h1>
      <p className="testerLead">{copy.tape.intro}</p>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          props.onSubmit();
        }}
      >
        <fieldset className="testerFieldset">
          <legend className="testerLegend">{copy.tape.hand}</legend>
          <div className="testerChoices">
            {(["left", "right"] as const).map((hand) => (
              <label key={hand} className="testerChoice">
                <input
                  type="radio"
                  name="tester-hand"
                  checked={draft.hand === hand}
                  onChange={() => onChange({ ...draft, hand })}
                />
                <span>
                  {hand === "left" ? copy.tape.left : copy.tape.right}
                </span>
              </label>
            ))}
          </div>
          {errors.hand && (
            <p className="testerError">{errorText(errors.hand)}</p>
          )}
        </fieldset>
        <MeasureFieldset
          name="handLength"
          legend={copy.tape.handLength}
          help={copy.tape.handLengthHelp}
          draft={draft.handLength}
          errors={errors}
          onChange={(handLength) => onChange({ ...draft, handLength })}
        />
        <MeasureFieldset
          name="palmWidth"
          legend={copy.tape.palmWidth}
          help={copy.tape.palmWidthHelp}
          draft={draft.palmWidth}
          errors={errors}
          onChange={(palmWidth) => onChange({ ...draft, palmWidth })}
        />
        <fieldset className="testerFieldset">
          <legend className="testerLegend">{copy.tape.palmWidthEdge}</legend>
          <p className="testerHint">{copy.tape.palmWidthEdgeHelp}</p>
          <MmInput
            id="palmWidthEdge"
            label={copy.tape.measurerA}
            value={draft.palmWidthEdge}
            error={errors.palmWidthEdge}
            onChange={(palmWidthEdge) => onChange({ ...draft, palmWidthEdge })}
          />
        </fieldset>
        <button type="submit" className="primaryButton testerPrimary">
          {copy.tape.next}
        </button>
      </form>
    </section>
  );
}

function ChoiceGroup<T extends string>(props: {
  readonly name: string;
  readonly legend: string;
  readonly options: readonly T[];
  readonly labels: Readonly<Record<T, string>>;
  readonly value: T | null;
  readonly showError: boolean;
  readonly onChange: (value: T) => void;
}) {
  return (
    <fieldset className="testerFieldset">
      <legend className="testerLegend">{props.legend}</legend>
      <div className="testerChoices">
        {props.options.map((option) => (
          <label key={option} className="testerChoice">
            <input
              type="radio"
              name={props.name}
              checked={props.value === option}
              onChange={() => props.onChange(option)}
            />
            <span>{props.labels[option]}</span>
          </label>
        ))}
      </div>
      {props.showError && props.value === null && (
        <p className="testerError">{copy.conditions.chooseOne}</p>
      )}
    </fieldset>
  );
}

function ConditionsStep(props: {
  readonly headingRef: HeadingRef;
  readonly draft: ConditionsDraft;
  readonly tried: boolean;
  readonly onChange: (draft: ConditionsDraft) => void;
  readonly onStart: () => void;
  readonly onEditTape: () => void;
}) {
  const { draft, tried, onChange } = props;
  const c = copy.conditions;
  const phoneBad = tried && !phoneModelAllowed(draft.phoneModel);
  return (
    <section>
      <h1 ref={props.headingRef} tabIndex={-1} className="testerTitle">
        {c.title}
      </h1>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          props.onStart();
        }}
      >
        <label className="testerField">
          <span className="testerLabel">{c.phoneModel}</span>
          <input
            className="testerInput"
            name="tester-phone-model"
            maxLength={40}
            autoComplete="off"
            value={draft.phoneModel}
            aria-invalid={phoneBad || undefined}
            onChange={(e) => onChange({ ...draft, phoneModel: e.target.value })}
          />
          <span className="testerHint">{c.phoneModelHelp}</span>
          {phoneBad && (
            <span className="testerError">{c.phoneModelInvalid}</span>
          )}
        </label>
        <ChoiceGroup
          name="tester-surface"
          legend={c.surface}
          options={TESTER_SURFACES}
          labels={c.surfaces}
          value={draft.surface}
          showError={tried}
          onChange={(surface) => onChange({ ...draft, surface })}
        />
        <ChoiceGroup
          name="tester-lighting"
          legend={c.lighting}
          options={TESTER_LIGHTING}
          labels={c.lightings}
          value={draft.lighting}
          showError={tried}
          onChange={(lighting) => onChange({ ...draft, lighting })}
        />
        <ChoiceGroup
          name="tester-reference"
          legend={c.reference}
          options={TESTER_REFERENCES}
          labels={c.references}
          value={draft.reference}
          showError={tried}
          onChange={(reference) =>
            onChange({
              ...draft,
              reference,
              cardType: reference === "card" ? draft.cardType : null,
            })
          }
        />
        {draft.reference === "card" && (
          <ChoiceGroup
            name="tester-card-type"
            legend={c.cardType}
            options={TESTER_CARD_TYPES}
            labels={c.cardTypes}
            value={draft.cardType}
            showError={tried}
            onChange={(cardType) => onChange({ ...draft, cardType })}
          />
        )}
        <label className="testerCheck">
          <input
            type="checkbox"
            checked={draft.deliberatelyPoor}
            onChange={(e) =>
              onChange({ ...draft, deliberatelyPoor: e.target.checked })
            }
          />
          <span>{c.deliberatelyPoor}</span>
        </label>
        {draft.reference && <p className="testerNote">{c.referenceReminder}</p>}
        <button type="submit" className="primaryButton testerPrimary">
          {c.start}
        </button>
        <button type="button" className="testerLink" onClick={props.onEditTape}>
          {c.editTape}
        </button>
      </form>
    </section>
  );
}

function ResultStep(props: {
  readonly headingRef: HeadingRef;
  readonly shot: ShotResult;
  readonly tape: TesterTape;
  readonly send: SendState;
  readonly photoDropped: boolean;
  readonly onRetry: () => void;
  readonly onSendWithoutPhoto: () => void;
  readonly onNext: () => void;
  readonly onReenterCode: () => void;
}) {
  const r = copy.result;
  const { shot, tape, send } = props;
  const rows =
    shot.kind === "measured"
      ? ([
          [
            r.handLength,
            shot.data.measurements.handLengthMm,
            tapeAverage(tape.handLength),
          ],
          [
            r.palmWidth,
            shot.data.measurements.palmWidthMm,
            tapeAverage(tape.palmWidth),
          ],
        ] as const)
      : null;
  const status =
    send.kind === "preparing"
      ? r.preparing
      : send.kind === "sending" || send.kind === "idle"
        ? r.sending
        : send.kind === "sent"
          ? shot.kind === "gaveUp"
            ? r.gaveUpSent
            : r.sent
          : send.outcome === "too-many"
            ? r.failedTooMany
            : send.outcome === "invalid"
              ? r.failedInvalid
              : send.outcome === "code"
                ? r.failedCode
                : send.outcome === "unavailable"
                  ? r.failedUnavailable
                  : r.failed;
  return (
    <section>
      <h1 ref={props.headingRef} tabIndex={-1} className="testerTitle">
        {r.title}
      </h1>
      {rows && (
        <table className="testerTable" data-testid="tester-result-table">
          <thead>
            <tr>
              <th scope="col" />
              <th scope="col">{r.app}</th>
              <th scope="col">{r.tape}</th>
              <th scope="col">{r.diff}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, app, tapeMm]) => (
              <tr key={label}>
                <th scope="row">{label}</th>
                <td>{r.mmValue(app.toFixed(1))}</td>
                <td>{r.mmValue(tapeMm.toFixed(1))}</td>
                <td data-testid="tester-diff">
                  {r.mmValue(formatDiffMm(app, tapeMm))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p
        className={`testerStatus${send.kind === "failed" ? " testerStatusError" : ""}`}
        role="status"
        aria-live="polite"
        data-testid="tester-send-status"
      >
        {status}
      </p>
      {send.kind === "sent" && props.photoDropped && (
        <p className="testerHint">{r.noPhoto}</p>
      )}
      {send.kind === "failed" && send.outcome === "code" && (
        <button
          type="button"
          className="primaryButton testerPrimary"
          onClick={props.onReenterCode}
        >
          {r.reenterCode}
        </button>
      )}
      {send.kind === "failed" &&
        (send.outcome === "network" || send.outcome === "too-many") && (
          <button
            type="button"
            className="primaryButton testerPrimary"
            onClick={props.onRetry}
          >
            {r.retry}
          </button>
        )}
      {send.kind === "failed" && send.outcome === "unavailable" && (
        <button
          type="button"
          className="primaryButton testerPrimary"
          onClick={props.onSendWithoutPhoto}
        >
          {r.sendWithoutPhoto}
        </button>
      )}
      {(send.kind === "sent" ||
        (send.kind === "failed" && send.outcome === "invalid")) && (
        <button
          type="button"
          className="primaryButton testerPrimary"
          data-testid="tester-next"
          onClick={props.onNext}
        >
          {r.next}
        </button>
      )}
    </section>
  );
}
