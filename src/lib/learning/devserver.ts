/**
 * The dev server `npm run learn:sort` starts, and the rules for starting and
 * stopping it. Node only (child processes, sockets), so nothing that runs in
 * the browser imports it. Split out of the script so the parts that used to be
 * untested (ending the whole process tree, refusing a busy port, giving up
 * when the server dies at start-up, cleaning up on Ctrl+C) can be tested with a
 * fake server made of a parent process and a listening grandchild.
 *
 * Why the care: `next dev` forks a worker that holds the port. Killing only
 * the process the script spawned leaves that worker listening, and the next
 * run then talks to a stale server, so the git commit in its run log no
 * longer describes the code that ran.
 */
import {
  execFileSync,
  spawn,
  type ChildProcess,
  type SpawnOptions,
} from "node:child_process";
import { connect } from "node:net";
import { join } from "node:path";

/** The address the dev server binds. */
export const DEV_SERVER_HOST = "127.0.0.1";

export interface DevServerSpec {
  readonly command: string;
  readonly args: readonly string[];
  readonly options: SpawnOptions;
}

/**
 * Spawn options for anything that may leave grandchildren: its own process
 * group where the platform has them (POSIX; Windows ends a tree by parent link
 * instead), no stdin or stdout, and stderr piped so a start-up failure can say
 * why.
 */
export function serverSpawnOptions(
  cwd: string,
  platform: NodeJS.Platform = process.platform,
): SpawnOptions {
  return {
    cwd,
    stdio: ["ignore", "ignore", "pipe"],
    detached: platform !== "win32",
    windowsHide: true,
  };
}

/** How `learn:sort` starts Next: Node runs it directly, no shell. */
export function devServerSpec(
  scriptRoot: string,
  port: number,
  platform: NodeJS.Platform = process.platform,
): DevServerSpec {
  return {
    command: process.execPath,
    args: [
      join(scriptRoot, "node_modules", "next", "dist", "bin", "next"),
      "dev",
      "--hostname",
      DEV_SERVER_HOST,
      "--port",
      String(port),
    ],
    options: serverSpawnOptions(scriptRoot, platform),
  };
}

export interface StopDeps {
  readonly platform?: NodeJS.Platform;
  /** Ends `pid` and everything it started. */
  readonly endTree?: (pid: number) => void;
  /** Signals the whole process group of `pid` (POSIX). */
  readonly signalGroup?: (pid: number, signal: NodeJS.Signals) => void;
}

const taskkill = (pid: number) => {
  execFileSync("taskkill", ["/pid", String(pid), "/T", "/F"], {
    stdio: "ignore",
    windowsHide: true,
  });
};
const signalGroup = (pid: number, signal: NodeJS.Signals) => {
  process.kill(-pid, signal);
};

/**
 * End the server and everything it started, so no worker is left on the port.
 * Windows: `taskkill /T` walks the tree. Elsewhere the server was spawned in
 * its own process group, and the whole group is sent SIGTERM. If that fails
 * (already gone, no group), fall back to ending the child itself.
 */
export function stopServer(
  child: Pick<ChildProcess, "pid" | "kill">,
  deps: StopDeps = {},
): void {
  const pid = child.pid;
  if (pid === undefined) return;
  const platform = deps.platform ?? process.platform;
  try {
    if (platform === "win32") (deps.endTree ?? taskkill)(pid);
    else (deps.signalGroup ?? signalGroup)(pid, "SIGTERM");
  } catch {
    try {
      child.kill();
    } catch {
      // already gone
    }
  }
}

/**
 * Is anything listening on the port? A TCP connect answers this whatever the
 * thing would say over HTTP: a server that replies 404, replies slowly, or
 * never replies is still in the way. Only "connection refused" means free; a
 * connect that hangs (a full accept queue) counts as busy.
 */
export function isListening(
  port: number,
  host: string = DEV_SERVER_HOST,
  timeoutMs = 1000,
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ port, host });
    const done = (busy: boolean) => {
      socket.destroy();
      resolve(busy);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(true));
    socket.once("error", () => done(false));
  });
}

export interface ExitInfo {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly error?: Error;
}

export interface WaitOptions {
  readonly timeoutMs?: number;
  /** Each request gives up after this long, so a server that accepts and never answers cannot hang the wait. */
  readonly fetchTimeoutMs?: number;
  readonly pollMs?: number;
  /** Settles if the server process ends; the wait then fails at once. */
  readonly exited?: Promise<ExitInfo>;
  /** The tail of the server's stderr, for the failure message. */
  readonly stderrTail?: () => string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Wait until `url` answers with a success status. */
export async function waitForServer(
  url: string,
  options: WaitOptions = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 90_000;
  const fetchTimeoutMs = options.fetchTimeoutMs ?? 2000;
  const pollMs = options.pollMs ?? 500;
  let early: ExitInfo | null = null;
  void options.exited?.then((info) => {
    early = info;
  });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (early) throw earlyExit(early, options.stderrTail?.() ?? "");
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(fetchTimeoutMs),
      });
      if (res.ok) return;
    } catch {
      // not up yet, or too slow to tell
    }
    await sleep(pollMs);
  }
  if (early) throw earlyExit(early, options.stderrTail?.() ?? "");
  throw new Error(`Server at ${url} did not become ready in time.`);
}

function earlyExit(info: ExitInfo, tail: string): Error {
  const how = info.error
    ? `could not start (${info.error.message})`
    : `exited before it was ready (${info.signal ?? `code ${info.code}`})`;
  return new Error(
    `The dev server ${how}.${tail ? ` Its last output:\n${tail}` : ""}`,
  );
}

/** What the signal handlers need from `process`; a stand-in in tests. */
export interface SignalTarget {
  on(signal: NodeJS.Signals, listener: () => void): unknown;
  off(signal: NodeJS.Signals, listener: () => void): unknown;
}

/** Conventional exit codes: 128 plus the signal number. */
export const SIGNAL_EXIT: Readonly<Record<string, number>> = {
  SIGINT: 130,
  SIGTERM: 143,
};

/**
 * On SIGINT or SIGTERM stop the server first, then exit. On POSIX the server
 * is in its own process group, so Ctrl+C in the terminal reaches this script
 * but not the server; without this it would be left running. Returns a
 * function that removes the handlers.
 */
export function installSignalHandlers(
  target: SignalTarget,
  stop: () => void,
  exit: (code: number) => void,
  signals: readonly NodeJS.Signals[] = ["SIGINT", "SIGTERM"],
): () => void {
  const handlers = signals.map((signal) => {
    const handler = () => {
      try {
        stop();
      } finally {
        exit(SIGNAL_EXIT[signal] ?? 1);
      }
    };
    target.on(signal, handler);
    return [signal, handler] as const;
  });
  return () => {
    for (const [signal, handler] of handlers) target.off(signal, handler);
  };
}

export class PortBusyError extends Error {
  constructor(url: string) {
    super(
      `Something already answers on ${url}. Stop it, choose another --port, or pass --base to use it on purpose.`,
    );
    this.name = "PortBusyError";
  }
}

export interface DevServerOptions {
  readonly spec: DevServerSpec;
  readonly port: number;
  /** The page whose success means the server is ready. */
  readonly readyUrl: string;
  /** Printed once the port has been checked and just before the server is started. */
  readonly log?: (message: string) => void;
  readonly readyTimeoutMs?: number;
  readonly fetchTimeoutMs?: number;
  readonly pollMs?: number;
}

export interface DevServerDeps {
  readonly spawn?: typeof spawn;
  readonly signals?: SignalTarget;
  readonly exit?: (code: number) => void;
  readonly stop?: (child: ChildProcess) => void;
}

const TAIL_BYTES = 2000;

/**
 * Run `fn` against a dev server that this call starts and always stops: after
 * `fn` returns, after it throws, when the server dies at start-up, and on
 * SIGINT or SIGTERM. Refuses if anything already listens on the port.
 */
export async function withDevServer<T>(
  options: DevServerOptions,
  fn: () => Promise<T>,
  deps: DevServerDeps = {},
): Promise<T> {
  if (await isListening(options.port))
    throw new PortBusyError(options.readyUrl);
  options.log?.(`Starting dev server on ${options.readyUrl} …`);

  const child = (deps.spawn ?? spawn)(
    options.spec.command,
    [...options.spec.args],
    options.spec.options,
  );
  const stop = () => (deps.stop ?? stopServer)(child);
  let tail = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    tail = (tail + chunk.toString()).slice(-TAIL_BYTES);
  });
  const exited = new Promise<ExitInfo>((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
    child.once("error", (error) =>
      resolve({ code: null, signal: null, error }),
    );
  });
  const removeHandlers = installSignalHandlers(
    deps.signals ?? process,
    stop,
    deps.exit ?? ((code) => process.exit(code)),
  );
  try {
    await waitForServer(options.readyUrl, {
      timeoutMs: options.readyTimeoutMs,
      fetchTimeoutMs: options.fetchTimeoutMs,
      pollMs: options.pollMs,
      exited,
      stderrTail: () => tail.trim(),
    });
    return await fn();
  } finally {
    removeHandlers();
    stop();
  }
}
