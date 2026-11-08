/**
 * The tester's phone model (contract src/lib/contracts/tester.ts: "filtered
 * like survey comments: no e-mail, phone numbers or URLs"). The survey's
 * `commentText` refuses control characters, e-mail addresses and phone
 * numbers; a link is refused here too. Shared by the page (before sending)
 * and the route (before storing).
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
