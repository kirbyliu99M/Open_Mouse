/**
 * A tiny program that runs `withDevServer` against the fake server tree and
 * then waits, so a test can send it SIGINT or SIGTERM and check that the tree
 * is gone. Run with tsx: `node tsx/cli.mjs dev-server-driver.ts <port>`.
 * Prints READY when the callback starts.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  serverSpawnOptions,
  withDevServer,
} from "../../../src/lib/learning/devserver";

const port = Number(process.argv[2]);
const here = dirname(fileURLToPath(import.meta.url));

await withDevServer(
  {
    spec: {
      command: process.execPath,
      args: [
        join(here, "fake-server-tree.mjs"),
        String(port),
        "parent",
        "http",
      ],
      options: serverSpawnOptions(process.cwd()),
    },
    port,
    readyUrl: `http://127.0.0.1:${port}/`,
    pollMs: 50,
  },
  async () => {
    console.log("READY");
    await new Promise((resolve) => setTimeout(resolve, 60_000));
  },
);
