/**
 * What a record may say about an error: its type, and nothing it said. An
 * error's message can quote a file path, an account name or pixel values, and
 * a run log must hold none of them.
 */

/** The error's type, and nothing it says: a plain identifier, or "Error". */
export function failureKind(err: unknown): string {
  if (!(err instanceof Error)) return "NonError";
  const name =
    err.name && err.name !== "Error"
      ? err.name
      : (err.constructor?.name ?? "Error");
  return /^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(name) ? name : "Error";
}

/**
 * What a terminal shows for a failure: the message, never the stack (a stack
 * is a list of absolute paths) and never the error's other fields. A thrown
 * string is its own message; any other value is named, not printed.
 */
export function failureMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "Unexpected failure (a value that is not an Error was thrown).";
}
