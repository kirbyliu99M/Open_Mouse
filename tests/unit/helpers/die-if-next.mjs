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
  console.error(`Note: settings are in '${join(homedir(), ".npmrc")}'`);
  // A folder the script's caller was in (set by the test): the sorter shows
  // its own working folder as ".", whichever folder that is.
  if (process.env.DIE_IF_NEXT_QUOTES) {
    console.error(
      `Note: started from '${join(process.env.DIE_IF_NEXT_QUOTES, "session.txt")}'`,
    );
  }
  // What Playwright says when its browser is missing, and stack frames.
  console.error(
    `browserType.launch: Executable doesn't exist at ${join(homedir(), "AppData", "Local", "ms-playwright", "chromium-1", "chrome.exe")}`,
  );
  console.error(
    `    at Module._resolveFilename (${join(homedir(), "loader.js")}:1:1)`,
  );
  console.error(
    `    at Object.<anonymous> (${join(process.cwd(), "x.js")}:2:2)`,
  );
  process.exit(1);
}
