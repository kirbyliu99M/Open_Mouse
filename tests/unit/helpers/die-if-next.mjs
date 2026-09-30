// Preloaded with NODE_OPTIONS="--import <this file's URL>" by the learn:sort
// script test. In every Node process of the run it does nothing, except in
// `next` itself: there it ends the process at once, with a crash report that
// quotes absolute paths (the working folder, the account's home), the way a
// real dev server dies when something is wrong with the checkout. That is what
// `learn:sort` must not repeat on a terminal.
import { homedir } from "node:os";
import { join } from "node:path";

const entry = String(process.argv[1] || "").replace(/\\/g, "/");
if (/\/node_modules\/next\/dist\/bin\/next$/.test(entry)) {
  console.error(
    `Error: Cannot find module '${join(process.cwd(), "node_modules", "next", "dist", "server", "next.js")}'`,
  );
  console.error(`    while reading ${join(homedir(), ".npmrc")}`);
  process.exit(1);
}
