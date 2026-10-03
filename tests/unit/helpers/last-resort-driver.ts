// Run by learning-terminal.test.ts with tsx. It installs the same last line of
// defence as scripts/learn-sort.ts and then lets something escape, the way a
// callback or a forgotten promise would:
//
//   tsx last-resort-driver.ts throw    an exception from a timer
//   tsx last-resort-driver.ts reject   a rejected promise nobody awaits
//
// The error's message and stack both quote absolute paths.
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import { terminalRedaction } from "../../../src/lib/learning/paths";
import {
  installLastResort,
  makeTerminal,
} from "../../../src/lib/learning/terminal";

const terminal = makeTerminal(
  terminalRedaction({
    cwd: process.cwd(),
    scriptRoot: process.cwd(),
    username: userInfo().username,
  }),
);
installLastResort(terminal.failure, (code) => process.exit(code));

const boom = () =>
  new Error(
    `escaped while reading '${join(homedir(), "notes.txt")}' and '${join(process.cwd(), "data.json")}'`,
  );

if (process.argv[2] === "reject") {
  void Promise.reject(boom());
} else {
  setTimeout(() => {
    throw boom();
  }, 10);
}
