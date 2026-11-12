/**
 * The tester's phone model (contract src/lib/contracts/tester.ts: "filtered
 * like survey comments: no e-mail, phone numbers or URLs"). The survey's
 * `commentText` refuses control characters, e-mail addresses and phone
 * numbers; a link is refused here too. Shared by the page (before sending)
 * and the route (before storing).
 *
 * `detectPhoneModel` fills the page's box where the browser tells the model
 * (User-Agent Client Hints: Chromium on Android, e.g. "SM-S9280", "Pixel 8";
 * Safari and Firefox tell nothing). The value only goes into the visible,
 * editable box: nothing is sent that the person did not see.
 */
import { commentText } from "../contracts/survey";

export const PHONE_MODEL_MAX_CHARS = 40;

const URL_LIKE =
  /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|tw|io|me|co|app|dev)\b)/i;

/** Whether the phone model as typed may be stored. */
export function phoneModelAllowed(phoneModel: string): boolean {
  const text = phoneModel.trim();
  return (
    text.length >= 1 &&
    text.length <= PHONE_MODEL_MAX_CHARS &&
    commentText.safeParse(text).success &&
    !URL_LIKE.test(text)
  );
}

/** The part of `navigator` the model hint needs. */
export interface PhoneModelSource {
  readonly userAgentData?: {
    readonly getHighEntropyValues?: (
      hints: string[],
    ) => Promise<{ readonly model?: unknown }>;
  };
}

/** The phone model the browser tells, if it may be stored; otherwise null. */
export async function detectPhoneModel(
  source: PhoneModelSource,
): Promise<string | null> {
  try {
    const data = source.userAgentData;
    if (typeof data?.getHighEntropyValues !== "function") return null;
    const { model } = await data.getHighEntropyValues(["model"]);
    const text = typeof model === "string" ? model.trim() : "";
    return phoneModelAllowed(text) ? text : null;
  } catch {
    return null;
  }
}
