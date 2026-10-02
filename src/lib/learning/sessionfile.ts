/**
 * Reading `session.json` and `participant.json` from the text of the file
 * (kit v2). The shapes are the contract's (`session.ts`); this adds only the
 * step from text to a checked record, with an error a person can act on.
 *
 * An error names the field that is wrong and what is wrong with it, never the
 * value it held: a session's text is typed by hand and a log or a terminal
 * must not repeat it. Pure.
 */
import type { z } from "zod";
import {
  labelsRecordSchema,
  participantRecordSchema,
  sessionRecordSchema,
  type LabelsRecord,
  type ParticipantRecord,
  type SessionRecord,
} from "./session";

export type Parsed<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string };

function where(issue: z.core.$ZodIssue): string {
  return issue.path.length > 0 ? issue.path.join(".") : "(top level)";
}

function check<T>(
  text: string,
  schema: z.ZodType<T>,
  label: string,
): Parsed<T> {
  let json: unknown;
  try {
    // Windows editors (Notepad, PowerShell's Out-File) save a hand-edited file
    // with a UTF-8 byte-order mark in front, which JSON.parse refuses.
    json = JSON.parse(text.replace(/^﻿/, ""));
  } catch {
    return {
      ok: false,
      message: `${label} is not valid JSON (check for a missing comma or quote; a UTF-8 byte-order mark is accepted).`,
    };
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 4)
      .map((i) => `${where(i)} (${i.code})`)
      .join(", ");
    return {
      ok: false,
      message: `${label} does not fit the format. Check: ${issues}.`,
    };
  }
  return { ok: true, value: parsed.data };
}

/** `session.json`, from its text. */
export function parseSessionFile(text: string): Parsed<SessionRecord> {
  return check(text, sessionRecordSchema, "session.json");
}

/**
 * A participant's `participant.json`, from its text. It must be that
 * participant's own: a file copied from another folder is refused.
 */
export function parseParticipantFile(
  text: string,
  participant: string,
): Parsed<ParticipantRecord> {
  const parsed = check(
    text,
    participantRecordSchema,
    `${participant}/participant.json`,
  );
  if (!parsed.ok) return parsed;
  if (parsed.value.participant !== participant) {
    return {
      ok: false,
      message: `${participant}/participant.json is another participant's record (its participant field is not ${participant}).`,
    };
  }
  return parsed;
}

/** `labels.json`, from its text. */
export function parseLabelsFile(text: string): Parsed<LabelsRecord> {
  return check(text, labelsRecordSchema, "labels.json");
}

/**
 * The filed photos a labels file has no entry for, in the order given. A
 * photo is covered by an entry with its relative destination (`P007/G02/1.jpg`)
 * as `file`, labelled or not.
 */
export function photosMissingLabels(
  labels: LabelsRecord,
  files: readonly string[],
): string[] {
  const have = new Set(labels.labels.map((l) => l.file));
  return files.filter((f) => !have.has(f));
}
