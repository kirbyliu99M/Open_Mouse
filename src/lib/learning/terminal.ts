/**
 * What `npm run learn:sort` may put on a terminal. Everything it prints goes
 * through here, so no absolute path and no account name reaches the screen
 * (or a log someone copies from it): `redactText` on every line, and for a
 * failure the message only, never the stack. Node only, like the script.
 */
import { failureMessage } from "./errorkind";
import { redactText, type RedactOptions } from "./paths";

export interface TerminalSinks {
  log(text: string): void;
  error(text: string): void;
}

export function makeTerminal(
  redaction: RedactOptions,
  sinks: TerminalSinks = console,
) {
  const show = (text: string) => redactText(text, redaction);
  return {
    /** The text as the terminal shows it. */
    show,
    /** A progress line (stdout). */
    say: (text: string) => sinks.log(show(text)),
    /** A complaint (stderr). */
    warn: (text: string) => sinks.error(show(text)),
    /** Why the run failed (stderr): the error's message, redacted; never its stack. */
    failure: (err: unknown) => sinks.error(show(failureMessage(err))),
  };
}

/** What `installLastResort` needs from `process`; a stand-in in tests. */
export interface ProcessLike {
  on(event: "uncaughtException", listener: (err: Error) => void): unknown;
  on(event: "unhandledRejection", listener: (reason: unknown) => void): unknown;
}

/**
 * The last line of defence for a script: an exception or a rejected promise
 * that nothing caught is printed through `failure` (redacted, message only)
 * and the process exits 1, instead of Node printing a raw stack with absolute
 * paths.
 */
export function installLastResort(
  failure: (err: unknown) => void,
  exit: (code: number) => void,
  target: ProcessLike = process,
): void {
  target.on("uncaughtException", (err) => {
    failure(err);
    exit(1);
  });
  target.on("unhandledRejection", (reason) => {
    failure(reason);
    exit(1);
  });
}
