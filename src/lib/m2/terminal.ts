/**
 * The terminal of `npm run m2:evaluate`: the same filter as `learn:sort`'s
 * (src/lib/learning/terminal.ts), plus the paths named on the command line
 * shown relative to where the command ran. Kept out of the script so a test can
 * check what it hides: a folder it was not told about becomes `<path>`, stack
 * frames become one note, the account name becomes `~`.
 */
import { relativeInputPath, terminalRedaction } from "../learning/paths";
import { makeTerminal } from "../learning/terminal";

export function m2Terminal(args: {
  readonly cwd: string;
  readonly scriptRoot: string;
  readonly username: string | null;
  /** Absolute paths from the command line (and anything below them is shown relative too). */
  readonly named?: readonly string[];
}) {
  const { cwd, scriptRoot, username } = args;
  // Everything `terminalRedaction` turns on, including `hideOtherPaths` and
  // `dropStackFrames`, is kept; only the paths grow.
  const base = terminalRedaction({ cwd, scriptRoot, username });
  return makeTerminal({
    ...base,
    paths: [
      ...base.paths,
      ...(args.named ?? []).map((from) => ({
        from,
        to: relativeInputPath(from, cwd, { username }),
      })),
    ],
  });
}
