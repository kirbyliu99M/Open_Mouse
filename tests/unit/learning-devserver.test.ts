/**
 * The dev server `learn:sort` starts and must always stop. The server is
 * faked by a tree of two processes (tests/unit/helpers/fake-server-tree.mjs): a
 * parent, and a grandchild that holds the port, the way `next dev` forks a
 * worker. What is checked is the port and the processes, not a mock.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { createServer as createNetServer, type AddressInfo } from "node:net";
import { userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PortBusyError,
  SIGNAL_EXIT,
  devServerSpec,
  installSignalHandlers,
  isListening,
  serverSpawnOptions,
  stopServer,
  waitForServer,
  withDevServer,
  type DevServerOptions,
  type SignalTarget,
} from "../../src/lib/learning/devserver";
import { redactText } from "../../src/lib/learning/paths";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FAKE_TREE = join(
  REPO,
  "tests",
  "unit",
  "helpers",
  "fake-server-tree.mjs",
);
const DRIVER = join(REPO, "tests", "unit", "helpers", "dev-server-driver.ts");
const TSX = join(REPO, "node_modules", "tsx", "dist", "cli.mjs");
const WINDOWS = process.platform === "win32";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(
  what: string,
  check: () => boolean | Promise<boolean>,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await sleep(50);
  }
  throw new Error(`Timed out waiting until ${what}.`);
}

/** A port nothing is listening on right now. */
async function freePort(): Promise<number> {
  const server = createNetServer();
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const { port } = server.address() as AddressInfo;
  await new Promise((closed) => server.close(closed));
  return port;
}

type Mode = "http" | "silent" | "exit" | "exit-paths";

function treeSpec(port: number, mode: Mode = "http") {
  return {
    command: process.execPath,
    args: [FAKE_TREE, String(port), "parent", mode],
    options: serverSpawnOptions(REPO),
  };
}

/**
 * The same fake server behind a shell, the shape of the bug this code exists
 * for: the process that is spawned is `cmd.exe` or `sh` (which is not Node and
 * so does not take its children down with it), and the process that holds the
 * port is its grandchild. Ending only the shell leaves the port taken.
 */
function shellTreeSpec(port: number) {
  const run = `"${process.execPath}" "${FAKE_TREE}" ${port} grandchild http`;
  return WINDOWS
    ? {
        command: "cmd.exe",
        args: ["/d", "/s", "/c", `"${run}"`],
        options: {
          ...serverSpawnOptions(REPO),
          windowsVerbatimArguments: true,
        },
      }
    : {
        command: "sh",
        // "; :" stops sh from replacing itself with the last command.
        args: ["-c", `${run}; :`],
        options: serverSpawnOptions(REPO),
      };
}

const portFree = async (port: number) => !(await isListening(port));
const exited = (child: ChildProcess) =>
  child.exitCode !== null || child.signalCode !== null;

// Whatever a test starts is ended in afterEach, on the same rules the code
// under test uses, so a failure does not leave servers behind.
const started: ChildProcess[] = [];
const servers: Server[] = [];
afterEach(async () => {
  for (const child of started.splice(0)) stopServer(child);
  for (const server of servers.splice(0)) {
    await new Promise((closed) => server.close(closed));
  }
});

function startTree(port: number, mode: Mode = "http") {
  const spec = treeSpec(port, mode);
  const child = spawn(spec.command, [...spec.args], spec.options);
  started.push(child);
  return child;
}

describe("stopServer", () => {
  it("ends the whole tree, not only the process it was given (the grandchild that holds the port goes too)", async () => {
    const port = await freePort();
    const child = startTree(port);
    await until("the grandchild listens", () => isListening(port));

    stopServer(child);

    await until("the port is released", () => portFree(port));
    await until("the parent has ended", () => exited(child));
  }, 60_000);

  it("ends the tree behind a shell too (cmd.exe or sh in front, the port held by its grandchild)", async () => {
    const port = await freePort();
    const spec = shellTreeSpec(port);
    const child = spawn(spec.command, [...spec.args], spec.options);
    started.push(child);
    await until("the grandchild listens", () => isListening(port));

    stopServer(child);

    await until("the port is released", () => portFree(port));
    await until("the shell has ended", () => exited(child));
  }, 60_000);

  it("Windows: ends the tree by parent link (taskkill /T), and does not signal a group", () => {
    const endTree = vi.fn();
    const signalGroup = vi.fn();
    stopServer(
      { pid: 4242, kill: vi.fn() },
      { platform: "win32", endTree, signalGroup },
    );
    expect(endTree).toHaveBeenCalledWith(4242);
    expect(signalGroup).not.toHaveBeenCalled();
  });

  it("POSIX: sends SIGTERM to the whole process group (a negative pid handled by signalGroup), not to the child alone", () => {
    const endTree = vi.fn();
    const signalGroup = vi.fn();
    const kill = vi.fn();
    stopServer(
      { pid: 4242, kill },
      { platform: "linux", endTree, signalGroup },
    );
    expect(signalGroup).toHaveBeenCalledWith(4242, "SIGTERM");
    expect(endTree).not.toHaveBeenCalled();
    expect(kill).not.toHaveBeenCalled();
  });

  it("falls back to ending the child itself when the tree or group cannot be reached", () => {
    for (const platform of ["win32", "linux"] as const) {
      const kill = vi.fn();
      const boom = () => {
        throw new Error("no such process");
      };
      stopServer(
        { pid: 7, kill },
        { platform, endTree: boom, signalGroup: boom },
      );
      expect(kill).toHaveBeenCalledTimes(1);
    }
  });

  it("does nothing for a child that never started (no pid)", () => {
    const endTree = vi.fn();
    const kill = vi.fn();
    stopServer({ pid: undefined, kill }, { endTree, signalGroup: endTree });
    expect(endTree).not.toHaveBeenCalled();
    expect(kill).not.toHaveBeenCalled();
  });
});

describe("how the dev server is spawned", () => {
  it("POSIX: in its own process group, so the group can be signalled; Windows: not (the tree is ended by parent link)", () => {
    expect(serverSpawnOptions("/repo", "linux").detached).toBe(true);
    expect(serverSpawnOptions("/repo", "darwin").detached).toBe(true);
    expect(serverSpawnOptions("/repo", "win32").detached).toBe(false);
  });

  it("stderr is piped (to say why a start-up failed), stdin and stdout are not, and the cwd is the checkout", () => {
    const options = serverSpawnOptions("/repo", "linux");
    expect(options.stdio).toEqual(["ignore", "ignore", "pipe"]);
    expect(options.cwd).toBe("/repo");
  });

  it("runs Node on Next's own CLI with no shell, bound to 127.0.0.1 on the chosen port", () => {
    const spec = devServerSpec("/repo", 3455, "linux");
    expect(spec.command).toBe(process.execPath);
    expect(spec.args).toEqual([
      join("/repo", "node_modules", "next", "dist", "bin", "next"),
      "dev",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3455",
    ]);
    expect(spec.options.shell).toBeUndefined();
    expect(spec.options.detached).toBe(true);
  });
});

describe("isListening", () => {
  it("is true for a server that answers 404, one that answers slowly, and one that never answers", async () => {
    const notFound = createServer((_req, res) => {
      res.statusCode = 404;
      res.end("no");
    });
    const slow = createServer((_req, res) =>
      setTimeout(() => res.end("late"), 5000),
    );
    const silent = createNetServer(() => {});
    for (const server of [notFound, slow, silent]) {
      servers.push(server as Server);
      await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
      expect(await isListening((server.address() as AddressInfo).port)).toBe(
        true,
      );
    }
  });

  it("is false when nothing listens (connection refused)", async () => {
    expect(await isListening(await freePort())).toBe(false);
  });
});

describe("waitForServer", () => {
  it("returns once the page answers 200", async () => {
    const port = await freePort();
    startTree(port);
    await waitForServer(`http://127.0.0.1:${port}/`, { pollMs: 50 });
  }, 60_000);

  it("gives up on a server that accepts connections and never answers, instead of hanging on the request", async () => {
    const port = await freePort();
    startTree(port, "silent");
    await until("the silent server listens", () => isListening(port));
    const began = Date.now();
    await expect(
      waitForServer(`http://127.0.0.1:${port}/`, {
        timeoutMs: 1500,
        fetchTimeoutMs: 200,
        pollMs: 50,
      }),
    ).rejects.toThrow(/did not become ready/);
    expect(Date.now() - began).toBeLessThan(6000);
  }, 60_000);

  it("fails at once, with the server's last output, when the server process ends first", async () => {
    const port = await freePort();
    const child = startTree(port, "exit");
    let tail = "";
    child.stderr?.on("data", (d: Buffer) => (tail += d.toString()));
    const gone = new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
    }>((resolve) =>
      child.once("exit", (code, signal) => resolve({ code, signal })),
    );
    const began = Date.now();
    await expect(
      waitForServer(`http://127.0.0.1:${port}/`, {
        timeoutMs: 30_000,
        pollMs: 50,
        exited: gone,
        stderrTail: () => tail,
      }),
    ).rejects.toThrow(/exited before it was ready.*EADDRINUSE/s);
    expect(Date.now() - began).toBeLessThan(10_000);
  }, 60_000);

  // The server's last words quote absolute paths (its folder, the account's
  // home); the message that reaches a terminal must not.
  describe("redact", () => {
    const shown = (text: string) =>
      redactText(text, {
        username: userInfo().username,
        paths: [{ from: REPO, to: "." }],
      });

    async function failureOf(redact?: (text: string) => string) {
      const port = await freePort();
      const child = startTree(port, "exit-paths");
      let tail = "";
      child.stderr?.on("data", (d: Buffer) => (tail += d.toString()));
      const gone = new Promise<{
        code: number | null;
        signal: NodeJS.Signals | null;
      }>((resolve) =>
        child.once("exit", (code, signal) => resolve({ code, signal })),
      );
      try {
        await waitForServer(`http://127.0.0.1:${port}/`, {
          timeoutMs: 30_000,
          pollMs: 50,
          exited: gone,
          stderrTail: () => tail.trim(),
          redact,
        });
      } catch (err) {
        return (err as Error).message;
      }
      throw new Error("waitForServer did not fail");
    }

    it("the server's own words quote absolute paths (so the next test means something)", async () => {
      const raw = await failureOf();
      expect(raw.toLowerCase()).toContain(REPO.toLowerCase());
    }, 60_000);

    it("applies to the whole failure message, the server's last output included", async () => {
      const message = await failureOf(shown);
      expect(message).toMatch(/exited before it was ready \(code 1\)/);
      expect(message).toMatch(/Cannot find module/);
      expect(message.toLowerCase()).not.toContain(REPO.toLowerCase());
      expect(message.toLowerCase()).not.toContain(
        userInfo().username.toLowerCase(),
      );
      // This checkout is shown as ".".
      expect(message).toMatch(/'\.[\\/]node_modules[\\/]next/);
    }, 60_000);

    it("also covers a server that could not be started at all", async () => {
      const missing = join(REPO, "no-such-node-binary");
      const child = spawn(missing, [], { stdio: "ignore" });
      const gone = new Promise<{
        code: null;
        signal: null;
        error: Error;
      }>((resolve) =>
        child.once("error", (error) =>
          resolve({ code: null, signal: null, error }),
        ),
      );
      const raw = (await gone).error.message;
      expect(raw.toLowerCase()).toContain(REPO.toLowerCase());
      const message = await waitForServer("http://127.0.0.1:1/", {
        timeoutMs: 5000,
        pollMs: 20,
        exited: gone,
        redact: shown,
      }).then(
        () => "",
        (err: Error) => err.message,
      );
      expect(message).toMatch(/could not start/);
      expect(message.toLowerCase()).not.toContain(REPO.toLowerCase());
      expect(message).toMatch(/spawn \.[\\/]no-such-node-binary ENOENT/);
    }, 60_000);

    it("covers the timeout message too", async () => {
      const port = await freePort();
      await expect(
        waitForServer(`http://127.0.0.1:${port}/`, {
          timeoutMs: 300,
          fetchTimeoutMs: 100,
          pollMs: 20,
          redact: (text) => text.replaceAll("127.0.0.1", "HOST"),
        }),
      ).rejects.toThrow(/Server at http:\/\/HOST:\d+\/ did not become ready/);
    }, 60_000);
  });
});

describe("withDevServer", () => {
  const options = (
    port: number,
    mode: Mode = "http",
    extra: Partial<DevServerOptions> = {},
  ): DevServerOptions => ({
    spec: treeSpec(port, mode),
    port,
    readyUrl: `http://127.0.0.1:${port}/`,
    pollMs: 50,
    ...extra,
  });

  it("runs the callback against a live server, returns its value, and leaves no server on the port", async () => {
    const port = await freePort();
    let listeningDuring = false;
    const value = await withDevServer(options(port), async () => {
      listeningDuring = await isListening(port);
      return 42;
    });
    expect(value).toBe(42);
    expect(listeningDuring).toBe(true);
    await until("the port is released", () => portFree(port));
  }, 60_000);

  it("stops the server when the callback throws, and passes the error on", async () => {
    const port = await freePort();
    await expect(
      withDevServer(options(port), async () => {
        throw new Error("the browser crashed");
      }),
    ).rejects.toThrow("the browser crashed");
    await until("the port is released", () => portFree(port));
  }, 60_000);

  it("calls stop exactly once for the server it started (in the finally, on success)", async () => {
    const port = await freePort();
    const stop = vi.fn((child: ChildProcess) => stopServer(child));
    await withDevServer(options(port), async () => "ok", { stop });
    expect(stop).toHaveBeenCalledTimes(1);
    await until("the port is released", () => portFree(port));
  }, 60_000);

  it("refuses a port something already listens on, even if it answers 404 or never answers, and starts nothing", async () => {
    const busy = createNetServer(() => {});
    servers.push(busy as unknown as Server);
    await new Promise<void>((ready) => busy.listen(0, "127.0.0.1", ready));
    const port = (busy.address() as AddressInfo).port;
    const log = vi.fn();
    const spawnSpy = vi.fn();
    await expect(
      withDevServer(options(port, "http", { log }), async () => "never", {
        spawn: spawnSpy as never,
      }),
    ).rejects.toBeInstanceOf(PortBusyError);
    expect(spawnSpy).not.toHaveBeenCalled();
    // "Starting dev server" is only said once the port has been checked.
    expect(log).not.toHaveBeenCalled();
  });

  it("says it is starting only after the port check passed, and just before it spawns", async () => {
    const port = await freePort();
    const order: string[] = [];
    const realSpawn = spawn;
    await withDevServer(
      options(port, "http", { log: () => order.push("log") }),
      async () => "ok",
      {
        spawn: ((...args: Parameters<typeof spawn>) => {
          order.push("spawn");
          return realSpawn(...args);
        }) as typeof spawn,
      },
    );
    expect(order).toEqual(["log", "spawn"]);
  }, 60_000);

  it("fails fast, with the server's own words, when the server dies at start-up (for example the port was taken in between)", async () => {
    const port = await freePort();
    const began = Date.now();
    await expect(
      withDevServer(
        options(port, "exit", { readyTimeoutMs: 30_000 }),
        async () => "never",
      ),
    ).rejects.toThrow(/exited before it was ready.*EADDRINUSE/s);
    expect(Date.now() - began).toBeLessThan(10_000);
  }, 60_000);

  it("passes its redaction to the failure it throws when the server dies at start-up", async () => {
    const port = await freePort();
    const error = await withDevServer(
      options(port, "exit-paths", {
        readyTimeoutMs: 30_000,
        redact: (text) =>
          redactText(text, { paths: [{ from: REPO, to: "." }] }),
      }),
      async () => "never",
    ).catch((err: Error) => err);
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toMatch(/exited before it was ready.*Cannot find module/s);
    expect(message.toLowerCase()).not.toContain(REPO.toLowerCase());
  }, 60_000);

  it("stops a server that never becomes ready", async () => {
    const port = await freePort();
    await expect(
      withDevServer(
        options(port, "silent", { readyTimeoutMs: 1200, fetchTimeoutMs: 200 }),
        async () => "never",
      ),
    ).rejects.toThrow(/did not become ready/);
    await until("the port is released", () => portFree(port));
  }, 60_000);
});

describe("installSignalHandlers", () => {
  function fakeProcess() {
    const listeners = new Map<string, () => void>();
    const target: SignalTarget = {
      on: (signal, listener) => listeners.set(signal, listener),
      off: (signal, listener) => {
        if (listeners.get(signal) === listener) listeners.delete(signal);
      },
    };
    return { target, listeners };
  }

  it("on SIGINT and SIGTERM stops the server first and then exits with 130 and 143", () => {
    for (const [signal, code] of [
      ["SIGINT", 130],
      ["SIGTERM", 143],
    ] as const) {
      const { target, listeners } = fakeProcess();
      const calls: string[] = [];
      installSignalHandlers(
        target,
        () => calls.push("stop"),
        (c) => calls.push(`exit ${c}`),
      );
      listeners.get(signal)!();
      expect(calls).toEqual(["stop", `exit ${code}`]);
      expect(SIGNAL_EXIT[signal]).toBe(code);
    }
  });

  it("still exits if stopping throws", () => {
    const { target, listeners } = fakeProcess();
    const exit = vi.fn();
    installSignalHandlers(
      target,
      () => {
        throw new Error("boom");
      },
      exit,
    );
    expect(() => listeners.get("SIGINT")!()).toThrow("boom");
    expect(exit).toHaveBeenCalledWith(130);
  });

  it("registers both signals, and the returned function removes them", () => {
    const { target, listeners } = fakeProcess();
    const remove = installSignalHandlers(
      target,
      () => {},
      () => {},
    );
    expect([...listeners.keys()].sort()).toEqual(["SIGINT", "SIGTERM"]);
    remove();
    expect(listeners.size).toBe(0);
  });

  it("withDevServer registers the handlers while it runs and removes them afterwards", async () => {
    const port = await freePort();
    const { target, listeners } = fakeProcess();
    let during = 0;
    await withDevServer(
      {
        spec: treeSpec(port),
        port,
        readyUrl: `http://127.0.0.1:${port}/`,
        pollMs: 50,
      },
      async () => {
        during = listeners.size;
      },
      { signals: target, exit: () => {} },
    );
    expect(during).toBe(2);
    expect(listeners.size).toBe(0);
  }, 60_000);
});

// Real signals reach a real process only on POSIX (on Windows a "signal" ends
// the process at once, with no handler). CI runs on Linux, so it runs there.
describe.skipIf(WINDOWS)("Ctrl+C and kill on a running learn:sort", () => {
  for (const [signal, code] of [
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ] as const) {
    it(`${signal} stops the server tree and exits with ${code}`, async () => {
      const port = await freePort();
      const driver = spawn(process.execPath, [TSX, DRIVER, String(port)], {
        cwd: REPO,
        stdio: ["ignore", "pipe", "pipe"],
      });
      started.push(driver);
      let out = "";
      driver.stdout?.on("data", (d: Buffer) => (out += d.toString()));
      await until(
        "the driver is running the callback",
        () => out.includes("READY"),
        60_000,
      );
      expect(await isListening(port)).toBe(true);

      driver.kill(signal);

      const status = await new Promise<number | null>((done) =>
        driver.once("exit", (c) => done(c)),
      );
      expect(status).toBe(code);
      await until("the port is released", () => portFree(port));
    }, 120_000);
  }
});
