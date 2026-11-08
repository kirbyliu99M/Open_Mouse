/**
 * The tester page's two requests (contract src/lib/contracts/tester.ts).
 * A shot is sent with its browser-made `shotId`, the idempotency key: a
 * retry after a lost answer stores nothing twice.
 */
import {
  TESTER_CHECK_PATH,
  TESTER_SHOT_PATH,
  testerCheckResponseSchema,
  type TesterRecord,
} from "../../lib/contracts/tester";

export const TESTER_CODE_STORAGE_KEY = "palmate-tester-code";
const TIMEOUT_MS = 30_000;

export type CheckOutcome =
  | { readonly ok: true; readonly participant: string }
  | { readonly ok: false; readonly reason: "invalid" | "too-many" | "network" };

export async function checkTesterCode(code: string): Promise<CheckOutcome> {
  try {
    const response = await fetch(TESTER_CHECK_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.status === 404 || response.status === 400)
      return { ok: false, reason: "invalid" };
    if (response.status === 429) return { ok: false, reason: "too-many" };
    if (!response.ok) return { ok: false, reason: "network" };
    const parsed = testerCheckResponseSchema.safeParse(await response.json());
    return parsed.success
      ? { ok: true, participant: parsed.data.participant }
      : { ok: false, reason: "network" };
  } catch {
    return { ok: false, reason: "network" };
  }
}

export type ShotOutcome =
  "sent" | "invalid" | "code" | "too-many" | "unavailable" | "network";

export async function sendTesterShot(input: {
  readonly code: string;
  readonly record: TesterRecord;
  readonly photo?: Blob;
}): Promise<ShotOutcome> {
  const form = new FormData();
  form.append("code", input.code);
  form.append("record", JSON.stringify(input.record));
  if (input.photo) form.append("photo", input.photo, "photo.jpg");
  try {
    const response = await fetch(TESTER_SHOT_PATH, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.status === 200 || response.status === 201) return "sent";
    if (response.status === 404) return "code";
    if (response.status === 400 || response.status === 413) return "invalid";
    if (response.status === 429) return "too-many";
    if (response.status === 503) return "unavailable";
    return "network";
  } catch {
    return "network";
  }
}

/** sessionStorage, never throwing (a private window may refuse it). */
export const codeStorage = {
  read(): string | null {
    try {
      return window.sessionStorage.getItem(TESTER_CODE_STORAGE_KEY);
    } catch {
      return null;
    }
  },
  write(code: string): void {
    try {
      window.sessionStorage.setItem(TESTER_CODE_STORAGE_KEY, code);
    } catch {
      // Kept in memory only.
    }
  },
  clear(): void {
    try {
      window.sessionStorage.removeItem(TESTER_CODE_STORAGE_KEY);
    } catch {
      // Nothing stored.
    }
  },
};
