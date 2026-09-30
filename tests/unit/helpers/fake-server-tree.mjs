// A stand-in for `next dev`, made to be stopped: a parent process that starts a
// grandchild, and the grandchild is what listens on the port (as Next's worker
// does). Killing only the parent leaves the port taken.
//
//   node fake-server-tree.mjs <port> [role] [mode]
//
// role  parent (default) starts the grandchild and stays alive; grandchild listens.
// mode  http    answers every request 200
//       silent  accepts connections and never answers
//       exit    the parent writes an EADDRINUSE-like line to stderr and exits 1
//
// Every process in the tree ends by itself after 60 s, so a failing test cannot
// leave one behind.
import { spawn } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";

const [, self, portArg, role = "parent", mode = "http"] = process.argv;
const port = Number(portArg);

setTimeout(() => process.exit(0), 60_000);
setInterval(() => {}, 1000);

if (role === "grandchild") {
  const server =
    mode === "silent"
      ? createNetServer(() => {})
      : createHttpServer((_req, res) => res.end("ok"));
  server.listen(port, "127.0.0.1");
} else if (mode === "exit") {
  console.error(
    `Error: listen EADDRINUSE: address already in use 127.0.0.1:${port}`,
  );
  process.exit(1);
} else {
  spawn(process.execPath, [self, String(port), "grandchild", mode], {
    stdio: "ignore",
  });
}
