/**
 * The tester page's tape form, pure (candidate 未拍板; contract
 * src/lib/contracts/tester.ts): what was typed -> the contract's `tape`, the
 * "measure again" hint, and the averages the result screen compares with.
 * Unit-tested in tests/unit/tester-client.test.ts.
 */
import type { TesterRecord } from "../../lib/contracts/tester";

export type TesterTape = TesterRecord["tape"];

export interface PairDraft {
  readonly first: string;
  readonly second: string;
}

export interface MeasureDraft {
  readonly a: PairDraft;
  readonly b: PairDraft;
}

export interface TapeDraft {
  readonly hand: "left" | "right" | null;
  readonly handLength: MeasureDraft;
  readonly palmWidth: MeasureDraft;
  readonly palmWidthEdge: string;
}

const EMPTY_PAIR: PairDraft = { first: "", second: "" };
export const EMPTY_TAPE: TapeDraft = {
  hand: null,
  handLength: { a: EMPTY_PAIR, b: EMPTY_PAIR },
  palmWidth: { a: EMPTY_PAIR, b: EMPTY_PAIR },
  palmWidthEdge: "",
};

/** Two readings of one measurer that differ by more than this ask for a re-measure (never blocks). */
export const RECHECK_MM = 3;

/**
 * A typed tape value: "" -> null, a number from 50 to 300 with at most one
 * decimal -> that number, anything else -> "invalid". A comma decimal is read
 * as a point.
 */
export function parseTapeMm(raw: string): number | null | "invalid" {
  const text = raw.trim().replace(",", ".");
  if (text === "") return null;
  if (!/^\d{2,3}(\.\d)?$/.test(text)) return "invalid";
  const value = Number(text);
  return value >= 50 && value <= 300 ? value : "invalid";
}

export type TapeFieldError = "required" | "invalid" | "pairIncomplete";

/** Field key -> its problem, for the form. Keys: `handLength.a.first`, ..., `palmWidthEdge`, `hand`. */
export type TapeErrors = Partial<
  Record<string, TapeFieldError | "handRequired">
>;

function readPair(
  draft: PairDraft,
  key: string,
  required: boolean,
  errors: TapeErrors,
): { first: number; second: number } | undefined {
  const first = parseTapeMm(draft.first);
  const second = parseTapeMm(draft.second);
  if (first === "invalid") errors[`${key}.first`] = "invalid";
  if (second === "invalid") errors[`${key}.second`] = "invalid";
  if (first === "invalid" || second === "invalid") return undefined;
  if (first === null && second === null) {
    if (required) {
      errors[`${key}.first`] = "required";
      errors[`${key}.second`] = "required";
    }
    return undefined;
  }
  if (first === null || second === null) {
    errors[`${key}.${first === null ? "first" : "second"}`] = required
      ? "required"
      : "pairIncomplete";
    return undefined;
  }
  return { first, second };
}

/** The draft as the contract's `tape`, or the errors to show. */
export function buildTape(
  draft: TapeDraft,
): { ok: true; tape: TesterTape } | { ok: false; errors: TapeErrors } {
  const errors: TapeErrors = {};
  if (!draft.hand) errors.hand = "handRequired";
  const measure = (name: "handLength" | "palmWidth") => {
    const a = readPair(draft[name].a, `${name}.a`, true, errors);
    const b = readPair(draft[name].b, `${name}.b`, false, errors);
    return a ? { a, ...(b ? { b } : {}) } : undefined;
  };
  const handLength = measure("handLength");
  const palmWidth = measure("palmWidth");
  const edge = parseTapeMm(draft.palmWidthEdge);
  if (edge === "invalid") errors.palmWidthEdge = "invalid";
  if (
    Object.keys(errors).length > 0 ||
    !handLength ||
    !palmWidth ||
    !draft.hand
  )
    return { ok: false, errors };
  return {
    ok: true,
    tape: {
      hand: draft.hand,
      handLength,
      palmWidth,
      ...(typeof edge === "number" ? { palmWidthEdge: edge } : {}),
    },
  };
}

/** Whether a measurer's two typed readings differ by more than `RECHECK_MM`. */
export function needsRecheck(draft: PairDraft): boolean {
  const first = parseTapeMm(draft.first);
  const second = parseTapeMm(draft.second);
  return (
    typeof first === "number" &&
    typeof second === "number" &&
    Math.abs(first - second) > RECHECK_MM + 1e-9
  );
}

/** The mean of every reading of one measure (A's two, plus B's two when typed). */
export function tapeAverage(measure: TesterTape["handLength"]): number {
  const values = [
    measure.a.first,
    measure.a.second,
    ...(measure.b ? [measure.b.first, measure.b.second] : []),
  ];
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/** App minus tape, rounded to 0.1 mm, signed ("+2.3" / "-1.0" / "0.0"). */
export function formatDiffMm(appMm: number, tapeMm: number): string {
  const d = Math.round((appMm - tapeMm) * 10) / 10;
  if (Object.is(d, -0) || d === 0) return "0.0";
  return `${d > 0 ? "+" : "−"}${Math.abs(d).toFixed(1)}`;
}
